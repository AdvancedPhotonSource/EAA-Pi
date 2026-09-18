# pi-graph workflow example

The application uses unchanged pi-graph as its only DAG runner. The installed `pi-experiment-ops` bundle's `examples/toy-workflow` is copied to a fresh workspace's `workflows/toy`. It is deliberately a small software-only example.

1. `generate` asks an agent for JSON containing a dataset title and three numeric values. A command gate checks the structure.
2. `review` asks a separate agent to return an `approved` boolean and a reason. Its gate requires literal `true`.
3. `render` runs deterministic Python, checks the review, writes a small PNG chart and an atomic completion receipt, then validates the receipt.

`workers: 1`, zero automatic retries, and 30-second node timeouts bound this example. The string `thinking: "off"` is quoted because YAML's unquoted `off` can become a boolean. A rejected review skips rendering. The command checks for `receipt.json` before producing the completion effect.

## Run and resume

Use **Sessions & tools → select toy → enter a task → Run workflow**, or:

```bash
curl -sS http://127.0.0.1:8010/api/workflows/run \
  -H 'Content-Type: application/json' -d '{"workflow":"toy","input":"Three example measurements"}'
curl -sS http://127.0.0.1:8010/api/workflows
```

The demo command configures the example to use its local fixture model. For other providers, set the model in `workflows/toy/steps.yaml` before launching. Generated files stay in the reported run directory.

The first response contains the host run ID. The list contains status, the copied definition, pi-graph's durable run directory and summary. Workflows run asynchronously. Stop them through the Jobs control or `POST /api/jobs/workflow%3ARUN_ID/cancel`.

The deterministic demo recognizes these inputs:

| Input | Behavior |
|---|---|
| `Three example measurements` | Approves, creates chart and receipt |
| `reject-review` | Reviewer rejects; rendering is skipped |
| `fail-command` | Generation/review pass; rendering raises a deliberate error |
| `slow-workflow` | Delayed fixture response provides a cancellation window |

To recover the deliberate command failure, create an empty file named `allow-render` inside that run's reported `run_dir`, then click **Resume workflow**. Completed agents are reused; the deterministic command is retried. `receipt.json` records `count: 1`. Resuming an already completed host run is a no-op. For an intentional upstream rewind, use `piw resume DEFINITION RUN_DIRECTORY_NAME --from render --json`; the toy receipt still prevents repeating the image creation effect.

## Author a workflow

Create `workflows/NAME/steps.yaml` and any helper files, then post `{"workflow":"NAME","input":"..."}` to `/api/workflows/run`. The adapter accepts directories below the configured workspace workflow root, copies them into a per-run definition directory, and launches `piw`. Workflow definitions are copied unchanged; configure models in `steps.yaml`. Relative command paths resolve beside the copied definition. Do not put run output inside source inputs.

Use pi-graph's documented `needs`, `agent`, `cmd`, `gate`, `timeout`, and output substitutions. Gate structured output before side effects, bound execution, and make external effects idempotent. Resume semantics, cache rules, failure propagation, and scheduling belong to pi-graph; the adapter observes and launches it. See the [pinned graph repository](https://github.com/ali-abassi/pi-graph/tree/4db15464e2268755aafcb52e32341bd536dc56dd).

## Child recordings and ordering

The `bin/shims/pi` launcher forwards arguments, standard input/output/error, exit status, and signals to the installed Pi CLI. When a graph launch requests JSON output, it additionally records the stream in the selected workspace. The observer converts completed messages into durable Pi-format child sessions and indexes them with the pinned archive. It does not reimplement graph execution or enable extensions inside graph children that the runner disables.

SDK-owned primary sessions use sequential tools; supported ad hoc children receive an extension that registers built-in tools with sequential execution. Toy graph nodes expose only `read`, and graph workers are serial. These settings order calls within an agent/runner; they do not lock a shared physical instrument across clients.

The demo MCP instrument service therefore maintains its own queue. A background operation returns a job ID immediately, but retains ownership of the simulated physical resource until the operation finishes. The acceptance test connects two real Pi clients while such a job is active and checks non-overlapping start/end events. Production instrument services must provide the same guarantee, including cancellation/failure cleanup and operations that return background IDs. The toy service is a validation fixture, not a facility-control implementation.
