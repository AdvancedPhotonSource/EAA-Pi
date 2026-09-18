import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workflows } from "../dist/server/workflows.js";

test("workflow discovery lists definitions in workspace directories", t => {
  const workspace = mkdtempSync(join(tmpdir(), "eaa-workflow-catalog-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const workflows = new Workflows({ workspace, store: { db: { prepare: () => ({ all: () => [] }) } } });
  assert.deepEqual(workflows.list(), []);
  const root = join(workspace, "workflows");
  mkdirSync(root);
  assert.deepEqual(workflows.list(), []);
  for (const name of ["zeta", "alpha", "incomplete", "directory-definition", "external-definition"]) mkdirSync(join(root, name));
  for (const name of ["zeta", "alpha"]) writeFileSync(join(root, name, "steps.yaml"), "steps: []\n");
  writeFileSync(join(root, "notes.txt"), "not a workflow");
  mkdirSync(join(root, "directory-definition", "steps.yaml"));
  writeFileSync(join(workspace, "outside.yaml"), "steps: []\n");
  symlinkSync(join(workspace, "outside.yaml"), join(root, "external-definition", "steps.yaml"));
  assert.deepEqual(workflows.list(), ["alpha", "zeta"]);
  rmSync(join(root, "alpha"), { recursive: true });
  assert.deepEqual(workflows.list(), ["zeta"]);
});
