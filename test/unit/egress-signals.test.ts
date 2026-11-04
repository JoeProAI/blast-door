import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidates, reclassifySignals } from "../../worker/judge";

test("allowlist refusals logged as console errors become blocked egress, never candidates", () => {
  const signals: any[] = [
    { kind: "console_error", page: "https://a.example/", message: "Failed to load resource: net::ERR_TUNNEL_CONNECTION_FAILED", detail: { url: "https://cdn.tracker.example/p.js" } },
    { kind: "request_failed", page: "https://a.example/", message: "net::ERR_TUNNEL_CONNECTION_FAILED GET https://fonts.example/f.woff2" },
    { kind: "console_error", page: "https://a.example/", message: "Uncaught TypeError: x is undefined" },
  ];
  reclassifySignals(signals);
  assert.equal(signals[0].kind, "blocked_egress");
  assert.equal(signals[1].kind, "blocked_egress");
  assert.equal(signals[1].detail.url, "https://fonts.example/f.woff2");
  assert.equal(signals[2].kind, "console_error");
  const c = buildCandidates({ pages: [], shots: [], flows: [], signals } as any, []);
  assert.ok(c.every((x) => !/TUNNEL/.test(JSON.stringify(x))), "no tunnel failure reaches a claim");
});
