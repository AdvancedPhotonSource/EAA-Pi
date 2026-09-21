export type WebUIRoutes = {
  events: string;
  state: string;
  image: string;
  send: string;
  interrupt: string;
  approval: string;
  permissions: string;
  upload: string;
  skillCatalog: string;
  toolSchemas: string;
  mcpReconnect: string;
  mathjax: string;
};

export type WebUIConfig = {
  title: string;
  runtimeUrl: string;
  pollIntervalMs: number;
  routes: WebUIRoutes;
};

export type WebUIMessage = {
  id?: string | number;
  role?: string;
  content?: string;
  image?: string;
  images?: string[];
  timestamp?: string;
  tool_calls?: unknown;
  pending?: boolean;
  approval_id?: string;
  approval_requested_at?: string;
  approval_expires_at?: string;
  approval_timeout_seconds?: number;
  approval_options?: ApprovalOption[];
};

export type RuntimeLogEntry = {
  id: string;
  timestamp: string;
  source: string;
  level: string;
  message: string;
  tool_name?: string | null;
  progress?: number | null;
  total?: number | null;
};

export type TerminalChunk = {
  stream: "stdout" | "stderr" | string;
  text: string;
};

export type RuntimeTerminal = {
  command: string;
  status: "running" | "completed" | "failed" | "timed_out" | string;
  chunks: TerminalChunk[];
  sequence: number;
  returncode?: number | null;
  timeout?: boolean;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

export type RuntimeSnapshot = {
  session_id?: string;
  sequence?: number;
  conversations?: RuntimeConversation[];
  messages?: WebUIMessage[];
  logs?: RuntimeLogEntry[];
  status?: string;
  input_requested?: boolean;
  interrupt_requested?: boolean;
  pending_approval?: PendingApproval | null;
  tool_execution_queue?: ToolExecutionQueueEntry[];
  message_queue?: MessageQueueEntry[];
  plan_mode?: boolean;
  plan_mode_available?: boolean;
  permission_auto_allow?: boolean;
};

export type ApprovalDecision = "allow_once" | "allow_session" | "deny";
export type ApprovalOption = { decision: ApprovalDecision; label: string };

export type ToolExecutionQueueEntry = {
  job_id: string;
  tool_name: string;
  conversation_id: string;
  conversation_label: string;
  status: "executing" | string;
  timestamp: string;
};

export type MessageQueueEntry = {
  job_id: string;
  tool_name: string;
  conversation_id: string;
  conversation_label: string;
  status: "completed" | "failed" | string;
  content: string;
  queued_at: string;
};

export type PendingApproval = {
  id?: string;
  conversation_id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  requested_at?: string;
  expires_at?: string;
  timeout_seconds?: number;
  options?: ApprovalOption[];
};

export type RuntimeConversation = {
  id: string;
  label: string;
  kind: "primary" | "subagent" | string;
  status?: string;
  terminated?: boolean;
  messages?: WebUIMessage[];
  pending_approval?: PendingApproval | null;
  terminal?: RuntimeTerminal | null;
};

export type Skill = {
  name?: string;
  description?: string;
};

export type ToolSchema = {
  type?: string;
  mcp?: {
    server_id?: string;
    server_name?: string;
    tool_name?: string;
  };
  function?: {
    name?: string;
    description?: string;
    parameters?: {
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  };
};

declare global {
  interface Window {
    EAA_WEBUI_CONFIG?: WebUIConfig;
    MathJax?: {
      tex?: Record<string, unknown>;
      svg?: Record<string, unknown>;
      typesetPromise?: (elements: Element[]) => Promise<void>;
    };
  }
}
