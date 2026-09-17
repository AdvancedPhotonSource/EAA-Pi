// npm's bundled tarball extraction can drop hard-linked executable entries.
// Give each installed file its own inode while preserving its bytes and mode.
import { readdirSync, lstatSync, copyFileSync, chmodSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../node_modules');
let normalized = 0;
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile()) {
      const stat = lstatSync(path);
      if (stat.nlink < 2) continue;
      const temporary = `${path}.pack-${process.pid}`;
      copyFileSync(path, temporary);
      chmodSync(temporary, stat.mode);
      renameSync(temporary, path);
      normalized++;
    }
  }
}
visit(root);
if (normalized) console.error(`Prepared ${normalized} hard-linked files for npm packaging.`);
