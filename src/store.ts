import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, writeFileSync, openSync, closeSync, constants } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.js";

export interface Message {
  id: string;
  role: string;
  content: string;
  images?: string[];
  timestamp?: string;
  tool_calls?: unknown;
}
export interface Terminal {
  command: string;
  status: string;
  chunks: { stream: string; text: string }[];
  sequence: number;
  returncode?: number;
}
export interface Conversation {
  id: string;
  label: string;
  kind: string;
  parent_id?: string;
  status?: string;
  terminated?: boolean;
  messages: Message[];
  terminal?: Terminal;
  pending_approval?: Record<string, unknown> | null;
}
export interface Job {
  job_id: string;
  tool_name: string;
  conversation_id: string;
  conversation_label: string;
  status: string;
  timestamp: string;
  content?: string;
  queued_at?: string;
}
export interface Snapshot {
  conversations: Conversation[];
  logs: Record<string, unknown>[];
  status: string;
  input_requested: boolean;
  interrupt_requested: boolean;
  plan_mode: boolean;
  plan_mode_available: boolean;
  tool_execution_queue: Job[];
  message_queue: Job[];
  session_id: string;
  sequence: number;
  capabilities: Record<string, boolean>;
}
export class Store {
  db: DatabaseSync;
  constructor(readonly workspace: string) {
    this.db = new DatabaseSync(join(dataDir(workspace), "adapter.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (session_id TEXT PRIMARY KEY, snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, path TEXT NOT NULL, mime TEXT NOT NULL); CREATE TABLE IF NOT EXISTS completions (id TEXT PRIMARY KEY);");
  }
  get(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | undefined)?.value;
  }
  set(key: string, value: string) { this.db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(key, value); }
  load(id: string): Snapshot | undefined {
    const row = this.db.prepare("SELECT snapshot FROM state WHERE session_id=?").get(id) as { snapshot: string } | undefined;
    return row ? JSON.parse(row.snapshot) : undefined;
  }
  save(snapshot: Snapshot) { this.db.prepare("INSERT OR REPLACE INTO state VALUES (?,?)").run(snapshot.session_id, JSON.stringify(snapshot)); }
  completeOnce(id: string): boolean { return Number(this.db.prepare("INSERT OR IGNORE INTO completions VALUES (?)").run(id).changes) > 0; }
  artifact(data: Buffer, mime: string): string {
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
    if (!extensions[mime]) throw new Error("Unsupported image type");
    const id = createHash("sha256").update(data).digest("hex") + extensions[mime];
    const path = join(dataDir(this.workspace), "artifacts", id);
    if (realpathSync(join(dataDir(this.workspace), "artifacts")) !== join(dataDir(this.workspace), "artifacts")) throw new Error("Artifact directory must not be a symlink");
    const file = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(file, data); } finally { closeSync(file); }
    this.db.prepare("INSERT OR REPLACE INTO artifacts VALUES (?,?,?)").run(id, path, mime);
    return path;
  }
  resolveArtifact(path: string): { path: string; mime: string } | undefined {
    const row = this.db.prepare("SELECT path,mime FROM artifacts WHERE path=? OR id=?").get(path, path) as { path: string; mime: string } | undefined;
    if (!row) return;
    try { if (realpathSync(row.path) !== row.path) return; } catch { return; }
    return row;
  }
  close() { this.db.close(); }
}
export const id = () => randomUUID();
export const timestamp = () => new Date().toISOString();
