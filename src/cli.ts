import { initialize as initializeOps, packageRoot as opsRoot, piwCli } from "pi-experiment-ops";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { initialize, configureEnvironment, loadConfig, writeJson, agentDir, migrateLegacySessions, PACKAGE_ROOT, adapterResources } from "./config.js";
import { startModelFixture, startInstrumentFixture } from "./fixture.js";

const args = process.argv.slice(2);
const command = args.shift() || "serve";
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error(`${name} requires a value`);
  return args.splice(index, 2)[1];
}
if (command === "help" || command === "--help") {
  console.log("eaa-pi init|doctor|serve|demo|pi|piw [--workspace DIR] [--host HOST] [--port PORT]\nPi and piw arguments follow --. Default workspace: current directory.");
} else if (command === "pi") {
  const workspace = initializeOps(resolve(option("--workspace", process.cwd())));
  migrateLegacySessions(workspace);
  const forwarded = args[0] === "--" ? args.slice(1) : args;
  const child = spawn(process.execPath, [join(opsRoot, "bin/pi-experiment-ops.mjs"), "pi", "--workspace", workspace, "--", ...forwarded], { cwd: workspace, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143); });
} else {
  const workspace = initialize(resolve(option("--workspace", command === "demo" ? ".demo" : process.cwd())));
  configureEnvironment(workspace);
  if (command === "init") console.log(`Initialized ${workspace}. Configure provider settings in .pi-experiment-ops/agent using pi-experiment-ops configure, or edit settings.json and models.json there. See docs/configuration.md. Configure .pi/mcp.json as needed, then run eaa-pi serve --workspace ${workspace}`);
  else if (command === "doctor") {
    const paths = adapterResources();
    const checks = [
      { name: "Node.js", ok: Number(process.versions.node.split(".")[0]) > 22 || (Number(process.versions.node.split(".")[0]) === 22 && Number(process.versions.node.split(".")[1]) >= 19), detail: process.versions.node },
      { name: "Frontend", ok: existsSync(join(PACKAGE_ROOT, "dist/webui/index.html")) },
      { name: "Pi extensions", ok: paths.extensions.every(existsSync) },
      { name: "Python dependencies", ok: spawnSync(process.env.PI_GRAPH_PYTHON!, ["-c", "import yaml, ruamel.yaml, jsonschema"]).status === 0 },
      { name: "Pi CLI", ok: spawnSync(join(PACKAGE_ROOT, "bin/shims/pi"), ["--version"], { encoding: "utf8" }).status === 0 },
    ];
    const config = loadConfig(workspace);
    console.log(JSON.stringify({ workspace, checks, providerConfigured: Boolean(config.provider && config.model), agentDirectory: agentDir(workspace) }, null, 2));
    process.exitCode = checks.every(check => check.ok) ? 0 : 1;
  } else if (command === "piw") {
    process.chdir(workspace);
    const forwarded = args[0] === "--" ? args.slice(1) : args;
    const child = spawn(piwCli, forwarded, { cwd: workspace, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
    child.on("error", error => { console.error(error.message); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
  } else if (command === "serve" || command === "demo") {
    if (command === "demo" && (loadConfig(workspace).provider && loadConfig(workspace).provider !== "eaa-demo")) throw new Error("Use a separate workspace for the demo; this workspace has a provider configured.");
    const model = command === "demo" ? await startModelFixture() : undefined;
    const instrument = command === "demo" ? await startInstrumentFixture() : undefined;
    if (model && instrument) {
      const settingsPath = join(agentDir(workspace), "settings.json");
      writeJson(settingsPath, { ...JSON.parse(readFileSync(settingsPath, "utf8")), defaultProvider: "eaa-demo", defaultModel: "toy" });
      const previousModels = existsSync(join(agentDir(workspace), "models.json")) ? JSON.parse(readFileSync(join(agentDir(workspace), "models.json"), "utf8")) : {};
      writeJson(join(agentDir(workspace), "models.json"), { ...previousModels, providers: { ...previousModels.providers, "eaa-demo": { baseUrl: model.url, api: "openai-completions", apiKey: "local-fixture", models: [{ id: "toy", name: "EAA deterministic fixture", reasoning: false, input: ["text", "image"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
      const previousMcp = JSON.parse(readFileSync(join(workspace, ".pi/mcp.json"), "utf8"));
      writeJson(join(workspace, ".pi/mcp.json"), { ...previousMcp, mcpServers: { ...previousMcp.mcpServers, toy: { url: instrument.url, directTools: true, lifecycle: "eager" } } });
    }
    const { Runtime } = await import("./runtime.js");
    const { startServer } = await import("./server.js");
    const runtime = new Runtime(workspace);
    await runtime.start();
    const app = await startServer(runtime, Number(option("--port", String(runtime.config.port))), option("--host", runtime.config.host));
    console.log(`EAA Pi ${command === "demo" ? "credential-free demo " : ""}listening at ${app.url}`);
    let stopping = false;
    const close = async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
      await model?.close();
      await instrument?.close();
      process.exit(0); // Upstream CLI extensions may retain background timers after their shutdown hooks.
    };
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void close().catch(error => { console.error(error); process.exitCode = 1; }));
  } else throw new Error(`Unknown command: ${command}`);
}
