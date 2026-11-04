// Shared event plumbing and receipt shaping. Split out so containment and the sweep pipeline can
// both use it without importing each other.
import path from "node:path";
import { config } from "../lib/config";
import { addEvent } from "../lib/db";
import type { SandboxResult, SandboxTask } from "./sandbox";

/** Lifecycle, egress, broker and runner lines all land in the run log. */
export function wire(runId: string, stage: string): Pick<SandboxTask, "onLine" | "onEgress" | "onBroker" | "onLifecycle"> {
  return {
    onLine: (m) => {
      const { type, _dir, ...rest } = m;
      if (type === "shot") addEvent(runId, stage, "shot", { ...rest, file: path.join(_dir, "out", "shots", rest.file) });
      else if (type === "step") addEvent(runId, stage, "agent_step", rest);
      else addEvent(runId, stage, `runner_${type}`, rest);
    },
    onEgress: (r) => addEvent(runId, stage, r.allowed ? "egress_allowed" : "egress_blocked", r),
    onBroker: (kind, data) => addEvent(runId, stage, `broker_${kind}`, data),
    onLifecycle: (phase, data) => addEvent(runId, stage, `sandbox_${phase}`, data),
  };
}

export function sandboxReceipt(r: SandboxResult) {
  return {
    taskId: r.taskId,
    container: r.name,
    containerId: r.containerId.slice(0, 12),
    ip: r.ip,
    exitCode: r.exitCode,
    oomKilled: r.oomKilled,
    timedOut: r.timedOut,
    durationMs: r.durationMs,
    caps: r.caps,
    stats: r.stats,
    destroyed: r.destroyed,
    dockerEvents: r.dockerEvents.map((e) => e.action),
    egressBlocked: r.egress.filter((e) => !e.allowed).length,
    egressAllowed: r.egress.filter((e) => e.allowed).length,
    egressDenied: [...new Set(r.egress.filter((e) => !e.allowed).map((e) => `${e.host}:${e.port} ${e.reason}`))],
    brokerCalls: r.brokerCalls,
    readonlyRootfs: r.inspect.readonlyRootfs,
    capDrop: r.inspect.capDrop,
    securityOpt: r.inspect.securityOpt,
    user: r.inspect.user,
    envNames: r.inspect.env.map((e) => e.split("=")[0]),
    mounts: r.inspect.mounts.map((m) => m.replace(config.dataDir, "$DATA")),
  };
}
