import { initialize as initializeOps, configureEnvironment as configureOps, resources, workspacePaths } from "pi-experiment-ops";
import { SettingsManager } from "pi-experiment-ops/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, unlinkSync, constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE_ROOT = existsSync(join(ROOT, "package.json")) ? ROOT : resolve(ROOT, "..");
export interface Config {
  provider: string;
  model: string;
  host: string;
  port: number;
}
export const defaults: Config = { provider: "", model: "", host: "127.0.0.1", port: 8010 };
export const dataDir = (workspace: string) => join(workspace, ".eaa-pi");
export const agentDir = (workspace: string) => workspacePaths(workspace).agentDirectory;
export const sessionDir = (workspace: string) => workspacePaths(workspace).sessionDirectory;
export function migrateLegacySessions(workspace: string) {
  const legacy = join(dataDir(workspace), "agent", "sessions");
  const target = sessionDir(workspace);
  mkdirSync(target, { recursive: true });
  for (const source of [legacy, join(legacy, basename(target))]) {
    if (!existsSync(source)) continue;
    for (const file of readdirSync(source).filter(file => file.endsWith(".jsonl"))) {
      const from = join(source, file), to = join(target, file);
      if (existsSync(to)) {
        if (!readFileSync(from).equals(readFileSync(to))) throw new Error(`Session migration conflict: ${to}`);
      } else copyFileSync(from, to, constants.COPYFILE_EXCL);
      unlinkSync(from);
    }
  }
}
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}
export function initialize(workspace: string): string {
  workspace = initializeOps(workspace);
  migrateLegacyConfiguration(workspace);
  for (const dir of [dataDir(workspace), join(dataDir(workspace), "artifacts")]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const configPath = join(workspace, "eaa-pi.json");
  if (!existsSync(configPath)) writeJson(configPath, readJson(join(PACKAGE_ROOT, "examples/config/eaa-pi.json")));
  return workspace;
}
export function configureEnvironment(workspace: string) {
  configureOps(workspace);
  process.env.EAA_PI_ROOT = PACKAGE_ROOT;
  process.env.EAA_PI_WORKSPACE = workspace;
  process.env.PATH = [join(PACKAGE_ROOT, "bin/shims"), process.env.PATH].join(":");
}
export function loadConfig(workspace: string): Config {
  const web = readJson<{ host?: string; port?: number }>(join(workspace, "eaa-pi.json"));
  const settings = SettingsManager.create(workspace, agentDir(workspace));
  return { host: web.host ?? defaults.host, port: web.port ?? defaults.port,
    provider: settings.getDefaultProvider() ?? "", model: settings.getDefaultModel() ?? "" };
}

// Import legacy EAA configuration once; established experiment-ops providers win.
export function migrateLegacyConfiguration(workspace: string) {
  const legacy = join(dataDir(workspace), "agent");
  const target = agentDir(workspace);
  const configPath = join(workspace, "eaa-pi.json");
  const config = existsSync(configPath) ? readJson<Record<string, any>>(configPath) : {};
  const hasLegacySelection = ["provider", "model", "providerWorkspace"].some(key => Object.hasOwn(config, key));
  const marker = join(dataDir(workspace), "workspace-migrated");
  if (existsSync(marker) && !hasLegacySelection) return;
  mkdirSync(target, { recursive: true });
  const settingsPath = join(target, "settings.json");
  const settings = existsSync(settingsPath) ? readJson<Record<string, any>>(settingsPath) : {};
  const hasNativeProvider = settings.defaultProvider || settings.defaultModel || ["models.json", "auth.json"].some(name => existsSync(join(target, name)));
  if (!hasNativeProvider) for (const name of ["models.json", "auth.json"]) {
    const from = join(legacy, name), to = join(target, name);
    if (existsSync(from)) copyFileSync(from, to, constants.COPYFILE_EXCL);
  }
  let changed = false;
  for (const [old, key] of [["provider", "defaultProvider"], ["model", "defaultModel"]]) {
    if (!hasNativeProvider && typeof config[old] === "string" && config[old] && !config[old].startsWith("YOUR_")) {
      settings[key] = config[old]; changed = true;
    }
  }
  if (changed) writeJson(settingsPath, settings);
  if (hasLegacySelection) {
    for (const key of ["provider", "model", "providerWorkspace"]) delete config[key];
    writeJson(configPath, config);
  }
  if (existsSync(legacy) || hasLegacySelection) {
    mkdirSync(dataDir(workspace), { recursive: true });
    writeFileSync(marker, "Native experiment-ops workspace configured.\n");
  }
}

export function adapterResources() {
  return resources(Object.fromEntries(["policy", "mcp", "terminal", "archive"].map(name => [name, join(PACKAGE_ROOT, `extensions/${name}.ts`)])));
}
