import { piwCli } from "pi-experiment-ops";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, realpathSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { dataDir } from "./config.js";
import { HttpError, type Runtime } from "./runtime.js";
import { id } from "./store.js";

export class Workflows {
  private processes = new Map<string, ChildProcess>();
  private cancelled = new Set<string>();
  constructor(readonly runtime: Runtime) {
    const rows = runtime.store.db.prepare("SELECT key,value FROM metadata WHERE key LIKE 'workflow:%'").all() as { key: string; value: string }[];
    for (const row of rows) {
      const record = JSON.parse(row.value);
      if (record.status !== "running") continue;
      record.status = "interrupted";
      const runs = join(dirname(record.definition), "runs");
      if (!record.run_dir && existsSync(runs)) record.run_dir = readdirSync(runs).sort().map(name => join(runs, name)).findLast(path => existsSync(join(path, "ledger.json")));
      runtime.store.set(row.key, JSON.stringify(record));
    }
  }
  list(): string[] {
    const root = join(this.runtime.workspace, "workflows");
    if (!existsSync(root)) return [];
    const resolvedRoot = realpathSync(root);
    return readdirSync(root, { withFileTypes: true }).filter(entry => {
      if (!entry.isDirectory()) return false;
      const definition = join(root, entry.name, "steps.yaml");
      return existsSync(definition) && statSync(definition).isFile() && realpathSync(definition).startsWith(resolvedRoot + "/");
    }).map(entry => entry.name).sort();
  }
  async run(input: string, workflow?: string, resume?: string) {
    this.runtime.requireBuild();
    if (!input.trim() && !resume) throw new HttpError(400, "Workflow input is required");
    const workflowId = id();
    const definitions = join(dataDir(this.runtime.workspace), "graph/definitions");
    let definition: string;
    let args: string[];
    if (resume) {
      const saved = this.runtime.store.get(`workflow:${resume}`);
      if (!saved) throw new HttpError(404, "Unknown workflow run");
      const record = JSON.parse(saved);
      if (record.sessionId !== this.runtime.snapshot.session_id) throw new HttpError(404, "Workflow belongs to another session");
      if (record.status === "completed") return record;
      definition = record.definition;
      if (!record.run_dir) throw new HttpError(409, "This run has no resumable runner state");
      args = ["resume", definition, basename(record.run_dir), "--json"];
    } else {
      if (typeof workflow !== "string" || !workflow) throw new HttpError(400, "Workflow selection is required");
      if (!this.list().includes(workflow)) throw new HttpError(400, "Unknown workflow");
      const source = realpathSync(join(this.runtime.workspace, "workflows", workflow));
      if (!source.startsWith(realpathSync(join(this.runtime.workspace, "workflows")) + "/")) throw new HttpError(400, "Workflow is outside configured roots");
      const target = join(definitions, workflowId);
      mkdirSync(definitions, { recursive: true });
      cpSync(source, target, { recursive: true, filter: file => !file.includes("/runs/") && !file.endsWith("/runs") });
      definition = join(target, "steps.yaml");
      args = ["run", definition, "--input", input, "--json", "--no-cache"];
    }
    const key = `workflow:${workflowId}`;
    const record: any = { id: workflowId, sessionId: this.runtime.snapshot.session_id, definition, status: "running" };
    this.runtime.store.set(key, JSON.stringify(record));
    this.runtime.startJob(key, "pi-graph", "primary");
    const env = { ...process.env, PI_GRAPH_ROOTS: definitions, EAA_PI_CAPTURE_DIR: join(dataDir(this.runtime.workspace), "children", this.runtime.snapshot.session_id), EAA_PI_WORKFLOW_RUN: workflowId };
    const child = spawn(piwCli, args, { cwd: this.runtime.workspace, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    this.processes.set(workflowId, child);
    let stdout = "", stderr = "";
    child.stdout!.on("data", chunk => { stdout += chunk; });
    child.stderr!.on("data", chunk => { stderr = (stderr + chunk).slice(-32_000); });
    child.on("error", error => { stderr += String(error); });
    child.on("close", code => {
      this.processes.delete(workflowId);
      let result: any = {};
      try { result = JSON.parse(stdout); } catch { /* Interrupted/startup failures have no JSON summary. */ }
      record.status = this.cancelled.delete(workflowId) ? "cancelled" : code === 0 && result.ok ? "completed" : "failed";
      Object.assign(record, result);
      record.stderr = stderr;
      this.runtime.store.set(key, JSON.stringify(record));
      this.runtime.finishJob(key, record.status, JSON.stringify({ ...result, error: result.error || stderr || undefined }));
      this.runtime.log("workflow", `${workflowId}: ${record.status}`);
    });
    return record;
  }
  cancel(workflowId: string) {
    const child = this.processes.get(workflowId);
    if (!child?.pid) throw new HttpError(404, "Workflow is not running");
    this.cancelled.add(workflowId);
    process.kill(-child.pid, "SIGTERM");
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, 3000);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
    return { ok: true };
  }
  async close() {
    const pending = [...this.processes.entries()].map(([workflowId, child]) => {
      const done = new Promise<void>(resolve => child.once("close", () => resolve()));
      this.cancel(workflowId);
      return done;
    });
    await Promise.all(pending);
  }
}
