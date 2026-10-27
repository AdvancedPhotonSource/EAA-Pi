import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  const result = run(["add-skill", skill], [""]);
  passed(result);
  assert.match(result.stdout, /\(copy\/link\) \[copy\]/);
  assert.equal(lstatSync(join(workspace, ".pi/skills/analysis")).isSymbolicLink(), false);
  assert.equal(readFileSync(join(workspace, ".pi/skills/analysis/SKILL.md"), "utf8"), readFileSync(join(skill, "SKILL.md"), "utf8"));
  assert.equal(readJson(join(workspace, "eaa-pi.json")).port, 8010);
});

for (const useFlag of [false, true]) {
  test(`EAA delegates skill linking selected through ${useFlag ? "--link" : "the prompt"}`, t => {
    const { root, workspace, run } = fixture(t);
    const skill = join(root, "analysis");
    mkdirSync(skill);
    writeFileSync(join(skill, "SKILL.md"), "---\nname: analysis\ndescription: Analyze data\n---\nAnalyze it.\n");
    const result = run(["add-skill", skill, ...(useFlag ? ["--link"] : [])], useFlag ? [] : ["link"]);
    passed(result);
    if (useFlag) assert.doesNotMatch(result.stdout, /copy\/link/);
    const installed = join(workspace, ".pi/skills/analysis");
    assert.ok(lstatSync(installed).isSymbolicLink());
    assert.equal(realpathSync(installed), realpathSync(skill));
    writeFileSync(join(skill, "SKILL.md"), "Updated instructions");
    assert.equal(readFileSync(join(installed, "SKILL.md"), "utf8"), "Updated instructions");
  });
}

test("delegated help and invalid arguments do not initialize EAA workspace files", t => {
  const { workspace, run } = fixture(t);
  const result = run(["--help"]);
  passed(result);
  assert.match(result.stdout, /eaa-pi config add-mcp/);
  assert.match(result.stdout, /add-skill .*\[--link\]/);
  assert.equal(existsSync(workspace), false);
  assert.equal(run(["not-a-command"]).status, 1);
  assert.equal(existsSync(workspace), false);
});
