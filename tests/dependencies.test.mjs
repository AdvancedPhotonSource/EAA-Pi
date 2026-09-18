import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { piCli, packageRoot } from "pi-experiment-ops";
import { SessionManager } from "pi-experiment-ops/sdk";
import { PACKAGE_ROOT } from "../dist/server/config.js";

test("experiment-ops owns the single installed Pi SDK and CLI", async () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.ok(Object.keys(manifest.dependencies).every(name => !name.startsWith("@earendil-works/pi-")));
  assert.equal(realpathSync(packageRoot), join(PACKAGE_ROOT, "node_modules/pi-experiment-ops"));
  const installed = execFileSync("npm", ["ls", "--parseable", "--all", "@earendil-works/pi-coding-agent"], { cwd: PACKAGE_ROOT, encoding: "utf8" }).trim().split("\n").filter(path => path.endsWith("/@earendil-works/pi-coding-agent"));
  assert.equal(installed.length, 1, "Only one physical Pi package should be installed");
  assert.equal(realpathSync(piCli), join(realpathSync(installed[0]), "dist/bundle/cli.js"));
  const native = await import(pathToFileURL(resolve(dirname(piCli), "../index.js")));
  assert.equal(SessionManager, native.SessionManager);
});
