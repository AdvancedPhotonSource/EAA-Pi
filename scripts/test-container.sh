#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
engine=${CONTAINER_ENGINE:-podman}
command -v "$engine" >/dev/null || { echo "BLOCKED: $engine is unavailable" >&2; exit 77; }
"$engine" build -t eaa-pi:local "$root"
directory=$(mktemp -d /tmp/eaa-pi-container-XXXXXX)
mkdir "$directory/workspace" "$directory/fixtures"
printf 'unchanged\n' > "$directory/fixtures/sentinel"
printf 'host-only\n' > "$directory/host-secret"
identity=()
if [[ "$engine" == podman ]]; then identity=(--userns=keep-id:uid=1000,gid=1000); else chmod 777 "$directory/workspace"; fi
"$engine" run --rm "${identity[@]}" --user 1000:1000 --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=256 \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  -v "$directory/workspace:/workspace:rw" -v "$directory/fixtures:/fixtures:ro" \
  -v "$root/tests/container:/acceptance:ro" -e HOST_SECRET_PATH="$directory/host-secret" \
  --entrypoint node eaa-pi:local --test --test-force-exit /acceptance/isolation.mjs
test "$(cat "$directory/fixtures/sentinel")" = unchanged
echo "Container isolation passed; test artifacts: $directory"
