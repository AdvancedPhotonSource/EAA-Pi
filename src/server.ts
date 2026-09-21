import { createServer, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { PACKAGE_ROOT, readJson } from "./config.js";
import { jsonBody } from "./fixture.js";
import { Runtime, HttpError } from "./runtime.js";
import { Workflows } from "./workflows.js";

export async function startServer(runtime: Runtime, port = runtime.config.port, host = runtime.config.host) {
  const streams = new Set<ServerResponse>();
  const workflows = new Workflows(runtime);
  const event = (event: any) => {
    const data = `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const stream of streams) {
      if (stream.writableLength > 2 * 1024 * 1024) { stream.destroy(); streams.delete(stream); }
      else stream.write(data);
    }
  };
  runtime.on("event", event);
  let boundPort = port;
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    try {
      const allowed = new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`, `${host}:${boundPort}`]);
      if (!req.headers.host || !allowed.has(req.headers.host)) throw new HttpError(403, "Invalid Host header");
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, "Cross-origin requests are not allowed");
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const route = url.pathname;
      const json = (data: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      if (req.method === "GET") {
        if (route === "/api/state") return json(runtime.snapshot);
        if (route === "/api/health") return json({ ok: true, extensions: runtime.extensions.length, session_id: runtime.snapshot.session_id });
        if (route === "/api/events") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
          res.write(`id: ${runtime.snapshot.sequence}\nevent: snapshot\ndata: ${JSON.stringify(runtime.snapshot)}\n\n`);
          streams.add(res);
          const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
          req.on("close", () => { streams.delete(res); clearInterval(heartbeat); }); return;
        }
        if (route === "/api/skill-catalog") return json({ skills: runtime.loader.getSkills().skills.map(s => ({ name: s.name, description: s.description })) });
        if (route === "/api/tool-schemas") return json({ tools: runtime.session.getAllTools().map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters }, mcp: runtime.mcpTools.has(tool.name) ? { server_id: runtime.mcpTools.get(tool.name), server_name: runtime.mcpTools.get(tool.name), status: runtime.mcpStatus?.servers?.find((s: any) => s.name === runtime.mcpTools.get(tool.name))?.status } : undefined })) });
        if (route === "/api/sessions") return json({ sessions: await runtime.sessions(), active: runtime.snapshot.session_id });
        if (route === "/api/agents") return json({ agents: await runtime.availableAgents() });
        if (route === "/api/subagents") return json(await runtime.rpc("status"));
        if (route === "/api/workflows") {
          const rows = runtime.store.db.prepare("SELECT value FROM metadata WHERE key LIKE 'workflow:%'").all() as { value: string }[];
          return json({ workflows: workflows.list(), runs: rows.map(row => JSON.parse(row.value)).filter(run => run.sessionId === runtime.snapshot.session_id) });
        }
        if (route === "/api/image") {
          const artifact = runtime.store.resolveArtifact(url.searchParams.get("path") || "");
          if (!artifact) throw new HttpError(404, "Unknown artifact");
          res.writeHead(200, { "Content-Type": artifact.mime }); createReadStream(artifact.path).pipe(res); return;
        }
        let file: string | undefined;
        if (route === "/") file = join(PACKAGE_ROOT, "dist/webui/index.html");
        else if (route.startsWith("/static/webui/")) {
          const root = join(PACKAGE_ROOT, "dist/webui");
          const target = resolve(root, decodeURIComponent(route.slice(14)));
          if (target.startsWith(root + "/")) file = target;
        } else if (route === "/static/mathjax/es5/tex-svg-full.js") file = join(PACKAGE_ROOT, "public/mathjax/tex-svg-full.js");
        if (!file || !existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, "Not found");
        const mime = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" } as Record<string, string>)[extname(file)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime }); createReadStream(file).pipe(res); return;
      }
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
      if (!req.headers["content-type"]?.startsWith("application/json") && route !== "/api/interrupt") throw new HttpError(415, "Use application/json");
      const body = await jsonBody(req);
      if (route === "/api/input") {
        if (body.plan_mode !== undefined && typeof body.plan_mode !== "boolean") throw new HttpError(400, "plan_mode must be a boolean");
        const pending = runtime.conversation("primary").pending_approval;
        if (pending && /^(y|yes|n|no)$/i.test(String(body.content).trim())) {
          runtime.approve(String(pending.id), /^(y|yes)$/i.test(String(body.content).trim())); return json({ ok: true, handled_as: "approval" }, 201);
        }
        const content = String(body.content || "");
        const attachments = [...content.matchAll(/<img\s+([^>]+)>/g)].map(match => match[1].trim());
        await runtime.input(content, body.plan_mode, [...(body.images ?? []), ...attachments]); return json({ ok: true }, 201);
      }
      if (route === "/api/interrupt") { await runtime.interrupt(); return json({ ok: true }); }
      if (route === "/api/mode") { if (typeof body.plan_mode !== "boolean") throw new HttpError(400, "plan_mode must be boolean"); await runtime.mode(body.plan_mode); return json({ ok: true }); }
      if (route === "/api/permissions") {
        if (typeof body.auto_allow !== "boolean") throw new HttpError(400, "auto_allow must be boolean");
        return json(runtime.setPermissionAutoAllow(body.auto_allow));
      }
      if (route === "/api/approval") {
        const decision = body.decision ?? body.approved;
        if (typeof decision !== "boolean" && !["allow_once", "allow_session", "deny"].includes(decision)) throw new HttpError(400, "decision must be allow_once, allow_session, or deny");
        runtime.approve(String(body.approval_id || ""), decision); return json({ ok: true });
      }
      if (route === "/api/upload-image") {
        const match = String(body.image_data || "").match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) throw new HttpError(400, "Expected a supported image data URL");
        const path = runtime.store.artifact(Buffer.from(match[2], "base64"), match[1]);
        return json({ file_path: path }, 201);
      }
      if (route === "/api/mcp/reconnect") {
        runtime.requireIdle();
        const name = String(body.server_id || "");
        if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new HttpError(400, "Invalid server ID");
        if (!readJson<any>(join(runtime.workspace, ".pi/mcp.json")).mcpServers?.[name]) throw new HttpError(404, "Unknown MCP server");
        await runtime.session.prompt(`/mcp reconnect ${name}`); return json({ ok: true, mcp: { server_name: name } });
      }
      if (route === "/api/sessions") {
        if (!["new", "resume", "branch"].includes(body.action)) throw new HttpError(400, "Unknown session action");
        await runtime.replaceSession(body.action, body.session_id); return json({ ok: true, session_id: runtime.snapshot.session_id });
      }
      if (route === "/api/subagents") return json(await runtime.spawnChild(String(body.task || ""), body.agent), 201);
      const child = route.match(/^\/api\/subagents\/([^/]+)\/(steer|stop)$/);
      if (child) return json(await runtime.childAction(decodeURIComponent(child[1]), child[2] as "steer" | "stop", body.message));
      if (route === "/api/processes") return json(await runtime.startProcess(String(body.command || "")), 201);
      if (route === "/api/terminals") return json(await runtime.openTerminal(body.command), 201);
      const terminal = route.match(/^\/api\/terminals\/([^/]+)\/input$/);
      if (terminal) return json(await runtime.terminal({ sessionId: decodeURIComponent(terminal[1]), input: String(body.input ?? ""), submit: body.submit !== false }));
      if (route === "/api/workflows/run") return json(await workflows.run(String(body.input || ""), body.workflow), 201);
      if (route === "/api/workflows/resume") return json(await workflows.run("", undefined, body.id), 201);
      const job = route.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (job) { const jobId = decodeURIComponent(job[1]); return json(jobId.startsWith("workflow:") ? workflows.cancel(jobId.slice(9)) : await runtime.cancelJob(jobId)); }
      throw new HttpError(404, "Unknown API route");
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : (error as any).status || 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error), message: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  boundPort = (server.address() as { port: number }).port;
  return { server, workflows, url: `http://127.0.0.1:${boundPort}`, close: async () => {
    await workflows.close();
    runtime.off("event", event);
    for (const stream of streams) stream.end();
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    await runtime.close();
  } };
}
