import { createReadTool, createBashTool, createEditTool, createWriteTool, createGrepTool, createFindTool, createLsTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRequiredChildExtensions } from "pi-experiment-ops/subagents";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  let file: string;
  let registration: { dispose(): void } | undefined;
  const record = (event: unknown) => { if (file) appendFileSync(file, JSON.stringify(event) + "\n", { mode: 0o600 }); };
  pi.on("session_start", (_event, ctx) => {
    const root = join(process.env.EAA_PI_WORKSPACE!, ".eaa-pi/children", process.env.EAA_PI_PARENT_SESSION!);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    file = join(root, ctx.sessionManager.getSessionId() + ".jsonl");
    record({ type: "eaa_child", id: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(), parent: process.env.EAA_PI_PARENT_SESSION, kind: "subagent" });
    for (const create of [createReadTool, createBashTool, createEditTool, createWriteTool, createGrepTool, createFindTool, createLsTool]) {
      pi.registerTool({ ...create(ctx.cwd), executionMode: "sequential" } as any);
    }
    registration = registerRequiredChildExtensions({ sessionId: ctx.sessionManager.getSessionId(), extensions: [{ id: "eaa-child-observer", path: join(process.env.EAA_PI_ROOT!, "extensions/child.ts") }] });
  });
  pi.on("message_start", record);
  pi.on("message_update", record);
  pi.on("message_end", record);
  pi.on("agent_end", record);
  pi.on("session_shutdown", () => { record({ type: "eaa_child_stopped" }); registration?.dispose(); });
}
