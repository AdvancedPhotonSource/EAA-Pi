#!/bin/sh
# Downloadable release installer; also accepts a local release archive.
set -eu
fail() { printf '%s\n' "Error: $*" >&2; exit 1; }
version=0.1.0
prefix=${XDG_DATA_HOME:-"$HOME/.local/share"}/eaa-pi
bin_dir=$HOME/.local/bin
archive=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      cat <<'HELP'
Usage: sh install.sh [options]
  --version VERSION  GitHub release version (default 0.1.0)
  --prefix DIR       Installation directory (default ~/.local/share/eaa-pi)
  --bin-dir DIR      Launcher directory (default ~/.local/bin)
  --archive FILE     Install a local release tarball

Requires Linux, Node.js 22.19+, npm, uv, Git, Bash, curl, tar, and sha256sum.
Adds the launcher directory to PATH in your Bash or Zsh startup file.
Choose a workspace when launching: eaa-pi serve --workspace /path/to/workspace
HELP
      exit 0;;
    --version|--prefix|--bin-dir|--archive)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value"
      case "$1" in
        --version) version=$2;; --prefix) prefix=$2;;
        --bin-dir) bin_dir=$2;; --archive) archive=$2;;
      esac
      shift 2;;
    *) fail "Unknown option: $1";;
  esac
done
[ "$(uname -s)" = Linux ] || fail 'Linux is required'
for directory in "$prefix" "$bin_dir"; do
  case "$directory" in /*) ;; *) fail 'Use absolute paths for --prefix and --bin-dir';; esac
done
for tool in node npm uv git bash curl tar sha256sum; do
  command -v "$tool" >/dev/null || fail "Install $tool before running this installer"
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22 || a===22 && b>=19 ? 0:1)' || fail 'Node.js 22.19+ is required'
node -e 'if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(process.argv[1])) process.exit(1)' "$version" || fail 'Invalid release version'
node_path=$(command -v node)
umask 077
mkdir -p "$prefix/releases" "$bin_dir"
mkdir "$prefix/.install-lock" 2>/dev/null || fail "Another install is active: $prefix/.install-lock"
temporary=
trap 'if [ -n "$temporary" ]; then rm -rf "$temporary"; fi; rmdir "$prefix/.install-lock"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
temporary=$(mktemp -d)
if [ -z "$archive" ]; then
  filename=eaa-pi-$version.tgz
  release_url=https://github.com/AdvancedPhotonSource/EAA-Pi/releases/download/v$version
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 2 "$release_url/$filename" -o "$temporary/$filename"
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 2 "$release_url/$filename.sha256" -o "$temporary/$filename.sha256"
  (cd "$temporary"; sha256sum -c "$filename.sha256")
  archive=$temporary/$filename
fi
[ -f "$archive" ] || fail 'Release archive does not exist'
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")
tar -xOf "$archive" package/package.json > "$temporary/package.json"
version=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));if(p.name!=="eaa-pi" || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(p.version))process.exit(1);console.log(p.version)' "$temporary/package.json") || fail 'Expected an eaa-pi release package'
digest=$(sha256sum "$archive" | cut -c 1-12)
release_dir=$prefix/releases/$version-$digest
package_dir=$release_dir/node_modules/eaa-pi
if [ ! -f "$release_dir/.installed" ]; then
  mkdir -p "$release_dir"
  npm install --prefix "$release_dir" --omit=dev --legacy-peer-deps --no-audit --no-fund "$archive" </dev/null
fi
[ -f "$package_dir/dist/webui/index.html" ] || fail 'Release package is missing the compiled frontend'
bash "$package_dir/scripts/install.sh" --runtime-only </dev/null
"$node_path" "$package_dir/bin/eaa-pi.mjs" --help </dev/null
# Replace the launcher only after installation succeeds; preserve the caller's cwd.
EAA_INSTALL_BIN=$bin_dir EAA_INSTALL_PACKAGE=$package_dir EAA_INSTALL_NODE=$node_path node --input-type=module <<'JS'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const env = process.env, path = join(env.EAA_INSTALL_BIN, 'eaa-pi');
const existing = lstatSync(path, { throwIfNoEntry: false });
if (existing && (!existing.isFile() || !readFileSync(path, 'utf8').includes('# eaa-pi managed launcher'))) {
  throw Error(`Refusing to replace an unrelated launcher: ${path}. Choose another --bin-dir or move the existing launcher.`);
}
const script = '#!/bin/sh\n# eaa-pi managed launcher\n' +
  `export PATH=${quote(dirname(env.EAA_INSTALL_NODE) + ':')}"$PATH"\n` +
  `exec ${quote(env.EAA_INSTALL_NODE)} ${quote(join(env.EAA_INSTALL_PACKAGE, 'bin/eaa-pi.mjs'))} "$@"\n`;
writeFileSync(path + '.tmp', script, { mode: 0o755 });
renameSync(path + '.tmp', path);
const shell = basename(env.SHELL || '/bin/bash');
const profile = shell === 'bash' ? join(env.HOME, '.bashrc')
  : shell === 'zsh' ? join(env.ZDOTDIR || env.HOME, '.zshrc') : undefined;
if (profile) {
  const entry = '# eaa-pi PATH\n' +
    `case ":$PATH:" in\n  *:${quote(env.EAA_INSTALL_BIN)}:*) ;;\n` +
    `  *) export PATH=${quote(env.EAA_INSTALL_BIN)}:"$PATH" ;;\nesac\n`;
  const contents = existsSync(profile) ? readFileSync(profile, 'utf8') : '';
  if (!contents.includes(entry)) {
    mkdirSync(dirname(profile), { recursive: true });
    appendFileSync(profile, '\n' + entry, { mode: 0o600 });
  }
  console.log(`PATH configured in ${profile}. Open a new terminal or run: source ${quote(profile)}`);
} else {
  console.log(`Add ${env.EAA_INSTALL_BIN} to PATH in your ${shell} startup configuration.`);
}
JS
touch "$release_dir/.installed"
printf '\nInstalled: %s/eaa-pi\nRun: eaa-pi init --workspace /path/to/workspace\nThen: eaa-pi serve --workspace /path/to/workspace\n' "$bin_dir"
