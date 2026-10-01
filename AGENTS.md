# eaa-pi

Standalone TypeScript host for the Pi SDK and EAA's React frontend.

The agent backend is a Pi package (/data/programs/pi-experiment-ops).

- `src/`: HTTP/SSE adapter, runtime, state, CLI, and credential-free demo services.
- `extensions/`: EAA bridges loaded by Pi's extension loader; keep upstream packages unchanged.
- `webui/`: copied EAA frontend, built into `dist/webui`.
- `examples/`: application configuration templates.
- `vendor/`: versioned pi-experiment-ops release; owns community pins, Python provisioning, and the toy workflow. Update via scripts/update-pi-bundle.mjs, never sibling runtime imports.
- `tests/`: integration tests against real Pi/extensions and a local provider fixture.

Run `npm run build` and `npm test` after backend changes. Run `npm run test:browser` for frontend changes. Container and packaging acceptance have separate scripts. Never use the original EAA package at runtime or in tests.

Commit messages use `TAG: message`.

## Release checklist

1. Align the application version in `package.json`, both root version fields in `npm-shrinkwrap.json`, and the default and help text in `install.sh`. Update versioned URLs, commands, archive names, and checksum examples in `README.md` and `docs/installation.md`.
2. Publish the required pi-experiment-ops release first. Download its `.tgz` and `.tgz.sha256` assets and verify the checksum. Run `node scripts/update-pi-bundle.mjs /path/to/pi-experiment-ops-VERSION.tgz`; this updates the dependency and the single vendor archive in `package.json.files` while preserving older local archives.
3. Run `npm install --legacy-peer-deps`, then `npm install --package-lock-only --ignore-scripts --legacy-peer-deps`. Check the dependency path, installed bundle version, and shrinkwrap's resolved path/version/integrity against that exact release asset. Update bundle references in `docs/repositories.md` and `docs/validation.md`; review `THIRD_PARTY.md` if upstream provenance changed.
4. Run `npm run build`, `npm test`, and `npm run test:package`. Run browser acceptance for frontend changes and container acceptance for container changes. The package test must confirm that only the selected vendor archive is shipped. Keep fixed historical test fixtures and changelog entries at their original versions.
5. Commit and push the tested source, manifests, lockfile, installer, documentation, and this checklist. Tag that commit `vVERSION`, pack `eaa-pi-VERSION.tgz`, and generate `eaa-pi-VERSION.tgz.sha256`. Publish both assets on the matching GitHub Release in `AdvancedPhotonSource/EAA-Pi`; verify the uploaded checksum and installer URL. Generated archives, caches, credentials, and workspaces stay outside Git.
