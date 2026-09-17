import shell from "pi-experiment-ops/shell";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

// Adapt the upstream factory's public tool registration, without reaching into its manager.
export default function (pi: ExtensionAPI) {
  let tool: ToolDefinition | undefined;
  let context: ExtensionContext;
  pi.on("session_start", (_event, ctx) => { context = { ...ctx, hasUI: false }; });
  shell(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return (definition: ToolDefinition) => {
      const execute = definition.execute;
      definition = { ...definition, execute: (id, args: any, signal, update, ctx) => execute(id,
        args.command && !args.sessionId ? { ...args, mode: "dispatch", background: true, handsFree: { ...args.handsFree, autoExitOnQuiet: false } } : args,
        signal, update, { ...ctx, hasUI: false }) };
      if (definition.name === "interactive_shell") tool = definition;
      target.registerTool(definition);
    };
    return Reflect.get(target, key);
  } }));
  pi.events.on("eaa:terminal", async (request: any) => {
    try {
      if (!tool || !context) throw new Error("Terminal extension is not ready");
      request.resolve(await tool.execute(request.id, request.params, request.signal, request.update, context));
    } catch (error) { request.reject(error); }
  });
}
