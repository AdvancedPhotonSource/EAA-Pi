import { configure as configureOps } from "pi-experiment-ops/config";
import { join } from "node:path";
import { initialize, readJson, writeJson } from "./config.js";

export function configure(workspace: string, args: string[]) {
  return configureOps(workspace, args, {
    commandName: "eaa-pi",
    initializeWorkspace: initialize,
    configureHost: async (workspace, prompts) => {
      const path = join(workspace, "eaa-pi.json");
      const web = readJson<Record<string, unknown>>(path);
      const port = await prompts.required("Web interface port", String(web.port ?? 8010), value =>
        /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? undefined : "Enter a port number from 1 to 65535.");
      writeJson(path, { ...web, port: Number(port) });
    },
  });
}
