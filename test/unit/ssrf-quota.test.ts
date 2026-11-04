import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BLASTDOOR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bd-quota-"));
const { guardPublicUrl, isPrivateAddress } = await import("../../lib/ssrf");
const { publicUrlQuota, clientKey } = await import("../../lib/quota");
const { createRun } = await import("../../lib/db");
const { checkTarget } = await import("../../lib/targets");

test("private, reserved and metadata addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fc12::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "66.135.31.133", "100.128.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("guard: literal IPs, internal names, odd ports and rebinding answers are refused", async () => {
  const pub = async () => ["93.184.216.34"];
  for (const u of ["http://127.0.0.1/", "http://2130706433/", "http://[::1]/", "http://169.254.169.254/latest/", "http://[fd00::5]/", "http://localhost/", "http://printer.local/", "http://db.internal/"])
    assert.equal((await guardPublicUrl(new URL(u).toString(), pub)).ok, false, u);
  assert.equal((await guardPublicUrl("http://example.com:8080/", pub)).ok, false);
  assert.equal((await guardPublicUrl("https://example.com/", pub)).ok, true);
  assert.equal((await guardPublicUrl("https://rebind.example/", async () => ["93.184.216.34", "10.0.0.7"])).ok, false, "any private answer fails");
  assert.equal((await guardPublicUrl("https://gone.example/", async () => { throw new Error("NXDOMAIN"); })).ok, false);
});

test("targets: public URLs are accepted in shape and flagged as non-fixture", () => {
  const t = checkTarget("https://example.com/", false);
  assert.ok(t.ok && !t.fixture);
  const f = checkTarget("http://shop.blastdoor.local/", false);
  assert.ok(f.ok && f.fixture);
});

test("quota: 3 public sweeps per client per day, then refused; other clients unaffected", () => {
  const a = clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }));
  const b = clientKey(new Headers({ "x-forwarded-for": "198.51.100.8" }));
  assert.notEqual(a, b);
  assert.equal(a, clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" })), "spoofed left entries are ignored");
  for (let i = 0; i < 3; i++) {
    assert.equal(publicUrlQuota(a).ok, true);
    createRun({ kind: "sweep", target: "https://example.com/", source: "public-url", client: a, tokenBudget: 60_000 });
  }
  assert.equal(publicUrlQuota(a).ok, false);
  assert.equal(publicUrlQuota(b).ok, true);
});
