import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const source = resolve(import.meta.dirname, "..");
const target = mkdtempSync(join(tmpdir(), "eaa-pi-package-"));
const run = (command, args, cwd = target) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
console.log(`Packing application for ${target}`);
const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", target], source))[0];
assert.ok(packed.bundled.includes("pi-experiment-ops"));
console.log("Installing packaged application");
run("npm", ["install", "--prefix", target, "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", join(target, packed.filename)]);
const root = join(target, "node_modules/eaa-pi");
const piPackages = run("npm", ["ls", "--parseable", "--all", "@earendil-works/pi-coding-agent"], root).trim().split("\n").filter(path => path.endsWith("/@earendil-works/pi-coding-agent"));
assert.equal(piPackages.length, 1, "Packaged eaa-pi must install exactly one Pi package through experiment-ops");
assert.ok(existsSync(join(root, "dist/webui/index.html")));
for (const file of ["public/mathjax/LICENSE", "README.md", "THIRD_PARTY.md", "docs/installation.md", "docs/architecture.md", "docs/validation.md", "examples/config/eaa-pi.json", "vendor/pi-experiment-ops-0.2.0.tgz", "npm-shrinkwrap.json", "Dockerfile", "compose.yaml"]) assert.ok(existsSync(join(root, file)), `Missing packaged resource: ${file}`);
console.log("Provisioning packaged runtime and checking installer idempotency");
const workspace = join(target, "workspace");
run("bash", [join(root, "scripts/install.sh"), workspace]);
// Exercise the shipped installer twice: it must preserve workspace configuration.
const before = readFileSync(join(workspace, "eaa-pi.json"), "utf8");
run("bash", [join(root, "scripts/install.sh"), workspace]);
assert.equal(readFileSync(join(workspace, "eaa-pi.json"), "utf8"), before);
const child = spawn(process.execPath, [join(root, "bin/eaa-pi.mjs"), "demo", "--workspace", workspace, "--port", "0"], { cwd: target, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { output += chunk; });
const until = async predicate => {
  for (let i = 0; i < 1800; i++) {
    if (child.exitCode !== null) throw new Error(output);
    const value = await predicate(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Packaged startup timed out: " + output);
};
try {
  const url = await until(() => output.match(/listening at (http:\/\/[^\s]+)/)?.[1]);
  assert.equal((await (await fetch(url + "/api/health")).json()).extensions, 8);
  assert.equal((await fetch(url)).status, 200);
  const response = await fetch(url + "/api/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"content":"hello packaged application"}' });
  assert.equal(response.status, 201);
  await until(async () => (await (await fetch(url + "/api/state")).json()).conversations[0].messages.some(m => m.content === "Demo reply: hello packaged application"));
  const workflow = await (await fetch(url + "/api/workflows/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"workflow":"toy","input":"packaged toy"}' })).json();
  await until(async () => (await (await fetch(url + "/api/workflows")).json()).runs.some(run => run.id === workflow.id && run.status === "completed"));
  console.log(`Packaged install, idempotent installer, chat, frontend, eight extensions, and pi-graph passed in ${target}`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 10000).unref())]);
}
