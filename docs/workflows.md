# Subagent workflows

Workflows use the pinned pi-subagents engine for sequencing, parallel children, conditional checks, host commands, cancellation, and execution receipts. A fresh workspace receives `workflows/toy/workflow.mjs` from pi-experiment-ops.

The toy workflow generates a three-number dataset, validates it, asks a reader-only agent to review it, and renders `chart.png` only after approval. The renderer also writes `receipt.json`. Both agents inherit the selected model; the demo uses its local fixture provider.

Use **Sessions & tools → select toy → enter a task → Run workflow**, or:

```sh
curl -sS http://127.0.0.1:8010/api/workflows/run \
  -H 'Content-Type: application/json' -d '{"workflow":"toy","input":"Three example measurements"}'
curl -sS http://127.0.0.1:8010/api/workflows
```

Runs execute asynchronously. The record includes the host ID, upstream subagent run ID, copied definition, output directory, status, and completion result. Stop a run through Jobs or `POST /api/jobs/workflow%3ARUN_ID/cancel`.

**Run again** (`POST /api/workflows/rerun` with `{"id":"HOST_RUN_ID"}`) executes the saved definition and input in a fresh directory. All steps execute again. For a different task, edit the input and use **Run workflow**. Interrupted and older pi-graph records remain available as history; select a migrated workflow to replace an old graph run.

The fixture recognizes these inputs:

| Input | Behavior |
|---|---|
| `reject-review` | Reviewer rejects; rendering does not run |
| `fail-command` | Renderer deliberately fails |
| `slow-workflow` | Delayed model response provides a cancellation window |

## Author a workflow

Create `workflows/NAME/workflow.mjs` exporting a pi-subagents resource definition:

```js
export default {
  name: 'my-review',
  version: 1,
  resolve(args) {
    if (typeof args.input !== 'string' || !args.input.trim()) return { error: 'input is required' };
    return {
      script: `return runs.run('review', {
        agent: 'reviewer', context: 'fresh', task: ${JSON.stringify(args.input)}
      });`,
    };
  },
};
```

These modules are trusted workspace code. `resolve` performs bounded synchronous validation and script construction. The script is a JavaScript statement body using `runs.run`, `runs.all`, and ordinary control flow. Check child `ok` results before consuming outputs. A resource can grant exact command/key pairs through `hostCommands` and invoke them with `runs.host`; the toy example demonstrates this. Validate inputs and shell-quote command arguments separately from JavaScript string escaping.

The browser copies the definition and helper files into a new run directory before registering the resource and launching it. Host commands resolve against that run directory. The adapter passes `args.outputDirectory` with its absolute path; use absolute child output paths to keep artifacts there. Relative child output paths use pi-subagents’ managed artifact directory. Definitions use `import.meta.url` to locate copied helpers. Run again uses the copied definition. The native Pi launcher also registers workspace resources by their exported names, so the `subagent` tool can invoke `{"workflow":"my-review","args":{"input":"Review the change"}}` directly; choose a separate `cwd` for outputs when needed.

See the pinned package's [workflow API](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md) and [resource registration API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md). Existing YAML definitions need manual conversion. Initialization preserves existing workspace files.
