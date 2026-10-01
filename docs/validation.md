# Compatibility and validation

The acceptance tests use a deterministic local OpenAI-compatible streaming endpoint and a simulated MCP instrument. They exercise the real Pi runtime and installed extensions, including actual workflow and ad hoc child execution. They require no model credentials. The fixture emits real streaming text/tool-call frames and records image-bearing requests; it does not substitute a mock session or workflow runner.

## Compatibility matrix

| Surface | Baseline/contract | Validation |
|---|---|---|
| Native platform | Linux, Node ≥22.19 | Host tested with Node 24.5 |
| Container | Node 22.19.0, Debian Bookworm, non-root | Rootless Podman execution |
| Python | 3.12, hashed lock | Tested 3.12.11 |
| Pi distribution | pi-experiment-ops 0.6.1 | Independent CLI/resources/Python installer; versioned tarball dependency |
| Pi SDK/CLI | 0.85.1 | SDK sessions, streaming, tools, CLI children, session files |
| MCP | pi-mcp-adapter 2.34.0 | Factory, direct tools, images, status, metadata trace |
| Children | pi-subagents 0.68.0 | Public spawn/status/steer/stop RPC and required-child extensions |
| Processes | @aliou/pi-processes 0.12.0 | Event-bus launch/output/completion/cancel |
| PTY | pi-interactive-shell 0.15.2 | Headless background dispatch, persistent state and cancellation |
| Modes | pi-agent-modes 0.3.0 | Upstream mode state plus host reader-only enforcement |
| Workflow | pi-subagents 0.68.0 | Native workflow scripts, structured outputs, host commands, rerun and cancellation |
| Archive | Git `4030631…` | Native SQLite FTS schema and exported session indexer |
| Browser | Playwright 1.58.2 / Chromium | EAA layout, streaming, controls and recovery |

## Ten capability areas

| Capability | Implementation and evidence |
|---|---|
| 1. Custom multiagent workflows | Toy pi-subagents workflow; success/rejection, command failure, fresh rerun, cancellation, and rendering receipts. No scientific workflow migration. |
| 2. Gallery, MCP logs, jobs, tool viewer | Durable images, direct MCP schemas/reconnect, execution/completion panels, connection status and protocol metadata traces. Complete server-log/progress content remains unavailable through the inspected public interfaces. |
| 3. Visible child conversations | Required subagent observer streams JSON into child tabs; parent relationships and Pi-format transcripts survive restart. |
| 4. Serial execution | Sequential SDK tools, required child bridge, sequential toy workflow steps, and a service-owned instrument queue tested with two real Pi clients and a background operation. |
| 5. Images from tools and disk | Real MCP image result, uploaded image bytes observed at model endpoint, durable gallery files, registry-only image serving. |
| 6. Release long-running tools | Real background process while primary chat remains responsive; single completion identity and stop controls. |
| 7. Checkpointing/database logging | Pi sessions plus pinned SQLite archive; adapter records retain conversations, relationships, jobs, artifacts, and completions across restart. |
| 8. Persistent PTY and SSH | Actual local PTY retains environment state across requests and cancels. SSH uses the same terminal facility; a remote SSH host is outside credential-free acceptance. |
| 9. Filesystem isolation | Non-root read-only container; attempted writes via file tool, shell, process, PTY, workflow host command/agent, traversal and symlink paths. Native execution is unsandboxed. |
| 10. Reader-only plan | Tool allowlist and browser mutation checks; entry rejected while work is active; adversarial writer call denied. |

## Reproduction and results

Run these commands from the source repository to check changes:

```bash
npm run check
npm run build
npm test
PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/browsers" npx playwright install chromium
npm run test:browser
npm run test:package
npm run test:container
```

Tests create isolated temporary workspaces and leave them for inspection. Package acceptance installs the tarball outside the checkout and runs the shipped installer twice, startup, streaming chat, frontend assets, extension loading, and an actual toy workflow. Container acceptance prints its retained host test directory. Browser failures retain a Playwright trace.

Workflow migration validation for `pi-experiment-ops` 0.5.0 on 2026-09-28:

| Check | Command | Result |
|---|---|---|
| Server/frontend build | `npm run build` | Passed |
| Unit and integration | `npm test` | Passed: 45 checks, including native/legacy provider configuration, workflow execution, fresh reruns, cancellation, transcripts, and session recovery |
| Browser | `npm run test:browser` | Passed: 5 checks |
| Standalone application tarball | `npm run test:package` | Passed: independent installation, repeated installer, chat, frontend, ten extensions, and real toy workflow |
| Container isolation | `npm run test:container` | Passed with an isolated Podman store under `/tmp` |
| Backend source | `npm test` in pi-experiment-ops | Passed: 5 checks |
| Backend tarball | `npm run test:package` in pi-experiment-ops | Passed: 4 checks and repeated runtime installation |

The default Podman store ran out of space during the first build; its temporary build artifacts were removed and container acceptance passed using separate storage. Experiment-ops' tests cover native SDK export identity, workspace paths, TUI/provider behavior, and actual subagent workflows. Package checks install outside the source checkout. Fixture endpoints are local; live Argo authentication and inference were not exercised.

## Optional live-provider validation

Live model quality, provider OAuth, production MCP authentication, remote SSH, physical hardware control, and recovery after operating-system failure are separate deployment checks. Configure a real provider in a fresh workspace, run a short chat and an image request, exercise approval/interrupt, then run the toy workflow. Review model selection and token/tool limits before applying workflows to costly systems. Automated fixture success establishes integration behavior, not a model's ability to produce valid scientific decisions.
