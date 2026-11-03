import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { newId, runDir } from "../lib/db";
import { logger } from "../lib/log";
import { redact } from "../lib/redact";
import { allocateIp, issueToken, registerLease, releaseLease, liveTaskIds, type Lease, type EgressRecord } from "./registry";

const exec = promisify(execFile);
const log = logger("sandbox");

export interface Caps {
  cpus: string;
  memory: string;
  pids: number;
  timeoutMs: number;
  tmpfs: string;
  shm: string;
}

export interface CgroupStats {
  memoryPeak: number;
  memoryMax: number | null;
  pidsPeak: number;
  pidsMax: number | null;
  pidsMaxEvents: number;
  oomEvents: number;
  oomKills: number;
  cpuUsageUsec: number;
  nrPeriods: number;
  nrThrottled: number;
  throttledUsec: number;
  cpuMax: string;
  samples: number;
}

export interface SandboxResult {
  taskId: string;
  containerId: string;
  name: string;
  ip: string;
  exitCode: number | null;
  oomKilled: boolean;
  timedOut: boolean;
  durationMs: number;
  caps: Caps;
  stats: CgroupStats;
  destroyed: boolean;
  dockerEvents: { action: string; t: number }[];
  egress: EgressRecord[];
  brokerCalls: number;
  bytesIn: number;
  bytesOut: number;
  outDir: string;
  relDir: string;
  stderrTail: string[];
  inspect: { readonlyRootfs: boolean; capDrop: string[]; securityOpt: string[]; user: string; env: string[]; mounts: string[]; networkMode: string; privileged: boolean };
}

export interface SandboxTask {
  runId: string;
  stage: string;
  label: string;
  mode: "recon" | "sweep" | "repro" | "probe";
  allowHosts: string[];
  input: Record<string, unknown>;
  caps?: Partial<Caps>;
  files?: Record<string, string>;
  onLine?: (msg: Record<string, any>) => void;
  onEgress?: (r: EgressRecord) => void;
  onBroker?: (kind: string, data: Record<string, unknown>) => void;
  onLifecycle?: (phase: string, data: Record<string, unknown>) => void;
}

export async function docker(args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await exec("docker", args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

// ---- docker events fan-out -------------------------------------------------------------
type EvtListener = (e: { action: string; t: number }) => void;
const evtListeners = new Map<string, EvtListener>();
let eventsProc: ReturnType<typeof spawn> | null = null;
let eventsWanted = false;

export function stopDockerEvents() {
  eventsWanted = false;
  eventsProc?.kill();
  eventsProc = null;
}

export function startDockerEvents() {
  eventsWanted = true;
  if (eventsProc) return;
  eventsProc = spawn("docker", ["events", "--filter", "label=blastdoor.managed=1", "--filter", "type=container", "--format", "{{json .}}"]);
  let buf = "";
  eventsProc.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(line);
        const name = e.Actor?.Attributes?.name;
        const l = name && evtListeners.get(name);
        if (l) l({ action: String(e.Action ?? e.status), t: Math.round(Number(e.timeNano ?? 0) / 1e6) || Date.now() });
      } catch {}
    }
  });
  eventsProc.on("exit", () => {
    eventsProc = null;
    if (eventsWanted) setTimeout(startDockerEvents, 2000).unref();
  });
}

// ---- cgroup telemetry ------------------------------------------------------------------
function readNum(p: string): number | null {
  try {
    const v = fs.readFileSync(p, "utf8").trim();
    if (v === "max") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function readKv(p: string): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const [k, v] = line.trim().split(/\s+/);
      if (k) out[k] = Number(v);
    }
  } catch {}
  return out;
}

