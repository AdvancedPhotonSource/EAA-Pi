import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE_ROOT } from "../dist/server/config.js";

test("pi delegates to experiment-ops without reading or initializing WebUI configuration", t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-pi-cli-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const invalidWebConfig = "not JSON: only the WebUI should read this";
  writeFileSync(join(workspace, "eaa-pi.json"), invalidWebConfig);
  const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, "bin/eaa-pi.mjs"), "pi", "--workspace", workspace, "--", "--version"], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /\d+\.\d+\.\d+/);
  assert.ok(existsSync(join(workspace, ".pi-experiment-ops/agent/settings.json")));
  assert.equal(existsSync(join(workspace, ".eaa-pi")), false);
  assert.equal(readFileSync(join(workspace, "eaa-pi.json"), "utf8"), invalidWebConfig);
});
