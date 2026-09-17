import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { initialize, agentDir, loadConfig, writeJson, syncProviderConfiguration } from "../dist/server/config.js";

test("init creates usable custom provider templates and preserves edited configuration", async t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-config-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  initialize(workspace);
  const configPath = join(workspace, "eaa-pi.json");
  const modelsPath = join(agentDir(workspace), "models.json");
  const template = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(loadConfig(workspace).provider, "");
  assert.equal(loadConfig(workspace).model, "");
  assert.equal(JSON.parse(readFileSync(modelsPath, "utf8")).providers[template.provider].models[0].input, undefined);
  syncProviderConfiguration(workspace);
  const models = await ModelRuntime.create({ authPath: join(agentDir(workspace), "auth.json"), modelsPath, allowModelNetwork: false });
  const model = models.getModel(template.provider, template.model);
  assert.ok(model, "Pi must accept the generated provider schema");
  assert.equal(model.baseUrl, "https://YOUR_ENDPOINT_HOST/v1");
  assert.deepEqual(model.input, ["text", "image"]);

  writeJson(configPath, { ...template, provider: "custom", model: "my-model" });
  writeJson(modelsPath, { providers: { custom: { baseUrl: "http://localhost:9000/v1", api: "openai-completions", apiKey: "${LOCAL_KEY}", models: [{ id: "my-model" }] } } });
  const saved = [configPath, modelsPath].map(path => readFileSync(path, "utf8"));
  initialize(workspace);
  assert.deepEqual([configPath, modelsPath].map(path => readFileSync(path, "utf8")), saved);
  assert.equal(loadConfig(workspace).provider, "custom");
  assert.equal(loadConfig(workspace).model, "my-model");
});

test("omitted model inputs default to text and image while explicit capabilities are preserved", async t => {
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-model-input-")));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const path = join(agentDir(workspace), "models.json");
  const provider = { baseUrl: "http://localhost:9000/v1", api: "openai-completions", apiKey: "fixture", models: [
    { id: "default" }, { id: "text-only", input: ["text"] }, { id: "vision", input: ["text", "image"] },
  ] };
  writeJson(path, { providers: { custom: provider } });
  syncProviderConfiguration(workspace);
  const runtime = await ModelRuntime.create({ authPath: join(agentDir(workspace), "auth.json"), modelsPath: path, allowModelNetwork: false });
  assert.deepEqual(runtime.getModel("custom", "default").input, ["text", "image"]);
  assert.deepEqual(runtime.getModel("custom", "text-only").input, ["text"]);
  assert.deepEqual(runtime.getModel("custom", "vision").input, ["text", "image"]);
  const saved = readFileSync(path, "utf8");
  const modified = statSync(path).mtimeMs;
  syncProviderConfiguration(workspace);
  assert.equal(readFileSync(path, "utf8"), saved);
  assert.equal(statSync(path).mtimeMs, modified);
});

test("shared provider refreshes only selected entries and keeps source and local settings intact", async t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-shared-config-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  initialize(workspace);
  const source = join(workspace, "ops/.pi-experiment-ops/agent");
  const provider = { baseUrl: "http://localhost:9000/v1", api: "openai-completions", apiKey: "source-key", models: [{ id: "my-model", samplingParams: { user: "test-user" } }] };
  writeJson(join(source, "models.json"), { providers: { argo: provider, unselected: provider } });
  writeJson(join(source, "auth.json"), { argo: { type: "api_key", key: "source-credential" }, unselected: { type: "api_key", key: "other-secret" } });
  writeJson(join(source, "settings.json"), { packages: ["must-not-load"], defaultProvider: "unselected" });
  writeJson(join(workspace, "eaa-pi.json"), { provider: "argo", model: "my-model", providerWorkspace: "ops" });
  const local = agentDir(workspace);
  writeJson(join(local, "auth.json"), { argo: { type: "api_key", key: "stale" }, local: { type: "api_key", key: "local-key" } });
  const originalSettings = readFileSync(join(local, "settings.json"), "utf8");
  const originalSource = ["models.json", "auth.json", "settings.json"].map(name => readFileSync(join(source, name), "utf8"));
  syncProviderConfiguration(workspace);
  const modelConfig = JSON.parse(readFileSync(join(local, "models.json"), "utf8"));
  assert.deepEqual(modelConfig.providers.argo, { ...provider, models: provider.models.map(model => ({ ...model, input: ["text", "image"] })) });
  assert.ok(modelConfig.providers.YOUR_PROVIDER_NAME);
  assert.equal(modelConfig.providers.unselected, undefined);
  assert.deepEqual(JSON.parse(readFileSync(join(local, "auth.json"), "utf8")), { argo: { type: "api_key", key: "source-credential" }, local: { type: "api_key", key: "local-key" } });
  assert.equal(statSync(join(local, "auth.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(local, "settings.json"), "utf8"), originalSettings);
  assert.deepEqual(["models.json", "auth.json", "settings.json"].map(name => readFileSync(join(source, name), "utf8")), originalSource);
  const runtime = await ModelRuntime.create({ authPath: join(local, "auth.json"), modelsPath: join(local, "models.json"), allowModelNetwork: false });
  assert.equal((await runtime.getAuth("argo")).auth.apiKey, "source-credential");
  assert.deepEqual(runtime.getModel("argo", "my-model").input, ["text", "image"]);

  provider.baseUrl = "http://localhost:9001/v1";
  writeJson(join(source, "models.json"), { providers: { argo: provider } });
  rmSync(join(source, "auth.json"));
  syncProviderConfiguration(workspace);
  assert.equal(JSON.parse(readFileSync(join(local, "models.json"), "utf8")).providers.argo.baseUrl, provider.baseUrl);
  assert.equal(JSON.parse(readFileSync(join(local, "auth.json"), "utf8")).argo, undefined);
  const refreshed = await ModelRuntime.create({ authPath: join(local, "auth.json"), modelsPath: join(local, "models.json"), allowModelNetwork: false });
  assert.equal((await refreshed.getAuth("argo")).auth.apiKey, "source-key");
  assert.deepEqual(refreshed.getModel("argo", "my-model").input, ["text", "image"]);
});

test("shared provider errors clearly instead of falling back to stale local configuration", t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-missing-config-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  initialize(workspace);
  writeJson(join(workspace, "eaa-pi.json"), { provider: "argo", model: "missing", providerWorkspace: "." });
  assert.throws(() => syncProviderConfiguration(workspace), /Provider configuration not found/);
  const path = join(workspace, ".pi-experiment-ops/agent/models.json");
  writeJson(path, { providers: {} });
  assert.throws(() => syncProviderConfiguration(workspace), /Provider argo is not defined/);
  writeJson(path, { providers: { argo: { models: [{ id: "available" }] } } });
  assert.throws(() => syncProviderConfiguration(workspace), /Model missing is not defined/);
  writeJson(join(workspace, "eaa-pi.json"), { provider: "argo", model: "available", providerWorkspace: "" });
  syncProviderConfiguration(workspace);
  assert.equal(JSON.parse(readFileSync(join(agentDir(workspace), "models.json"), "utf8")).providers.argo, undefined);
});
