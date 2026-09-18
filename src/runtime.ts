import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { Type } from "typebox";
import {
  createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, initTheme,
  type AgentSession, type EventBus, type ExtensionContext,
} from "pi-experiment-ops/sdk";
import { agentDir, dataDir, sessionDir, migrateLegacySessions, adapterResources, configureEnvironment, loadConfig, type Config } from "./config.js";
import { Store, id, timestamp, type Snapshot, type Conversation, type Message } from "./store.js";

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const readers = ["read", "grep", "find", "ls", "pi_modes_plan_complete"];
export class Runtime extends EventEmitter {
  session!: AgentSession;
  bus!: EventBus;
  loader!: DefaultResourceLoader;
  settings!: SettingsManager;
  store: Store;
  config: Config;
  snapshot!: Snapshot;
  context?: ExtensionContext;
  busy = false;
  private transitioning = false;
  closing = false;
  extensions: string[] = [];
  mcpTools = new Map<string, string>();
  mcpStatus: any;
  private traceCount = 0;
  private poll?: NodeJS.Timeout;
  private offsets = new Map<string, number>();
  private approvals = new Map<string, { resolve: (value: boolean) => void; timer: NodeJS.Timeout }>();
  private unsubscribe?: () => void;
  private subagentIds = new Set<string>();
  private terminalIds = new Set<string>();
  private terminalReads = new Map<string, Promise<void>>();
  private polling = false;
  private buildTools: string[] = [];
  private childSessions = new Map<string, SessionManager>();
  private observedMessages = new Set<string>();

