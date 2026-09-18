import type { ExtensionAPI } from "pi-experiment-ops/sdk";
import { registerRequiredChildExtensions } from "pi-experiment-ops/subagents";
import { join } from "node:path";

// The host also checks direct browser operations; these hooks cover model calls.
export default function (pi: ExtensionAPI) {
  let plan = false;
  let registration: { dispose(): void } | undefined;
  const readers = new Set(["read", "grep", "find", "ls", "pi_modes_plan_complete"]);
  pi.events.on("eaa:mode", (event: any) => { plan = event.plan; });
  pi.on("tool_call", (event) => {
    if (plan && !readers.has(event.toolName)) return { block: true, reason: "EAA plan mode permits reader tools only." };
  });
  pi.on("user_bash", () => {
    if (plan) return { result: { output: "Shell commands are disabled in EAA plan mode.", exitCode: 1, cancelled: false, truncated: false } };
  });
  pi.on("session_start", (_event, ctx) => {
    registration?.dispose();
    registration = registerRequiredChildExtensions({ sessionId: ctx.sessionManager.getSessionId(), extensions: [{ id: "eaa-child-observer", path: join(process.env.EAA_PI_ROOT!, "extensions/child.ts") }] });
    pi.events.emit("eaa:context", ctx);
  });
  pi.on("session_shutdown", () => registration?.dispose());
  pi.events.on("eaa:confirm", async (request: any) => {
    // Actual UI confirmation is supplied by the SDK host.
    pi.events.emit("eaa:confirm-request", request);
  });
}
