import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidates, flowTitle, pickShots } from "../../worker/judge";
import { evidenceGate } from "../../worker/adversary";
import { classify, templateFor, validateTest } from "../../worker/repro";
import type { Bug, JudgedShot, SweepOutput } from "../../lib/types";

const shop = "http://shop.blastdoor.local/";
const sweep: SweepOutput = {
  pages: [],
  flows: [
    { name: "cart", goal: "check subtotal", startUrl: shop, outcome: "BUG FOUND: The cart subtotal is wrong. It shows $64.00 for two items.", steps: [{ index: 1, url: shop, ok: true, action: { action: "click", ref: 3, reason: "add" }, selector: "button.add", shot: "f1.jpg" }] },
    { name: "nav", goal: "links", startUrl: shop, outcome: "All links loaded. No issues found.", steps: [] },
  ],
  signals: [
    { kind: "http_error", page: shop, viewport: "desktop", message: "GET /api/reviews returned 500", detail: { url: `${shop}api/reviews`, status: 500 } },
    { kind: "console_error", page: shop, viewport: "desktop", message: "Failed to load resource: the server responded with a status of 500" },
    { kind: "console_error", page: shop, viewport: "desktop", message: "ReferenceError: loadReviews is not defined" },
    { kind: "blocked_egress", page: shop, viewport: "desktop", message: "fonts.example blocked" },
  ],
  shots: [
    { file: "tasks/t/out/shots/p1.jpg", page: shop, viewport: "desktop", label: "page 1" },
    { file: "tasks/t/out/shots/p1m.jpg", page: shop, viewport: "mobile", label: "page 1 mobile" },
    { file: "tasks/t/out/shots/f1.jpg", page: shop, viewport: "desktop", label: "cart step 1", flow: "cart" },
  ],
  links: [],
  har: { requests: 0, failed: 0, bytes: 0, byType: {}, hosts: {} },
  dom: {},
};
const judged: JudgedShot[] = [
  { shot: sweep.shots[1], model: "qwen3.8-27b", scores: { layout_integrity: 4, visual_bugs: 8, readability_contrast: 9, broken_media: 10, responsive: 3, error_states: 10 }, issues: [
    { title: "Product grid overflows the viewport", rubric: "responsive", severity: "medium", region: { x: 0.5, y: 0.2, w: 0.5, h: 0.3 }, evidence: "Cards are cut off at the right edge", confidence: 0.8 },
    { title: "Maybe a faint button", rubric: "readability_contrast", severity: "low", region: { x: 0, y: 0, w: 0.1, h: 0.1 }, evidence: "unsure", confidence: 0.3 },
  ] },
];

test("candidates: flow bugs, vision issues and signals are merged; noise is dropped", () => {
  const c = buildCandidates(sweep, judged, 20);
  const titles = c.map((x) => x.title).join(" | ");
  assert.ok(c.some((x) => x.source === "flow" && /subtotal/.test(x.title)), titles);
  assert.ok(!c.some((x) => x.flow === "nav"), "a clean flow outcome is not a bug");
  assert.ok(c.some((x) => x.source === "vision" && x.region && x.viewport === "mobile"));
  assert.ok(!c.some((x) => /faint button/.test(x.title)), "low confidence vision issues are dropped");
  assert.ok(!c.some((x) => x.category === "blocked_egress"), "sandbox egress blocks are not target bugs");
  assert.ok(!c.some((x) => /Failed to load resource/.test(x.title)), "console noise duplicating an http error is dropped");
  assert.equal(c.find((x) => x.category === "http_error")?.severity, "high");
  assert.deepEqual(c.map((x) => x.id), c.map((_, i) => `B${String(i + 1).padStart(2, "0")}`));
  for (const x of c) assert.ok(x.steps.length > 0 && x.shot, `${x.id} has steps and a screenshot`);
});

test("pickShots: one frame per page and viewport, page frames first, capped", () => {
  const p = pickShots([...sweep.shots, ...sweep.shots], 2);
  assert.equal(p.length, 2);
  assert.ok(p.every((s) => !s.flow));
});

