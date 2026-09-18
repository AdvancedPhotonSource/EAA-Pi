import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function configureDemoWorkflow(workspace: string) {
  const definition = join(workspace, "workflows/toy/steps.yaml");
  if (!existsSync(definition)) return;
  const source = readFileSync(definition, "utf8");
  if (/^model: local-test\/toy$/m.test(source)) writeFileSync(definition, source.replace(/^model: local-test\/toy$/m, "model: eaa-demo/toy"));
}

export async function jsonBody(request: IncomingMessage, limit = 12 * 1024 * 1024): Promise<any> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString() || "{}");
}
export const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

/** Deterministic protocol fixture, deliberately not a general-purpose model. */
export async function startModelFixture() {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/v1/models") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ data: [{ id: "toy" }] })); return; }
      if (req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
      const body = await jsonBody(req);
      requests.push(body);
      const lastUser = [...body.messages].reverse().find((m: any) => m.role === "user");
      const text = typeof lastUser?.content === "string" ? lastUser.content : (lastUser?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      const tools = body.tools?.map((t: any) => t.function.name) ?? [];
      const afterTool = body.messages.at(-1)?.role === "tool";
      let output = `Demo reply: ${text || "Ready."}`;
      let call: { name: string; args: unknown } | undefined;
      if (!afterTool && text.includes("EAA_BOUNDARY_WRITE")) call = { name: "write", args: { path: "/fixtures/sentinel", content: "escaped" } };
      else if ((text.includes("PI_OPS_TOY_GENERATE") || text.includes("EAA_TOY_GENERATE"))) output = JSON.stringify({ title: "Toy dataset", values: [1, 2, 3] });
      else if ((text.includes("PI_OPS_TOY_REVIEW") || text.includes("EAA_TOY_REVIEW"))) output = JSON.stringify({ approved: !text.includes("reject-review"), reason: "Deterministic toy review" });
      else if (afterTool) output = "Tool completed. " + String(body.messages.at(-1).content).slice(0, 1200);
      else if (/^\/?fixture-tool /.test(text)) {
        const spec = JSON.parse(text.slice(text.indexOf(" ") + 1));
        call = { name: spec.name, args: spec.arguments ?? {} };
      } else if (text.startsWith("read ") && tools.includes("read")) call = { name: "read", args: { path: text.slice(5) } };
      else if (text === "review in background" && tools.includes("subagent")) call = { name: "subagent", args: { agent: "reviewer", task: "Say 'Reviewer finished'", async: true } };
      else if (text === "run background job" && tools.includes("process")) call = { name: "process", args: { action: "start", name: "toy-job", command: "sleep 2; printf 'toy-job finished\\n'" } };
      else if (text === "open terminal" && tools.includes("interactive_shell")) call = { name: "interactive_shell", args: { command: "bash --noprofile --norc", mode: "dispatch", background: true, handsFree: { autoExitOnQuiet: false } } };
      else if (text === "request approval" && tools.includes("eaa_confirm")) call = { name: "eaa_confirm", args: { message: "Approve the toy action?" } };
      if (Array.isArray(lastUser?.content) && lastUser.content.some((b: any) => b.type === "image_url")) output = "Image received by the local fixture.";
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const completionId = "chatcmpl-" + randomUUID();
      const send = (delta: unknown, finish: string | null = null) => res.write("data: " + JSON.stringify({ id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model: "toy", choices: [{ index: 0, delta, finish_reason: finish }] }) + "\n\n");
      send({ role: "assistant", content: "" });
      if (text.includes("slow-workflow")) await new Promise(resolve => setTimeout(resolve, 8000));
      if (call) {
        send({ tool_calls: [{ index: 0, id: "call_" + randomUUID().replaceAll("-", ""), type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] });
        send({}, "tool_calls");
      } else {
        for (const piece of output.match(/.{1,24}/gs) ?? []) {
          if (res.destroyed) return;
          send({ content: piece });
          await new Promise(resolve => setTimeout(resolve, text.includes("slow response") ? 180 : 8));
        }
        send({}, "stop");
      }
      res.write("data: " + JSON.stringify({ id: completionId, object: "chat.completion.chunk", model: "toy", choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) + "\n\n");
      res.end("data: [DONE]\n\n");
    } catch (error) { if (!res.headersSent) res.writeHead(400); res.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, requests, url: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/** Minimal simulated MCP service. Its shared queue owns physical operations to completion. */
export async function startInstrumentFixture() {
  let tail = Promise.resolve();
  const jobs = new Map<string, any>();
  const events: { id: string; operation: string; event: string; at: number }[] = [];
  const schemas = [
    { name: "operate", description: "Run a serialized simulated instrument operation", inputSchema: { type: "object", properties: { operation: { type: "string" }, durationMs: { type: "number" }, background: { type: "boolean" } }, required: ["operation"] } },
    { name: "status", description: "Read simulated job status", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { id: { type: "string" } } } },
    { name: "image", description: "Return a toy image", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {} } },
  ];
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    try {
      const body = await jsonBody(req);
      if (body.id === undefined) { res.writeHead(202).end(); return; }
      let result: unknown;
      if (body.method === "initialize") result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "eaa-toy-instrument", version: "1.0.0" } };
      else if (body.method === "ping") result = {};
      else if (body.method === "tools/list") result = { tools: schemas };
      else if (body.method === "resources/list") result = { resources: [] };
      else if (body.method === "prompts/list") result = { prompts: [] };
      else if (body.method === "tools/call") {
        const args = body.params.arguments ?? {};
        if (body.params.name === "image") result = { content: [{ type: "image", data: tinyPng, mimeType: "image/png" }] };
        else if (body.params.name === "status") result = { content: [{ type: "text", text: JSON.stringify(args.id ? jobs.get(args.id) : [...jobs.values()]) }] };
        else if (body.params.name === "operate") {
          const job = { id: randomUUID(), operation: String(args.operation), status: "queued" };
          jobs.set(job.id, job);
          const execution = tail.then(async () => {
            job.status = "running";
            events.push({ id: job.id, operation: job.operation, event: "start", at: Date.now() });
            await new Promise(resolve => setTimeout(resolve, Math.min(3000, Math.max(0, Number(args.durationMs) || 100))));
            job.status = "completed";
            events.push({ id: job.id, operation: job.operation, event: "end", at: Date.now() });
          });
          tail = execution.catch(() => {});
          if (!args.background) await execution;
          result = { content: [{ type: "text", text: JSON.stringify(job) }] };
        } else throw new Error("Unknown tool");
      } else { res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } })); return; }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, events, jobs, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, close: async () => { await tail; await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); } };
}
