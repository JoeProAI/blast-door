#!/usr/bin/env node
// Blast Door CI gate: start a sweep, wait for it, fail on surviving claims at or above a severity.
// Env: BLASTDOOR_URL, BLASTDOOR_OPERATOR_KEY, BLASTDOOR_TARGET, optional BLASTDOOR_GOAL,
// BLASTDOOR_FAIL_ON (critical | high | medium | low, default high), BLASTDOOR_TIMEOUT_S (default 900).
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const RANK = { low: 1, medium: 2, high: 3, critical: 4 };

export function gate(report, failOn = "high") {
  const floor = RANK[failOn] ?? RANK.high;
  const bugs = report?.bugs ?? [];
  const survived = bugs.filter((b) => b.adversary?.verdict === "survived");
  const blocking = survived.filter((b) => (RANK[b.severity] ?? 0) >= floor);
  return { candidates: bugs.length, survived: survived.length, blocking, pass: blocking.length === 0 };
}

export function summaryMarkdown(url, run, g, failOn) {
  const rows = g.blocking.map((b) => `| ${b.severity} | ${b.id ?? ""} | ${String(b.title).replace(/\|/g, "/")} | ${b.repro?.status ?? "not run"} |`);
  return [
    `### Blast Door: ${g.pass ? "no blocking claims" : `${g.blocking.length} blocking claim(s)`}`,
    `Run [${run.id}](${url}/runs/${run.id}) on ${run.target}: ${g.candidates} candidates, ${g.survived} survived the adversary. Gate: ${failOn} and above.`,
    ...(rows.length ? ["", "| Severity | Id | Claim | Repro |", "| --- | --- | --- | --- |", ...rows] : []),
    "",
  ].join("\n");
}

async function main() {
  const url = (process.env.BLASTDOOR_URL ?? "").replace(/\/$/, "");
  const key = process.env.BLASTDOOR_OPERATOR_KEY ?? "";
  const target = process.env.BLASTDOOR_TARGET ?? "";
  const failOn = (process.env.BLASTDOOR_FAIL_ON ?? "high").toLowerCase();
  const deadline = Date.now() + Number(process.env.BLASTDOOR_TIMEOUT_S ?? 900) * 1000;
  if (!url || !key || !target) throw new Error("Set BLASTDOOR_URL, BLASTDOOR_OPERATOR_KEY and BLASTDOOR_TARGET.");

  const res = await fetch(`${url}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-key": key },
    body: JSON.stringify({ target, goal: process.env.BLASTDOOR_GOAL || undefined }),
  });
  const started = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Blast Door refused the run (${res.status}): ${started.error ?? "no reason given"}`);
  console.log(`Sweep ${started.id} queued: ${url}/runs/${started.id}`);

  let run;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Sweep ${started.id} did not finish in time.`);
    await new Promise((r) => setTimeout(r, 10_000));
    const r = await fetch(`${url}/api/runs/${started.id}`);
    if (!r.ok) continue;
    run = await r.json();
    console.log(`  ${run.status}${run.stage ? ` / ${run.stage}` : ""}`);
    if (run.status === "done" || run.status === "failed") break;
  }
  if (run.status !== "done") throw new Error(`Sweep ${run.id} failed: ${run.error ?? "see the run page"}`);

  const g = gate(run.report, failOn);
  const md = summaryMarkdown(url, run, g, failOn);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.exitCode = g.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Blast Door gate error: ${e.message}`);
    process.exitCode = 2;
  });
}
