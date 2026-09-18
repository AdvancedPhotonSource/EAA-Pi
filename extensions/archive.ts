import archive, { openDb, syncSessionFile } from "pi-experiment-ops/archive";
import type { ExtensionAPI } from "pi-experiment-ops/sdk";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Scope the upstream indexer's startup discovery to this application's workspace.
// Its search tool, turn indexing, schema, and shutdown implementation are unchanged.
export default function (pi: ExtensionAPI) {
  archive(new Proxy(pi, { get(target, key) {
    if (key === "on") return (event: string, handler: any) => {
      if (event !== "session_start") target.on(event as any, handler);
    };
    return Reflect.get(target, key);
  } }));
  let db: ReturnType<typeof openDb> | undefined;
  pi.on("session_start", (_event, ctx) => {
    db = openDb(join(ctx.cwd, ".pi/archive.db"));
    for (const directory of ["sessions", "children"]) {
      const root = join(process.env.PI_CODING_AGENT_DIR!, directory);
      if (existsSync(root)) for (const file of readdirSync(root)) {
        if (file.endsWith(".jsonl")) syncSessionFile(db, join(root, file));
      }
    }
  });
  pi.events.on("eaa:archive", (event: any) => { if (db) syncSessionFile(db, event.sessionFile); });
  pi.on("session_shutdown", () => { db?.close(); db = undefined; });
}
