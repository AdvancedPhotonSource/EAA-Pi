import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { SessionManager } from "pi-experiment-ops/sdk";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { initialize, configureEnvironment, writeJson, agentDir, sessionDir, PACKAGE_ROOT } from "../dist/server/config.js";
import { startModelFixture, startInstrumentFixture, tinyPng, configureDemoWorkflow } from "../dist/server/fixture.js";

const wait = async (fn, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Timed out waiting for condition");
};

for (const providerSource of ["native", "legacy"]) test(`real Pi and community extensions through EAA's HTTP interface (${providerSource} provider)`, { timeout: 240000 }, async t => {
  const cwd = process.cwd();
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-integration-")));
  configureEnvironment(workspace);
  configureDemoWorkflow(workspace);
  const model = await startModelFixture();
  const instrument = await startInstrumentFixture();
  writeJson(join(workspace, "eaa-pi.json"), { host: "127.0.0.1", port: 0, ...(providerSource === "legacy" ? { provider: "eaa-demo", model: "toy" } : {}) });
  const providerDirectory = providerSource === "legacy" ? join(workspace, ".eaa-pi/agent") : agentDir(workspace);
  writeJson(join(providerDirectory, "models.json"), { providers: { "eaa-demo": { baseUrl: model.url, api: "openai-completions", apiKey: "fixture", models: [{ id: "toy", input: ["text", "image"], reasoning: false, contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
  if (providerSource === "native") writeJson(join(agentDir(workspace), "settings.json"), { offline: true, packages: [], theme: "dark", defaultProvider: "eaa-demo", defaultModel: "toy" });
  initialize(workspace);
  const settingsBefore = readFileSync(join(agentDir(workspace), "settings.json"), "utf8");
  const modelsBefore = readFileSync(join(agentDir(workspace), "models.json"), "utf8");
  writeJson(join(workspace, ".pi/mcp.json"), { mcpServers: { toy: { url: instrument.url, directTools: true, lifecycle: "eager", approveTools: ["image"] } } });
  const { Runtime } = await import("../dist/server/runtime.js");
  const { startServer } = await import("../dist/server/server.js");
  let runtime = new Runtime(workspace);
  await runtime.start();
  assert.equal(readFileSync(join(agentDir(workspace), "settings.json"), "utf8"), settingsBefore);
  assert.equal(readFileSync(join(agentDir(workspace), "models.json"), "utf8"), modelsBefore);
  let app = await startServer(runtime, 0);
  const request = async (path, body, expected = 200) => {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const idle = () => wait(() => !runtime.busy && !runtime.session.isStreaming);
  const prompt = async content => { await request("/api/input", { content }, 201); await idle(); };
  t.after(async () => { await app.close(); await model.close(); await instrument.close(); process.chdir(cwd); });

  await t.test("workflow catalog and explicit selection", async () => {
    assert.deepEqual((await request("/api/workflows")).workflows, ["toy"]);
    await request("/api/workflows/run", { input: "missing selection" }, 400);
    await request("/api/workflows/run", { input: "unknown selection", workflow: "missing" }, 400);
    await request("/api/workflows/run", { input: "outside root", workflow: "../toy" }, 400);
  });

  await t.test("extension startup and SSE streaming", async () => {
    assert.equal(runtime.extensions.length, 8);
    
    assert.equal(runtime.snapshot.logs.filter(l => l.level === "error").length, 0);
    const tools = await request("/api/tool-schemas");
    for (const name of ["subagent", "process", "interactive_shell", "pi_graph", "search_archive", "toy_operate"]) assert.ok(tools.tools.some(t => t.function.name === name), name);
    const abort = new AbortController();
    const events = await fetch(app.url + "/api/events", { signal: abort.signal });
    const reader = events.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /event: snapshot/);
    await prompt("hello streaming");
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /event: (status.changed|message.created)/);
    abort.abort();
    const messages = runtime.snapshot.conversations[0].messages;
    assert.ok(messages.some(m => m.content === "Demo reply: hello streaming"));
    assert.equal(new Set(messages.map(m => m.id)).size, messages.length);
  });
  await t.test("actual MCP tool and image blocks", async () => {
    await request("/api/input", { content: 'fixture-tool {"name":"toy_image","arguments":{}}' }, 201);
    const mcpApproval = await wait(() => runtime.snapshot.conversations[0].pending_approval);
    await request("/api/approval", { approval_id: mcpApproval.id, approved: true });
    await idle();
    assert.ok(runtime.snapshot.conversations[0].messages.some(m => m.role === "tool" && m.images?.length));
    const toolImages = model.requests.at(-1).messages.filter(m => m.role === "user" && Array.isArray(m.content)).flatMap(m => m.content).filter(block => block.type === "image_url");
    assert.ok(toolImages.some(block => block.image_url.url === `data:image/png;base64,${tinyPng}`), "Tool image must reach the configured vision model");
    const upload = await request("/api/upload-image", { image_data: `data:image/png;base64,${tinyPng}` }, 201);
    await request("/api/input", { content: "Inspect image", images: [upload.file_path] }, 201);
    await idle();
    const last = model.requests.at(-1);
    const image = last.messages.findLast(m => m.role === "user").content.find(b => b.type === "image_url");
    assert.equal(image.image_url.url, `data:image/png;base64,${tinyPng}`);
    await prompt("fixture-tool " + JSON.stringify({ name: "read", arguments: { path: upload.file_path } }));
    const readResult = runtime.snapshot.conversations[0].messages.findLast(m => m.role === "tool");
    assert.ok(readResult.images?.length);
    assert.doesNotMatch(readResult.content, /Current model does not support images/);
    assert.ok(model.requests.at(-1).messages.some(m => m.role === "user" && Array.isArray(m.content) && m.content.some(block => block.type === "image_url")), "Read-tool image must reach the model");
    assert.equal((await fetch(app.url + "/api/image?path=" + encodeURIComponent(upload.file_path))).status, 200);
    assert.equal((await fetch(app.url + "/api/image?path=/etc/passwd")).status, 404);
    assert.equal((await fetch(app.url + "/api/image?path=../../etc/passwd")).status, 404);
    const outside = join(workspace, "outside.png"); symlinkSync("/etc/passwd", outside);
    assert.equal((await fetch(app.url + "/api/image?path=" + encodeURIComponent(outside))).status, 404);
  });
  await t.test("approval round trip and interrupt", async () => {
    await request("/api/input", { content: "request approval" }, 201);
    const approval = await wait(() => runtime.snapshot.conversations[0].pending_approval);
    await request("/api/approval", { approval_id: approval.id, approved: true });
    await request("/api/approval", { approval_id: approval.id, approved: true }, 409);
    await idle();
    assert.ok(runtime.snapshot.conversations[0].messages.some(m => m.role === "tool" && m.content === "Approved"));
    await request("/api/input", { content: "slow response " + "x".repeat(300) }, 201);
    await new Promise(r => setTimeout(r, 200));
    await request("/api/interrupt", {}); await idle();
    assert.equal(runtime.snapshot.interrupt_requested, false);
  });
  await t.test("real background process, responsive chat, and idle-only plan mode", async () => {
    const process = await request("/api/processes", { command: "sleep 2; printf 'background finished\\n'" }, 201);
    await request("/api/mode", { plan_mode: true }, 409);
    await prompt("chat while a job is running");
    await wait(() => runtime.snapshot.message_queue.some(j => j.job_id === `process:${process.process.id}`));
    assert.equal(runtime.snapshot.message_queue.filter(j => j.job_id === `process:${process.process.id}`).length, 1);
    await idle();
    await request("/api/mode", { plan_mode: true });
    for (const name of runtime.session.getActiveToolNames()) assert.ok(["read", "grep", "find", "ls", "pi_modes_plan_complete"].includes(name), name);
    await request("/api/processes", { command: "touch forbidden" }, 409);
    await request("/api/terminals", {}, 409);
    await request("/api/workflows/run", { workflow: "toy", input: "forbidden" }, 409);
    await request("/api/subagents", { task: "forbidden" }, 409);
    await request("/api/input", { content: "!touch forbidden" }, 409);
    // Adversarial fixture emits a writer even when the advertised tools omit it.
    await prompt('fixture-tool {"name":"write","arguments":{"path":"forbidden","content":"no"}}');
    assert.equal(existsSync(join(workspace, "forbidden")), false);
    await request("/api/mode", { plan_mode: false });
  });
  await t.test("real persistent PTY", async () => {
    const result = await request("/api/terminals", {}, 201);
    const terminal = result.details.sessionId;
    await request(`/api/terminals/${terminal}/input`, { input: "export EAA_TEST_MARKER=retained" });
    await request(`/api/terminals/${terminal}/input`, { input: "printf 'marker=%s\\n' \"$EAA_TEST_MARKER\"" });
    await wait(() => runtime.snapshot.conversations.find(c => c.id === `terminal:${terminal}`)?.terminal?.chunks.some(c => c.text.includes("marker=retained")));
    await request(`/api/jobs/${encodeURIComponent(`terminal:${terminal}`)}/cancel`, {});
    assert.equal(runtime.snapshot.conversations.find(c => c.id === `terminal:${terminal}`).terminal.status, "cancelled");
  });
  await t.test("pi-subagents actual child and durable transcript", async () => {
    const result = await request("/api/subagents", { task: "Say Reviewer finished" }, 201);

    await wait(() => runtime.snapshot.conversations.some(c => c.kind === "subagent" && c.messages.some(m => m.role === "assistant" && m.content.includes("Reviewer finished"))), 60000);

  });
  await t.test("pi-graph actual generation, review, rendering and rejection", async () => {
    const run = await request("/api/workflows/run", { workflow: "toy", input: "Three toy measurements" }, 201);
    await wait(() => runtime.snapshot.conversations.some(c => c.kind === "workflow" && c.status === "running"), 60000);
    const record = await wait(() => { const r = JSON.parse(runtime.store.get(`workflow:${run.id}`)); return r.status !== "running" && r; }, 60000);
    assert.equal(record.status, "completed", JSON.stringify(record));
    assert.equal(readFileSync(record.definition, "utf8"), readFileSync(join(workspace, "workflows/toy/steps.yaml"), "utf8"));
    assert.ok(existsSync(join(record.run_dir, "chart.png")));
    assert.equal(runtime.snapshot.conversations.find(c => c.id === "primary").messages.some(m => m.id === `workflow:${run.id}`), false);
    assert.equal(JSON.parse(readFileSync(join(record.run_dir, "receipt.json"), "utf8")).count, 1);
    assert.ok(runtime.snapshot.conversations.some(c => c.kind === "workflow" && c.messages.some(m => m.role === "assistant")));
    const rejected = await request("/api/workflows/run", { workflow: "toy", input: "reject-review" }, 201);
    const rejection = await wait(() => { const r = JSON.parse(runtime.store.get(`workflow:${rejected.id}`)); return r.status !== "running" && r; }, 60000);
    assert.equal(rejection.status, "failed");
    assert.equal(existsSync(join(rejection.run_dir, "receipt.json")), false);
  });
  await t.test("workflow failure, resume, receipt idempotency, and cancellation", async () => {
    const settled = run => wait(() => { const record = JSON.parse(runtime.store.get(`workflow:${run.id}`)); return record.status !== "running" && record; }, 60000);
    const failed = await settled(await request("/api/workflows/run", { workflow: "toy", input: "fail-command" }, 201));
    assert.equal(failed.status, "failed");
    writeFileSync(join(failed.run_dir, "allow-render"), "approved test retry");
    const count = model.requests.length;
    const resumed = await settled(await request("/api/workflows/resume", { id: failed.id }, 201));
    assert.equal(resumed.status, "completed", JSON.stringify(resumed));
    assert.equal(model.requests.length, count, "completed agent steps must be reused");
    const receipt = readFileSync(join(resumed.run_dir, "receipt.json"), "utf8");
    const again = await settled(await request("/api/workflows/resume", { id: resumed.id }, 201));
    assert.equal(again.status, "completed");
    assert.equal(readFileSync(join(again.run_dir, "receipt.json"), "utf8"), receipt);
    const slow = await request("/api/workflows/run", { workflow: "toy", input: "slow-workflow" }, 201);
    await wait(() => model.requests.some(r => JSON.stringify(r.messages).includes("slow-workflow")));
    await request(`/api/jobs/${encodeURIComponent(`workflow:${slow.id}`)}/cancel`, {});
    assert.equal((await settled(slow)).status, "cancelled");
  });
  await t.test("child steering, stopping, and active-session replacement refusal", async () => {
    await idle();
    const child = await request("/api/subagents", { task: "slow response " + "a".repeat(800) }, 201);
    const runId = child.details.asyncId;
    await request("/api/sessions", { action: "new" }, 409);
    await request("/api/mode", { plan_mode: true }, 409);
    await request(`/api/subagents/${runId}/steer`, { message: "Say steered" });
    await request(`/api/subagents/${runId}/stop`, {});
    await wait(() => !runtime.snapshot.tool_execution_queue.some(j => j.job_id === `subagent:${runId}`), 60000);
  });
  await t.test("simulated shared instrument retains its queue after returning job IDs", async () => {
    const call = async (operation, background) => (await (await fetch(instrument.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: operation, method: "tools/call", params: { name: "operate", arguments: { operation, durationMs: 100, background } } }) })).json()).result;
    const client = operation => new Promise((resolve, reject) => {
      const child = spawn(join(PACKAGE_ROOT, "bin/shims/pi"), ["-p", "--mode", "json", "--no-session", "--no-approve", "--no-extensions", "--no-skills", "--no-context-files", "-e", join(PACKAGE_ROOT, "extensions/mcp.ts"), "--model", "eaa-demo/toy", 'fixture-tool ' + JSON.stringify({ name: "toy_operate", arguments: { operation, durationMs: 200, background: false } })], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.on("error", reject);
      child.on("exit", code => code === 0 && output.includes('tool_execution_end') ? resolve() : reject(new Error(output)));
    });
    await call("scan", true);
    // A long asynchronous operation retains the service queue while two actual Pi clients connect.
    const scan = await fetch(instrument.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "long-scan", method: "tools/call", params: { name: "operate", arguments: { operation: "long-scan", durationMs: 3000, background: true } } }) });
    assert.equal(scan.status, 200);
    await Promise.all([client("agent-a-move"), client("agent-b-move")]);
    assert.equal(instrument.events.filter(e => e.operation.startsWith("agent-") && e.event === "end").length, 2);
    assert.deepEqual(instrument.events.map(e => e.event), ["start", "end", "start", "end", "start", "end", "start", "end"]);
  });
  await t.test("archive, host restart, reconnect, and session isolation", async () => {
    await idle();
    const before = structuredClone(runtime.snapshot);
    const db = new DatabaseSync(join(workspace, ".pi/archive.db"));
    assert.ok(db.prepare("SELECT count(*) AS count FROM entries").get().count > 0);
    assert.ok(db.prepare("SELECT count(*) AS count FROM sessions").get().count >= 3, "primary and child native transcripts are indexed");
    assert.ok(db.prepare("SELECT count(*) AS count FROM entries WHERE custom_type='eaa-parent'").get().count > 0);
    db.close();
    const relationships = runtime.store.db.prepare("SELECT value FROM metadata WHERE key LIKE 'child:%'").all().map(row => JSON.parse(row.value));
    assert.ok(relationships.length >= 3);
    assert.ok(relationships.every(row => row.parent === before.session_id));
    assert.ok(relationships.some(row => row.run));
    assert.ok(runtime.store.db.prepare("SELECT count(*) AS count FROM artifacts").get().count > 0);
    const abandonedProcess = await runtime.startProcess("sleep 30");
    const abandonedTerminal = await runtime.openTerminal();
    const sharedFile = runtime.session.sessionFile;
    await app.close();
    // Simulate upgrading a workspace whose active transcript is in the old store.
    const legacyDirectory = join(workspace, ".eaa-pi/agent/sessions");
    mkdirSync(legacyDirectory, { recursive: true });
    const legacyFile = join(legacyDirectory, basename(sharedFile));
    renameSync(sharedFile, legacyFile);
    const metadata = new DatabaseSync(join(workspace, ".eaa-pi/adapter.sqlite"));
    metadata.prepare("UPDATE metadata SET value=? WHERE key='activeSession'").run(legacyFile);
    metadata.close();
    runtime = new Runtime(workspace); await runtime.start(); app = await startServer(runtime, 0);
    assert.equal(runtime.snapshot.session_id, before.session_id);
    assert.equal(runtime.session.sessionFile, sharedFile);
    assert.equal(runtime.store.get("activeSession"), sharedFile);
    assert.equal(existsSync(legacyFile), false);
    assert.equal(runtime.session.sessionManager.getSessionDir(), sessionDir(workspace));
    assert.equal(runtime.snapshot.conversations.find(c => c.id === `process:${abandonedProcess.process.id}`).status, "interrupted");
    assert.equal(runtime.snapshot.conversations.find(c => c.id === `terminal:${abandonedTerminal.details.sessionId}`).terminal.status, "interrupted");
    for (const child of before.conversations.filter(c => c.kind !== "primary")) assert.ok(runtime.snapshot.conversations.some(c => c.id === child.id));
    const origin = await fetch(app.url + "/api/input", { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: '{"content":"bad"}' });
    assert.equal(origin.status, 403);
    await request("/api/sessions", { action: "new" });
    assert.equal(runtime.snapshot.conversations[0].messages.length, 0);
    await request("/api/sessions", { action: "resume", session_id: before.session_id });
    assert.ok(runtime.snapshot.conversations[0].messages.length > 0);
    assert.equal(runtime.session.sessionManager.getSessionDir(), sessionDir(workspace));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    let tuiSession;
    try {
      process.env.PI_CODING_AGENT_DIR = join(workspace, ".pi-experiment-ops/agent");
      assert.ok((await SessionManager.list(workspace)).some(session => session.id === runtime.snapshot.session_id), "TUI discovers WebUI sessions");
      tuiSession = SessionManager.forkFrom(runtime.session.sessionFile, workspace);
      tuiSession.appendMessage({ role: "user", content: "Message added from the TUI", timestamp: Date.now() });
    } finally { process.env.PI_CODING_AGENT_DIR = previousAgentDir; }
    assert.ok((await request("/api/sessions")).sessions.some(session => session.id === tuiSession.getSessionId()));
    // Resume by ID through the actual eaa-pi launcher, exercising its directory lookup.
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(PACKAGE_ROOT, "bin/eaa-pi.mjs"), "pi", "--workspace", workspace, "--session", tuiSession.getSessionId(), "-p", "--no-approve", "hello from CLI"], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`CLI resume timed out: ${output}`)); }, 30000);
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("exit", code => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`CLI resume exited ${code}: ${output}`));
        else resolve();
      });
    });
    await request("/api/sessions", { action: "resume", session_id: tuiSession.getSessionId() });
    assert.ok(runtime.snapshot.conversations[0].messages.some(message => message.content === "Message added from the TUI"));
    assert.ok(runtime.snapshot.conversations[0].messages.some(message => message.content === "Demo reply: hello from CLI"));
    await request("/api/sessions", { action: "branch", session_id: before.session_id });
    assert.notEqual(runtime.snapshot.session_id, before.session_id);
    assert.equal(runtime.session.sessionManager.getSessionDir(), sessionDir(workspace));
    assert.ok(runtime.snapshot.conversations[0].messages.length > 0);
    await request("/api/mcp/reconnect", { server_id: "toy" });
    await request("/api/sessions", { action: "new" });
    const emptySession = runtime.snapshot.session_id;
    runtime.log("test", "Activity before the first assistant reply");
    assert.equal(existsSync(runtime.session.sessionFile), false);
    await app.close();
    runtime = new Runtime(workspace); await runtime.start(); app = await startServer(runtime, 0);
    assert.equal(runtime.snapshot.session_id, emptySession);
    assert.ok(runtime.snapshot.logs.some(l => l.message === "Activity before the first assistant reply"));
  });
});
