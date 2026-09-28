import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workflows } from "../dist/server/workflows.js";

test("workflow discovery lists definitions in workspace directories", t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-workflow-catalog-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const workflows = new Workflows({ workspace, on() {}, store: { db: { prepare: () => ({ all: () => [] }) } } });
  assert.deepEqual(workflows.list(), []);
  const root = join(workspace, "workflows");
  mkdirSync(root);
  assert.deepEqual(workflows.list(), []);
  for (const name of ["zeta", "alpha", "incomplete", "directory-definition", "external-definition"]) mkdirSync(join(root, name));
  for (const name of ["zeta", "alpha"]) writeFileSync(join(root, name, "workflow.mjs"), "export default {};\n");
  writeFileSync(join(root, "notes.txt"), "not a workflow");
  mkdirSync(join(root, "directory-definition", "workflow.mjs"));
  writeFileSync(join(workspace, "outside.mjs"), "export default {};\n");
  symlinkSync(join(workspace, "outside.mjs"), join(root, "external-definition", "workflow.mjs"));
  assert.deepEqual(workflows.list(), ["alpha", "zeta"]);
  rmSync(join(root, "alpha"), { recursive: true });
  assert.deepEqual(workflows.list(), ["zeta"]);
});

import { EventEmitter } from "node:events";

function harness(t, launch) {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-workflow-adapter-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, "workflows/toy");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "workflow.mjs"), "export default { name: 'toy', version: 1 };\n");
  const metadata = new Map();
  const runtime = Object.assign(new EventEmitter(), {
    workspace, config: { provider: "fixture", model: "toy" }, snapshot: { session_id: "primary" },
    store: { get: key => metadata.get(key), set: (key, value) => metadata.set(key, value), db: { prepare: () => ({ all: () => [] }) } },
    requireBuild() {}, startJob() {}, finishJob() {}, log() {},
    busRequest: async (_channel, request) => launch(runtime, request),
  });
  return { runtime, workflows: new Workflows(runtime), metadata, source };
}

test("workflow completion arriving during admission is retained and failed states stay failed", async t => {
  const { workflows, metadata } = harness(t, runtime => {
    runtime.emit("subagentComplete", { runId: "upstream", state: "failed", success: false, error: "review rejected" });
    return { result: { details: { asyncId: "upstream" } } };
  });
  const run = await workflows.run("input", "toy");
  assert.equal(run.status, "failed");
  assert.equal(JSON.parse(metadata.get(`workflow:${run.id}`)).result.error, "review rejected");
});

test("workflow launch leaves model selection to pi-subagents", async t => {
  const { workflows, runtime } = harness(t, (_runtime, request) => ({
    result: request.params.model === undefined
      ? { details: { asyncId: "inherited-model" } }
      : { text: `Unexpected model override: ${request.params.model}` },
  }));
  runtime.config = { provider: "", model: "" };
  const run = await workflows.run("input", "toy");
  assert.equal(run.status, "running", run.error);
  assert.equal(run.runId, "inherited-model");
  runtime.emit("subagentComplete", { runId: run.runId, state: "complete", success: true });
});

test("rerun uses the saved definition and input in a new output directory", async t => {
  let sequence = 0;
  const { workflows, runtime, source } = harness(t, (_runtime, request) => {
    assert.equal(request.params.args.input, "original input");
    assert.equal(request.params.args.outputDirectory, request.params.cwd);
    return { result: { details: { asyncId: `upstream-${++sequence}` } } };
  });
  const first = await workflows.run("original input", "toy");
  runtime.emit("subagentComplete", { runId: first.runId, state: "complete", success: true });
  writeFileSync(join(source, "workflow.mjs"), "changed source");
  const second = await workflows.run("", undefined, first.id);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.run_dir, first.run_dir);
  assert.equal(readFileSync(second.definition, "utf8"), readFileSync(first.definition, "utf8"));
  runtime.emit("subagentComplete", { runId: second.runId, state: "stopped", success: false });
  assert.equal(second.status, "cancelled");
  runtime.snapshot.session_id = "different";
  await assert.rejects(workflows.run("", undefined, first.id), /another session/);
});

test("launch rejection releases the workflow job", async t => {
  const { workflows, runtime } = harness(t, () => ({ error: "invalid workflow" }));
  const finished = [];
  runtime.finishJob = (...args) => finished.push(args);
  const run = await workflows.run("input", "toy");
  assert.equal(run.status, "failed");
  assert.match(run.error, /invalid workflow/);
  assert.equal(finished.length, 1);
  await workflows.close();
});

test("shutdown waits for upstream cancellation completion", async t => {
  const { workflows, runtime } = harness(t, () => ({ result: { details: { asyncId: "stopping" } } }));
  const run = await workflows.run("input", "toy");
  let stopped = false;
  runtime.rpc = async method => { assert.equal(method, "stop"); stopped = true; return { state: "stopping" }; };
  let closed = false;
  const closing = workflows.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal(closed, false);
  runtime.emit("subagentComplete", { runId: "stopping", state: "stopped", success: false });
  await closing;
  assert.equal(run.status, "cancelled");
});
