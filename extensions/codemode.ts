import { resources } from "pi-experiment-ops";
import type { ExtensionAPI } from "pi-experiment-ops/sdk";

// UI polling must preserve the one-shot metadata that CodeMode passes to Pi.
function mergeMetadata(target: any, source: any) {
  if (source.usage) {
    if (!target.usage) target.usage = structuredClone(source.usage);
    else for (const [key, value] of Object.entries(source.usage)) {
      if (key === "cost") for (const [kind, cost] of Object.entries(value as any)) target.usage.cost[kind] = (target.usage.cost[kind] ?? 0) + (cost as number);
      else target.usage[key] = (target.usage[key] ?? 0) + (value as number);
    }
  }
  if (source.addedToolNames) target.addedToolNames = [...new Set([...(target.addedToolNames ?? []), ...source.addedToolNames])];
  if (source.terminate) target.terminate = true;
}

export default async function (pi: ExtensionAPI) {
  const path = resources().extensions.find(path => path.endsWith("/@ian-pascoe/pi-codemode/src/index.ts"));
  if (!path) throw new Error("CodeMode resource is unavailable");
  const upstream = await import(path);
  const tools = new Map<string, any>();
  const metadata = new Map<string, any>();
  pi.on("session_shutdown", async () => {
    metadata.clear();
    // Process-group shutdown may have already closed a worker's stdin. Cancellation
    // terminates workers before upstream cleanup attempts a graceful pipe write.
    const result = await tools.get("codemode_sessions")?.execute("eaa-shutdown", {});
    for (const session of result?.details?.sessions ?? []) {
      await tools.get("codemode_cancel")?.execute("eaa-shutdown", { sessionId: session.sessionId });
    }
  });
  pi.events.on("eaa:codemode", async (request: any) => {
    try {
      const tool = tools.get(request.action === "cancel" ? "codemode_cancel" : "codemode_result");
      if (!tool) throw new Error("CodeMode tool is unavailable");
      const result = await tool.execute(request.id, { sessionId: request.sessionId });
      const saved = metadata.get(request.sessionId) ?? {};
      mergeMetadata(saved, result);
      if (Object.keys(saved).length) metadata.set(request.sessionId, saved);
      request.resolve(result.details);
    } catch (error) { request.reject(error); }
  });
  await upstream.default(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (tool: any) => {
      tools.set(tool.name, tool);
      if (!["codemode_execute", "codemode_result"].includes(tool.name)) return target.registerTool(tool);
      target.registerTool({ ...tool, execute: async (...args: any[]) => {
        // Capture an earlier cell's terminal state before a reusable session is advanced.
        const sessionId = args[1]?.sessionId;
        if (tool.name === "codemode_execute" && sessionId) {
          const previous = await tools.get("codemode_result")?.execute(args[0], { sessionId });
          if (previous) {
            const saved = metadata.get(sessionId) ?? {};
            mergeMetadata(saved, previous);
            if (Object.keys(saved).length) metadata.set(sessionId, saved);
            pi.events.emit("eaa:codemode-status", previous.details);
          }
        }
        const result = await tool.execute(...args);
        const details = result.details;
        const saved = metadata.get(details?.sessionId);
        if (saved && details.result !== "pending" && details.error?.code !== "busy") {
          mergeMetadata(result, saved);
          metadata.delete(details.sessionId);
        }
        if (tool.name === "codemode_result") pi.events.emit("eaa:codemode-status", details);
        return result;
      } });
    };
    return Reflect.get(target, key);
  } }));
}
