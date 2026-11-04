import { test } from "node:test";
import assert from "node:assert/strict";
import { dedash, dedashDeep } from "../../lib/text";

test("em and en dashes are removed from model text", () => {
  assert.equal(dedash("intentional demo page \u2014 not a bug"), "intentional demo page, not a bug");
  assert.equal(dedash("pages 2\u20134"), "pages 2-4");
  assert.deepEqual(dedashDeep({ a: ["x \u2014 y"], b: 3, c: { d: "e\u2013f" } }), { a: ["x, y"], b: 3, c: { d: "e, f" } });
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(dedashDeep({ s: "a\u2014b\u2013c" }))));
});
