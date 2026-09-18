import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ModelRuntime, SessionManager } from "pi-experiment-ops/sdk";
import { initialize, agentDir, sessionDir, migrateLegacySessions, loadConfig, writeJson, migrateLegacyConfiguration } from "../dist/server/config.js";

test("shared sessions match the experiment-ops Pi default and migrate without overwriting conflicts", t => {
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-sessions-")));
  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(workspace, { recursive: true, force: true });
  });
  process.env.PI_CODING_AGENT_DIR = join(workspace, ".pi-experiment-ops/agent");
  assert.equal(sessionDir(workspace), SessionManager.create(workspace).getSessionDir());
  const legacy = join(workspace, ".eaa-pi/agent/sessions");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "session.jsonl"), "original transcript\n");
  const legacyTui = join(legacy, basename(sessionDir(workspace)));
  mkdirSync(legacyTui, { recursive: true });
  writeFileSync(join(legacyTui, "tui.jsonl"), "TUI transcript\n");
  migrateLegacySessions(workspace);
  assert.equal(readFileSync(join(sessionDir(workspace), "tui.jsonl"), "utf8"), "TUI transcript\n");
  assert.equal(existsSync(join(legacyTui, "tui.jsonl")), false);
  const target = join(sessionDir(workspace), "session.jsonl");
  assert.equal(readFileSync(target, "utf8"), "original transcript\n");
  assert.equal(existsSync(join(legacy, "session.jsonl")), false);
  // Recover a migration interrupted after copying but before deleting the source.
  writeFileSync(join(legacy, "session.jsonl"), "original transcript\n");
  migrateLegacySessions(workspace);
  assert.equal(existsSync(join(legacy, "session.jsonl")), false);
  writeFileSync(join(legacy, "session.jsonl"), "different transcript\n");
  assert.throws(() => migrateLegacySessions(workspace), /Session migration conflict/);
  assert.equal(readFileSync(target, "utf8"), "original transcript\n");
  assert.equal(readFileSync(join(legacy, "session.jsonl"), "utf8"), "different transcript\n");
});

test("WebUI uses native model defaults without rewriting shared provider configuration", async t => {
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-native-config-")));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  assert.deepEqual(JSON.parse(readFileSync(join(workspace, "eaa-pi.json"))), { host: "127.0.0.1", port: 8010 });
  assert.equal(existsSync(join(workspace, ".eaa-pi/agent/models.json")), false);
  const settings = join(agentDir(workspace), "settings.json");
  const models = join(agentDir(workspace), "models.json");
  writeJson(settings, { theme: "light", defaultProvider: "native", defaultModel: "vision" });
  writeJson(models, { providers: { native: { baseUrl: "http://localhost:9000/v1", api: "openai-completions", apiKey: "fixture", models: [{ id: "vision", input: ["text", "image"] }, { id: "text", input: ["text"] }] } } });
  const before = [settings, models].map(path => readFileSync(path, "utf8"));
  initialize(workspace);
  assert.equal(loadConfig(workspace).provider, "native");
  assert.equal(loadConfig(workspace).model, "vision");
  const runtime = await ModelRuntime.create({ authPath: join(agentDir(workspace), "auth.json"), modelsPath: models, allowModelNetwork: false });
  assert.deepEqual(runtime.getModel("native", "vision").input, ["text", "image"]);
  assert.deepEqual(runtime.getModel("native", "text").input, ["text"]);
  assert.deepEqual([settings, models].map(path => readFileSync(path, "utf8")), before);
});

test("legacy EAA provider configuration migrates once into the native workspace", t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-legacy-config-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const legacy = join(workspace, ".eaa-pi/agent");
  writeJson(join(legacy, "models.json"), { providers: { custom: { apiKey: "fixture", models: [{ id: "toy" }] } } });
  writeJson(join(legacy, "auth.json"), { custom: { type: "api_key", key: "fixture" } });
  writeJson(join(workspace, "eaa-pi.json"), { provider: "custom", model: "toy", providerWorkspace: ".", port: 8123 });
  initialize(workspace);
  for (const name of ["models.json", "auth.json"]) assert.equal(readFileSync(join(agentDir(workspace), name), "utf8"), readFileSync(join(legacy, name), "utf8"));
  assert.equal(statSync(join(agentDir(workspace), "auth.json")).mode & 0o777, 0o600);
  assert.equal(loadConfig(workspace).provider, "custom");
  assert.equal(loadConfig(workspace).model, "toy");
  assert.equal(loadConfig(workspace).port, 8123);
  assert.deepEqual(JSON.parse(readFileSync(join(workspace, "eaa-pi.json"))), { port: 8123 });
  rmSync(join(agentDir(workspace), "auth.json"));
  initialize(workspace);
  assert.equal(existsSync(join(agentDir(workspace), "auth.json")), false, "Removed credentials must not reappear from legacy files");
});

test("legacy migration preserves established experiment-ops configuration", t => {
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-existing-config-")));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const paths = ["models.json", "auth.json", "settings.json"].map(name => join(agentDir(workspace), name));
  writeJson(paths[0], { providers: { native: { models: [{ id: "original" }] } } });
  writeJson(paths[1], { native: { type: "api_key", key: "fixture" } });
  writeJson(paths[2], { defaultProvider: "native", defaultModel: "original", theme: "light" });
  const before = paths.map(path => readFileSync(path, "utf8"));
  writeJson(join(workspace, ".eaa-pi/agent/models.json"), { providers: { stale: {} } });
  writeJson(join(workspace, "eaa-pi.json"), { provider: "stale", model: "old", host: "127.0.0.1" });
  migrateLegacyConfiguration(workspace);
  assert.deepEqual(paths.map(path => readFileSync(path, "utf8")), before);
  assert.equal(loadConfig(workspace).provider, "native");
  assert.equal(loadConfig(workspace).model, "original");
  rmSync(paths[1]);
  writeJson(join(workspace, ".eaa-pi/agent/auth.json"), { native: { type: "api_key", key: "stale" } });
  writeJson(join(workspace, "eaa-pi.json"), { provider: "native", model: "old" });
  migrateLegacyConfiguration(workspace);
  assert.equal(existsSync(paths[1]), false, "Legacy credentials must not override a native provider using models.json authentication");
});
