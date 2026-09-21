import test from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { piCli, packageRoot } from "pi-experiment-ops";
import { SessionManager } from "pi-experiment-ops/sdk";
import { PACKAGE_ROOT } from "../dist/server/config.js";

test("experiment-ops owns the single installed Pi SDK and CLI", async () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.ok(Object.keys(manifest.dependencies).every(name => !name.startsWith("@earendil-works/pi-")));
  assert.equal(realpathSync(packageRoot), realpathSync(join(PACKAGE_ROOT, "node_modules/pi-experiment-ops")));
  const installed = globSync("node_modules/**/@earendil-works/pi-coding-agent/package.json", { cwd: packageRoot })
    .map(path => join(packageRoot, dirname(path)));
  assert.equal(installed.length, 1, "Only one physical Pi package should be installed");
  assert.equal(realpathSync(piCli), join(realpathSync(installed[0]), "dist/bundle/cli.js"));
  const native = await import(pathToFileURL(resolve(dirname(piCli), "../index.js")));
  assert.equal(SessionManager, native.SessionManager);
});
