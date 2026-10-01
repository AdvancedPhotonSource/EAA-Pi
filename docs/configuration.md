# Configuration, providers, and MCP

## Guided setup

Run `eaa-pi config --workspace /path/to/workspace` for step-by-step setup. EAA delegates provider, MCP, and skill setup to pi-experiment-ops and adds its own WebUI port prompt. If you omit `--workspace`, it uses the current directory. Setup creates missing workspace files, then offers to configure a provider and model, save them as the defaults, choose the WebUI port, and optionally add an MCP server or skill. Press Enter to accept a displayed default; answer no to skip optional steps.

Provider setup supports Argo and services with an OpenAI-compatible chat API. For Argo, supply your Argonne username and model ID. For other services, supply the base URL and, if needed, the name of an environment variable containing your API key. Setup stores the variable reference, so set its value in the terminal before launching EAA Pi. Existing authentication is retained when you leave that prompt blank. Other provider types can be configured manually as described below.

Settings are saved after each completed step. Updating an existing provider requires confirmation and preserves its other models and unrelated fields. To leave setup, press Ctrl+C; unfinished steps are not saved. Stop a running EAA Pi instance before changing its configuration, and restart it afterward.

You can add tools and skills independently:

```bash
eaa-pi config add-mcp --workspace /path/to/workspace
eaa-pi config add-skill /path/to/skill/dir --workspace /path/to/workspace
```

`add-mcp` asks for a unique server name and a transport: `http` for Streamable HTTP, `sse` for older web servers, or `stdio` for a locally launched program. Web connections accept a URL, optional bearer-token or OAuth authentication, and extra headers. Local connections accept a program, arguments entered one at a time without shell quotes, an optional working directory, and environment variables. Relative directory paths are resolved from the directory where you run the command. Local programs also inherit the launching terminal's environment. Header and environment values can use `$env:NAME` to refer to a terminal environment variable. Setup saves the entry in `.pi/mcp.json` and leaves existing servers intact. It does not start or test the server; connection happens when you next launch EAA Pi. For OAuth, complete authentication through the TUI's `/mcp-auth SERVER_NAME` command when prompted by the server.

`add-skill` copies a folder containing `SKILL.md` into `.pi/skills/<folder-name>`, including its supporting files. Omit the source path to enter it at a prompt. Existing destination folders are never overwritten. Restart EAA Pi after adding a skill, then invoke it with `/skill:name`, using the name in its `SKILL.md`.

## Workspace

`eaa-pi init --workspace DIR` creates an explicit configuration and data root:

| Path | Contents |
|---|---|
| `eaa-pi.json` | Web server host and port |
| `.pi-experiment-ops/agent/settings.json` | Pi host settings and project trust |
| `.pi-experiment-ops/agent/auth.json` | Pi credentials and OAuth tokens |
| `.pi-experiment-ops/agent/models.json` | Native custom provider definitions |
| `.pi-experiment-ops/agent/interactive-shell.json` | PTY output query interval (five seconds) |
| `.pi-experiment-ops/agent/modes.config.json` | Build/plan mode configuration |
| `.pi-experiment-ops/agent/permission-system.json` | Permission extension settings and default session mode |
| `.pi-experiment-ops/agent/pi-permissions.jsonc` | Pattern-based tool, command, MCP, skill, and special-operation policies |
| `.pi-experiment-ops/agent/sessions/<encoded-workspace>/` | Authoritative primary Pi JSONL sessions shared with the experiment-ops TUI |
| `.eaa-pi/agent/children/` | Durable Pi-format child transcript projections |
| `.eaa-pi/children/` | Captured child JSON events, grouped by primary session |
| `.pi-experiment-ops/subagents/` | Upstream subagent lifecycle, control, and result artifacts |
| `.pi-experiment-ops/workflows/runs/` | Copied workflow definitions, outputs, receipts |
| `.eaa-pi/artifacts/` | Content-addressed gallery images |
| `.eaa-pi/adapter.sqlite` | Frontend snapshots, relationships, artifact references, completion IDs |
| `.eaa-pi/mcp-trace.jsonl` | Bounded MCP protocol metadata trace |
| `.pi/archive.db` | Pinned archive's searchable transcript index |
| `.pi/mcp.json` | Explicit MCP server configuration |
| `.pi/agents/reviewer.md` | Toy ad hoc reviewer definition |
| `.pi/skills/` | Workspace skills, each in `<name>/SKILL.md`; includes `workspace-setup` after initialization |
| `workflows/toy/` | Editable toy workflow source |

Initialization creates configuration files, including `models.json` with `{ "providers": {} }` and `auth.json` with `{}`, while preserving existing contents. Sessions, logs, databases, and workflow outputs are created when used. Restart the server after adding workspace skills, then invoke them with `/skill:name`. New workspaces set `defaultPolicy.skills` to `"allow"` in `pi-permissions.jsonc`, so skill descriptions are available for automatic selection. Existing permission files are preserved; change that field to `"allow"` to adopt the new default, keeping individual rules and other permission categories. Initialization adds the shared `workspace-setup` skill, which explains direct MCP JSON editing and skill copying when neither CLI is on PATH. Local edits to that skill are preserved.

