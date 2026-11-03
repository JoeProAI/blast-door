import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { newRunId, sandbox, shutdown, TARGET } from "./harness";
import { sensitiveValues, resetRedactionCache } from "../../lib/redact";

after(shutdown);
const base = { stage: "test", allowHosts: ["target.blastdoor.test"] };
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const probeOut = (r: { outDir: string }, name: string) => JSON.parse(fs.readFileSync(path.join(r.outDir, `probe-${name}.json`), "utf8"));

test("no secrets: container env and filesystem hold none of the host's secret values", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "env", mode: "probe", input: { probe: "env" } });
  assert.equal(r.exitCode, 0, r.stderrTail.join("\n"));
  const out = probeOut(r, "env");
  resetRedactionCache();
  const secretHashes = new Set(sensitiveValues().map(sha));
  assert.ok(secretHashes.has(sha(process.env.BD_TEST_CANARY_SECRET!)), "canary is in the host env");
  for (const e of out.env) assert.ok(!secretHashes.has(e.sha256), `env ${e.name} matches a host secret`);
  for (const e of out.env) assert.ok(!/KEY|TOKEN|SECRET|PASSWORD/i.test(e.name), `suspicious env name ${e.name}`);
  assert.deepEqual(out.fsScan.hits, []);
  assert.equal(out.dockerSock, false);
  assert.notEqual(out.uid, 0);
  assert.equal(out.capEff, "0000000000000000");
  assert.equal(out.noNewPrivs, "1");
  assert.equal(out.seccomp, "2");
  assert.equal(out.rootWritable, false);
  const taskJson = fs.readFileSync(path.join(r.outDir, "..", "task.json"), "utf8");
  for (const v of sensitiveValues()) assert.ok(!taskJson.includes(v), "task.json holds no host secret");
});

test("egress: only the allowlisted target is reachable, through the proxy", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "net", mode: "probe", input: { probe: "net", target: TARGET, attackerUrl: "http://attacker.blastdoor.local/" } });
  assert.equal(r.exitCode, 0, r.stderrTail.join("\n"));
  const n = probeOut(r, "net");
  assert.equal(n.direct_internet_tcp.connected, false);
  assert.equal(n.metadata_service_tcp.connected, false);
  assert.equal(n.host_ssh_tcp.connected, false);
  assert.equal(n.host_app_tcp.connected, false);
  assert.equal(n.udp_dns_exfil.answered, false);
  assert.equal(n.dns_resolution.resolved, false);
  assert.equal(n.proxy_attacker.blocked, true);
  assert.equal(n.proxy_metadata.blocked, true);
  assert.notEqual(n.proxy_https_offlist.status, 200);
  assert.equal(n.proxy_allowed_target.status, 200);
  assert.ok(r.egress.some((e) => !e.allowed && e.host === "attacker.blastdoor.local"), "proxy logged the blocked exfil");
});

test("pids limit: a fork bomb hits the cap and the host survives", async () => {
  const hostProcsBefore = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).length;
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "fork", mode: "probe", input: { probe: "forkbomb", holdMs: 6000 }, caps: { pids: 64, timeoutMs: 12_000 } });
  const hostProcsAfter = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).length;
  assert.equal(r.stats.pidsMax, 64);
  assert.ok(r.stats.pidsPeak <= 64, `peak ${r.stats.pidsPeak}`);
  assert.ok(r.stats.pidsMaxEvents > 0, "kernel refused forks at the limit");
  assert.equal(r.destroyed, true);
  assert.ok(Math.abs(hostProcsAfter - hostProcsBefore) < 40, `host procs ${hostProcsBefore} -> ${hostProcsAfter}`);
});

test("memory cap: a balloon is OOM killed inside its cgroup", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "mem", mode: "probe", input: { probe: "memory" }, caps: { memory: "256m", timeoutMs: 30_000 } });
  assert.ok(r.oomKilled || r.stats.oomKills > 0, "kernel OOM killed the balloon");
  assert.ok(r.stats.memoryPeak <= 256 * 1024 * 1024 + 4096);
  assert.equal(r.destroyed, true);
});
