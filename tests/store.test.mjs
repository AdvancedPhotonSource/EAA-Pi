import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialize } from "../dist/server/config.js";
import { Store } from "../dist/server/store.js";

test("artifact registry rejects symlink substitution and completion identity survives reopen", () => {
  const workspace = initialize(mkdtempSync(join(tmpdir(), "eaa-pi-store-")));
  let store = new Store(workspace);
  const path = store.artifact(Buffer.from("test image bytes"), "image/png");
  assert.ok(store.resolveArtifact(path));
  const outside = join(workspace, "untouched"); writeFileSync(outside, "untouched");
  unlinkSync(path); symlinkSync(outside, path);
  assert.equal(store.resolveArtifact(path), undefined);
  assert.throws(() => store.artifact(Buffer.from("test image bytes"), "image/png"));
  assert.equal(readFileSync(outside, "utf8"), "untouched");
  assert.equal(store.completeOnce("same-completion"), true);
  store.close(); store = new Store(workspace);
  assert.equal(store.completeOnce("same-completion"), false);
  store.close();
});
