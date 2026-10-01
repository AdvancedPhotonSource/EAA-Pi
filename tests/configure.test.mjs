import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialize, agentDir, PACKAGE_ROOT, readJson, writeJson } from "../dist/server/config.js";
import { ModelRuntime } from "pi-experiment-ops/sdk";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eaa-pi-configure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const run = (args, answers = [], options = {}) => spawnSync(process.execPath,
    [join(PACKAGE_ROOT, "bin/eaa-pi.mjs"), "config", ...args, "--workspace", workspace],
    { input: answers.join("\n") + (answers.length ? "\n" : ""), encoding: "utf8", timeout: 15000, ...options });
  return { root, workspace, run };
}
function passed(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }

test("guided setup creates a usable provider and defaults while optional steps can be skipped", async t => {
  const { workspace, run } = fixture(t);
  const result = run([], ["", "", "lab", "not a URL", "https://models.example.test/v1", "LAB_KEY", "model-one", "y", "", "invalid", "8021", "", ""]);
  passed(result);
  assert.match(result.stdout, /complete http/);
  assert.match(result.stdout, /port number/);
  const models = readJson(join(agentDir(workspace), "models.json"));
  assert.equal(models.providers.lab.apiKey, "$LAB_KEY");
  assert.deepEqual(models.providers.lab.models[0].input, ["text", "image"]);
  const settings = readJson(join(agentDir(workspace), "settings.json"));
  assert.equal(settings.defaultProvider, "lab");
  assert.equal(settings.defaultModel, "model-one");
  assert.equal(readJson(join(workspace, "eaa-pi.json")).port, 8021);
  assert.deepEqual(readJson(join(workspace, ".pi/mcp.json")).mcpServers, {});
  assert.deepEqual(readdirSync(join(workspace, ".pi/skills")), []);
  const runtime = await ModelRuntime.create({ authPath: join(agentDir(workspace), "auth.json"), modelsPath: join(agentDir(workspace), "models.json"), allowModelNetwork: false });
  assert.equal(runtime.getModel("lab", "model-one").baseUrl, "https://models.example.test/v1");
});

test("provider updates preserve credentials, other models, and unrelated settings", t => {
  const { workspace, run } = fixture(t);
  initialize(workspace);
  writeJson(join(agentDir(workspace), "settings.json"), { theme: "dark", defaultProvider: "lab", defaultModel: "existing" });
  writeJson(join(agentDir(workspace), "auth.json"), { lab: { type: "api_key", key: "test-secret" } });
  writeJson(join(agentDir(workspace), "models.json"), { providers: { untouched: { models: [{ id: "other" }] }, lab: {
    baseUrl: "https://models.example.test/v1", apiKey: "$EXISTING_KEY", headers: { "x-test": "keep" },
    models: [{ id: "existing", reasoning: true, contextWindow: 64000, input: ["text", "image"] }, { id: "second" }],
  } } });
  passed(run([], ["y", "", "lab", "y", "", "", "", "", "", "", "", ""]));
  const models = readJson(join(agentDir(workspace), "models.json"));
  assert.equal(models.providers.lab.apiKey, "$EXISTING_KEY");
  assert.deepEqual(models.providers.lab.headers, { "x-test": "keep" });
  assert.equal(models.providers.lab.models.find(m => m.id === "existing").contextWindow, 64000);
  assert.equal(models.providers.lab.models.find(m => m.id === "existing").reasoning, true);
  assert.ok(models.providers.lab.models.some(m => m.id === "second"));
  assert.deepEqual(models.providers.untouched, { models: [{ id: "other" }] });
  assert.equal(readJson(join(agentDir(workspace), "settings.json")).theme, "dark");
  assert.equal(readJson(join(agentDir(workspace), "auth.json")).lab.key, "test-secret");
});

test("Argo setup supplies username and compatibility settings", t => {
  const { workspace, run } = fixture(t);
  passed(run([], ["", "argo", "", "", "testuser", "test-model", "", "", "", "", ""]));
  const provider = readJson(join(agentDir(workspace), "models.json")).providers.argo;
  assert.equal(provider.baseUrl, "https://apps.inside.anl.gov/argoapi/v1");
  assert.equal(provider.apiKey, "testuser");
  assert.equal(provider.models[0].samplingParams.user, "testuser");
  assert.equal(provider.compat.supportsDeveloperRole, false);
});

test("HTTP MCP setup preserves existing servers and rejects duplicate names", t => {
  const { workspace, run } = fixture(t);
  initialize(workspace);
  const original = { url: "http://localhost:8888/mcp" };
  writeJson(join(workspace, ".pi/mcp.json"), { settings: { toolPrefix: "server" }, mcpServers: { existing: original } });
  const result = run(["add-mcp"], ["existing", "remote", "invalid", "http", "ftp://wrong", "https://tools.example.test/mcp", "bearer", "BAD-NAME", "MCP_TOKEN", "X-User", "$env:MCP_USER", ""]);
  passed(result);
  assert.match(result.stdout, /already exists/);
  const config = readJson(join(workspace, ".pi/mcp.json"));
  assert.deepEqual(config.mcpServers.existing, original);
  assert.deepEqual(config.settings, { toolPrefix: "server" });
  assert.deepEqual(config.mcpServers.remote, { directTools: true, lifecycle: "eager", url: "https://tools.example.test/mcp", httpTransport: "streamable-http", auth: "bearer", bearerTokenEnv: "MCP_TOKEN", headers: { "X-User": "$env:MCP_USER" } });
});

