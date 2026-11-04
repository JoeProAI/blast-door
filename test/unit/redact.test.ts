import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BD_TEST_SECRET_TOKEN = "zq8-unit-test-value-4491";
const { redact, redactDeep, resetRedactionCache } = await import("../../lib/redact");
resetRedactionCache();

test("literal secret values from env are replaced", () => {
  assert.equal(redact("auth zq8-unit-test-value-4491 ok"), "auth [REDACTED] ok");
});

test("bearer tokens and key blocks are scrubbed", () => {
  const out = redact("Authorization: Bearer abcdefghijklmnop1234 and -----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----");
  assert.ok(!out.includes("abcdefghijklmnop1234"));
  assert.ok(!out.includes("AAAA"));
});

test("redactDeep walks nested objects", () => {
  const o = redactDeep({ a: [{ b: "x zq8-unit-test-value-4491" }] }) as { a: { b: string }[] };
  assert.equal(o.a[0].b, "x [REDACTED]");
});