test("evidence gate needs a screenshot, a log and steps", () => {
  const c = buildCandidates(sweep, judged, 20)[0];
  assert.deepEqual(evidenceGate(c), { screenshot: true, log: true, steps: true });
  assert.equal(evidenceGate({ ...c, shot: undefined }).screenshot, false);
  assert.equal(evidenceGate({ ...c, source: "signal", logs: [] }).log, false);
});

const bug = (over: Partial<Bug>): Bug => ({
  id: "B01", title: "t", category: "http_error", severity: "high", source: "signal", page: shop, viewport: "desktop", evidence: [], confidence: 1, steps: ["Open"],
  adversary: { verdict: "survived", modelVerdict: "holds", argument: "", counter: "", gate: { screenshot: true, log: true, steps: true }, model: "m" }, ...over,
});

test("templates: signal bugs get a deterministic test that passes the validator", () => {
  const hosts = ["shop.blastdoor.local"];
  for (const b of [
    bug({ signalKinds: ["http_error"], detail: { url: `${shop}api/reviews`, status: 500 } }),
    bug({ signalKinds: ["broken_link"], category: "broken_link", detail: { url: `${shop}careers` } }),
    bug({ signalKinds: ["console_error"], category: "console_error", logs: ["console_error: ReferenceError: loadReviews is not defined"] }),
    bug({ category: "responsive", source: "vision", viewport: "mobile" }),
    bug({ signalKinds: ["a11y"], category: "a11y", logs: ["a11y: 2 images have no alt text"] }),
  ]) {
    const code = templateFor(b);
    assert.ok(code, `template for ${b.category}`);
    assert.equal(validateTest(code!, hosts), null, code!);
  }
  assert.match(templateFor(bug({ category: "responsive", viewport: "mobile" }))!, /390/);
  assert.equal(templateFor(bug({ category: "functional", source: "flow" })), null);
});

test("validator refuses escapes from the code sandbox contract", () => {
  const ok = `import { test, expect } from "@playwright/test";\ntest("x", async ({ page }) => { await page.goto("http://shop.blastdoor.local/"); expect(1).toBe(1); });`;
  const hosts = ["shop.blastdoor.local"];
  assert.equal(validateTest(ok, hosts), null);
  assert.match(validateTest(ok.replace("shop.blastdoor.local", "attacker.example"), hosts)!, /not the target/);
  assert.match(validateTest(`import fs from "node:fs";\n${ok}`, hosts)!, /not allowed/);
  assert.match(validateTest(ok.replace("expect(1)", "process.env; expect(1)"), hosts)!, /forbidden/);
  assert.match(validateTest(ok.replace("expect(1)", "await import('x'); expect(1)"), hosts)!, /forbidden/);
  assert.ok(validateTest("console.log(1)", hosts));
});

test("classify: only an assertion failure counts as reproduced", () => {
  assert.equal(classify({ status: "passed", duration: 10 }).status, "not_reproduced");
  assert.equal(classify({ status: "failed", error: { message: "Error: expect(received).toEqual(expected)" } }).status, "reproduced");
  assert.equal(classify({ status: "failed", error: { message: "locator.click: Timeout 5000ms exceeded" } }).status, "inconclusive");
  assert.equal(classify({ status: "timedOut", error: { message: "Error: Test timeout of 25000ms exceeded." } }).status, "inconclusive");
  assert.equal(classify(undefined).status, "not_run");
});

test("flow titles use the sentence that names the defect", () => {
  assert.equal(flowTitle("All nav links have been tested. The Careers link returns a 404 page."), "The Careers link returns a 404 page.");
  assert.equal(flowTitle("BUG FOUND: Subtotal is wrong."), "Subtotal is wrong.");
});

test("vision issues are deduplicated per page, viewport and rubric", () => {
  const twice: JudgedShot[] = [{ ...judged[0], issues: [judged[0].issues[0], { ...judged[0].issues[0], title: "same overflow again", confidence: 0.7 }] }];
  const c = buildCandidates(sweep, twice, 20).filter((x) => x.source === "vision");
  assert.equal(c.length, 1);
  assert.equal(c[0].confidence, 0.8);
});
