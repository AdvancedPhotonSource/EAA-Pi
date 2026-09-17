import { useEffect, useState } from "react";
import type { ToolExecutionQueueEntry } from "./types";

async function post(path: string, body: unknown = {}) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

export function RuntimeControls({ planMode, jobs, onChanged }: { planMode: boolean; jobs: ToolExecutionQueueEntry[]; onChanged: () => void }) {
  const [sessions, setSessions] = useState<{ id: string; name?: string; firstMessage?: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [task, setTask] = useState("A toy dataset with three measurements");
  const [runs, setRuns] = useState<{ id: string; status: string; run_dir?: string }[]>([]);
  const [children, setChildren] = useState<{ id: string }[]>([]);
  const [error, setError] = useState("");
  const refresh = async () => {
    const [sessionResponse, workflowResponse, childResponse] = await Promise.all([fetch("/api/sessions"), fetch("/api/workflows"), fetch("/api/subagents")]);
    const s = await sessionResponse.json();
    setSessions(s.sessions ?? []);
    setSelected(current => current || s.active);
    setRuns((await workflowResponse.json()).runs ?? []);
    setChildren((await childResponse.json()).asyncSnapshot?.runs ?? []);
  };
  useEffect(() => { void refresh().catch(() => {}); }, [jobs.length]);
  const run = async (path: string, body: unknown = {}) => {
    setError("");
    try { await post(path, body); await refresh(); onChanged(); }
    catch (error) { setError(String(error instanceof Error ? error.message : error)); }
  };
  return <details className="eaa-runtime-controls" onToggle={(event) => { if (event.currentTarget.open) void refresh().catch(() => {}); }}>
    <summary>Sessions & tools</summary>
    <div className="eaa-runtime-popover">
      <label>Session<select aria-label="Session" value={selected} onChange={event => setSelected(event.target.value)}>
        {sessions.map(s => <option key={s.id} value={s.id}>{s.name || s.firstMessage?.slice(0, 35) || s.id.slice(0, 12)}</option>)}
      </select></label>
      <div className="eaa-runtime-row">
        <button onClick={() => void run("/api/sessions", { action: "new" })}>New session</button>
        <button disabled={!selected} onClick={() => void run("/api/sessions", { action: "resume", session_id: selected })}>Resume</button>
        <button disabled={!selected} onClick={() => void run("/api/sessions", { action: "branch", session_id: selected })}>Branch</button>
      </div>
      <label>Task<input aria-label="Workflow or reviewer task" value={task} onChange={event => setTask(event.target.value)} /></label>
      <div className="eaa-runtime-row">
        <button disabled={planMode} onClick={() => void run("/api/workflows/run", { input: task })}>Run toy workflow</button>
        <button disabled={planMode} onClick={() => void run("/api/subagents", { task })}>Launch reviewer</button>
        <button disabled={planMode} onClick={() => void run("/api/terminals")}>Open terminal</button>
      </div>
      <button onClick={() => void refresh().catch(error => setError(String(error)))}>Refresh runs</button>
      {runs.map(r => <div className="eaa-runtime-row" key={r.id}><span>Workflow {r.id.slice(0, 8)}: {r.status}</span>{r.run_dir && r.status !== "running" && <button disabled={planMode} onClick={() => void run("/api/workflows/resume", { id: r.id })}>Resume workflow</button>}</div>)}
      {children.map(c => <div className="eaa-runtime-row" key={c.id}><span>Child {c.id.slice(0, 8)}</span><button disabled={planMode} onClick={() => void run(`/api/subagents/${encodeURIComponent(c.id)}/steer`, { message: task })}>Send task</button><button onClick={() => void run(`/api/subagents/${encodeURIComponent(c.id)}/stop`)}>Stop child</button></div>)}
      {jobs.filter(j => !j.job_id.startsWith("tool:")).map(j => <div className="eaa-runtime-row" key={j.job_id}><span>{j.tool_name}: {j.status}</span><button onClick={() => void run(`/api/jobs/${encodeURIComponent(j.job_id)}/cancel`)}>Stop</button></div>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
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
