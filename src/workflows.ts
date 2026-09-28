import { workspacePaths } from "pi-experiment-ops";
import { cpSync, existsSync, realpathSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { HttpError, type Runtime } from "./runtime.js";
import { id } from "./store.js";

export class Workflows {
  private onComplete = (event: any) => this.complete(event);
  private runs = new Map<string, any>();
  private completions = new Map<string, any>();
  private cancelled = new Set<string>();
  constructor(readonly runtime: Runtime) {
    const rows = runtime.store.db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'workflow:%'").all() as { key: string; value: string }[];
    for (const row of rows) {
      const record = JSON.parse(row.value);
      if (record.status !== "running") continue;
      record.status = "interrupted";
      runtime.store.set(row.key, JSON.stringify(record));
    }
    runtime.on("subagentComplete", this.onComplete);
  }
  list(): string[] {
    const root = join(this.runtime.workspace, "workflows");
    if (!existsSync(root)) return [];
    const resolvedRoot = realpathSync(root);
    return readdirSync(root, { withFileTypes: true }).filter(entry => {
      if (!entry.isDirectory()) return false;
      const definition = join(root, entry.name, "workflow.mjs");
      return existsSync(definition) && statSync(definition).isFile() && realpathSync(definition).startsWith(resolvedRoot + "/");
    }).map(entry => entry.name).sort();
  }
  async run(input: string, workflow?: string, rerun?: string) {
    this.runtime.requireBuild();
    let source: string;
    if (rerun) {
      const saved = this.runtime.store.get(`workflow:${rerun}`);
      if (!saved) throw new HttpError(404, "Unknown workflow run");
      const previous = JSON.parse(saved);
      if (previous.sessionId !== this.runtime.snapshot.session_id) throw new HttpError(404, "Workflow belongs to another session");
      if (previous.status === "running") throw new HttpError(409, "Workflow is still running");
      if (previous.runner !== "pi-subagents") throw new HttpError(409, "Select a pi-subagents workflow to start a new run");
      source = dirname(previous.definition);
      input = previous.input;
      workflow = previous.workflow;
    } else {
      if (typeof workflow !== "string" || !workflow) throw new HttpError(400, "Workflow selection is required");
      if (!this.list().includes(workflow)) throw new HttpError(400, "Unknown workflow");
      source = realpathSync(join(this.runtime.workspace, "workflows", workflow));
      if (!source.startsWith(realpathSync(join(this.runtime.workspace, "workflows")) + "/")) throw new HttpError(400, "Workflow is outside configured roots");
    }
    if (!input.trim()) throw new HttpError(400, "Workflow input is required");
    const workflowId = id();
    const runDir = join(workspacePaths(this.runtime.workspace).dataDirectory, "workflows/runs", workflowId);
    mkdirSync(runDir, { recursive: true });
    const target = join(runDir, "definition");
    cpSync(source, target, { recursive: true, filter: file => file === source || !file.slice(source.length + 1).split("/").includes("runs") });
    const record: any = { id: workflowId, sessionId: this.runtime.snapshot.session_id, runner: "pi-subagents", workflow, input, definition: join(target, "workflow.mjs"), run_dir: runDir, status: "running", ...(rerun ? { previousRun: rerun } : {}) };
    const key = `workflow:${workflowId}`;
    this.runs.set(workflowId, record);
    this.runtime.store.set(key, JSON.stringify(record));
    this.runtime.startJob(key, "pi-subagents workflow", "primary");
    try {
      const reply = await this.runtime.busRequest("pi-ops:workflow", { definition: record.definition, params: { args: { input, outputDirectory: runDir }, cwd: runDir, context: "fresh" } }, 35000);
      if (reply.error) throw new Error(reply.error);
      const result = reply.result;
      record.runId = result.details?.asyncId ?? result.details?.runId;
      if (!record.runId) throw new Error(result.text || "Workflow launch returned no run ID");
      this.runtime.store.set(key, JSON.stringify(record));
      const completed = this.completions.get(record.runId);
      if (completed) this.complete(completed);
    } catch (error) {
      record.error = String(error);
      this.finish(record, "failed");
    }
    if (![...this.runs.values()].some(run => !run.runId)) this.completions.clear();
    return record;
  }
  private complete(event: any) {
    const record = [...this.runs.values()].find(run => run.runId === (event.runId ?? event.id));
    if (!record) {
      if ([...this.runs.values()].some(run => !run.runId)) this.completions.set(event.runId ?? event.id, event);
      return;
    }
    this.completions.delete(record.runId);
    record.result = event;
    const status = this.cancelled.delete(record.id) || event.stopped || (event.state ?? event.status) === "stopped" ? "cancelled" : event.success === false || event.exitCode || ["failed", "rejected", "partial"].includes(event.state ?? event.status) ? "failed" : "completed";
    this.finish(record, status);
  }
  private finish(record: any, status: string) {
    record.status = status;
    this.runs.delete(record.id);
    this.runtime.store.set(`workflow:${record.id}`, JSON.stringify(record));
    this.runtime.finishJob(`workflow:${record.id}`, status, record.error || JSON.stringify(record.result ?? {}));
    this.runtime.log("workflow", `${record.id}: ${status}`);
    this.runtime.emit("workflowComplete", record.id);
  }
  async cancel(workflowId: string) {
    const record = this.runs.get(workflowId);
    if (!record?.runId) throw new HttpError(404, "Workflow is not running");
    this.cancelled.add(workflowId);
    try { return await this.runtime.rpc("stop", { id: record.runId }); }
    catch (error) { this.cancelled.delete(workflowId); throw error; }
  }
  async close() {
    await Promise.all([...this.runs.values()].map(async record => {
      let timer: NodeJS.Timeout;
      let finished: (workflowId: string) => void;
      const done = new Promise<void>(resolve => {
        finished = workflowId => { if (workflowId === record.id) resolve(); };
        this.runtime.on("workflowComplete", finished);
        timer = setTimeout(() => { this.finish(record, "interrupted"); resolve(); }, 30000);
      });
      try { await this.cancel(record.id); await done; }
      finally { clearTimeout(timer!); this.runtime.off("workflowComplete", finished!); }
    }));
    this.runtime.off("subagentComplete", this.onComplete);
  }
}
