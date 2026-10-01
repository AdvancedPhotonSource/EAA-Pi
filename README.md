# EAA Pi

EAA's React control center, backed by Pi and community extensions. This repository owns the frontend, MathJax assets, HTTP/SSE adapter, and browser extension bridges. It consumes the independently installable **pi-experiment-ops** bundle for Pi, community resources, Python provisioning, and the toy workflow. A versioned bundle tarball is included in `vendor/`, so installation needs no sibling checkout.

## Quickstart

Requirements: native Linux, Node.js **22.19 or newer**, Git, Bash, and [uv](https://docs.astral.sh/uv/getting-started/installation/). The installer provisions Python 3.12 and the locked Python dependencies. A C/C++ toolchain may be needed if a PTY binary is unavailable for your platform.

```bash
bash scripts/install.sh /tmp/my-eaa-demo
```

Enable the `eaa-pi` command by running this once from the repository root:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/eaa-pi.mjs" "$HOME/.local/bin/eaa-pi"
export PATH="$HOME/.local/bin:$PATH"
```

The shortcut works from any directory. If needed, add the `export` line to `~/.bashrc` to keep it available in new terminals. See [command setup](docs/installation.md#enable-the-eaa-pi-command) for tarball installations and removing the link.

Start the demo:

```bash
eaa-pi demo --workspace /tmp/my-eaa-demo
```

Open **http://127.0.0.1:8010**. The demo uses a local deterministic model endpoint and simulated MCP instrument; no provider credentials are required. Try `hello`, `request approval`, `run background job`, or `review in background`. Use **Sessions & tools → select toy → enter a task → Run workflow** to exercise generator → reviewer → image creation.

For a real provider, initialize an EAA workspace:

```bash
eaa-pi init --workspace /path/to/workspace
```

If the workspace is already configured for experiment-ops, its provider settings and sessions are ready to use. Otherwise configure the provider with `pi-experiment-ops configure`, or edit `.pi-experiment-ops/agent/models.json` and set `defaultProvider`/`defaultModel` in `.pi-experiment-ops/agent/settings.json`. Both interfaces read these native Pi files directly. `eaa-pi.json` contains only the web host and port.

See [configuration and authentication](docs/configuration.md#real-provider-authentication) for custom endpoints and legacy workspace migration.

Initialization creates the documented configuration files, including `.pi-experiment-ops/agent/models.json` with `{ "providers": {} }` and `auth.json` with `{}`. Rerunning `init` fills in missing files and preserves existing contents. Sessions, logs, databases, and workflow outputs are created when used.

Then start EAA:

```bash
eaa-pi serve --workspace /path/to/workspace
```

Native execution has the permissions of your operating-system account. The supplied container configuration provides a filesystem boundary for the server and all agent descendants. The service defaults to local, single-user access.

## Use Pi's terminal interface

Launch the installed experiment-ops TUI in your workspace:

```bash
eaa-pi pi --workspace /path/to/workspace -- --provider argo --model gpt55
```

Replace `argo` and `gpt55` with a provider/model configured in `.pi-experiment-ops/agent`. The command delegates to the installed `pi-experiment-ops` launcher, including its native terminal extensions. The TUI and WebUI share primary sessions; use one interface per session at a time. See [TUI and CLI usage](docs/installation.md#pi-tui-and-cli-passthrough) for configuration details.

## Workspace skills

Initialization creates `<workspace>/.pi/skills`. Put each skill in `.pi/skills/<name>/SKILL.md`, for example:

```markdown
---
name: analyze-data
description: Analyze experimental data in this workspace
---
Read the data and summarize the findings.
```

Restart eaa-pi after adding skills, then enter `/skill:analyze-data` to load one explicitly. To expose a skill for automatic discovery by the agent, allow it in `.pi-experiment-ops/agent/pi-permissions.jsonc`. The WebUI and experiment-ops TUI both load this directory alongside bundled skills.

## Guides

- [Installation, packaging, upgrades, and uninstall](docs/installation.md)
- [Configuration, authentication, and MCP](docs/configuration.md)
- [Frontend, sessions, jobs, interactive shells, and recovery](docs/usage.md)
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

The acceptance suite exercises installed Pi packages and actual pi-subagents workflows. The deterministic provider tests transport, tool calls, images, orchestration, persistence, and policy enforcement; optional live-provider validation is described separately in the validation guide.