export function cgroupDirForPid(pid: number): string | null {
  try {
    const line = fs.readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find((l) => l.startsWith("0::"));
    if (!line) return null;
    const dir = path.join("/sys/fs/cgroup", line.slice(3).trim());
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function emptyStats(): CgroupStats {
  return { memoryPeak: 0, memoryMax: null, pidsPeak: 0, pidsMax: null, pidsMaxEvents: 0, oomEvents: 0, oomKills: 0, cpuUsageUsec: 0, nrPeriods: 0, nrThrottled: 0, throttledUsec: 0, cpuMax: "", samples: 0 };
}

export function sampleCgroup(dir: string, s: CgroupStats) {
  const memPeak = readNum(path.join(dir, "memory.peak")) ?? readNum(path.join(dir, "memory.current")) ?? 0;
  s.memoryPeak = Math.max(s.memoryPeak, memPeak);
  s.memoryMax = readNum(path.join(dir, "memory.max"));
  const pidsPeak = readNum(path.join(dir, "pids.peak")) ?? readNum(path.join(dir, "pids.current")) ?? 0;
  s.pidsPeak = Math.max(s.pidsPeak, pidsPeak);
  s.pidsMax = readNum(path.join(dir, "pids.max"));
  s.pidsMaxEvents = Math.max(s.pidsMaxEvents, readKv(path.join(dir, "pids.events")).max ?? 0);
  const me = readKv(path.join(dir, "memory.events"));
  s.oomEvents = Math.max(s.oomEvents, me.oom ?? 0);
  s.oomKills = Math.max(s.oomKills, me.oom_kill ?? 0);
  const cpu = readKv(path.join(dir, "cpu.stat"));
  s.cpuUsageUsec = Math.max(s.cpuUsageUsec, cpu.usage_usec ?? 0);
  s.nrPeriods = Math.max(s.nrPeriods, cpu.nr_periods ?? 0);
  s.nrThrottled = Math.max(s.nrThrottled, cpu.nr_throttled ?? 0);
  s.throttledUsec = Math.max(s.throttledUsec, cpu.throttled_usec ?? 0);
  try {
    s.cpuMax = fs.readFileSync(path.join(dir, "cpu.max"), "utf8").trim();
  } catch {}
  s.samples++;
}

// ---- lifecycle -------------------------------------------------------------------------
const active = new Set<string>();

export function containerArgs(name: string, ip: string, caps: Caps, workDir: string, labels: Record<string, string>, uid: string): string[] {
  const args = [
    "create",
    "--name", name,
    "--network", config.sandbox.network,
    "--ip", ip,
    "--dns", config.sandbox.dnsSink,
    "--hostname", "sandbox",
    "--cpus", caps.cpus,
    "--memory", caps.memory,
    "--memory-swap", caps.memory,
    "--pids-limit", String(caps.pids),
    "--read-only",
    "--tmpfs", `/tmp:rw,nosuid,nodev,size=${caps.tmpfs}`,
    "--shm-size", caps.shm,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", uid,
    "--ulimit", "nofile=2048:2048",
    "--stop-timeout", "1",
    "-e", "HOME=/tmp",
    "-v", `${workDir}:/work:rw`,
    "--workdir", "/work",
  ];
  for (const [k, v] of Object.entries(labels)) args.push("--label", `${k}=${v}`);
  args.push(config.sandbox.image);
  return args;
}

export async function runSandbox(t: SandboxTask): Promise<SandboxResult> {
  const caps: Caps = {
    cpus: config.sandbox.cpus,
    memory: config.sandbox.memory,
    pids: config.sandbox.pids,
    timeoutMs: config.sandbox.timeoutMs,
    tmpfs: config.sandbox.tmpfs,
    shm: config.sandbox.shm,
    ...t.caps,
  };
  const taskId = newId("tsk");
  const name = `bd-${taskId.replace(/_/g, "-")}`;
  const relDir = path.join("tasks", taskId);
  const workDir = path.join(runDir(t.runId), relDir);
  fs.mkdirSync(path.join(workDir, "out"), { recursive: true });
  const ip = allocateIp();
  const lease: Lease = registerLease({ taskId, runId: t.runId, stage: t.stage, ip, allowHosts: t.allowHosts.map((h) => h.toLowerCase()), label: t.label, context: {}, onEgress: t.onEgress, onBroker: t.onBroker });
  const token = issueToken(taskId);
  const gw = config.sandbox.gateway;
  fs.writeFileSync(
    path.join(workDir, "task.json"),
    JSON.stringify({ mode: t.mode, ...t.input, gateway: gw, proxy: `http://${gw}:${config.proxy.port}`, broker: { url: `http://${gw}:${config.broker.port}`, token } }, null, 2),
  );
  for (const [f, body] of Object.entries(t.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(workDir, f)), { recursive: true });
    fs.writeFileSync(path.join(workDir, f), body);
  }
  const uid = process.getuid?.() === 0 ? "1001:1001" : `${process.getuid?.()}:${process.getgid?.()}`;
  if (process.getuid?.() === 0) for (const d of [workDir, path.join(workDir, "out")]) fs.chownSync(d, 1001, 1001);

  const dockerEvents: { action: string; t: number }[] = [];
  evtListeners.set(name, (e) => {
    dockerEvents.push(e);
    t.onLifecycle?.("docker_event", { action: e.action, container: name });
  });
  const stats = emptyStats();
  const stderrTail: string[] = [];
  let containerId = "";
  let exitCode: number | null = null;
  let oomKilled = false;
  let timedOut = false;
  let destroyed = false;
  let inspect: SandboxResult["inspect"] = { readonlyRootfs: false, capDrop: [], securityOpt: [], user: "", env: [], mounts: [], networkMode: "", privileged: false };
  const started = Date.now();
  active.add(name);
  try {
    containerId = (await docker(containerArgs(name, ip, caps, workDir, { "blastdoor.managed": "1", "blastdoor.run": t.runId, "blastdoor.task": taskId, "blastdoor.created": String(Date.now()) }, uid))).trim();
    const ins = JSON.parse(await docker(["inspect", containerId]))[0];
    inspect = {
      readonlyRootfs: !!ins.HostConfig.ReadonlyRootfs,
      capDrop: ins.HostConfig.CapDrop ?? [],
      securityOpt: ins.HostConfig.SecurityOpt ?? [],
      user: ins.Config.User,
      env: ins.Config.Env ?? [],
      mounts: (ins.Mounts ?? []).map((m: any) => `${m.Source}:${m.Destination}:${m.RW ? "rw" : "ro"}`),
      networkMode: ins.HostConfig.NetworkMode,
      privileged: !!ins.HostConfig.Privileged,
    };
    t.onLifecycle?.("created", { container: name, id: containerId.slice(0, 12), ip, caps, label: t.label });

    const proc = spawn("docker", ["start", "-a", containerId], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    proc.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("@@BD ")) {
          try {
            t.onLine?.({ ...JSON.parse(line.slice(5)), _dir: relDir });
          } catch {}
        } else if (line.trim()) {
          stderrTail.push(redact(line).slice(0, 300));
          if (stderrTail.length > 80) stderrTail.shift();
        }
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) if (line.trim()) stderrTail.push(redact(line).slice(0, 300));
      while (stderrTail.length > 80) stderrTail.shift();
    });

    let cg: string | null = null;
    const poll = setInterval(async () => {
      if (!cg) {
        try {
          const pid = Number((await docker(["inspect", "-f", "{{.State.Pid}}", containerId], 5000)).trim());
          if (pid > 0) cg = cgroupDirForPid(pid);
        } catch {}
      }
      if (cg) sampleCgroup(cg, stats);
    }, 300);
    const killer = setTimeout(async () => {
      timedOut = true;
      if (cg) sampleCgroup(cg, stats);
      t.onLifecycle?.("wall_clock_kill", { container: name, afterMs: Date.now() - started, limitMs: caps.timeoutMs });
      await docker(["kill", containerId], 15000).catch(() => {});
    }, caps.timeoutMs);
    await new Promise<void>((resolve) => proc.on("exit", () => resolve()));
    clearInterval(poll);
    clearTimeout(killer);
    try {
      const st = JSON.parse(await docker(["inspect", "-f", "{{json .State}}", containerId]));
      exitCode = st.ExitCode;
      oomKilled = !!st.OOMKilled;
    } catch {}
    t.onLifecycle?.("exited", { container: name, exitCode, oomKilled, timedOut, ms: Date.now() - started });
  } catch (e) {
    log.error("sandbox failure", e);
    t.onLifecycle?.("error", { container: name, message: (e as Error).message });
  } finally {
    destroyed = await destroyContainer(containerId || name);
    t.onLifecycle?.("destroyed", { container: name, verified: destroyed });
    releaseLease(taskId);
    active.delete(name);
    setTimeout(() => evtListeners.delete(name), 3000);
  }
  return {
    taskId,
    containerId,
    name,
    ip,
    exitCode,
    oomKilled,
    timedOut,
    durationMs: Date.now() - started,
    caps,
    stats,
    destroyed,
    dockerEvents,
    egress: lease.egress,
    brokerCalls: lease.brokerCalls,
    bytesIn: lease.bytesIn,
    bytesOut: lease.bytesOut,
    outDir: path.join(workDir, "out"),
    relDir,
    stderrTail,
    inspect,
  };
}

/** Force-removes a container and its anonymous volumes, then proves it is gone. */
export async function destroyContainer(ref: string): Promise<boolean> {
  await docker(["rm", "-f", "-v", ref], 30000).catch(() => {});
  try {
    await docker(["inspect", ref], 10000);
    return false;
  } catch {
    return true;
  }
}

/** Removes any managed container this process is not actively running (crash leftovers). */
export async function reapOrphans(): Promise<string[]> {
  const out = await docker(["ps", "-a", "--filter", "label=blastdoor.managed=1", "--format", "{{.Names}}"]).catch(() => "");
  const names = out.split("\n").map((s) => s.trim()).filter(Boolean);
  const reaped: string[] = [];
  for (const n of names) {
    if (active.has(n)) continue;
    if (await destroyContainer(n)) reaped.push(n);
  }
  if (reaped.length) log.warn("reaped orphan sandboxes", { reaped, live: liveTaskIds().length });
  return reaped;
}

export async function managedContainerCount(): Promise<number> {
  const out = await docker(["ps", "-aq", "--filter", "label=blastdoor.managed=1"]).catch(() => "");
  return out.split("\n").filter((s) => s.trim()).length;
}
