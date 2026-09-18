# Frontend and daily use

The interface preserves EAA's conversation area, conversation tabs, gallery, logs, tool viewer, and execution/completion panels. It connects to the same origin as the page.

## Chat, images, and approval

Enter a message in the composer. Pi streams replace the same message by stable ID as text arrives. Interrupt stops the primary agent's current response and bash execution. Background jobs have their own stop controls.

Use the attachment button or paste an image from the clipboard into the composer to upload PNG, JPEG, GIF, or WebP data. Uploaded bytes become durable gallery artifacts and Pi image blocks. Images returned by MCP tools are also registered in the gallery. The image endpoint serves only registered artifacts; arbitrary filesystem paths are rejected.

Approval cards offer approve/deny. Typing `yes` or `no` while a primary approval is pending also answers it. Interrupt and shutdown deny pending requests. An approval is a tool-level confirmation, not an operating-system sandbox.

The supported command suggestions are `/mode plan`, `/mode build`, `/skill:name`, and `/mcp`. Pi's other installed extension commands can be entered in build mode when compatible with a headless host. Use browser session controls for new/resume/branch, so the host can rebind subscriptions and policy settings.

## Sessions and conversation tabs

Open **Sessions & tools** to create a session, resume a listed session, or branch a session. Branch copies that Pi session's current history into a new primary session. Session replacement is rejected while primary generation, tools, child runs, workflows, processes, or terminals remain active; the response lists active work.

Primary sessions in the WebUI, `eaa-pi pi`, and the experiment-ops TUI share the default directory: `<workspace>/.pi-experiment-ops/agent/sessions/<encoded-workspace>/`. Use either interface to resume them, with only one interface using a given session at a time. TUI launches with an explicit `--session-dir` use that override instead. WebUI settings, child transcripts, and adapter SQLite state remain under `.eaa-pi`.

At WebUI or TUI startup, eaa-pi moves existing `.eaa-pi/agent/sessions/*.jsonl` transcripts and the old launcher's `<encoded-workspace>/*.jsonl` transcripts into the shared directory. The WebUI restores its active session there. Session IDs and WebUI metadata are preserved. If a destination file has different contents, startup reports a migration conflict and retains the source file. Stop both hosts before upgrading.

**Launch reviewer** starts pi-subagents' asynchronous reader agent with the task text. Child conversations appear as events arrive. **Refresh runs** lists upstream async run IDs; **Send task** delivers a steering message and **Stop child** requests cancellation. These controls use pi-subagents' public event-bus RPC and retain its ownership and acknowledgment checks. The main composer addresses the primary agent; the child control addresses the selected run.

Workflow agents appear in separate tabs while pi-graph runs them. Their launcher records JSON events even though pi-graph disables native child session persistence. Parent relationships and workflow run IDs are stored durably. Closing a conversation tab is a display action; it does not stop execution.

## Background processes and terminals

The model can launch a background script using the upstream `process` tool. Its output appears in a terminal-style tab, its state appears in the execution panel, and completion is recorded once. The primary conversation remains available while it runs. **Stop** in Sessions & tools cancels the corresponding job.

**Open terminal** starts a real persistent Bash PTY using pi-interactive-shell's headless background dispatch. The terminal input form sends a line; environment variables and current directory survive successive input requests. For example:

```bash
export EXAMPLE=retained
printf '%s\n' "$EXAMPLE"
```

**Close terminal** kills that PTY. Quiet auto-close is disabled. Output polling uses the upstream supported five-second minimum query interval; input is sent immediately. In build mode, the model can use the same upstream tool to start a supported persistent command, including an SSH client where installed and configured. Automated tests cover local Bash PTYs; remote SSH authentication and networking require separate deployment validation.

## Plan mode

The checkbox or `/mode plan` enters reader-only mode while idle. Read, grep, find, ls, and the mode completion tool remain available. Writers, bash, unknown tools, MCP tools, workflow dispatch, child launch, process launch, and terminal input are blocked. Browser endpoints enforce the same policy. Stopping work remains available.

The mode requires idle state because already-running agents or commands cannot be retroactively made read-only. Switch back to build mode to allow execution. Production instrument read/write classifications need an explicit policy before expanding the allowlist.

## Recovery

Refreshing or reconnecting the browser receives an authoritative snapshot before subsequent events. Messages and job completions use stable IDs; terminal chunks and SSE events have sequence numbers. A reconnect does not replay completion effects.

Restarting the host restores the active primary Pi session and adapter-owned child/terminal histories. Processes and PTYs from a previous host are marked interrupted; a restored transcript does not reconnect a shell. Graceful shutdown stops owned children and processes. After a hard native host crash, check for surviving operating-system processes before resuming work; detached pi-graph runners may outlive the HTTP host. Container shutdown contains those descendants within the same boundary.

Workflow records with incomplete host state are marked interrupted; available run directories can be resumed through pi-graph. Resume reuses completed nodes. The toy receipt makes rendering idempotent. A completed workflow's Resume request returns its existing result. See the workflow guide for failed-command recovery.

Back up the whole workspace while the host is stopped, including both SQLite databases and their WAL files if present. Primary Pi JSONL sessions remain the conversation authority; the archive is a search index, and adapter SQLite stores presentation/relationship state. Legacy EAA checkpoints are not converted.
