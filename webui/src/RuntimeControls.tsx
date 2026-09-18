import { useEffect, useState } from "react";
import { MessageCircle, Plus, Play, RotateCcw, GitBranch, Terminal, Users, FileText, RefreshCw } from "lucide-react";
import type { ToolExecutionQueueEntry } from "./types";

async function post(path: string, body: unknown = {}) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function RuntimeControls({ planMode, jobs, onChanged, onExpandedChange }: { planMode: boolean; jobs: ToolExecutionQueueEntry[]; onChanged: () => void; onExpandedChange: (expanded: boolean) => void }) {
  const [sessions, setSessions] = useState<{ id: string; name?: string; firstMessage?: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [workflow, setWorkflow] = useState("");
  const [task, setTask] = useState("");
  const [runs, setRuns] = useState<{ id: string; status: string; run_dir?: string }[]>([]);
  const [children, setChildren] = useState<{ id: string }[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => {
    const [sessionResponse, workflowResponse, childResponse] = await Promise.all([fetch("/api/sessions"), fetch("/api/workflows"), fetch("/api/subagents")]);
    const s = await sessionResponse.json();
    setSessions(s.sessions ?? []);
    setSelected(current => current || s.active);
    const w = await workflowResponse.json();
    setWorkflows(w.workflows ?? []);
    setWorkflow(current => (w.workflows ?? []).includes(current) ? current : "");
    setRuns(w.runs ?? []);
    setChildren((await childResponse.json()).asyncSnapshot?.runs ?? []);
  };
  useEffect(() => { void refresh().catch(() => {}); }, [jobs.length]);
  const run = async (path: string, body: unknown = {}) => {
    setError("");
    try { await post(path, body); await refresh(); onChanged(); }
    catch (error) { setError(String(error instanceof Error ? error.message : error)); }
  };
  return <aside className="eaa-runtime-controls" id="runtime-panel" popover="auto" aria-label="Sessions and tools" onToggle={event => {
    const expanded = event.newState === "open";
    onExpandedChange(expanded);
    if (expanded) void refresh().catch(error => setError(String(error)));
  }}>
    <div className="eaa-runtime-title">Sessions & tools</div>
    <div className="eaa-runtime-content">
      <section className="eaa-runtime-section" aria-label="Sessions">
        <div className="eaa-runtime-heading"><h2>Sessions</h2><button className="eaa-runtime-primary" onClick={() => void run("/api/sessions", { action: "new" })}><Plus size={14} />New session</button></div>
        <div className="eaa-session-list" role="group" aria-label="Select session">
          {sessions.map(s => <button className={`eaa-session-card${selected === s.id ? " is-selected" : ""}`} key={s.id} aria-pressed={selected === s.id} onClick={() => setSelected(s.id)}>
            <MessageCircle size={17} /><span>{s.name || s.firstMessage?.slice(0, 35) || s.id.slice(0, 12)}</span>
          </button>)}
          {!sessions.length && <p className="eaa-runtime-empty">No saved sessions yet.</p>}
        </div>
        <div className="eaa-runtime-actions">
          <button disabled={!selected} onClick={() => void run("/api/sessions", { action: "resume", session_id: selected })}><RotateCcw size={14} />Resume</button>
          <button disabled={!selected} onClick={() => void run("/api/sessions", { action: "branch", session_id: selected })}><GitBranch size={14} />Branch</button>
        </div>
      </section>
      <section className="eaa-runtime-section" aria-label="Workflow controls">
        <h2>Workflow</h2>
        <label>Registered workflow<select aria-label="Workflow" value={workflow} onChange={event => setWorkflow(event.target.value)}>
          <option value="">{workflows.length ? "Select a workflow" : "No workflows available"}</option>
          {workflows.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <label>Task<textarea aria-label="Workflow or reviewer task" rows={3} value={task} onChange={event => setTask(event.target.value)} /></label>
        <div className="eaa-runtime-actions">
          <button disabled={planMode || !workflow} onClick={() => void run("/api/workflows/run", { input: task, workflow })}><Play size={14} />Run workflow</button>
          <button disabled={planMode} onClick={() => void run("/api/subagents", { task })}><Users size={14} />Launch reviewer</button>
          <button disabled={planMode} onClick={() => void run("/api/terminals")}><Terminal size={14} />Open terminal</button>
        </div>
      </section>
      <section className="eaa-runtime-section" aria-label="Recent runs">
        <div className="eaa-runtime-heading"><h2>Recent runs</h2><button className="eaa-runtime-refresh" aria-label="Refresh runs" title="Refresh runs" onClick={() => void refresh().catch(error => setError(String(error)))}><RefreshCw size={15} /></button></div>
        {!runs.length && <p className="eaa-runtime-empty">Your workflow runs will appear here.</p>}
        {runs.slice().reverse().map(r => <div className="eaa-run-card" key={r.id}>
          <div className="eaa-run-summary"><FileText size={17} /><span title={r.id}>Workflow {r.id.slice(0, 8)}</span><span className={`eaa-run-status status-${r.status}`}>{r.status}</span></div>
          {r.run_dir && r.status !== "running" && <button disabled={planMode} onClick={() => void run("/api/workflows/resume", { id: r.id })}><RotateCcw size={13} />Resume workflow</button>}
        </div>)}
      </section>
      {!!children.length && <section className="eaa-runtime-section"><h2>Reviewers</h2>
        {children.map(c => <div className="eaa-runtime-row" key={c.id}><span>Child {c.id.slice(0, 8)}</span><div className="eaa-runtime-actions"><button disabled={planMode} onClick={() => void run(`/api/subagents/${encodeURIComponent(c.id)}/steer`, { message: task })}>Send task</button><button onClick={() => void run(`/api/subagents/${encodeURIComponent(c.id)}/stop`)}>Stop child</button></div></div>)}
      </section>}
      {jobs.some(j => !j.job_id.startsWith("tool:")) && <section className="eaa-runtime-section"><h2>Active jobs</h2>
        {jobs.filter(j => !j.job_id.startsWith("tool:")).map(j => <div className="eaa-runtime-row" key={j.job_id}><span>{j.tool_name}: {j.status}</span><button onClick={() => void run(`/api/jobs/${encodeURIComponent(j.job_id)}/cancel`)}>Stop</button></div>)}
      </section>}
      {error && <p role="alert">{error}</p>}
    </div>
  </aside>;
}

export function TerminalControls({ conversationId, planMode }: { conversationId: string; planMode: boolean }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  if (!conversationId.startsWith("terminal:")) return null;
  return <form className="eaa-terminal-input" onSubmit={event => {
    event.preventDefault();
    void post(`/api/terminals/${encodeURIComponent(conversationId.slice(9))}/input`, { input }).then(() => { setInput(""); setError(""); }).catch(error => setError(error.message));
  }}>
    <input aria-label="Terminal input" placeholder="Shell input…" value={input} disabled={planMode} onChange={event => setInput(event.target.value)} />
    <button disabled={planMode}>Send</button>
    <button type="button" onClick={() => void post(`/api/jobs/${encodeURIComponent(conversationId)}/cancel`).catch(error => setError(error.message))}>Close terminal</button>
    {error && <span role="alert">{error}</span>}
  </form>;
}
