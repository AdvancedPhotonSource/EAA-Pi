import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { agentDir, initialize, readJson, writeJson } from "./config.js";
import type { ServerEntry } from "pi-experiment-ops/mcp-types";

type Json = Record<string, any>;
type Validator = (value: string) => string | undefined;
const nameError: Validator = value => /^[a-zA-Z0-9_-]+$/.test(value) ? undefined : "Use letters, numbers, hyphens, or underscores.";
const envError: Validator = value => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? undefined : "Enter an environment variable name, such as MY_API_KEY.";
const urlError: Validator = value => {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return;
  } catch { /* Show the same guidance for malformed URLs. */ }
  return "Enter a complete http:// or https:// address without a username or password.";
};
const localPath = (value: string) => resolve(value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value);

class Prompts {
  private rl = createInterface({ input: process.stdin, output: process.stdout });
  private lines = this.rl[Symbol.asyncIterator]();
  constructor() { this.rl.on("SIGINT", () => this.rl.close()); }
  close() { this.rl.close(); }
  async ask(label: string, fallback = "", validate?: Validator): Promise<string> {
    while (true) {
      process.stdout.write(`${label}${fallback ? ` [${fallback}]` : ""}: `);
      const next = await this.lines.next();
      if (next.done) throw new Error("Configuration cancelled: input ended. Completed steps have been saved.");
      const value = next.value.trim() || fallback;
      const error = validate?.(value);
      if (!error) return value;
      console.log(error);
    }
  }
  required(label: string, fallback = "", validate?: Validator) {
    return this.ask(label, fallback, value => value ? validate?.(value) : "Please enter a value.");
  }
  choice(label: string, choices: string[], fallback: string) {
    return this.ask(`${label} (${choices.join("/")})`, fallback,
      value => choices.includes(value) ? undefined : `Choose ${choices.join(" or ")}.`);
  }
  async yes(label: string, fallback = false) {
    const value = await this.ask(`${label} (${fallback ? "Y/n" : "y/N"})`, fallback ? "y" : "n",
      value => /^(y|yes|n|no)$/i.test(value) ? undefined : "Enter yes or no.");
    return /^y/i.test(value);
  }
}

async function configureProvider(workspace: string, prompts: Prompts) {
  const modelsPath = join(agentDir(workspace), "models.json");
  const settingsPath = join(agentDir(workspace), "settings.json");
  const config = readJson<Json>(modelsPath);
  const settings = readJson<Json>(settingsPath);
  console.log("A provider is the service that runs your AI model. Have its address and model ID ready.");
  console.log("Choose argo for Argonne's Argo service, or openai for any service with an OpenAI-compatible chat API.");
  const preset = await prompts.choice("Provider type", ["argo", "openai"], "openai");
  const name = await prompts.required("Provider name", preset === "argo" ? "argo" : "inference", nameError);
  const previous = config.providers?.[name] ?? {};
  if (config.providers?.[name] && !await prompts.yes(`Update existing provider ${name}?`)) return;
  const baseUrl = await prompts.required("Provider address (base URL)", previous.baseUrl ?? (preset === "argo" ? "https://apps.inside.anl.gov/argoapi/v1" : ""), urlError);
  let apiKey = previous.apiKey ?? "keyless-endpoint";
  let user: string | undefined;
  if (preset === "argo") {
    user = await prompts.required("Argonne username", "", value => /^[a-zA-Z0-9._-]+$/.test(value) ? undefined : "Enter your Argonne username.");
    apiKey = user;
  } else {
    console.log("Use an environment variable for your API key. Leave blank to keep existing authentication, or use a service without a key.");
    const keyEnv = await prompts.ask("API key environment variable name", "", value => value ? envError(value) : undefined);
    if (keyEnv) {
      apiKey = `$${keyEnv}`;
      console.log(`Before launching EAA Pi, set ${keyEnv} in your terminal: export ${keyEnv}='YOUR_API_KEY'`);
    }
  }
  const modelId = await prompts.required("Model ID", settings.defaultProvider === name ? settings.defaultModel ?? "" : "");
  const existingModels: Json[] = previous.models ?? [];
  const existingModel = existingModels.find(model => model.id === modelId) ?? {};
  const images = await prompts.yes("Can this model accept images?", existingModel.input?.includes("image") ?? false);
  const model = { ...existingModel, id: modelId, input: images ? ["text", "image"] : ["text"],
    ...(user ? { samplingParams: { ...existingModel.samplingParams, user } } : {}) };
  const useDefault = await prompts.yes("Use this provider and model by default?", true);
  const provider = { ...previous, baseUrl, api: "openai-completions", apiKey,
    ...(preset === "argo" ? { compat: { ...previous.compat, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false } } : {}),
    models: [...existingModels.filter(model => model.id !== modelId), model] };
  writeJson(modelsPath, { ...config, providers: { ...config.providers, [name]: provider } });
  if (useDefault) writeJson(settingsPath, { ...settings, defaultProvider: name, defaultModel: modelId });
  console.log(`Saved provider ${name} and model ${modelId}${useDefault ? " as the default" : ""}.`);
}

