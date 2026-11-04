import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateIp, consumeToken, issueToken, registerLease, releaseLease } from "../../worker/registry";

function lease(taskId: string) {
  return registerLease({ taskId, runId: "run_test", stage: "test", ip: allocateIp(), allowHosts: ["shop.blastdoor.local"], label: "t", context: {} });
}

test("a broker token works exactly once", () => {
  lease("tsk_a");
  const t = issueToken("tsk_a");
  const first = consumeToken(t);
  assert.equal(first.ok, true);
  const second = consumeToken(t);
  assert.deepEqual(second, { ok: false, reason: "replayed", taskId: "tsk_a" });
  releaseLease("tsk_a");
});

test("chained tokens: the next token works, the old one stays dead", () => {
  lease("tsk_b");
  const t1 = issueToken("tsk_b");
  assert.equal(consumeToken(t1).ok, true);
  const t2 = issueToken("tsk_b");
  assert.equal(consumeToken(t2).ok, true);
  assert.equal(consumeToken(t1).ok, false);
  releaseLease("tsk_b");
});

test("tokens die with their lease", () => {
  lease("tsk_c");
  const t = issueToken("tsk_c");
  releaseLease("tsk_c");
  const r = consumeToken(t);
  assert.equal(r.ok, false);
});

test("garbage and unknown tokens are refused", () => {
  assert.equal(consumeToken(undefined).ok, false);
  assert.equal(consumeToken("short").ok, false);
  assert.deepEqual(consumeToken("x".repeat(43)), { ok: false, reason: "unknown" });
});

test("each lease gets a distinct IP", () => {
  const a = lease("tsk_d");
  const b = lease("tsk_e");
  assert.notEqual(a.ip, b.ip);
  releaseLease("tsk_d");
  releaseLease("tsk_e");
});
