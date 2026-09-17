# Configuration, providers, and MCP

## Workspace

`eaa-pi init --workspace DIR` creates an explicit configuration and data root:

| Path | Contents |
|---|---|
| `eaa-pi.json` | Provider/model selection, optional `providerWorkspace`, host, port |
| `.eaa-pi/agent/settings.json` | Pi host settings and project trust |
| `.eaa-pi/agent/auth.json` | Pi credentials and OAuth tokens |
| `.eaa-pi/agent/models.json` | Custom provider template with endpoint and authentication placeholders |
| `.eaa-pi/agent/interactive-shell.json` | PTY output query interval (five seconds) |
| `.eaa-pi/agent/modes.config.json` | Build/plan mode configuration |
| `.eaa-pi/agent/sessions/` | Authoritative primary Pi JSONL sessions |
| `.eaa-pi/agent/children/` | Durable Pi-format child transcript projections |
| `.eaa-pi/children/` | Captured child JSON events, grouped by primary session |
| `.eaa-pi/subagents/` | Upstream subagent lifecycle, control, and result artifacts |
| `.eaa-pi/graph/` | Copied workflow definitions, run ledgers, state, receipts |
| `.eaa-pi/artifacts/` | Content-addressed gallery images |
| `.eaa-pi/adapter.sqlite` | Frontend snapshots, relationships, artifact references, completion IDs |
| `.eaa-pi/mcp-trace.jsonl` | Bounded MCP protocol metadata trace |
| `.pi/archive.db` | Pinned archive's searchable transcript index |
| `.pi/mcp.json` | Explicit MCP server configuration |
| `.pi/agents/reviewer.md` | Toy ad hoc reviewer definition |
| `workflows/toy/` | Editable toy workflow source |

Global Pi extensions and original EAA configuration are not imported. The host sets `PI_CODING_AGENT_DIR`, `PI_SUBAGENTS_TEMP_ROOT`, graph paths, and a workspace temporary directory before loading extensions. It explicitly supplies bundle resources with browser-specific entrypoint replacements. Workspace files and descendants still have native filesystem access unless the entire application runs in the container.

## Real provider authentication

`eaa-pi.json` selects a provider by name, such as `argo`, and a model ID. A custom provider's endpoint, authentication, and model definitions live in `models.json`. Choose one of the following configuration sources.

### Reuse a pi-experiment-ops workspace

If `pi-experiment-ops` is already configured, point EAA to that workspace in `eaa-pi.json`:

```json
{
  "provider": "argo",
  "model": "YOUR_CONFIGURED_MODEL_ID",
  "providerWorkspace": "/path/to/pi-experiment-ops-workspace",
  "host": "127.0.0.1",
  "port": 8010
}
```

The source must contain `.pi-experiment-ops/agent/models.json` with the selected provider and model. `providerWorkspace` is a workspace path, not the package installation path. Relative paths resolve from the EAA workspace; `"."` selects the same workspace. Use an absolute path for a separate workspace. Omitting the field or setting it to `""` selects EAA-local configuration.

EAA reads the selected provider's entire definition, including its available models and Argo-specific request settings, plus its credential entry from `.pi-experiment-ops/agent/auth.json` when present. It refreshes those entries in EAA's local `models.json` and `auth.json` before serving, loading a session, running `doctor`, or launching the `pi`/`piw` passthrough. This gives SDK sessions and Pi child processes the same configuration. The source files stay unchanged; settings, extensions, and sessions remain EAA-owned. Other local provider entries are preserved.

While sharing is enabled, the source takes precedence for the selected provider. A local credential for that provider is removed if the source has no matching `auth.json` entry, allowing its `models.json` authentication settings to take effect. Export referenced credential environment variables in EAA's launch environment. OAuth token refreshes and `/login` through EAA modify the local copy; authenticate in the source workspace for credentials intended to be shared. Copies containing credentials are written with owner-only permissions.

