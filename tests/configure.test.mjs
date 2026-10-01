import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialize, agentDir, PACKAGE_ROOT, readJson, writeJson } from "../dist/server/config.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "eaa-pi-configure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const run = (args, answers = []) => spawnSync(process.execPath,
    [join(PACKAGE_ROOT, "bin/eaa-pi.mjs"), "config", ...args, "--workspace", workspace],
    { input: answers.join("\n") + (answers.length ? "\n" : ""), encoding: "utf8", timeout: 15000 });
  return { root, workspace, run };
}
function passed(result) { assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr); }

test("EAA delegates provider setup and adds its own web port prompt and initializer", t => {
  const { workspace, run } = fixture(t);
  initialize(workspace);
  writeJson(join(workspace, "eaa-pi.json"), { host: "127.0.0.1", port: 8010 });
  const result = run([], ["", "", "lab", "https://models.example.test/v1", "LAB_KEY", "model-one", "y", "", "invalid", "8021", "", ""]);
  passed(result);
  assert.match(result.stdout, /port number/);
  assert.equal(readJson(join(agentDir(workspace), "models.json")).providers.lab.apiKey, "$LAB_KEY");
  assert.equal(readJson(join(agentDir(workspace), "settings.json")).defaultModel, "model-one");
  assert.deepEqual(readJson(join(workspace, "eaa-pi.json")), { host: "127.0.0.1", port: 8021 });
  assert.equal(readJson(join(agentDir(workspace), "pi-permissions.jsonc")).defaultPolicy.skills, "allow");
  assert.ok(existsSync(join(workspace, ".pi/skills/workspace-setup/SKILL.md")));
});

test("EAA delegates standalone MCP and skill addition to the shared implementation", t => {
  const { root, workspace, run } = fixture(t);
  passed(run(["add-mcp"], ["remote", "http", "https://tools.example.test/mcp", "bearer", "MCP_TOKEN", ""]));
  const server = readJson(join(workspace, ".pi/mcp.json")).mcpServers.remote;
  assert.equal(server.bearerTokenEnv, "MCP_TOKEN");
  assert.equal(server.httpTransport, "streamable-http");
  const skill = join(root, "analysis");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: analysis\ndescription: Analyze data\n---\nAnalyze it.\n");
  passed(run(["add-skill", skill]));
  assert.equal(readFileSync(join(workspace, ".pi/skills/analysis/SKILL.md"), "utf8"), readFileSync(join(skill, "SKILL.md"), "utf8"));
  assert.equal(readJson(join(workspace, "eaa-pi.json")).port, 8010);
});

test("delegated help and invalid arguments do not initialize EAA workspace files", t => {
  const { workspace, run } = fixture(t);
  const result = run(["--help"]);
  passed(result);
  assert.match(result.stdout, /eaa-pi config add-mcp/);
  assert.equal(existsSync(workspace), false);
  assert.equal(run(["not-a-command"]).status, 1);
  assert.equal(existsSync(workspace), false);
});
