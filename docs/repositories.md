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

EAA includes `vendor/pi-experiment-ops-0.1.1.tgz` and declares it as a `file:vendor/...` dependency. This is a release artifact with integrity recorded by npm, not a link to another checkout. npm bundles the installed dependency and its runtime dependencies in the application tarball. The prepack hook gives installed hard-linked files independent inodes, preserving their bytes and modes, so npm can extract bundled executables reliably. Docker builds copy the vendored release before installing. Both source and tarball installation work when the separate bundle source repository is absent.

## Developing both repositories together

For local development, install the sibling checkout as an unsaved symbolic link. This uses npm's [local-folder installation](https://docs.npmjs.com/cli/v11/commands/npm-install/#description), leaving the release dependency in `package.json` and `npm-shrinkwrap.json` unchanged. Keep the checkout outside the EAA repository.

Prepare the bundle's dependencies and Python runtime once:

```bash
cd /data/programs/pi-experiment-ops
npm ci --legacy-peer-deps
bash scripts/install.sh --runtime-only
```

Then, from an already installed EAA checkout:

```bash
cd /data/programs/eaa-pi
npm install --no-save --package-lock=false --install-links=false --legacy-peer-deps ../pi-experiment-ops
node --input-type=module -e 'import { packageRoot } from "pi-experiment-ops"; console.log(packageRoot)'
node bin/eaa-pi.mjs serve --workspace /path/to/eaa-workspace
```

The printed path should be your sibling checkout. EAA now reads the bundle's JavaScript and Pi-loaded TypeScript directly from that checkout. Restart EAA after editing them; repacking the bundle and rebuilding EAA are unnecessary for those changes. EAA's own compiled TypeScript still needs `npm run build` after edits. Keep both repositories on matching Pi SDK versions. Dependency or Python-lock changes require updating the bundle's installation.

EAA supplies its own policy, MCP, terminal, and archive extension entrypoints. Changes confined to the bundle's native versions of those entrypoints affect its standalone CLI; edit the EAA bridges when changing their browser behavior.

Workspace configuration and toy workflow files are copied during initialization and preserved thereafter. Changes to their source templates apply to fresh workspaces; update existing workspace copies explicitly when needed. `providerWorkspace` shares provider configuration and is separate from this code link.

To return to the pinned release, run:

```bash
cd /data/programs/eaa-pi
bash scripts/install.sh /path/to/eaa-workspace
```

The source installer runs `npm ci`, restores the locked tarball dependency, provisions its Python runtime, and rebuilds EAA. Restore the pinned installation before packaging or release acceptance tests. Running `npm ci` at any time removes the development link.

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

Remove superseded vendored tarballs after verifying the new release; retain released artifacts elsewhere for rollback. When changing the Pi version, match this application's direct SDK dependencies to the bundle's exact Pi baseline. Once published, a registry version can replace the vendored dependency without changing the runtime API. Registry publication is a separate release action.

Application workspace paths and existing data remain unchanged by the split. Initialization preserves existing workflow definitions and settings. Fresh workspaces obtain the toy graph from the installed bundle. Existing demo workflows with the earlier fixture markers remain supported.
