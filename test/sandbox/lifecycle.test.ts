import { test, after } from "node:test";
import assert from "node:assert/strict";
import { leftovers, newRunId, sandbox, shutdown, TARGET } from "./harness";

after(shutdown);
const base = { stage: "test", allowHosts: ["target.blastdoor.test"] };
const volumesBefore = (await leftovers()).volumes;

async function assertClean() {
  const l = await leftovers();
  assert.equal(l.containers, "", "no managed containers left");
  assert.equal(l.volumes, volumesBefore, "no new dangling volumes");
  assert.equal(l.networks, 1, "only the sandbox network exists");
}

test("success: container runs, exits 0, is destroyed", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "ok", mode: "probe", input: { probe: "cpu", holdMs: 500, target: TARGET } });
  assert.equal(r.exitCode, 0, r.stderrTail.join("\n"));
  assert.equal(r.destroyed, true);
  assert.ok(r.dockerEvents.some((e) => e.action === "destroy"), "docker reported destroy");
  await assertClean();
});

test("failure: a runner error still destroys the container", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "fail", mode: "probe", input: { probe: "does-not-exist" } });
  assert.notEqual(r.exitCode, 0);
  assert.equal(r.destroyed, true);
  await assertClean();
});

test("timeout: the wall clock kills and destroys a hung task", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "hang", mode: "probe", input: { probe: "cpu", holdMs: 60_000 }, caps: { timeoutMs: 4000 } });
  assert.equal(r.timedOut, true, `exit ${r.exitCode} after ${r.durationMs}ms: ${r.stderrTail.join(" | ")}`);
  assert.ok(r.durationMs < 20_000);
  assert.equal(r.destroyed, true);
  await assertClean();
});

test("crash: an orphan left by a dead orchestrator is reaped", async () => {
  await sandbox.docker(["run", "-d", "--label", "blastdoor.managed=1", "--label", `blastdoor.owner=${process.env.BLASTDOOR_SANDBOX_OWNER}`, "--name", "bd-orphan-test", "--network", "none", "--entrypoint", "sleep", "blastdoor/sandbox:1", "300"]);
  const reaped = await sandbox.reapOrphans();
  assert.ok(reaped.includes("bd-orphan-test"));
  await assertClean();
});

test("caps are applied as configured", async () => {
  const r = await sandbox.runSandbox({ ...base, runId: newRunId(), label: "caps", mode: "probe", input: { probe: "cpu", holdMs: 1500 }, caps: { pids: 77, memory: "300m", cpus: "0.5" } });
  assert.equal(r.stats.pidsMax, 77);
  assert.equal(r.stats.memoryMax, 300 * 1024 * 1024);
  assert.match(r.stats.cpuMax, /^50000 100000$/);
  assert.equal(r.inspect.readonlyRootfs, true);
  assert.deepEqual(r.inspect.capDrop, ["ALL"]);
  assert.ok(r.inspect.securityOpt.includes("no-new-privileges"));
  assert.notEqual(r.inspect.user, "0");
  assert.equal(r.inspect.privileged, false);
  assert.equal(r.inspect.mounts.length, 1, "only the per-task work dir is mounted");
  assert.ok(!r.inspect.mounts.some((m) => m.includes("docker.sock")));
});
