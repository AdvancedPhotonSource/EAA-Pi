#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
node --input-type=module -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && b<19)) throw Error("Node 22.19+ required")'
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' >&2; exit 1; }
if [[ -d src ]]; then npm ci --no-audit --no-fund; elif ! node --input-type=module -e 'import "@earendil-works/pi-coding-agent"; import "pi-experiment-ops"' >/dev/null 2>&1; then npm install --omit=dev --legacy-peer-deps --no-audit --no-fund; fi
bundle_root=$(node --input-type=module -e 'import { packageRoot } from "pi-experiment-ops"; console.log(packageRoot)')
bash "$bundle_root/scripts/install.sh" --runtime-only
if [[ -d src ]]; then npm run build; fi
node bin/eaa-pi.mjs doctor --workspace "${1:-$root/.demo}"
