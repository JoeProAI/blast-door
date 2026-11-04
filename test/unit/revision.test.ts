import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRevision } from "../../lib/revision";

const tmp = (body: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bd-rev-")), ".revision.json");
  fs.writeFileSync(f, body);
  return f;
};
const sha = "b15b9e6".padEnd(40, "0");

test("reads the revision deploy.sh writes", () => {
  const r = readRevision(tmp(JSON.stringify({ commit: sha, branch: "main", main: sha, onMain: true, dirty: false, deployedAt: "2026-11-04T02:00:00Z" })));
  assert.equal(r?.short, "b15b9e6");
  assert.equal(r?.onMain, true);
  assert.equal(r?.main, sha);
});

test("missing, malformed or non-sha revisions read as unrecorded", () => {
  assert.equal(readRevision("/nonexistent/.revision.json"), null);
  assert.equal(readRevision(tmp("{not json")), null);
  assert.equal(readRevision(tmp(JSON.stringify({ commit: "<script>" }))), null);
});

test("an empty main sha from a detached deploy is dropped, not linked", () => {
  const r = readRevision(tmp(JSON.stringify({ commit: sha, main: "", onMain: false })));
  assert.equal(r?.main, null);
  assert.equal(r?.onMain, false);
});
