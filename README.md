# EAA Pi

EAA's React control center, backed by Pi and community extensions. This repository owns the frontend, MathJax assets, HTTP/SSE adapter, and browser extension bridges. It consumes the independently installable **pi-experiment-ops** bundle for Pi, community resources, Python provisioning, and the toy workflow. A versioned bundle tarball is included in `vendor/`, so installation needs no sibling checkout.

## Quickstart

Requirements: native Linux, Node.js **22.19 or newer**, Git, Bash, and [uv](https://docs.astral.sh/uv/getting-started/installation/). The installer provisions Python 3.12 and the locked graph dependencies. A C/C++ toolchain may be needed if a PTY binary is unavailable for your platform.

```bash
bash scripts/install.sh /tmp/my-eaa-demo
node bin/eaa-pi.mjs demo --workspace /tmp/my-eaa-demo
```

To use `eaa-pi` in place of `node bin/eaa-pi.mjs`, run this once from the repository root:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/eaa-pi.mjs" "$HOME/.local/bin/eaa-pi"
export PATH="$HOME/.local/bin:$PATH"
```

The shortcut works from any directory. If needed, add the `export` line to `~/.bashrc` to keep it available in new terminals. See [command setup](docs/installation.md#enable-the-eaa-pi-command) for tarball installations and removing the link.

Open **http://127.0.0.1:8010**. The demo uses a local deterministic model endpoint and simulated MCP instrument; no provider credentials are required. Try `hello`, `request approval`, `run background job`, `review in background`, or `open terminal`. Use **Sessions & tools → Run toy workflow** to exercise generator → reviewer → image creation.

For a real provider, initialize an EAA workspace:

```bash
eaa-pi init --workspace /path/to/workspace
```

**Already configured Argo in pi-experiment-ops?** Edit `/path/to/workspace/eaa-pi.json`:

```json
{
  "provider": "argo",
  "model": "YOUR_CONFIGURED_MODEL_ID",
  "providerWorkspace": "/path/to/your/pi-experiment-ops-workspace",
  "host": "127.0.0.1",
  "port": 8010
}
```

Use the workspace that contains `.pi-experiment-ops/agent/models.json`, rather than the package's installation directory. Set `providerWorkspace` to `"."` if both applications use the same workspace. EAA reads the selected provider/model definition and any matching `auth.json` credential from that workspace; you do not need to edit EAA's `models.json`. EAA refreshes its local copy at startup, including for subagents and workflows. Restart EAA after changing the source configuration. Environment-based credentials must also be exported in the shell that starts EAA.

**Configuring a custom endpoint directly in EAA?** Leave `providerWorkspace` empty. Edit both generated files:

- `eaa-pi.json`: select the provider **name** and model ID.
- `.eaa-pi/agent/models.json`: define that provider's `baseUrl`, API protocol, authentication, and supported models. The provider name and model ID must match `eaa-pi.json`.

For built-in Pi providers, select the provider/model and configure authentication; a custom `models.json` entry is optional. See [configuration and authentication](docs/configuration.md#real-provider-authentication) for complete examples and sharing behavior.

Then start EAA:

```bash
eaa-pi serve --workspace /path/to/workspace
```

Native execution has the permissions of your operating-system account. The supplied container configuration provides a filesystem boundary for the server and all agent descendants. The service defaults to local, single-user access.

## Use Pi's terminal interface

Launch Pi's TUI with an EAA workspace and its configured provider, without starting the web server:

```bash
eaa-pi pi --workspace /path/to/workspace -- --provider argo --model gpt55
```

Replace `argo` and `gpt55` with your configured provider/model. Stop the web server before using the same workspace in the TUI. EAA's command loads its browser extension bridges; for regular terminal-only use with native terminal extensions, use `pi-experiment-ops pi --workspace /path/to/pi-workspace`. See [TUI and CLI usage](docs/installation.md#pi-tui-and-cli-passthrough) for configuration details.

## Guides

- [Installation, packaging, upgrades, and uninstall](docs/installation.md)
- [Configuration, authentication, and MCP](docs/configuration.md)
- [Frontend, sessions, jobs, terminals, and recovery](docs/usage.md)
- [Workflow authoring and toy example](docs/workflows.md)
- [Containers and execution policy](docs/security.md)
- [Repository separation and bundle upgrades](docs/repositories.md)
- [Architecture and HTTP/SSE API](docs/architecture.md)
- [Compatibility and capability validation](docs/validation.md)
- [Upstream provenance and notices](THIRD_PARTY.md)

## Development and verification

To test changes in a sibling `pi-experiment-ops` checkout without repacking it, use the [local development link](docs/repositories.md#developing-both-repositories-together). Restart EAA after bundle code changes; the saved release dependency remains pinned.

```bash
npm run check
npm run build
npm test
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" npx playwright install chromium
npm run test:browser
npm run test:package
npm run test:container
```

The acceptance suite exercises installed Pi packages and actual pi-graph child processes. The deterministic provider tests transport, tool calls, images, orchestration, persistence, and policy enforcement; optional live-provider validation is described separately in the validation guide.