Restart EAA after editing the source. A missing source file, provider, or model produces a setup error rather than using an older local copy. `doctor` reports the resolved source workspace. Setting `providerWorkspace` back to `""` retains the last imported entries for local use; edit or remove them as needed. `init` preserves existing configuration and does not perform the import. Use a separate workspace for `demo`.

For containers, mount the source workspace read-only and use its container path in `providerWorkspace`; see [container configuration](security.md#container-usage).

### Configure providers directly in EAA

`init` creates both configuration templates and preserves existing files on subsequent runs. In `eaa-pi.json`, replace `YOUR_PROVIDER_NAME` and `YOUR_MODEL_ID`. For a custom endpoint, edit `.eaa-pi/agent/models.json`: use the same provider name and model ID, replace `https://YOUR_ENDPOINT_HOST/v1` with the endpoint's API base URL, and replace `YOUR_API_KEY_ENV_VAR` with the name of your exported credential variable (keep the `${...}` syntax). Adjust the API protocol, model capabilities, token limits, and cost values to match your service; the template assumes OpenAI-compatible chat completions. The provider name is a label, such as `argo`, rather than a URL.

For built-in providers, you can leave the unused custom provider template as generated. Unchanged provider/model placeholders count as unconfigured; `doctor` reports `providerConfigured: false`, and model input requests a configuration update.

The `input` field in a custom model entry is optional. EAA defaults it to `["text", "image"]`; use `"input": ["text"]` for a text-only endpoint. Explicit values are preserved. Before loading models, EAA writes missing defaults into its local `models.json` so the web UI, `eaa-pi pi` TUI, and child agents use the same capabilities. When using `providerWorkspace`, defaults are applied to EAA's local copy and the source file stays unchanged. This default applies to EAA's launchers; standalone `pi-experiment-ops` retains Pi's own defaults.

Restart EAA or its TUI after editing model capabilities. If an image read reports “Current model does not support images,” remove an unintended `"input": ["text"]` entry or change it to `["text", "image"]`, restart, and read the image again.

Set `eaa-pi.json` to a provider/model available in the pinned Pi catalog:

```json
{"provider":"anthropic","model":"YOUR_MODEL_ID","host":"127.0.0.1","port":8010}
```

Use the provider's environment key when starting the server, or launch `eaa-pi pi --workspace DIR` and use Pi's `/login` flow for supported OAuth providers. Authentication created through this CLI goes into the workspace's `.eaa-pi/agent/auth.json`. The browser receives conversation content and tool results, never a provider credential configuration response. Keys inherited by a native server are available to its trusted extension/child processes.

For an OpenAI-compatible endpoint, edit the generated `.eaa-pi/agent/models.json`, for example:

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

Use `provider: "local-provider"`, `model: "my-model"` in `eaa-pi.json`. Consult the pinned Pi [custom model documentation](https://pi.dev/docs/latest/models) for authentication value resolution and provider-specific fields. The SDK host runs offline catalog lookup; explicit network provider calls remain available.

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

The bridge loads this configuration through upstream `createMcpAdapter`. Individual tools appear in the tool viewer; the proxy and script tools also remain available in build mode. The default server prefix permits attribution and reconnect controls. Host-tool discovery is disabled. For HTTP authentication, use upstream MCP adapter configuration/OAuth support; keep secrets in server-side configuration.

`approveTools` supports upstream booleans and allowlisted tool-name patterns. Browser confirmation grants **Allow once** or **Deny**; session-wide grants are available through Pi's native interfaces. Pending approvals expire after 120 seconds and interruption denies them. The WebUI tool viewer provides reconnect for configured, prefixed tools while the runtime is idle. Changing the configuration file requires restarting this factory-based host.

The Logs pane shows connection snapshots, metadata-only protocol traces, and tool execution events. Complete MCP server logging/progress payloads are unavailable through the inspected public interfaces. No backend fork or internal event interception is used to claim otherwise. Traces intentionally omit argument/result payloads; model-visible tool results appear in conversations. See [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) for the upstream configuration contract.
