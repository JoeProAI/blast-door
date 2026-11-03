import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { addEvent, getRun, updateRun, type RunRow } from "../lib/db";
import { logger } from "../lib/log";
import type { SweepOutput } from "../lib/types";
import { makePlan, type Recon } from "./planner";
import { runSandbox, type SandboxResult, type SandboxTask } from "./sandbox";

const log = logger("orchestrator");

export function allowHostsFor(target: string): string[] {
  return [new URL(target).hostname.toLowerCase()];
}

/** Event plumbing shared by every sandbox task: lifecycle, egress, broker and runner lines all land in the run log. */
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
    brokerCalls: r.brokerCalls,
    readonlyRootfs: r.inspect.readonlyRootfs,
    capDrop: r.inspect.capDrop,
    securityOpt: r.inspect.securityOpt,
    user: r.inspect.user,
    envNames: r.inspect.env.map((e) => e.split("=")[0]),
    mounts: r.inspect.mounts.map((m) => m.replace(config.dataDir, "$DATA")),
  };
}

function readOut<T>(r: SandboxResult, file: string): T | null {
  for (const f of [file, file.replace(".json", ".partial.json")]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(r.outDir, f), "utf8")) as T;
    } catch {}
  }
  return null;
}

/** Shot paths in the report are relative to the run directory so the UI can serve them. */
function rebase<T extends { file: string }>(shots: T[], r: SandboxResult): T[] {
  return shots.map((s) => ({ ...s, file: path.join(r.relDir, "out", "shots", s.file) }));
}

async function stage<T>(runId: string, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  updateRun(runId, { stage: name });
  addEvent(runId, name, "stage_start", {});
  try {
    const out = await fn();
    addEvent(runId, name, "stage_done", { ms: Date.now() - t0 });
    return out;
  } catch (e) {
    addEvent(runId, name, "stage_failed", { ms: Date.now() - t0, message: (e as Error).message });
    throw e;
  }
}

export async function executeSweep(run: RunRow) {
  const allowHosts = allowHostsFor(run.target);
  const receipts: ReturnType<typeof sandboxReceipt>[] = [];

  const recon = await stage(run.id, "recon", async () => {
    const r = await runSandbox({ runId: run.id, stage: "recon", label: "recon", mode: "recon", allowHosts, input: { target: run.target }, caps: { timeoutMs: 60_000 }, ...wire(run.id, "recon") });
    receipts.push(sandboxReceipt(r));
    const out = readOut<Recon & { shots: { file: string }[]; signals: unknown[] }>(r, "recon.json");
    if (!out) throw new Error(`recon produced no output (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""})`);
    out.shots = rebase(out.shots, r);
    return out;
  });

  const { plan, usedFallback } = await stage(run.id, "plan", async () => {
    const p = await makePlan(run.id, recon, allowHosts, run.goal);
    addEvent(run.id, "plan", "plan", { ...p.plan, usedFallback: p.usedFallback });
    return p;
  });

  const sweep = await stage(run.id, "sweep", async () => {
    const r = await runSandbox({
      runId: run.id,
      stage: "sweep",
      label: "sweep",
      mode: "sweep",
      allowHosts,
      input: { target: run.target, plan, maxSteps: config.budget.agentStepsPerFlow },
      ...wire(run.id, "sweep"),
    });
    receipts.push(sandboxReceipt(r));
    const out = readOut<SweepOutput>(r, "sweep.json");
    if (!out) throw new Error(`sweep produced no output (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""})`);
    out.shots = rebase(out.shots, r);
    return out;
  });

  const fresh = getRun(run.id)!;
  const report = {
    version: 1,
    runId: run.id,
    target: run.target,
    goal: run.goal,
    plan,
    planFallback: usedFallback,
    recon: { title: recon.title, status: recon.status, shots: recon.shots, links: recon.links.length, forms: recon.forms.length },
    sweep,
    sandboxes: receipts,
    tokens: { prompt: fresh.tokens_prompt, completion: fresh.tokens_completion, costUsd: fresh.cost_usd, budget: fresh.token_budget },
    models: config.models,
  };
  fs.writeFileSync(path.join(config.dataDir, "runs", run.id, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

export async function executeRun(run: RunRow) {
  log.info("run started", { id: run.id, kind: run.kind, target: run.target });
  addEvent(run.id, "run", "run_start", { target: run.target, goal: run.goal, kind: run.kind });
  try {
    if (run.kind !== "sweep") throw new Error(`run kind ${run.kind} is not wired yet`);
    const report = await executeSweep(run);
    updateRun(run.id, { status: "done", stage: "done", finished_at: Date.now(), report: JSON.stringify(report) });
    addEvent(run.id, "run", "run_done", { shots: report.sweep.shots.length, signals: report.sweep.signals.length });
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    updateRun(run.id, { status: "failed", finished_at: Date.now(), error: message });
    addEvent(run.id, "run", "run_failed", { message });
  }
}