Global Pi extensions and original EAA configuration are not imported. The host sets `PI_CODING_AGENT_DIR`, `PI_SUBAGENTS_TEMP_ROOT`, and a workspace temporary directory before loading extensions. It explicitly supplies bundle resources with browser-specific entrypoint replacements. Workspace files and descendants still have native filesystem access unless the entire application runs in the container.

## Real provider authentication

The WebUI and TUI use the same native Pi configuration under `.pi-experiment-ops/agent`. Start eaa-pi with `--workspace` pointing to your configured experiment-ops workspace. `eaa-pi.json` contains only web server settings.

Set `defaultProvider` and `defaultModel` in `.pi-experiment-ops/agent/settings.json`, preserving any existing settings:

```json
{"defaultProvider":"argo","defaultModel":"YOUR_MODEL_ID"}
```

Use `pi-experiment-ops configure` to configure a supported endpoint, or edit native `models.json` and `auth.json`. Built-in providers may use environment credentials or Pi's `/login` flow through `eaa-pi pi --workspace DIR`. OAuth credentials are saved in the shared agent directory. Restart the WebUI after changing model selection or configuration.

For custom providers, specify `input: ["text", "image"]` for vision models or `input: ["text"]` for text-only models. Both interfaces use Pi's native capability handling. The sample `examples/config/models.json` can be adapted into the shared agent directory.

### Legacy EAA workspaces

Run `eaa-pi init --workspace DIR` before switching an existing EAA-only workspace to the new TUI. When native provider configuration is absent, initialization imports legacy models, credentials, and default model selection from the old EAA files. Established experiment-ops provider configuration takes precedence. Legacy files remain available, and a migration marker prevents removed credentials from being restored on later starts. The old provider/model/providerWorkspace fields are removed from the web configuration; future changes belong in the shared native files.

Primary transcripts migrate when either interface starts. Browser history, artifacts, and child display projections remain under `.eaa-pi`. New workflow and subagent runs use experiment-ops' runtime directories; legacy runtime directories remain available for reference.

For an OpenAI-compatible endpoint, edit `.pi-experiment-ops/agent/models.json`, for example:

```json
{
  "providers": {
    "local-provider": {
      "baseUrl": "http://127.0.0.1:9000/v1",
      "api": "openai-completions",
      "apiKey": "$LOCAL_PROVIDER_API_KEY",
      "models": [{"id":"my-model","reasoning":false,"input":["text","image"],"contextWindow":128000,"maxTokens":4096,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]
    }
  }
}
```

Use `defaultProvider: "local-provider"`, `defaultModel: "my-model"` in `.pi-experiment-ops/agent/settings.json`. Consult the pinned Pi [custom model documentation](https://pi.dev/docs/latest/models) for authentication value resolution and provider-specific fields. The SDK host runs offline catalog lookup; explicit network provider calls remain available.

`demo` uses provider `eaa-demo/toy` and refreshes its ephemeral endpoint configuration each launch. Use a dedicated demo workspace. It refuses to replace a configured non-demo provider and preserves other custom provider/server entries.

## MCP setup

Edit `.pi/mcp.json`, then restart the server:

```json
{
  "mcpServers": {
    "instrument": {
      "command": "python3",
      "args": ["/workspace/instrument/server.py"],
      "directTools": true,
      "lifecycle": "eager",
      "approveTools": true
    },
    "remote": {"url":"http://instrument-host:9001/mcp","directTools":true,"lifecycle":"eager"}
  }
}
```

The bridge loads this configuration through upstream `createMcpAdapter`. Individual tools appear in the tool viewer, and the MCP proxy remains available in build mode. `mcpScript` is disabled by default so CodeMode is the single scripted tool-call interface. The default server prefix permits attribution and reconnect controls. Host-tool discovery is disabled. For HTTP authentication, use upstream MCP adapter configuration/OAuth support; keep secrets in server-side configuration.

`approveTools` supports upstream booleans and allowlisted tool-name patterns as an optional, independent MCP-adapter gate. The generated configuration omits it, leaving the general permission system as the default gate for direct MCP tools. If users enable `approveTools`, an MCP call must pass both layers. Pending approvals expire after 120 seconds and interruption denies them. The WebUI tool viewer provides reconnect for configured, prefixed tools while the runtime is idle. Changing the MCP configuration requires restarting this factory-based host.

The Logs pane shows connection snapshots, metadata-only protocol traces, and tool execution events. Complete MCP server logging/progress payloads are unavailable through the inspected public interfaces. No backend fork or internal event interception is used to claim otherwise. Traces intentionally omit argument/result payloads; model-visible tool results appear in conversations. See [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) for the upstream configuration contract.
