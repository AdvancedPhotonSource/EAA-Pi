# Installation and distribution

## Native source installation

Install Node.js ≥22.19, Git, Bash, and uv. Run `bash scripts/install.sh /absolute/workspace`. It installs the npm dependency graph from `npm-shrinkwrap.json`, invokes the installed `pi-experiment-ops` Python installer, builds the frontend/server, and runs `doctor`. Running it again preserves workspace configuration and existing sessions. Python packages are isolated from the system interpreter. `PI_GRAPH_PYTHON` is explicitly set by the CLI; set it yourself only when supplying an equivalent environment.

The application uses Python 3.12; this build was tested with 3.12.11. The Python lock includes hashes. The lock and its update command belong to `pi-experiment-ops`; release a new bundle to update Python dependencies here.

Start from any directory:

```bash
/path/to/eaa-pi/bin/eaa-pi.mjs init --workspace /path/to/workspace
/path/to/eaa-pi/bin/eaa-pi.mjs doctor --workspace /path/to/workspace
/path/to/eaa-pi/bin/eaa-pi.mjs serve --workspace /path/to/workspace --port 8010
```

`doctor` checks the Node version, compiled frontend, extension resources, Python imports, and Pi CLI. `serve` can start before authentication is configured; model input then reports a configuration error. First startup can take tens of seconds while Pi compiles TypeScript extensions.

Configure provider/model selection in `eaa-pi.json`. To reuse an existing `pi-experiment-ops` setup, set `providerWorkspace` to its configured workspace path. For a custom endpoint managed by EAA, edit `.eaa-pi/agent/models.json` as well. See [provider configuration](configuration.md#real-provider-authentication) for both setup paths.

### Enable the `eaa-pi` command

The `eaa-pi` shortcut is a symbolic link to the packaged executable and replaces `node bin/eaa-pi.mjs`. After installing, run these commands from the application's root directory:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/eaa-pi.mjs" "$HOME/.local/bin/eaa-pi"
export PATH="$HOME/.local/bin:$PATH"
eaa-pi serve --workspace /absolute/path/to/workspace
```

If `~/.local/bin` is not already on your shell's `PATH`, add the `export` line to `~/.bashrc` (or your shell's startup file). The link works from any directory and uses Node from your `PATH`. For a tarball installation, run the setup from `/path/to/eaa-install/node_modules/eaa-pi`. Create the link once; if you move the installation, update the link. Remove `~/.local/bin/eaa-pi` when uninstalling.

## Standard Pi package and npm tarball

`pi-experiment-ops` owns the standard Pi resource manifest and pinned community packages. This application consumes its release as a bundled npm dependency, and pins the matching Pi SDK for its host. The vendored release is recorded in `npm-shrinkwrap.json` and included in distribution files. See [repository boundaries and upgrades](repositories.md).
Build and ship:

```bash
npm ci
npm run build
npm pack
```

Install the resulting tarball on another Linux machine:

```bash
mkdir -p /path/to/eaa-install
npm install --prefix /path/to/eaa-install --omit=dev --legacy-peer-deps /path/to/eaa-pi-0.1.0.tgz
bash /path/to/eaa-install/node_modules/eaa-pi/scripts/install.sh /path/to/workspace
/path/to/eaa-install/node_modules/.bin/eaa-pi serve --workspace /path/to/workspace
```

The tarball contains the compiled server/frontend, bundled community resources, bridges, static assets and licenses, configuration examples, guides, npm shrinkwrap, and installation scripts. Building the frontend requires the source checkout; using the tarball requires no source checkout. The installed bundle contains the Python lock and workflow example. Its installer provisions Python under `node_modules/pi-experiment-ops/.runtime/python`.

`--legacy-peer-deps` is intentional: some unchanged community manifests still declare older Pi peer package names. Pi 0.85.1's extension loader supplies compatibility aliases. The runtime uses the pinned current SDK rather than loading a second agent runtime for those peer declarations.

For standalone Pi CLI/TUI use, install `pi-experiment-ops` directly. `eaa-pi` is the web application; its `pi` passthrough loads the browser adapter resources in the selected application workspace. pi-graph's runtime and Python provisioning are managed by the bundle according to its integration contract.

## Pi TUI and CLI passthrough

After [enabling the shell command](#enable-the-eaa-pi-command), launch Pi's interactive terminal interface with an EAA workspace:

```bash
eaa-pi pi --workspace /path/to/eaa-workspace -- --provider PROVIDER --model MODEL
```

This starts the TUI directly without starting the HTTP server or web frontend. Stop the web server before opening the same workspace in the TUI. Pi reads provider definitions and credentials from that workspace's `.eaa-pi/agent` directory. If `providerWorkspace` is configured in `eaa-pi.json`, EAA refreshes the selected provider from that source before launching Pi. Pass `--provider` and `--model` explicitly to select the TUI model; the passthrough does not forward those selections from `eaa-pi.json` as Pi flags.

For a workspace configured with Argo and `gpt55`:

```bash
eaa-pi pi --workspace /path/to/eaa-workspace -- --provider argo --model gpt55
```

The EAA launcher loads its browser extension bridges. For regular terminal-only use with native terminal extensions, use the separately installed `pi-experiment-ops` command and a workspace configured for that package:

```bash
pi-experiment-ops pi --workspace /path/to/pi-workspace
```

That command uses `.pi-experiment-ops/agent` configuration. Sharing a workspace directory does not automatically share the two packages' provider configuration; see [provider configuration](configuration.md#real-provider-authentication).

Other passthrough examples:

```bash
eaa-pi pi --workspace /path/to/workspace -- --version
eaa-pi piw --workspace /path/to/workspace -- list
```

Pi flags follow `--`; Pi's configuration and authentication files remain in the selected workspace. Avoid running two hosts against one workspace. The web host owns one active primary session; its session controls enforce idle replacement.

## Upgrades and uninstall

Stop the server, back up the entire workspace, install the new package into a fresh installation directory, run its installer and doctor, then point it at a copy of the workspace for validation. Keep old application and workspace copies together for rollback. Update exact dependencies and the npm shrinkwrap deliberately; rerun integration, browser, package, and container checks after changes to public interfaces.

To uninstall, stop the application and remove its installation directory (or use `npm uninstall --prefix /path/to/eaa-install eaa-pi`). The workspace is separate and contains credentials, sessions, transcripts, and artifacts; archive or remove it according to your retention needs. A source installation can also remove `.runtime` and `node_modules`. Container images and test workspaces can be removed separately with your container engine and ordinary filesystem tools.

## Troubleshooting

| Symptom | Action |
|---|---|
| `node:sqlite` unavailable | Use Node 22.19+; an experimental SQLite notice is expected on tested versions. |
| Python executable missing / graph import error | Rerun the installer; inspect `PI_GRAPH_PYTHON` and `doctor`. |
| `npm ci` reports missing keyring/recheck platform packages | Use the current shrinkwrap. When maintaining an older checkout, run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps --no-audit --no-fund`, then rerun the installer. This restores optional platform metadata without replacing `npm ci`. |
| Peer dependency installation failure | Use the documented `--legacy-peer-deps` tarball command. |
| PTY startup fails | Check platform support and native build prerequisites; Linux is the supported target. |
| Browser assets missing | Run `npm run build` in source, or reinstall the built tarball. |
| Empty model list / rejected model request | Verify workspace provider/model identifiers and authentication. |
| Port in use | Select `--port 8020`, or stop the previous instance. |
| Origin or Host rejected | Access the local URL directly; the supplied service is not configured as an authenticated reverse-proxy service. |
| Playwright executable missing | Run the Chromium installation command in the README. |