test("MCP setup supports SSE with OAuth and stdio arguments, directories, and environment", t => {
  const { workspace, run } = fixture(t);
  passed(run(["add-mcp"], ["events", "sse", "https://tools.example.test/sse", "oauth", ""]));
  passed(run(["add-mcp"], ["local", "stdio", "python3", "/path with spaces/server.py", "--port", "9000", "", "/path with spaces", "TOKEN", "$env:LOCAL_TOKEN", ""]));
  const servers = readJson(join(workspace, ".pi/mcp.json")).mcpServers;
  assert.equal(servers.events.httpTransport, "sse");
  assert.equal(servers.events.auth, "oauth");
  assert.deepEqual(servers.local.args, ["/path with spaces/server.py", "--port", "9000"]);
  assert.equal(servers.local.cwd, "/path with spaces");
  assert.deepEqual(servers.local.env, { TOKEN: "$env:LOCAL_TOKEN" });
});

test("skill addition copies the complete folder from an argument or prompt without overwriting", t => {
  const { root, workspace, run } = fixture(t);
  const skill = join(root, "my skill");
  mkdirSync(join(skill, "scripts"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: my-skill\ndescription: Test skill\n---\nUse the script.\n");
  writeFileSync(join(skill, "scripts/analyze.py"), "print('test')\n");
  passed(run(["add-skill", skill]));
  const installed = join(workspace, ".pi/skills/my skill");
  assert.equal(readFileSync(join(installed, "scripts/analyze.py"), "utf8"), "print('test')\n");
  writeFileSync(join(skill, "scripts/analyze.py"), "changed\n");
  const duplicate = run(["add-skill", skill]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.equal(readFileSync(join(installed, "scripts/analyze.py"), "utf8"), "print('test')\n");
  rmSync(installed, { recursive: true });
  passed(run(["add-skill"], [skill]));
  assert.equal(readFileSync(join(installed, "scripts/analyze.py"), "utf8"), "changed\n");
  const invalid = join(root, "invalid");
  mkdirSync(invalid);
  const missingSkill = run(["add-skill", invalid]);
  assert.equal(missingSkill.status, 1);
  assert.match(missingSkill.stderr, /SKILL.md/);
  assert.equal(existsSync(join(workspace, ".pi/skills/invalid")), false);
});

test("full wizard offers MCP and skill addition and preserves the existing provider when skipped", t => {
  const { root, workspace, run } = fixture(t);
  initialize(workspace);
  const settingsPath = join(agentDir(workspace), "settings.json");
  writeJson(settingsPath, { defaultProvider: "saved", defaultModel: "saved-model" });
  const before = readFileSync(settingsPath, "utf8");
  const skill = join(root, "analysis");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: analysis\ndescription: Analyze data\n---\nAnalyze it.\n");
  passed(run([], ["", "", "y", "server", "", "http://localhost:9000/mcp", "none", "", "y", skill]));
  assert.equal(readFileSync(settingsPath, "utf8"), before);
  assert.equal(readJson(join(workspace, ".pi/mcp.json")).mcpServers.server.auth, false);
  assert.ok(existsSync(join(workspace, ".pi/skills/analysis/SKILL.md")));
});

test("incomplete input does not save an unfinished provider or MCP entry", t => {
  const { workspace, run } = fixture(t);
  const provider = run([], ["y", "argo", "argo"]);
  assert.equal(provider.status, 1);
  assert.match(provider.stderr, /input ended/);
  assert.deepEqual(readJson(join(agentDir(workspace), "models.json")), { providers: {} });
  const mcp = run(["add-mcp"], ["unfinished", "http"]);
  assert.equal(mcp.status, 1);
  assert.deepEqual(readJson(join(workspace, ".pi/mcp.json")).mcpServers, {});
});

test("config help and invalid subcommands do not create a workspace; omitted workspace uses cwd", t => {
  const { root, workspace, run } = fixture(t);
  passed(run(["--help"]));
  assert.equal(existsSync(workspace), false);
  assert.equal(run(["not-a-command"]).status, 1);
  assert.equal(existsSync(workspace), false);
  const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, "bin/eaa-pi.mjs"), "config"],
    { cwd: root, input: "n\n\nn\nn\n", encoding: "utf8", timeout: 15000 });
  passed(result);
  assert.ok(existsSync(join(root, "eaa-pi.json")));
  assert.equal(existsSync(workspace), false);
});
