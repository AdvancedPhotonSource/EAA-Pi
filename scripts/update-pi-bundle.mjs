#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/update-pi-bundle.mjs /path/to/pi-experiment-ops-VERSION.tgz');
const tarball = resolve(source);
const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
if (manifest.name !== 'pi-experiment-ops' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error('Expected a versioned pi-experiment-ops release');
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, 'vendor'), { recursive: true });
const filename = `pi-experiment-ops-${manifest.version}.tgz`;
const destination = join(root, 'vendor', filename);
if (tarball !== destination) cpSync(tarball, destination);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
pkg.dependencies['pi-experiment-ops'] = `file:vendor/${filename}`;
writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`Selected ${basename(destination)}. Run npm install --legacy-peer-deps, then npm install --package-lock-only --ignore-scripts --legacy-peer-deps to complete optional dependency metadata, then all acceptance checks.`);
