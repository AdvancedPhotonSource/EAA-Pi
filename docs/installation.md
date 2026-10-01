# Installation and distribution

## Release installation

The root `install.sh` can be downloaded and piped to `sh`. It requires Linux, Node.js ≥22.19, npm, Git, Bash, uv, curl, tar, and sha256sum. It downloads the selected GitHub release tarball and checksum, verifies SHA-256, installs the package, provisions its Python runtime, and creates the `eaa-pi` command.

```bash
curl -fsSL https://raw.githubusercontent.com/AdvancedPhotonSource/EAA-Pi/v0.1.0/install.sh | \
  sh -s -- --version 0.1.0
```

The installer adds the launcher directory to `~/.bashrc` for Bash or `${ZDOTDIR:-$HOME}/.zshrc` for Zsh, according to `$SHELL`. It preserves existing settings and avoids duplicate entries on reruns. Open a new terminal or run the printed `source` command to activate it in your current shell:

```bash
eaa-pi init --workspace /absolute/path/to/workspace
eaa-pi serve --workspace /absolute/path/to/workspace
```

Configure a provider in the workspace before sending model requests; see [configuration](configuration.md#real-provider-authentication). The installer sets up the application independently of any workspace. The launcher preserves the current directory and forwards command arguments, so use `--workspace DIR` to select a workspace or launch from within it.

Installation defaults to `${XDG_DATA_HOME:-$HOME/.local/share}/eaa-pi`, with a launcher at `~/.local/bin/eaa-pi`. Override those locations with `--prefix /absolute/directory` and `--bin-dir /absolute/directory`; the PATH entry uses your chosen launcher directory. For other shells, the installer prints a manual PATH setup reminder. It refuses to overwrite an unrelated launcher; move an existing source-install symlink or select another launcher directory first.

For a downloaded package, verify its published checksum and install locally:

```bash
sh install.sh --archive /path/to/eaa-pi-0.1.0.tgz
```

Rerunning the installer reuses an installed release and rechecks Python provisioning. Each release is stored under `PREFIX/releases/VERSION-DIGEST`; the launcher switches after setup succeeds. To upgrade or roll back, stop the server and rerun the installer for the desired version. Workspaces remain at the locations you selected.

## Native source installation

Install Node.js ≥22.19, Git, Bash, and uv. Run `bash scripts/install.sh /absolute/workspace`. It installs the npm dependency graph from `npm-shrinkwrap.json`, invokes the installed `pi-experiment-ops` Python installer, builds the frontend/server, and runs `doctor`. Running it again preserves workspace configuration and existing sessions. Python packages are isolated from the system interpreter. `PI_OPS_PYTHON` is explicitly set by the CLI; set it yourself only when supplying an equivalent environment.

The application uses Python 3.12; this build was tested with 3.12.11. The Python lock includes hashes. The lock and its update command belong to `pi-experiment-ops`; release a new bundle to update Python dependencies here.

Use `bash scripts/install.sh --runtime-only` to provision the application without initializing or checking a workspace. The release installer uses this mode.

Start from any directory:

```bash
/path/to/eaa-pi/bin/eaa-pi.mjs init --workspace /path/to/workspace
/path/to/eaa-pi/bin/eaa-pi.mjs doctor --workspace /path/to/workspace
/path/to/eaa-pi/bin/eaa-pi.mjs serve --workspace /path/to/workspace --port 8010
```

`doctor` checks the Node version, compiled frontend, extension resources, Python imports, and Pi CLI. `serve` can start before authentication is configured; model input then reports a configuration error. First startup can take tens of seconds while Pi compiles TypeScript extensions.

Use the experiment-ops workspace directly. Provider selection, custom models, and credentials live in `.pi-experiment-ops/agent`; web host and port live in `eaa-pi.json`. See [provider configuration](configuration.md#real-provider-authentication).

### Enable the `eaa-pi` command

The release installer creates the command automatically. For a source or manual tarball installation, create a symbolic link to the packaged executable from the application's root directory:

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

`eaa-pi pi` delegates to the installed `pi-experiment-ops` launcher. Subagent workflow resources and Python provisioning are managed by the bundle according to its integration contract.

### Publishing installer assets

The curl installer requires a GitHub Release tagged `vVERSION` containing `eaa-pi-VERSION.tgz` and `eaa-pi-VERSION.tgz.sha256`. Keep `package.json`, the root versions in `npm-shrinkwrap.json`, the default version in `install.sh`, and the README installation examples aligned. Build and validate the package before publishing:

```bash
npm run build
npm test
npm run test:package
mkdir -p /tmp/eaa-pi-release
npm pack --pack-destination /tmp/eaa-pi-release
cd /tmp/eaa-pi-release
sha256sum eaa-pi-0.1.0.tgz > eaa-pi-0.1.0.tgz.sha256
```

Publish the matching tag from the tested commit in `AdvancedPhotonSource/EAA-Pi` and attach both files to its GitHub Release. The installer URL becomes usable once the tag includes `install.sh` and both assets are attached. Retain previous release assets for rollback.

## Pi TUI and CLI passthrough

After [enabling the shell command](#enable-the-eaa-pi-command), launch Pi's interactive terminal interface with an EAA workspace:

```bash
eaa-pi pi --workspace /path/to/eaa-workspace -- --provider PROVIDER --model MODEL
```

This starts the experiment-ops TUI with its native terminal extensions and configuration in `.pi-experiment-ops/agent`. Pass `--provider` and `--model` to select the TUI model, or use experiment-ops' saved defaults. The WebUI and TUI share primary sessions; use one interface per session at a time.

For a workspace configured with Argo and `gpt55`:

```bash
eaa-pi pi --workspace /path/to/eaa-workspace -- --provider argo --model gpt55
```

The equivalent command when `pi-experiment-ops` is on your PATH is:

```bash
pi-experiment-ops pi --workspace /path/to/pi-workspace
```

Both interfaces read the same provider configuration. For an existing EAA-only setup, run `eaa-pi init --workspace DIR` once to import missing native configuration; see [provider configuration](configuration.md#real-provider-authentication).

Other passthrough examples:

```bash
eaa-pi pi --workspace /path/to/workspace -- --version
eaa-pi pi --workspace /path/to/workspace
```

Pi flags follow `--`; Pi's configuration and authentication files remain in the selected workspace. Avoid running two hosts against one workspace. The web host owns one active primary session; its session controls enforce idle replacement.

## Upgrades and uninstall

Stop the server, back up the entire workspace, install the new package into a fresh installation directory, run its installer and doctor, then point it at a copy of the workspace for validation. Keep old application and workspace copies together for rollback. Update exact dependencies and the npm shrinkwrap deliberately; rerun integration, browser, package, and container checks after changes to public interfaces.

To uninstall, stop the application and remove its installation directory and launcher (by default `~/.local/share/eaa-pi` and `~/.local/bin/eaa-pi`), or use `npm uninstall --prefix /path/to/eaa-install eaa-pi` for a manual npm installation. The workspace is separate and contains credentials, sessions, transcripts, and artifacts; archive or remove it according to your retention needs. A source installation can also remove `.runtime` and `node_modules`. Container images and test workspaces can be removed separately with your container engine and ordinary filesystem tools.

## Troubleshooting

| Symptom | Action |
|---|---|
| `node:sqlite` unavailable | Use Node 22.19+; an experimental SQLite notice is expected on tested versions. |
| Python executable missing / Python import error | Rerun the installer; inspect `PI_OPS_PYTHON` and `doctor`. |
| `npm ci` reports missing keyring/recheck platform packages | Use the current shrinkwrap. When maintaining an older checkout, run `npm install --package-lock-only --ignore-scripts --legacy-peer-deps --no-audit --no-fund`, then rerun the installer. This restores optional platform metadata without replacing `npm ci`. |
| Peer dependency installation failure | Use the documented `--legacy-peer-deps` tarball command. |
| PTY startup fails | Check platform support and native build prerequisites; Linux is the supported target. |
| Browser assets missing | Run `npm run build` in source, or reinstall the built tarball. |
| Empty model list / rejected model request | Verify workspace provider/model identifiers and authentication. |
| Port in use | Select `--port 8020`, or stop the previous instance. |
| Origin or Host rejected | Access the local URL directly; the supplied service is not configured as an authenticated reverse-proxy service. |
| Playwright executable missing | Run the Chromium installation command in the [validation guide](validation.md#reproduction-and-results). |
