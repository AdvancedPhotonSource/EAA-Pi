import { createMcpAdapter } from "pi-experiment-ops/mcp";
import { getServerPrefix } from "pi-experiment-ops/mcp-types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const config = JSON.parse(readFileSync(join(process.env.EAA_PI_WORKSPACE || process.cwd(), ".pi/mcp.json"), "utf8"));
  config.settings = { ...config.settings, hostConfigDiscovery: "off", trace: { enabled: true, ...config.settings?.trace, file: ".eaa-pi/mcp-trace.jsonl" } };
  for (const server of Object.values(config.mcpServers || {}) as any[]) server.directTools ??= true;
  return createMcpAdapter({ config })(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (tool: any) => {
      const server = Object.entries(config.mcpServers || {}).find(([name, definition]: [string, any]) => {
        const prefix = getServerPrefix(name, definition.toolPrefix ?? config.settings.toolPrefix ?? "server");
        return prefix && tool.name.startsWith(prefix + "_");
      });
      if (server) pi.events.emit("eaa:mcp-tool", { name: tool.name, server: server[0] });
      target.registerTool(tool);
    };
    return Reflect.get(target, key);
  } }));
}
