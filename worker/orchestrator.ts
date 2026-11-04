import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { addEvent, getRun, updateRun, type RunRow } from "../lib/db";
import { logger } from "../lib/log";
import type { SweepOutput } from "../lib/types";
import { runAdversary } from "./adversary";
import { buildCandidates, judgeShots } from "./judge";
import { runRepros } from "./repro";
import { makePlan, type Recon } from "./planner";
import { executeContainment } from "./containment";
import { sandboxReceipt, wire } from "./orchestrator-wire";
import { runSandbox, type SandboxResult } from "./sandbox";

const log = logger("orchestrator");

export function allowHostsFor(target: string): string[] {
  return [new URL(target).hostname.toLowerCase()];
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
function rebase<T extends { file: string; thumb?: string }>(shots: T[], r: SandboxResult): T[] {
  return shots.map((s) => ({ ...s, file: path.join(r.relDir, "out", "shots", s.file), thumb: s.thumb ? path.join(r.relDir, "out", "shots", s.thumb) : undefined }));
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
    const p = await makePlan(run.id, recon, allowHosts, run.goal, run.source === "public-url" ? config.publicAny.maxPages : undefined);
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

  const judged = await stage(run.id, "judge", async () => judgeShots(run.id, sweep.shots));
  const candidates = buildCandidates(sweep, judged);
  addEvent(run.id, "judge", "candidates", {
    count: candidates.length,
    vision: candidates.filter((c) => c.source === "vision").length,
    signal: candidates.filter((c) => c.source === "signal").length,
    flow: candidates.filter((c) => c.source === "flow").length,
  });

  const challenged = await stage(run.id, "adversary", async () => runAdversary(run.id, candidates, sweep));

  const bugs = await stage(run.id, "repro", async () => {
    const r = await runRepros(run.id, challenged, sweep, allowHosts, wire(run.id, "repro"));
    if (r.receipt) receipts.push(sandboxReceipt(r.receipt));
    return r.bugs;
  });

  const fresh = getRun(run.id)!;
  const report = {
    version: 2,
    kind: "sweep" as const,
    runId: run.id,
    target: run.target,
    goal: run.goal,
    plan,
    planFallback: usedFallback,
    recon: { title: recon.title, status: recon.status, shots: recon.shots, links: recon.links.length, forms: recon.forms.length },
    sweep,
    judge: judged.map((j) => ({ shot: j.shot.file, page: j.shot.page, viewport: j.shot.viewport, label: j.shot.label, scores: j.scores, issues: j.issues, model: j.model, error: j.error })),
    bugs,
    summary: {
      candidates: bugs.length,
      survived: bugs.filter((b) => b.adversary.verdict === "survived").length,
      killed: bugs.filter((b) => b.adversary.verdict === "killed").length,
      reproduced: bugs.filter((b) => b.repro?.status === "reproduced").length,
    },
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
    const report = run.kind === "containment" ? await executeContainment(run) : await executeSweep(run);
    updateRun(run.id, { status: "done", stage: "done", finished_at: Date.now(), report: JSON.stringify(report) });
    addEvent(run.id, "run", "run_done", report.kind === "containment"
      ? { scenarios: report.summary.total, passed: report.summary.passed, failed: report.summary.failed }
      : { shots: report.sweep.shots.length, signals: report.sweep.signals.length, ...report.summary });
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    updateRun(run.id, { status: "failed", finished_at: Date.now(), error: message });
    addEvent(run.id, "run", "run_failed", { message });
  }
}
