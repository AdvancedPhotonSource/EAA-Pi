# Provenance and third-party notices

The web frontend was copied from EAA's `packages/eaa-core/webui` source and adapted for this standalone host. MathJax was copied from EAA's bundled static assets; its Apache-2.0 license is preserved at [public/mathjax/LICENSE](public/mathjax/LICENSE). No EAA Python backend is included. The original frontend source supplied for this migration did not contain a separate license file; EAA ownership and distribution permissions remain with its authors.

All upstream package sources remain unchanged. Their license files and notices travel with the installed/bundled dependencies. The adapter and bridge files are maintained in this repository; they do not patch installed packages.

| Component | Pinned baseline | Upstream |
|---|---|---|
| Pi coding agent, agent core, AI and TUI | `0.85.1` | [Pi](https://pi.dev/) |
| MCP adapter | `2.34.0` | [nicobailon/pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) |
| Subagents | `0.68.0` | [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) |
| Processes | `@aliou/pi-processes@0.12.0` | [aliou/pi-processes](https://github.com/aliou/pi-processes) |
| Interactive shell | `0.15.2` | [nicobailon/pi-interactive-shell](https://github.com/nicobailon/pi-interactive-shell) |
| Agent modes | `0.3.0` | [pi-agent-modes on npm](https://www.npmjs.com/package/pi-agent-modes) |
| pi-graph | `4db15464e2268755aafcb52e32341bd536dc56dd` | [ali-abassi/pi-graph](https://github.com/ali-abassi/pi-graph/tree/4db15464e2268755aafcb52e32341bd536dc56dd) |
| SQLite archive | `4030631e21608f549033b9d291dbf0d76578245a` | [gordonbrander/pi-archive](https://github.com/gordonbrander/pi-archive/tree/4030631e21608f549033b9d291dbf0d76578245a) |

The archive is installed from Gordon Brander's pinned Git source under `@gordonb/pi-archive`. The unscoped npm `pi-archive` is a different implementation. pi-graph is installed from its pinned Git source under its declared package name `@ali-abassi/piw`. npm's shrinkwrap preserves their resolved commit identities.

The root package supplies exact Pi host dependencies. Its `pi-experiment-ops` dependency owns and bundles community resources using Pi's [standard package manifest](https://pi.dev/docs/latest/packages). See also the [graph integration contract](https://github.com/ali-abassi/pi-graph/blob/4db15464e2268755aafcb52e32341bd536dc56dd/docs/integration-contract.md) and [subagent extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md).

Frontend dependencies include React, React DOM, and Lucide icons, compiled by Vite. Exact installed dependency resolutions and their license metadata are recorded in `npm-shrinkwrap.json`. The deployment image uses the official Node 22.19.0 Debian Bookworm image and uv 0.8.15.
