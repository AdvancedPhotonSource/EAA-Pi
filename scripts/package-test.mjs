import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, globSync, readdirSync } from "node:fs";
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
const prefix = join(target, "installation ' directory"), bin = join(target, "bin ' directory");
const home = join(target, "home");
mkdirSync(home);
const install = () => execFileSync("sh", ["-s", "--", "--archive", join(target, packed.filename), "--prefix", prefix, "--bin-dir", bin], {
  cwd: target, env: { ...process.env, HOME: home, SHELL: "/bin/bash" },
  input: readFileSync(join(source, "install.sh")), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
});
install();
const root = join(prefix, "releases", readdirSync(join(prefix, "releases"))[0], "node_modules/eaa-pi");
const launcher = join(bin, "eaa-pi");
assert.equal(existsSync(join(target, "eaa-pi.json")), false, "Installation must not initialize the caller's directory");
assert.equal(existsSync(join(root, ".demo")), false, "Installation must not create a default workspace");
const piPackages = globSync("node_modules/**/@earendil-works/pi-coding-agent/package.json", { cwd: root });
assert.equal(piPackages.length, 1, "Packaged eaa-pi must install exactly one Pi package through experiment-ops");
assert.ok(existsSync(join(root, "dist/webui/index.html")));
for (const file of ["public/mathjax/LICENSE", "README.md", "THIRD_PARTY.md", "docs/installation.md", "docs/architecture.md", "docs/validation.md", "examples/config/eaa-pi.json", "vendor/pi-experiment-ops-0.6.2.tgz", "npm-shrinkwrap.json", "install.sh", "Dockerfile", "compose.yaml"]) assert.ok(existsSync(join(root, file)), `Missing packaged resource: ${file}`);
console.log("Provisioning packaged runtime and checking installer idempotency");
const workspace = join(target, "workspace");
run(launcher, ["init", "--workspace", workspace]);
const configured = execFileSync(launcher, ["config", "--workspace", workspace], {
  cwd: target, input: "n\n\nn\nn\n", encoding: "utf8", timeout: 15000,
});
assert.match(configured, /Workspace setup saved/);
assert.ok(existsSync(join(workspace, ".pi/skills/workspace-setup/SKILL.md")));
assert.equal(JSON.parse(readFileSync(join(workspace, ".pi-experiment-ops/agent/pi-permissions.jsonc"))).defaultPolicy.skills, "allow");
run(launcher, ["doctor", "--workspace", workspace]);
// Exercise the shipped installer twice: it must preserve workspace configuration.
const before = readFileSync(join(workspace, "eaa-pi.json"), "utf8");
const profileBefore = readFileSync(join(home, ".bashrc"), "utf8");
install();
assert.equal(readFileSync(join(workspace, "eaa-pi.json"), "utf8"), before);
assert.equal(readFileSync(join(home, ".bashrc"), "utf8"), profileBefore);
assert.equal(run("bash", ["--noprofile", "--norc", "-c", '. "$1"; command -v eaa-pi', "profile-test", join(home, ".bashrc")]).trim(), launcher);
const alternate = join(target, "alternate workspace");
mkdirSync(alternate);
run(launcher, ["init"], alternate);
assert.ok(existsSync(join(alternate, "eaa-pi.json")), "The launcher must preserve the caller's working directory");
const child = spawn(launcher, ["demo", "--workspace", workspace, "--port", "0"], { cwd: target, stdio: ["ignore", "pipe", "pipe"] });
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
  assert.equal((await (await fetch(url + "/api/health")).json()).extensions, 11);
  assert.equal((await fetch(url)).status, 200);
  const response = await fetch(url + "/api/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"content":"hello packaged application"}' });
  assert.equal(response.status, 201);
  await until(async () => (await (await fetch(url + "/api/state")).json()).conversations[0].messages.some(m => m.content === "Demo reply: hello packaged application"));
  const workflow = await (await fetch(url + "/api/workflows/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"workflow":"toy","input":"packaged toy"}' })).json();
  await until(async () => (await (await fetch(url + "/api/workflows")).json()).runs.some(run => run.id === workflow.id && run.status === "completed"));
  console.log(`Packaged install, idempotent installer, chat, frontend, eleven extensions, and subagent workflows passed in ${target}`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 10000).unref())]);
}
