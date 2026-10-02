# EAA Pi

EAA Pi is an AI assistant for experimental work. You can ask it to work with files, analyze data, and use connected tools or instruments, either in a terminal or through a web browser.

It is based on [pi-experiment-ops](https://github.com/AdvancedPhotonSource/pi-experiment-ops), which adds tools for experimental work to [Pi](https://pi.dev/), an AI agent that can carry out tasks on your computer. EAA Pi adds a web interface for conversations, results, and ongoing tasks. Both interfaces use the same project folder, so you can choose whichever suits your work.

## Installation

EAA Pi currently supports **Linux**. Before installing, you need [Node.js](https://nodejs.org/) **22.19 or newer** with npm, [uv](https://docs.astral.sh/uv/getting-started/installation/), Git, Bash, curl, tar, and sha256sum. The installer sets up Python and the remaining dependencies for you.

### Ordinary installation

Open a terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/AdvancedPhotonSource/EAA-Pi/v1.0.0/install.sh | \
  sh -s -- --version 1.0.0
```

This downloads the release and installs the `eaa-pi` command. It also updates your Bash or Zsh startup settings so that the command is available in new terminals. After installation, **open a new terminal**, or run the `source` command printed by the installer. Then follow the quickstart below.

The command requires the installer and package files to be published for that release. If they are not yet available, use the developer installation below. See the [installation guide](docs/installation.md#release-installation) for installation locations, upgrades, and other options.

### Developer installation

To build EAA Pi from its source code, download the repository and run its setup script:

```bash
git clone https://github.com/AdvancedPhotonSource/EAA-Pi.git
cd EAA-Pi
bash scripts/install.sh --runtime-only
```

The script installs dependencies and builds the application. Next, make the `eaa-pi` command available from other folders:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/eaa-pi.mjs" "$HOME/.local/bin/eaa-pi"
export PATH="$HOME/.local/bin:$PATH"
```

Add the `export` line to `~/.bashrc` (or `~/.zshrc` for Zsh) to keep it available in new terminals. After changing the source code, run `npm run build` again. See the [development checks](docs/validation.md#reproduction-and-results) for testing instructions.

## Quickstart

### 1. Create a workspace

A **workspace** is a folder that holds your project's settings, conversations, and results. Choose a folder for your work; this example uses `~/eaa-workspace`, where `~` means your home folder:

```bash
eaa-pi init --workspace ~/eaa-workspace
cd ~/eaa-workspace
```

Initialization creates the configuration files and a skills folder containing `workspace-setup`, which teaches the agent to add tools and skills when you ask. You can also point it at an existing pi-experiment-ops workspace, since the two applications share their settings. Running `init` again preserves existing configuration.

The remaining file paths are relative to this workspace. Folders whose names begin with a dot, such as `.pi`, may be hidden in your file manager; enable “Show hidden files” to see them.

### 2. Configure an AI provider and model

A **provider** is the service that runs your AI model. You need its connection address, the exact model ID, and any required login details or API key. If your workspace already has a working provider, continue to step 3.

Run the guided setup:

```bash
eaa-pi config --workspace ~/eaa-workspace
```

It uses pi-experiment-ops' shared setup for your provider and model, and also asks for the web interface port. Choose `argo` for Argonne's Argo service, or `openai` for a service with an OpenAI-compatible chat API. If your provider needs an API key, setup asks for the name of an environment variable that holds it and shows you how to set that variable before launching EAA Pi.

Setup also offers to add an MCP server and copy a skill. You can skip both and add them later using steps 4 and 5. Existing settings are preserved unless you choose to update them. For other provider types or manual editing, see the [provider configuration guide](docs/configuration.md#real-provider-authentication).

### 3. Choose the default provider and model

During guided setup, answer yes to “Use this provider and model by default?” Both interfaces will then use your selection.

To change it manually later, open `.pi-experiment-ops/agent/settings.json` and update these fields, keeping the other settings:

```json
{
  "defaultProvider": "my-provider",
  "defaultModel": "YOUR_MODEL_ID"
}
```

Use a provider name and model ID listed in `.pi-experiment-ops/agent/models.json`. Separate each setting with a comma, but leave no comma after the last setting.

### 4. Add an MCP server (optional)

An **MCP server** connects the assistant to external tools, such as an instrument controller or a data service. You can skip this step if you only want to chat or work with local files.

Run:

```bash
eaa-pi config add-mcp --workspace ~/eaa-workspace
```

The prompts guide you through naming the server, choosing how to connect, and supplying its address or launch command. For a web server, you can also configure authentication and any required headers. For a local program, enter its arguments one at a time. Setup saves the connection in `.pi/mcp.json`; restart EAA Pi to use it. See the [MCP setup guide](docs/configuration.md#mcp-setup) for details.

### 5. Add skills (optional)

A **skill** is a set of written instructions for a recurring task. To add a skill you have downloaded or written, run:

```bash
eaa-pi config add-skill /path/to/skill/dir --workspace ~/eaa-workspace
```

You can leave out the path and enter it when asked. The command copies the entire folder into `.pi/skills`, including supporting files. The folder must contain `SKILL.md`; an existing skill folder with the same name is kept unchanged.

You can also create a skill directly. For example, write `.pi/skills/analyze-data/SKILL.md` with:

```markdown
---
name: analyze-data
description: Analyze experimental data in this workspace
---
Read the data, explain the analysis, and summarize the findings.
```

After launching EAA Pi, enter `/skill:analyze-data` in the conversation to use it. If EAA Pi is already running when you add a skill, restart it first. To allow agents to auto-discover skills, ensure `defaultPolicy.skills` is set to `"allow"` in `.pi-experiment-ops/agent/pi-permissions.jsonc` (this should be set automatically). See the [workspace configuration guide](docs/configuration.md#workspace).

### 6. Launch the terminal interface (TUI)

To chat directly in your terminal, run:

```bash
eaa-pi pi --workspace ~/eaa-workspace
```

This uses the provider and model you selected above. Type a request to begin.

### 7. Launch the web interface (WebUI)

To work in your browser, close the terminal interface and run:

```bash
eaa-pi serve --workspace ~/eaa-workspace
```

Then open **http://127.0.0.1:8010** in a browser on the same computer, or use the address printed in the terminal if you chose a different port. Keep the terminal running while you use the WebUI; press **Ctrl+C** there to stop it.

The two interfaces share conversations and settings, so use one at a time for a workspace. Restart EAA Pi after changing provider settings or MCP connections.

## Guides

- [Installation, upgrades, and troubleshooting](docs/installation.md)
- [Workspace settings, AI providers, and MCP connections](docs/configuration.md)
- [Using conversations, tools, and background tasks](docs/usage.md)
- [Creating workflows and trying the toy example](docs/workflows.md)
- [Permissions and running in a container](docs/security.md)
- [Developing EAA Pi and pi-experiment-ops together](docs/repositories.md)
- [How the application works and its API](docs/architecture.md)
- [Testing and supported features](docs/validation.md)
- [Included software and licenses](THIRD_PARTY.md)
