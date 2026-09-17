# Compatibility and validation

The acceptance tests use a deterministic local OpenAI-compatible streaming endpoint and a simulated MCP instrument. They exercise the real Pi runtime and installed extensions, including actual graph and ad hoc child execution. They require no model credentials. The fixture emits real streaming text/tool-call frames and records image-bearing requests; it does not substitute a mock session or workflow runner.

## Compatibility matrix

| Surface | Baseline/contract | Validation |
|---|---|---|
| Native platform | Linux, Node ≥22.19 | Host tested with Node 24.5 |
| Container | Node 22.19.0, Debian Bookworm, non-root | Rootless Podman execution |
| Python | 3.12, hashed lock | Tested 3.12.11 |
| Pi distribution | pi-experiment-ops 0.1.1 | Independent CLI/resources/Python installer; versioned tarball dependency |
| Pi SDK/CLI | 0.85.1 | SDK sessions, streaming, tools, CLI children, session files |
| MCP | pi-mcp-adapter 2.34.0 | Factory, direct tools, images, status, metadata trace |
| Children | pi-subagents 0.68.0 | Public spawn/status/steer/stop RPC and required-child extensions |
| Processes | @aliou/pi-processes 0.12.0 | Event-bus launch/output/completion/cancel |
| PTY | pi-interactive-shell 0.15.2 | Headless background dispatch, persistent state and cancellation |
| Modes | pi-agent-modes 0.3.0 | Upstream mode state plus host reader-only enforcement |
| Workflow | Git `4db15464…` | Real piw/Python/Pi processes, gates, resume and cancellation |
| Archive | Git `4030631…` | Native SQLite FTS schema and exported session indexer |
| Browser | Playwright 1.58.2 / Chromium | EAA layout, streaming, controls and recovery |

## Ten capability areas

| Capability | Implementation and evidence |
|---|---|
| 1. Custom multiagent workflows | Three-node toy pi-graph DAG; success/rejection, command failure, resume, cancellation, receipt idempotency. No scientific workflow migration. |
| 2. Gallery, MCP logs, jobs, tool viewer | Durable images, direct MCP schemas/reconnect, execution/completion panels, connection status and protocol metadata traces. Complete server-log/progress content remains unavailable through the inspected public interfaces. |
| 3. Visible child conversations | Subagent observer and graph launcher stream JSON into child tabs; parent relationships and Pi-format transcripts survive restart. |
| 4. Serial execution | Sequential SDK tools, required child bridge, one graph worker, and a service-owned instrument queue tested with two real Pi clients and a background operation. |
| 5. Images from tools and disk | Real MCP image result, uploaded image bytes observed at model endpoint, durable gallery files, registry-only image serving. |
| 6. Release long-running tools | Real background process while primary chat remains responsive; single completion identity and stop controls. |
| 7. Checkpointing/database logging | Pi sessions plus pinned SQLite archive; adapter records retain conversations, relationships, jobs, artifacts, and completions across restart. |
| 8. Persistent PTY and SSH | Actual local PTY retains environment state across requests and cancels. SSH uses the same terminal facility; a remote SSH host is outside credential-free acceptance. |
| 9. Filesystem isolation | Non-root read-only container; attempted writes via file tool, shell, process, PTY, graph command/agent, traversal and symlink paths. Native execution is unsandboxed. |
| 10. Reader-only plan | Tool allowlist and browser mutation checks; entry rejected while work is active; adversarial writer call denied. |

## Reproduction and results

Run the README's check/build/test commands from this repository. Tests create isolated temporary workspaces and leave them for inspection. Package acceptance installs the tarball outside the checkout and runs the shipped installer twice, startup, streaming chat, frontend assets, extension loading, and an actual toy graph. Container acceptance prints its retained host test directory. Browser failures retain a Playwright trace.

Validation with the published `pi-experiment-ops` 0.1.1 bundle recorded on 2026-09-17. Test sources define the exact assertions.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run check` | Passed |
| Server/frontend build | `npm run build` | Passed |
| Unit and integration | `npm test` | Passed: 29 checks, including local/shared providers, active process/PTY restart recovery and SQLite parent/artifact records |
| Browser | `npm run test:browser` | Passed: 2 Chromium scenarios; streaming/reload, graph/child tabs, gallery, PTY input, approval reconnect, plan controls, upload, MCP controls |
| Standalone tarball | `npm run test:package` | Passed: external installation, idempotent installer, startup, assets/extensions, chat and real graph |
| Container boundary | `npm run test:container` | Passed: actual prohibited-write attempts through every tested execution path |

The independent `pi-experiment-ops` tarball also passes external installation, two installer runs, real Pi chat with extension tools, graph executable discovery with checkout paths removed, and actual pi-graph success/rejection/failure/resume. Its tested release SHA-256 is `9f7f1ea35181e9eb2198a014bc2841ce9bf135f2d627e632c500b190187d40ca`. EAA resolves this release from its npm dependency tree; it does not reference the bundle source checkout. The split preserves the existing application workspace layout.

No checks are blocked by the environment. Live-provider and remote-SSH checks are outside this credential-free acceptance scope.

The HTTP integration suite runs with both EAA-local definitions and definitions imported through `providerWorkspace`, including actual subagent and pi-graph children and restart recovery. Configuration tests cover source preservation, selected-provider refresh, credential precedence, and missing-source/provider/model errors. A separate CLI smoke check passed Pi model discovery and `doctor` using a shared provider. These checks use a local deterministic endpoint; live Argo authentication and inference were not exercised.

The local development link also passed all 12 runtime integration checks against the sibling bundle checkout. The link left `package.json` and `npm-shrinkwrap.json` byte-for-byte unchanged. Running the application installer restored the pinned release and passed build and doctor checks. Container validation used a fresh temporary Podman store after the default store ran out of space.

## Optional live-provider validation

Live model quality, provider OAuth, production MCP authentication, remote SSH, physical hardware control, and recovery after operating-system failure are separate deployment checks. Configure a real provider in a fresh workspace, run a short chat and an image request, exercise approval/interrupt, then run the toy graph. Review model selection and token/tool limits before applying workflows to costly systems. Automated fixture success establishes integration behavior, not a model's ability to produce valid scientific decisions.
