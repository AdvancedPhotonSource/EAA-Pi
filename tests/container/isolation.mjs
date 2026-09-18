import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initialize, configureEnvironment, writeJson, agentDir } from "/opt/eaa-pi/dist/server/config.js";
import { startModelFixture } from "/opt/eaa-pi/dist/server/fixture.js";

test("non-root filesystem boundary contains every execution path", { timeout: 180000 }, async () => {
  assert.notEqual(process.getuid(), 0);
  assert.equal(existsSync("/var/run/docker.sock"), false);
  assert.equal(existsSync(process.env.HOST_SECRET_PATH), false);
  const workspace = initialize("/workspace");
  configureEnvironment(workspace);
  const model = await startModelFixture();
  writeJson(join(workspace, "eaa-pi.json"), { provider: "eaa-demo", model: "toy", host: "127.0.0.1", port: 0 });
  writeJson(join(agentDir(workspace), "models.json"), { providers: { "eaa-demo": { baseUrl: model.url, api: "openai-completions", apiKey: "fixture", models: [{ id: "toy", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
  const { Runtime } = await import("/opt/eaa-pi/dist/server/runtime.js");
  const { startServer } = await import("/opt/eaa-pi/dist/server/server.js");
  const runtime = new Runtime(workspace); await runtime.start();
  const app = await startServer(runtime, 0);
  const wait = async predicate => {
    for (let i = 0; i < 900; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error("Timed out waiting for boundary check");
  };
  const prompt = async (name, args) => { await runtime.input("fixture-tool " + JSON.stringify({ name, arguments: args })); await wait(() => !runtime.busy && !runtime.session.isStreaming); };
  try {
    await prompt("write", { path: "/fixtures/sentinel", content: "escaped" });
    await prompt("write", { path: "../../fixtures/sentinel", content: "escaped" });
    symlinkSync("/fixtures/sentinel", "/workspace/symlink");
    await prompt("write", { path: "/workspace/symlink", content: "escaped" });
    await prompt("read", { path: process.env.HOST_SECRET_PATH });
    assert.ok(runtime.snapshot.conversations[0].messages.some(m => /ENOENT|no such file/i.test(m.content)));
    await prompt("bash", { command: "echo escaped > /fixtures/sentinel" });
    const processJob = await runtime.startProcess("echo escaped > /fixtures/sentinel");
    await wait(() => runtime.snapshot.message_queue.some(j => j.job_id === `process:${processJob.process.id}`));
    assert.equal(runtime.snapshot.message_queue.find(j => j.job_id === `process:${processJob.process.id}`).status, "failed");
    const terminal = await runtime.openTerminal();
    await runtime.terminal({ sessionId: terminal.details.sessionId, input: "echo escaped > /fixtures/sentinel; echo boundary-finished", submit: true });
    await wait(() => runtime.snapshot.conversations.some(c => c.terminal?.chunks.some(x => /Read-only file system|Permission denied/i.test(x.text))));
    await runtime.cancelJob(`terminal:${terminal.details.sessionId}`);
    for (const [name, steps] of [
      ["command-boundary", '  - id: write\n    cmd: echo escaped > /fixtures/sentinel\n'],
      ["agent-boundary", '  - id: write\n    agent: true\n    tools: write\n    prompt: EAA_BOUNDARY_WRITE\n'],
    ]) {
      const dir = join(workspace, "workflows", name); mkdirSync(dir);
      writeFileSync(join(dir, "steps.yaml"), `version: 1\nworkflow: ${name}\nmodel: eaa-demo/toy\nthinking: "off"\nworkers: 1\nsteps:\n${steps}`);
      const run = await app.workflows.run("boundary", name);
      await wait(() => JSON.parse(runtime.store.get(`workflow:${run.id}`)).status !== "running");
      const record = JSON.parse(runtime.store.get(`workflow:${run.id}`));
      if (name === "command-boundary") {
        assert.equal(record.status, "failed");
        assert.match(readFileSync(join(record.run_dir, "write.stderr"), "utf8"), /Read-only file system|Permission denied/i);
      } else {
        assert.equal(record.status, "completed", JSON.stringify(record));
        await wait(() => runtime.snapshot.conversations.some(c => c.kind === "workflow" && c.messages.some(m => m.role === "tool" && /EROFS|EACCES/.test(m.content))));
      }
    }
    assert.equal(readFileSync("/fixtures/sentinel", "utf8"), "unchanged\n");
    assert.equal((await fetch(app.url + "/api/image?path=../../fixtures/sentinel")).status, 404);
    assert.equal((await fetch(app.url + "/api/image?path=/workspace/symlink")).status, 404);
    assert.throws(() => writeFileSync("/opt/eaa-pi/escape", "escaped"));
  } finally { await app.close(); await model.close(); }
});