async function addMcp(workspace: string, prompts: Prompts) {
  const path = join(workspace, ".pi/mcp.json");
  const config = readJson<Json>(path);
  const name = await prompts.required("MCP server name", "", value => nameError(value) ??
    (Object.hasOwn(config.mcpServers ?? {}, value) ? "That server name already exists. Choose another name." : undefined));
  console.log("Choose http for a web address, sse for an older SSE server, or stdio to launch a local program.");
  const transport = await prompts.choice("Transport", ["http", "sse", "stdio"], "http");
  const server: ServerEntry = { directTools: true, lifecycle: "eager" };
  if (transport === "stdio") {
    server.command = await prompts.required("Program to run (for example uv, python3, or npx)");
    server.args = [];
    console.log("Enter one command argument at a time, without shell quotes. Leave blank when finished.");
    while (true) {
      const argument = await prompts.ask("Argument");
      if (!argument) break;
      server.args.push(argument);
    }
    const cwd = await prompts.ask("Working directory (blank uses the workspace)");
    if (cwd) server.cwd = localPath(cwd);
    console.log("The program inherits your terminal's environment. Add any extra variables below; use $env:NAME to read a value from the environment.");
    const env: Record<string, string> = Object.create(null);
    while (true) {
      const key = await prompts.ask("Environment variable name (blank finishes)", "", value => value ? envError(value) : undefined);
      if (!key) break;
      env[key] = await prompts.ask("Value");
    }
    if (Object.keys(env).length) server.env = env;
  } else {
    server.url = await prompts.required("Server URL", "", urlError);
    server.httpTransport = transport === "http" ? "streamable-http" : "sse";
    console.log("Use auto to let the server request sign-in, none for no authentication, bearer for an access token, or oauth for browser sign-in.");
    const auth = await prompts.choice("Authentication", ["auto", "none", "bearer", "oauth"], "auto");
    if (auth === "none") server.auth = false;
    else if (auth === "bearer" || auth === "oauth") server.auth = auth;
    if (auth === "bearer") {
      server.bearerTokenEnv = await prompts.required("Environment variable containing the access token", "", envError);
      console.log(`Set ${server.bearerTokenEnv} in your terminal before launching EAA Pi.`);
    }
    console.log("Add any required HTTP headers below; use $env:NAME for a value stored in the environment.");
    const headers: Record<string, string> = Object.create(null);
    while (true) {
      const key = await prompts.ask("Header name (blank finishes)", "", value => value && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value) ? "Enter a valid HTTP header name." : undefined);
      if (!key) break;
      headers[key] = await prompts.required("Header value");
    }
    if (Object.keys(headers).length) server.headers = headers;
  }
  writeJson(path, { ...config, mcpServers: { ...config.mcpServers, [name]: server } });
  console.log(`Added MCP server ${name}. Restart EAA Pi to connect to it.`);
}

function copySkill(workspace: string, value: string) {
  const source = realpathSync(localPath(value));
  if (!statSync(source).isDirectory() || !existsSync(join(source, "SKILL.md")) || !statSync(join(source, "SKILL.md")).isFile()) {
    throw new Error("Choose a skill folder containing a SKILL.md file.");
  }
  const root = join(workspace, ".pi/skills");
  mkdirSync(root, { recursive: true });
  const destination = join(root, basename(source));
  if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error(`Skill folder already exists: ${destination}. Choose a different folder name or remove the installed copy first.`);
  const relativeDestination = relative(source, realpathSync(root));
  if (relativeDestination === "" || (!isAbsolute(relativeDestination) && relativeDestination !== ".." && !relativeDestination.startsWith(`..${sep}`))) {
    throw new Error("The source skill folder cannot contain the workspace's skills directory.");
  }
  const staging = mkdtempSync(join(root, ".install-"));
  try {
    cpSync(source, join(staging, "skill"), { recursive: true, verbatimSymlinks: true });
    renameSync(join(staging, "skill"), destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Copied skill to ${destination}. Restart EAA Pi, then use /skill:<name> with the name in SKILL.md.`);
}

export async function configure(workspace: string, args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("eaa-pi config [--workspace DIR]\neaa-pi config add-mcp [--workspace DIR]\neaa-pi config add-skill [SKILL_DIRECTORY] [--workspace DIR]\nDefault workspace: current directory. MCP and skill steps are optional.");
    return;
  }
  const [command, source, ...extra] = args;
  if (extra.length || (command !== undefined && command !== "add-mcp" && command !== "add-skill") || (source && command !== "add-skill")) {
    throw new Error("Use eaa-pi config, config add-mcp, or config add-skill [SKILL_DIRECTORY].");
  }
  workspace = initialize(workspace);
  console.log(`Workspace: ${workspace}`);
  if (command === "add-skill" && source) { copySkill(workspace, source); return; }
  const prompts = new Prompts();
  try {
    if (command === "add-mcp") await addMcp(workspace, prompts);
    else if (command === "add-skill") copySkill(workspace, await prompts.required("Path to skill folder"));
    else {
      const settings = readJson<Json>(join(agentDir(workspace), "settings.json"));
      if (settings.defaultProvider && settings.defaultModel) console.log(`Current default: ${settings.defaultProvider} / ${settings.defaultModel}`);
      if (await prompts.yes("Set up a provider and model?", !settings.defaultProvider)) await configureProvider(workspace, prompts);
      const webPath = join(workspace, "eaa-pi.json");
      const web = readJson<Json>(webPath);
      const port = await prompts.required("Web interface port", String(web.port ?? 8010), value =>
        /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? undefined : "Enter a port number from 1 to 65535.");
      writeJson(webPath, { ...web, port: Number(port) });
      if (await prompts.yes("Add an MCP server to connect external tools?")) await addMcp(workspace, prompts);
      if (await prompts.yes("Copy a skill into this workspace?")) copySkill(workspace, await prompts.required("Path to skill folder"));
      console.log("Workspace setup saved. Launch eaa-pi pi or eaa-pi serve with this workspace.");
    }
  } finally { prompts.close(); }
}
