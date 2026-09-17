# Execution boundary and containers

Native execution is unsandboxed. File tools, bash, extensions, process jobs, PTYs, subagents, and graph commands have the permissions of the account that launches the application. Plan mode is an execution policy enforced by the host and tool hooks; it is not an OS sandbox.

## Container usage

Build the supplied image with Docker or rootless Podman:

```bash
podman build -t eaa-pi:local .
mkdir -p workspace fixtures
podman run --rm --userns=keep-id:uid=1000,gid=1000 --user 1000:1000 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=256 \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  -p 127.0.0.1:8010:8010 \
  -v "$PWD/workspace:/workspace:rw" -v "$PWD/fixtures:/fixtures:ro" \
  eaa-pi:local demo --workspace /workspace --host 0.0.0.0
```

For Docker, omit the Podman `--userns=keep-id` option and arrange for the workspace to be writable by UID/GID 1000. `docker compose up --build` uses the supplied `compose.yaml`; create the bind directories and configure the workspace before starting real-provider service. Switch its command to `demo` for the credential-free fixture.

To reuse a configured `pi-experiment-ops` workspace, add a read-only mount such as `-v /path/to/ops-workspace:/provider-source:ro`, set `"providerWorkspace": "/provider-source"` in EAA's `eaa-pi.json`, and run `serve`. The source files must be readable by the container user. EAA writes its selected provider and credential copies inside the writable EAA workspace.

The image runs as non-root, with a read-only application/root filesystem, read-only `/fixtures`, and writable `/workspace` and temporary storage. No host container socket is mounted. All local descendants inherit this boundary, including Python graph runners and Pi child CLIs. Expose additional host files only through explicit mounts. Credentials placed in the workspace are server-side but available to trusted agent execution inside this boundary.

Outbound network access remains available for model/MCP calls. This configuration isolates filesystem access; it does not impose a network destination allowlist. Apply deployment-specific networking if required. An external MCP instrument service is outside the container and must enforce its own permissions and operation ordering.

## HTTP boundary

The default binding is `127.0.0.1:8010`. Host validation and same-origin checks reject unexpected browser origins. Provider configuration files have no public HTTP endpoint. Artifact reads require registration and reject path traversal or symlink substitution; uploads use no-follow writes.

There is no multi-user authentication or authorization layer. Do not expose this service as a public shared server. The container's `0.0.0.0` binding is paired with host publication on `127.0.0.1`. Browser sessions are views of one active primary session, not independent authenticated users.

## Acceptance checks

`npm run test:container` builds the image, mounts a read-only sentinel and writable workspace, and exercises attempted writes through real Pi file tools, bash, pi-processes, a PTY, graph command nodes, and graph agent children. It checks traversal/symlink paths, absent host-only paths, a read-only application filesystem, non-root identity, and absence of the host container socket. `CONTAINER_ENGINE=docker` selects Docker; rootless Podman is the default test engine. Missing runtimes are reported as blocked, not passed.
