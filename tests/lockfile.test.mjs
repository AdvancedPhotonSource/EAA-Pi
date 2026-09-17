import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// npm ci validates optional dependencies even when their OS/CPU does not match.
// Bundled packages can otherwise hide missing entries on the build machine.
test('shrinkwrap resolves every declared optional dependency on all platforms', () => {
  const { packages } = JSON.parse(readFileSync(new URL('../npm-shrinkwrap.json', import.meta.url), 'utf8'));
  const missing = [];
  for (const [path, pkg] of Object.entries(packages)) {
    for (const [name, version] of Object.entries(pkg.optionalDependencies || {})) {
      let parent = path;
      let found = false;
      while (true) {
        if (packages[(parent ? parent + '/' : '') + 'node_modules/' + name]) { found = true; break; }
        if (!parent) break;
        parent = parent.replace(/(^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/, '');
      }
      if (!found) missing.push(`${path || '(root)'} -> ${name}@${version}`);
    }
  }
  assert.deepEqual(missing, [], 'Optional dependency metadata is missing from npm-shrinkwrap.json');
});
