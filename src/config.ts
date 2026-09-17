import { initialize as initializeOps, configureEnvironment as configureOps, resources } from "pi-experiment-ops";
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE_ROOT = existsSync(join(ROOT, "package.json")) ? ROOT : resolve(ROOT, "..");
export interface Config {
  provider: string;
  model: string;
  providerWorkspace?: string;
  host: string;
  port: number;
}
export const defaults: Config = { provider: "", model: "", host: "127.0.0.1", port: 8010 };
export const dataDir = (workspace: string) => join(workspace, ".eaa-pi");
export const agentDir = (workspace: string) => join(dataDir(workspace), "agent");
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
export function initialize(workspace: string): string {
  mkdirSync(workspace, { recursive: true });
  workspace = realpathSync(workspace);
  for (const dir of [dataDir(workspace), agentDir(workspace), join(dataDir(workspace), "artifacts"), join(workspace, ".pi", "agents")]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  initializeOps(workspace, agentDir(workspace));
  for (const [name, path] of [["eaa-pi.json", join(workspace, "eaa-pi.json")], ["models.json", join(agentDir(workspace), "models.json")]]) {
    if (!existsSync(path)) writeJson(path, readJson(join(PACKAGE_ROOT, "examples/config", name)));
  }
  return workspace;
}
export function configureEnvironment(workspace: string) {
  configureOps(workspace, { dataDirectory: dataDir(workspace), agentDirectory: agentDir(workspace) });
  process.env.EAA_PI_ROOT = PACKAGE_ROOT;
  process.env.EAA_PI_WORKSPACE = workspace;
  process.env.PATH = [join(PACKAGE_ROOT, "bin/shims"), process.env.PATH].join(":");
}
export function loadConfig(workspace: string): Config {
  const config = { ...defaults, ...readJson<Partial<Config>>(join(workspace, "eaa-pi.json")) };
  if (config.provider === "YOUR_PROVIDER_NAME") config.provider = "";
  if (config.model === "YOUR_MODEL_ID") config.model = "";
  return config;
}

// Materialize the selected provider locally so the SDK and upstream Pi children
// use the same files without sharing sessions, extensions, or mutable settings.
export function syncProviderConfiguration(workspace: string) {
  const config = loadConfig(workspace);
  const readOptional = (path: string): Record<string, any> => existsSync(path) ? readJson(path) : {};
  const localModelsPath = join(agentDir(workspace), "models.json");
  const localModels = readOptional(localModelsPath);
  if (!config.providerWorkspace) {
    if (applyModelInputDefaults(localModels)) writeJson(localModelsPath, localModels);
    return;
  }
  if (typeof config.providerWorkspace !== "string") throw new Error("providerWorkspace must be a workspace path");
  if (!config.provider || !config.model) throw new Error("Set provider and model in eaa-pi.json before using providerWorkspace");
  const source = join(resolve(workspace, config.providerWorkspace), ".pi-experiment-ops/agent");
  const modelsPath = join(source, "models.json");
  if (!existsSync(modelsPath)) throw new Error(`Provider configuration not found: ${modelsPath}. providerWorkspace must point to a configured pi-experiment-ops workspace, not its installation directory.`);
  const shared = readJson<{ providers?: Record<string, { models?: { id: string }[] }> }>(modelsPath);
  const provider = shared.providers?.[config.provider];
  if (!provider) throw new Error(`Provider ${config.provider} is not defined in ${modelsPath}`);
  if (!provider.models?.some(model => model.id === config.model)) throw new Error(`Model ${config.model} is not defined for ${config.provider} in ${modelsPath}`);
  const auth = readOptional(join(source, "auth.json"));
  const localAuthPath = join(agentDir(workspace), "auth.json");
  const localAuth = readOptional(localAuthPath);
  localModels.providers = { ...localModels.providers, [config.provider]: provider };
  // A stale local credential must not override the selected source's apiKey.
  delete localAuth[config.provider];
  if (Object.hasOwn(auth, config.provider)) localAuth[config.provider] = auth[config.provider];
  applyModelInputDefaults(localModels);
  for (const [path, value] of [[localModelsPath, localModels], [localAuthPath, localAuth]] as const) {
    const text = JSON.stringify(value, null, 2) + "\n";
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeJson(path, value);
    chmodSync(path, 0o600);
  }
}

// Persist defaults for upstream Pi processes that read models.json themselves.
function applyModelInputDefaults(config: { providers?: Record<string, { models?: { input?: string[] }[] }> }) {
  let changed = false;
  for (const provider of Object.values(config.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (!Object.hasOwn(model, "input")) {
        model.input = ["text", "image"];
        changed = true;
      }
    }
  }
  return changed;
}

export function adapterResources() {
  return resources(Object.fromEntries(["policy", "mcp", "terminal", "archive"].map(name => [name, join(PACKAGE_ROOT, `extensions/${name}.ts`)])));
}
