import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, isPrivateAddress } from "../../worker/egress-proxy";
import type { Lease } from "../../worker/registry";

const lease = (hosts: string[]): Lease => ({ taskId: "tsk_x", runId: "run_x", stage: "t", ip: "172.31.250.10", allowHosts: hosts, label: "t", brokerCalls: 0, context: {}, egress: [], bytesIn: 0, bytesOut: 0 });

test("traffic from an unknown source is refused", async () => {
  assert.equal((await decide(undefined, "example.com", 443)).allowed, false);
});

test("hosts off the task allowlist are refused", async () => {
  const d = await decide(lease(["shop.blastdoor.local"]), "attacker.blastdoor.local", 80);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /allowlist/);
});

test("allowlisted hosts that resolve to private or metadata ranges are refused", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.31.250.1", "192.168.0.4", "::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
    const d = await decide(lease([ip]), ip, 80);
    assert.equal(d.allowed, false, ip);
  }
  assert.equal(isPrivateAddress("66.135.31.133"), false);
});

test("non web ports are refused even on an allowlisted host", async () => {
  const d = await decide(lease(["example.com"]), "example.com", 22);
  assert.equal(d.allowed, false);
});
