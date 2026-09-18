# Repository boundaries and bundle releases

`pi-experiment-ops` owns the reusable Pi distribution. `eaa-pi` owns the web application. Each directory is an independent source/package root with its own manifest, shrinkwrap, installer, documentation, and tests.

| pi-experiment-ops | eaa-pi |
|---|---|
| Pi/community dependency versions and standard Pi resource manifest | Pi SDK host and HTTP/SSE API |
| Native terminal extension entrypoints | Browser-specific policy, MCP, archive and terminal wrappers |
| Python lock, runtime installer, graph executable discovery | Application installer delegates Python provisioning to the bundle |
| Generic toy graph and workspace initialization | Browser launch/resume controls and child transcript capture |
| Pi native sessions and archive integration | Adapter SQLite, gallery, relationships and completion deduplication |
| CLI and independent Pi/graph acceptance | React frontend, static notices, browser/integration/container acceptance |

The bundle API exposes resource paths, executables, workspace setup, and Pi-loadable upstream wrapper APIs. EAA replaces four resource entries explicitly, preserving exactly eight loaded extensions. The graph child recorder remains an EAA adapter because it creates frontend conversation relationships. Native terminal behavior is retained in the standalone bundle.

EAA includes `vendor/pi-experiment-ops-0.2.0.tgz` and declares it as a `file:vendor/...` dependency. This is a release artifact with integrity recorded by npm, not a link to another checkout. npm bundles the installed dependency and its runtime dependencies in the application tarball. The prepack hook gives installed hard-linked files independent inodes, preserving their bytes and modes, so npm can extract bundled executables reliably. Docker builds copy the vendored release before installing. Both source and tarball installation work when the separate bundle source repository is absent.

## Developing both repositories together

Make backend changes in the experiment-ops repository, run its tests, and pack a versioned artifact. Update eaa-pi through `scripts/update-pi-bundle.mjs`, then reinstall and rebuild. This tests the same package boundary used by releases.

EAA supplies its own policy, MCP, terminal, and archive bridges. Changes confined to experiment-ops' native entrypoints affect its standalone CLI; browser adaptations remain in EAA.

## Updating the bundle

In the bundle repository, update the implementation and version, refresh its shrinkwrap, and run:

```bash
npm test
npm run test:package
npm pack
```

Then in this application repository:

```bash
node scripts/update-pi-bundle.mjs /path/to/pi-experiment-ops-VERSION.tgz
npm install --legacy-peer-deps
npm install --package-lock-only --ignore-scripts --legacy-peer-deps --no-audit --no-fund
node --test tests/lockfile.test.mjs
npm run check
npm run build
npm test
npm run test:browser
npm run test:package
npm run test:container
```

Remove superseded vendored tarballs after verifying the new release; retain released artifacts elsewhere for rollback. The application imports `pi-experiment-ops/sdk`; the bundle owns the Pi dependency and version. Once published, a registry version can replace the vendored dependency without changing the runtime API. Registry publication is a separate release action.

Backend workspace paths come from the bundle's `workspacePaths()` helper; browser metadata stays under `.eaa-pi`. Initialization preserves existing workflow definitions and settings. Fresh workspaces obtain the toy graph from the installed bundle. Existing demo workflows with the earlier fixture markers remain supported.