  constructor(readonly workspace: string) {
    super();
    this.store = new Store(workspace);
    this.config = loadConfig(workspace);
  }
  async start(manager?: SessionManager) {
    configureEnvironment(this.workspace);
    initTheme("dark", false);
    process.chdir(this.workspace);
    this.config = loadConfig(this.workspace);
    const sessions = sessionDir(this.workspace);
    migrateLegacySessions(this.workspace);
    let recent = this.store.get("activeSession");
    if (recent && dirname(recent) === join(dataDir(this.workspace), "agent/sessions")) recent = join(sessions, basename(recent));
    manager ??= recent && existsSync(recent) ? SessionManager.open(recent, sessions) : SessionManager.create(this.workspace, sessions, { id: this.store.get("activeSessionId") });
    this.store.set("activeSessionId", manager.getSessionId());
    process.env.EAA_PI_PARENT_SESSION = manager.getSessionId();
    this.snapshot = this.store.load(manager.getSessionId()) ?? {
      conversations: [{ id: "primary", label: "Main Agent", kind: "primary", messages: [] }], logs: [],
      status: "waiting_for_input", input_requested: true, interrupt_requested: false, plan_mode: false,
      plan_mode_available: true, tool_execution_queue: [], message_queue: [], session_id: manager.getSessionId(), sequence: 0,
      capabilities: { sessions: true, children: true, workflows: true, terminal_input: true, mcp_server_logs: false },
    };
    for (const conversation of this.snapshot.conversations) {
      conversation.pending_approval = null;
      if (conversation.status === "running") conversation.status = "interrupted";
      if (conversation.terminal?.status === "running") conversation.terminal.status = "interrupted";
    }
    for (const job of this.snapshot.tool_execution_queue) {
      this.snapshot.message_queue.push({ ...job, status: "interrupted", content: "Host restarted; execution was not resumed.", queued_at: timestamp() });
    }
    this.snapshot.tool_execution_queue = [];
    this.snapshot.status = "waiting_for_input";
    this.snapshot.input_requested = true;
    this.snapshot.interrupt_requested = false;
    this.bus = createEventBus();
    this.bindBus();
    this.settings = SettingsManager.create(this.workspace, agentDir(this.workspace));
    const paths = adapterResources();
    this.loader = new DefaultResourceLoader({
      cwd: this.workspace, agentDir: agentDir(this.workspace), settingsManager: this.settings, eventBus: this.bus,
      noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      additionalExtensionPaths: paths.extensions,
      additionalSkillPaths: paths.skills,
      systemPrompt: "You are EAA, an assistant powered by Pi. Use the available tools for the user's work. Delegate with subagent when useful. Use process for background scripts and interactive_shell in background dispatch mode for persistent terminals. Keep responses concise. The installed workflow is a toy demonstration, not an instrument-control workflow.",
    });
    await this.loader.reload();
    const loaded = this.loader.getExtensions();
    if (loaded.errors.length) throw new Error(loaded.errors.map(e => `${e.path}: ${e.error}`).join("\n"));
    this.extensions = loaded.extensions.map(e => e.path);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir(this.workspace), "auth.json"), modelsPath: join(agentDir(this.workspace), "models.json"), allowModelNetwork: false });
    const model = modelRuntime.getModel(this.config.provider || "eaa-demo", this.config.model || "toy");
    const created = await createAgentSession({
      cwd: this.workspace, agentDir: agentDir(this.workspace), resourceLoader: this.loader, settingsManager: this.settings,
      sessionManager: manager, modelRuntime, model: model as any, thinkingLevel: "off",
      customTools: [{ name: "eaa_confirm", label: "Confirm", description: "Ask the user to approve a proposed action", parameters: Type.Object({ message: Type.String() }), executionMode: "sequential",
        execute: async (_id, params) => ({ content: [{ type: "text", text: await this.confirm("Approval", (params as { message: string }).message) ? "Approved" : "Denied" }], details: {} }) }],
    });
    this.session = created.session;
    this.session.agent.toolExecution = "sequential";
    this.unsubscribe = this.session.subscribe(event => this.agentEvent(event, "primary"));
    const ui = this.session.extensionRunner.createContext().ui;
    await this.session.bindExtensions({
      mode: "rpc",
      uiContext: { ...ui,
        notify: (message, level = "info") => this.log("extension", message, level),
        confirm: (title, message) => this.confirm(title, message),
        select: async (title, options) => await this.confirm(title, `Choose ${options[0]}?`) ? options[0] : options.find(option => /deny|cancel|stay/i.test(option)),
      },
      onError: error => this.log("extension", JSON.stringify(error), "error"),
    });
    this.buildTools = this.session.getActiveToolNames();
    const wasPlan = this.snapshot.plan_mode;
    if (wasPlan) await this.applyMode(true);
    this.conversation("primary").messages = this.session.messages.map(message => this.convert(message));
    if (this.session.sessionFile) this.store.set("activeSession", this.session.sessionFile);
    this.poll = setInterval(() => void this.pollChildren(), 250);
    this.poll.unref();
    this.publish("snapshot", this.snapshot);
  }
  private bindBus() {
    this.bus.on("eaa:context", (ctx: any) => {
      this.context = ctx;
      ctx.ui.notify = (message: string, level: string = "info") => this.log("extension", message, level);
      ctx.ui.confirm = (title: string, message: string) => this.confirm(title, message);
      ctx.ui.setStatus = (_key: string, _value: string) => {};
    });
    this.bus.on("subagent:async-complete", (event: any) => {
      const runId = event.runId ?? event.id;
      if (!runId) return;
      this.subagentIds.delete(runId);
      const status = event.stopped || event.status === "stopped" ? "cancelled" : event.exitCode || ["failed", "rejected", "partial"].includes(event.status) ? "failed" : "completed";
      this.finishJob(`subagent:${runId}`, status, event.summary || event.output || `Subagent ${status}`);
    });
    this.bus.on("eaa:mcp-tool", (tool: any) => this.mcpTools.set(tool.name, tool.server));
    this.bus.on("pi-mcp-adapter/status/v1", (status: any) => { this.mcpStatus = status; this.log("mcp", JSON.stringify(status)); });
    this.bus.on("processes:started", (process: any) => {
      const conversation = this.conversation(`process:${process.id}`, process.name, "bash");
      conversation.status = "running";
      conversation.terminal = { command: process.command, status: "running", chunks: [], sequence: 0 };
      this.startJob(`process:${process.id}`, "process", conversation.id);
      this.publish("conversation.created", { conversation });
    });
    this.bus.on("processes:output_changed", (event: any) => {
      if (event.appendedText) this.terminalOutput(`process:${event.id}`, event.appendedText.map((part: any) => ({ stream: part.type, text: part.text })));
    });
    this.bus.on("processes:ended", (process: any) => {
      const conversation = this.conversation(`process:${process.id}`, process.name, "bash");
      conversation.status = this.closing ? "interrupted" : process.status === "killed" ? "cancelled" : process.success ? "completed" : "failed";
      if (conversation.terminal) { conversation.terminal.status = conversation.status; conversation.terminal.returncode = process.exitCode; conversation.terminal.sequence++; }
      this.finishJob(`process:${process.id}`, conversation.status, `Process ${process.name} ${conversation.status}`);
      this.publish("terminal.finished", { conversation_id: conversation.id, terminal: conversation.terminal });
    });
    this.bus.on("interactive-shell:update", (event: any) => this.log("terminal", JSON.stringify(event)));
    this.bus.on("interactive-shell:transfer", (event: any) => this.log("terminal", JSON.stringify(event)));
  }
  publish(type: string, payload: unknown) {
    this.snapshot.sequence++;
    this.store.save(this.snapshot);
    this.emit("event", { type, payload, sequence: this.snapshot.sequence });
  }
  log(source: string, message: string, level = "info") {
    const log = { id: id(), timestamp: timestamp(), source, message, level };
    this.snapshot.logs.push(log);
    this.snapshot.logs = this.snapshot.logs.slice(-500);
    this.publish("log.created", { log });
  }
  conversation(conversationId: string, label = conversationId, kind = "subagent"): Conversation {
    let conversation = this.snapshot.conversations.find(c => c.id === conversationId);
    if (!conversation) {
      conversation = { id: conversationId, label, kind, parent_id: "primary", status: "running", messages: [] };
      this.snapshot.conversations.push(conversation);
      this.publish("conversation.created", { conversation });
    }
    return conversation;
  }
  convert(message: any): Message {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const content = typeof message.content === "string" ? message.content : blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const images = blocks.filter((b: any) => b.type === "image").map((b: any) => this.store.artifact(Buffer.from(b.data, "base64"), b.mimeType));
    const calls = blocks.filter((b: any) => b.type === "toolCall").map((b: any) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.arguments) } }));
    return { id: `${message.role}:${message.timestamp ?? 0}:${message.toolCallId ?? ""}`, role: message.role === "toolResult" ? "tool" : message.role, content, images, tool_calls: calls.length ? calls : undefined, timestamp: new Date(message.timestamp || Date.now()).toISOString() };
  }
  message(message: Message, conversationId = "primary") {
    const conversation = this.conversation(conversationId);
    const index = conversation.messages.findIndex(m => m.id === message.id);
    if (index < 0) conversation.messages.push(message); else conversation.messages[index] = message;
    this.publish("message.created", { conversation_id: conversationId, message });
  }
  agentEvent(event: any, conversationId: string) {
    if (["message_start", "message_update", "message_end"].includes(event.type) && event.message) this.message(this.convert(event.message), conversationId);
    if (event.type === "tool_execution_start") {
      this.startJob(`tool:${event.toolCallId}`, event.toolName, conversationId);
      this.log("tool", `${event.toolName}: started`);
    }
    if (event.type === "tool_execution_end") {
      this.finishJob(`tool:${event.toolCallId}`, event.isError ? "failed" : "completed", `${event.toolName} ${event.isError ? "failed" : "completed"}`);
      if (event.toolName === "interactive_shell" && event.result?.details?.sessionId) this.trackTerminal(event.result.details.sessionId, event.result.details.command || "Interactive shell");
      if (event.toolName === "subagent") {
        const runId = event.result?.details?.asyncId ?? event.result?.details?.runId ?? event.result?.details?.id;
        if (runId) { this.subagentIds.add(runId); this.startJob(`subagent:${runId}`, "subagent", "primary"); }
      }
    }
    if (event.type === "agent_start" && conversationId === "primary") this.setStatus("processing");
    if (event.type === "agent_end" && conversationId === "primary") this.setStatus("waiting_for_input");
    if (event.type === "agent_end" && conversationId !== "primary" && !event.willRetry) {
      this.conversation(conversationId).status = event.messages?.some((m: any) => m.stopReason === "error" || m.stopReason === "aborted") ? "failed" : "completed";
      this.publish("conversation.terminated", { conversation: this.conversation(conversationId) });
    }
  }
  setStatus(status: string) {
    this.snapshot.status = status;
    this.snapshot.input_requested = status === "waiting_for_input" || status === "waiting_for_approval";
    this.publish("status.changed", this.snapshot);
  }
  startJob(jobId: string, name: string, conversationId: string) {
    if (!this.snapshot.tool_execution_queue.some(j => j.job_id === jobId)) this.snapshot.tool_execution_queue.push({ job_id: jobId, tool_name: name, conversation_id: conversationId, conversation_label: this.conversation(conversationId).label, status: "executing", timestamp: timestamp() });
    this.publish("queue.changed", this.snapshot);
  }
  finishJob(jobId: string, status: string, content: string) {
    const job = this.snapshot.tool_execution_queue.find(j => j.job_id === jobId);
    this.snapshot.tool_execution_queue = this.snapshot.tool_execution_queue.filter(j => j.job_id !== jobId);
    if (job && this.store.completeOnce(this.snapshot.session_id + ":" + jobId)) {
      this.snapshot.message_queue.push({ ...job, status, content, queued_at: timestamp() });
      this.snapshot.message_queue = this.snapshot.message_queue.slice(-200);
    }
    this.publish("queue.changed", this.snapshot);
  }
  activeWork(): string[] {
    return [...new Set([
      ...(this.busy || this.session?.isStreaming ? ["primary agent"] : []),
      ...(this.transitioning ? ["session transition"] : []),
      ...this.snapshot.tool_execution_queue.map(j => j.job_id),
      ...this.snapshot.conversations.filter(c => c.id !== "primary" && c.status === "running").map(c => c.id),
      ...this.terminalIds,
    ])];
  }
  requireBuild() { if (this.transitioning) throw new HttpError(409, "Session transition in progress"); if (this.snapshot.plan_mode) throw new HttpError(409, "This action is disabled in plan mode"); }
  requireIdle() { const active = this.activeWork(); if (active.length) throw new HttpError(409, `Finish or stop active work first: ${active.join(", ")}`); }
  async mode(plan: boolean) {
    this.requireIdle();
    this.transitioning = true;
    try { await this.applyMode(plan); } finally { this.transitioning = false; }
  }
  private async applyMode(plan: boolean) {
    this.bus.emit("eaa:mode", { plan });
    await this.session.prompt(`/mode ${plan ? "plan" : "build"}`);
    this.snapshot.plan_mode = plan;
    this.session.setActiveToolsByName(plan ? this.session.getAllTools().map(t => t.name).filter(n => readers.includes(n)) : this.buildTools);
    this.publish("status.changed", this.snapshot);
  }
  async input(content: string, plan?: boolean, images: string[] = []) {
    if (this.transitioning) throw new HttpError(409, "Session transition in progress");
    if (!content.trim() && !images.length) throw new HttpError(400, "No content provided");
    if (this.busy || this.session.isStreaming) throw new HttpError(409, "The primary agent is still responding");
    if (plan !== undefined && plan !== this.snapshot.plan_mode) await this.mode(plan);
    if (/^\/mode\b/.test(content.trim())) {
      const mode = content.trim().split(/\s+/)[1];
      if (mode !== "plan" && mode !== "build") throw new HttpError(400, "Use /mode plan or /mode build");
      await this.mode(mode === "plan"); return;
    }
    // Route application lifecycle through endpoints so extensions are always rebound.
    if (/^\/(new|resume|fork|tree|reload)\b/.test(content.trim())) throw new HttpError(400, "Use the session controls for this operation");
    if (this.snapshot.plan_mode && (content.trim().startsWith("!") || content.trim().startsWith("/"))) throw new HttpError(409, "Shell and extension commands are disabled in plan mode");
    if (!this.config.provider || !this.config.model) throw new HttpError(400, "Configure defaultProvider/defaultModel in .pi-experiment-ops/agent/settings.json and custom endpoints in .pi-experiment-ops/agent/models.json, or launch eaa-pi demo");
    const imageBlocks = images.map(path => {
      const artifact = this.store.resolveArtifact(path);
      if (!artifact) throw new HttpError(400, "Unknown image attachment");
      return { type: "image" as const, data: readFileSync(artifact.path).toString("base64"), mimeType: artifact.mime };
    });
    this.busy = true;
    this.setStatus("processing");
    const action = content.trim().startsWith("!") ? this.session.executeBash(content.trim().slice(1)) : this.session.prompt(content, { images: imageBlocks });
    void action.catch(error => this.log("agent", String(error), "error")).finally(() => {
      this.busy = false;
      this.snapshot.interrupt_requested = false;
      this.setStatus("waiting_for_input");
    });
  }
  async interrupt() {
    this.snapshot.interrupt_requested = true;
    this.publish("interrupt.requested", this.snapshot);
    for (const approvalId of this.approvals.keys()) this.approve(approvalId, false);
    await this.session.abort();
    this.session.abortBash();
    this.snapshot.interrupt_requested = false;
    this.publish("interrupt.cleared", this.snapshot);
  }
  confirm(title: string, message: string): Promise<boolean> {
    const approvalId = id();
    const pending = { id: approvalId, conversation_id: "primary", tool_name: title, arguments: { message }, requested_at: timestamp(), timeout_seconds: 120 };
    this.conversation("primary").pending_approval = pending;
    this.setStatus("waiting_for_approval");
    this.publish("approval.requested", pending);
    return new Promise(resolve => {
      const timer = setTimeout(() => this.approve(approvalId, false), 120_000);
      this.approvals.set(approvalId, { resolve, timer });
    });
  }
  approve(approvalId: string, approved: boolean) {
    const request = this.approvals.get(approvalId);
    if (!request) throw new HttpError(409, "No matching approval request is pending");
    clearTimeout(request.timer);
    this.approvals.delete(approvalId);
    this.conversation("primary").pending_approval = null;
    request.resolve(approved);
    this.setStatus(this.busy || this.session.isStreaming ? "processing" : "waiting_for_input");
    this.publish("snapshot", this.snapshot);
  }
  rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const requestId = id();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`Subagent ${method} request timed out`)); }, 30_000);
      const off = this.bus.on(`subagents:rpc:v1:reply:${requestId}`, (reply: any) => {
        clearTimeout(timer); off();
        if (reply.success) resolve(reply.data); else reject(new Error(reply.error?.message || "Subagent request failed"));
      });
      this.bus.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    });
  }
  async spawnChild(task: string, agent = "reviewer") {
    this.requireBuild();
    const result = await this.rpc("spawn", { agent, task, cwd: this.workspace, model: `${this.config.provider}/${this.config.model}` });
    const runId = result.details?.asyncId ?? result.details?.runId ?? result.details?.id;
    if (runId) { this.subagentIds.add(runId); this.startJob(`subagent:${runId}`, "subagent", "primary"); }
    return result;
  }
  async childAction(runId: string, action: "steer" | "stop", message?: string) {
    if (action === "steer") this.requireBuild();
    return this.rpc(action, { id: runId, message });
  }
  busRequest(channel: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${channel} unavailable`)), 10_000);
      this.bus.emit(channel, { ...params, reply: (result: any) => { clearTimeout(timer); resolve(result); } });
    });
  }
  async startProcess(command: string) {
    this.requireBuild();
    const result = await this.busRequest("processes:command:start", { command, name: "WebUI process", cwd: this.workspace });
    if (!result.ok) throw new HttpError(400, result.error);
    return result;
  }
  async terminal(params: Record<string, unknown>, readOnly = false): Promise<any> {
    if (!readOnly) this.requireBuild();
    return new Promise((resolve, reject) => this.bus.emit("eaa:terminal", { id: id(), params, resolve, reject }));
  }
  trackTerminal(terminalId: string, command: string) {
    if (this.terminalIds.has(terminalId)) return;
    this.terminalIds.add(terminalId);
    const conversation = this.conversation(`terminal:${terminalId}`, terminalId, "bash");
    conversation.status = "running";
    conversation.terminal = { command, status: "running", chunks: [], sequence: 0 };
    this.startJob(`terminal:${terminalId}`, "interactive_shell", conversation.id);
    this.publish("conversation.created", { conversation });
  }
  async openTerminal(command = "bash --noprofile --norc") {
    const result = await this.terminal({ command, mode: "dispatch", background: true, handsFree: { autoExitOnQuiet: false } });
    if (result.details?.sessionId) this.trackTerminal(result.details.sessionId, command);
    else throw new Error(result.content?.[0]?.text || "Terminal did not start");
    return result;
  }
  terminalOutput(conversationId: string, chunks: { stream: string; text: string }[]) {
    const terminal = this.conversation(conversationId).terminal;
    if (!terminal || !chunks.length) return;
    terminal.chunks.push(...chunks);
    terminal.chunks = terminal.chunks.slice(-2000);
    terminal.sequence++;
    this.publish("terminal.output.appended", { conversation_id: conversationId, sequence: terminal.sequence, chunks });
  }
  async pollChildren() {
    if (this.polling || this.closing) return;
    this.polling = true;
    try {
      const trace = join(dataDir(this.workspace), "mcp-trace.jsonl");
      if (existsSync(trace)) {
        const lines = readFileSync(trace, "utf8").trimEnd().split("\n");
        if (lines.length < this.traceCount) this.traceCount = 0;
        for (const line of lines.slice(this.traceCount)) if (line) this.log("mcp-trace", line);
        this.traceCount = lines.length;
      }
      const root = join(dataDir(this.workspace), "children", this.snapshot.session_id);
      if (existsSync(root)) for (const file of readdirSync(root).filter(f => f.endsWith(".jsonl"))) {
        const path = join(root, file);
        const lines = readFileSync(path, "utf8").split("\n");
        const consumed = this.offsets.get(path) ?? 0;
        for (let index = consumed; index < lines.length - 1; index++) {
          if (!lines[index]) continue;
          let event: any;
          try { event = JSON.parse(lines[index]); } catch { this.log("observer", `Ignoring an incomplete child event in ${file}`, "warning"); continue; }
          const childId = basename(file, ".jsonl");
          if (event.type === "eaa_child") {
            const conversation = this.conversation(childId, event.label || `Child ${childId.slice(0, 8)}`, event.kind || "subagent");
            this.store.set(`child:${childId}`, JSON.stringify({ parent: this.snapshot.session_id, run: event.run, sessionFile: event.sessionFile }));
            if (!this.childSessions.has(childId)) {
              const saved = this.store.get(`child-session:${childId}`);
              const manager = saved && existsSync(saved) ? SessionManager.open(saved) : SessionManager.create(this.workspace, join(dataDir(this.workspace), "agent/children"));
              if (!saved) manager.appendCustomEntry("eaa-parent", { primarySession: this.snapshot.session_id, childId, workflowRun: event.run });
              this.childSessions.set(childId, manager);
              this.store.set(`child-session:${childId}`, manager.getSessionFile()!);
              for (const entry of manager.getEntries()) if (entry.type === "message") this.observedMessages.add(childId + ":" + this.convert(entry.message).id);
            }

          }
          else if (event.type === "eaa_child_stopped") {
            const conversation = this.conversation(childId);
            if (conversation.status === "running") conversation.status = "interrupted";
            this.publish("conversation.terminated", { conversation });
          } else {
            this.agentEvent(event, childId);
            if (event.type === "message_end" && event.message) {
              const key = childId + ":" + this.convert(event.message).id;
              const manager = this.childSessions.get(childId);
              if (manager && !this.observedMessages.has(key)) {
                manager.appendMessage(event.message);
                this.observedMessages.add(key);
                const sessionFile = manager.getSessionFile();
                if (sessionFile && existsSync(sessionFile)) this.bus.emit("eaa:archive", { sessionFile });
              }
            }
          }
        }
        this.offsets.set(path, lines.length - 1);
      }
      for (const terminalId of this.terminalIds) {
        if (!this.terminalReads.has(terminalId)) {
          const read = this.readTerminal(terminalId).finally(() => this.terminalReads.delete(terminalId));
          this.terminalReads.set(terminalId, read);
        }
      }
    } catch (error) { this.log("observer", String(error), "error"); }
    finally { this.polling = false; }
  }
  private async readTerminal(terminalId: string) {
    try {
      const result = await this.terminal({ sessionId: terminalId, incremental: true }, true);
      if (!this.terminalIds.has(terminalId)) return;
      const details = result.details ?? {};
      if (details.output) this.terminalOutput(`terminal:${terminalId}`, [{ stream: "stdout", text: details.output }]);
      if (["exited", "killed", "ended", "completed"].includes(details.status) || details.exitCode != null || details.error === "session_not_found") this.terminalFinished(terminalId, details.status === "killed" ? "cancelled" : details.exitCode ? "failed" : "completed");
    } catch (error) { if (!this.closing) this.log("terminal", String(error), "error"); }
  }
  terminalFinished(terminalId: string, status = "completed") {
    this.terminalIds.delete(terminalId);
    const conversation = this.conversation(`terminal:${terminalId}`);
    conversation.status = status;
    if (conversation.terminal) { conversation.terminal.status = status; conversation.terminal.sequence++; }
    this.finishJob(`terminal:${terminalId}`, status, `Terminal ${status}`);
    this.publish("terminal.finished", { conversation_id: conversation.id, terminal: conversation.terminal });
  }
  async cancelJob(jobId: string) {
    if (jobId.startsWith("process:")) return this.busRequest("processes:command:kill", { id: jobId.slice(8), timeoutMs: 3000 });
    if (jobId.startsWith("terminal:")) { await this.terminal({ sessionId: jobId.slice(9), kill: true }, true); this.terminalFinished(jobId.slice(9), "cancelled"); return { ok: true }; }
    if (jobId.startsWith("subagent:")) return this.childAction(jobId.slice(9), "stop");
    throw new HttpError(404, "Unknown job");
  }
  async sessions() { return SessionManager.list(this.workspace, sessionDir(this.workspace)); }
  async replaceSession(action: string, sessionId?: string) {
    this.requireIdle();
    this.transitioning = true;
    try {
      const directory = sessionDir(this.workspace);
      let manager: SessionManager;
      if (action === "new") manager = SessionManager.create(this.workspace, directory);
      else {
        const target = (await this.sessions()).find(s => s.id === sessionId);
        if (!target) throw new HttpError(404, "Unknown session");
        manager = action === "branch" ? SessionManager.forkFrom(target.path, this.workspace, directory) : SessionManager.open(target.path, directory);
      }
      await this.stopSession();
      this.closing = false;
      this.offsets.clear();
      this.childSessions.clear();
      this.observedMessages.clear();
      this.subagentIds.clear();
      await this.start(manager);
    } finally { this.transitioning = false; }
  }
  async stopSession() {
    clearInterval(this.poll);
    for (const approvalId of this.approvals.keys()) this.approve(approvalId, false);
    for (const runId of this.subagentIds) {
      try { await this.rpc("stop", { id: runId }); } catch { /* Already finished. */ }
    }
    this.subagentIds.clear();
    for (const terminalId of [...this.terminalIds]) this.terminalFinished(terminalId, "interrupted");
    while (this.polling) await new Promise(resolve => setTimeout(resolve, 10));
    await this.session?.abort();
    if (this.session) {
      await this.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      await Promise.all(this.terminalReads.values());
      this.terminalIds.clear();
      this.unsubscribe?.();
      this.session.dispose();
    }
    await this.settings?.flush();
  }
  async close() {
    this.closing = true;
    await this.stopSession();
    this.store.save(this.snapshot);
    this.store.close();
  }
}
