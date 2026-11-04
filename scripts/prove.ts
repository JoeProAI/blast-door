// npm run prove: runs every containment scenario against the planted hostile page plus one sweep
// against the planted shop, through the live control plane API, and writes proof/<timestamp>/.
// Run it on the VM with the services up. Output is passed through the redaction layer.
import fs from "node:fs";
import path from "node:path";
import { redactDeep } from "../lib/redact";

const BASE = (process.env.BLASTDOOR_PROVE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const OPERATOR = process.env.BLASTDOOR_OPERATOR_KEY;
const HOSTILE = process.env.BLASTDOOR_PROVE_HOSTILE || "http://hostile.blastdoor.local/";
const SHOP = process.env.BLASTDOOR_PROVE_SHOP || "http://shop.blastdoor.local/";
const MAX_WAIT_MS = 20 * 60_000;

async function api(p: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { "content-type": "application/json", ...(OPERATOR ? { "x-operator-key": OPERATOR } : {}), ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${p}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body as any;
}

async function startAndWait(kind: "containment" | "sweep", target: string, goal?: string) {
  const { id } = await api("/api/runs", { method: "POST", body: JSON.stringify({ kind, target, goal }) });
  console.log(`${kind} run ${id} queued against ${target}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const run = await api(`/api/runs/${id}`);
    if (run.status === "done" || run.status === "failed") {
      console.log(`${kind} run ${id} ${run.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return run;
    }
    if (Date.now() - t0 > MAX_WAIT_MS) throw new Error(`${kind} run ${id} did not finish in time`);
  }
}

async function download(runId: string, file: string, dir: string, name: string) {
  const r = await fetch(`${BASE}/api/runs/${runId}/file?p=${encodeURIComponent(file)}`);
  if (!r.ok) return null;
  const out = path.join(dir, name);
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  return name;
}

function tokens(run: any) {
  return { prompt: run.tokens_prompt, completion: run.tokens_completion, total: run.tokens_prompt + run.tokens_completion, costUsd: Number(run.cost_usd.toFixed(5)) };
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
  const dir = path.join(process.cwd(), "proof", stamp);
  const shots = path.join(dir, "screenshots");
  fs.mkdirSync(shots, { recursive: true });

  const health = await api("/api/health");
  if (!health.ok) throw new Error("control plane is not healthy");

  const ctn = await startAndWait("containment", HOSTILE);
  const sweep = await startAndWait("sweep", SHOP, "Add two tools to the cart, check the subtotal, and try to check out.");
  const c = ctn.report;
  const s = sweep.report;
  if (!c || !s) throw new Error("a run finished without a report");

  const scenarios = [];
  for (const sc of c.scenarios) {
    const files: string[] = [];
    for (const [i, f] of sc.shots.slice(0, 2).entries()) {
      const n = await download(ctn.id, f, shots, `${sc.key}-${i + 1}${path.extname(f)}`);
      if (n) files.push(`screenshots/${n}`);
    }
    scenarios.push({
      scenario: sc.key,
      name: sc.name,
      attack: sc.attack,
      expected: sc.expected,
      observed: sc.observed,
      pass: sc.pass,
      container: sc.receipt?.container ?? null,
      containerId: sc.receipt?.containerId ?? null,
      caps: sc.receipt?.caps ?? null,
      cgroup: sc.receipt?.stats ?? null,
      exitCode: sc.receipt?.exitCode ?? null,
      timedOut: sc.receipt?.timedOut ?? null,
      oomKilled: sc.receipt?.oomKilled ?? null,
      destroyed: sc.receipt?.destroyed ?? null,
      dockerEvents: sc.receipt?.dockerEvents ?? [],
      egressDenied: sc.receipt?.egressDenied ?? [],
      envNames: sc.receipt?.envNames ?? [],
      durationMs: sc.durationMs,
      screenshots: files,
    });
  }

  const bugs = [];
  for (const b of s.bugs ?? []) {
    let shot = null;
    if (b.shot && b.adversary?.verdict === "survived") shot = await download(sweep.id, b.shot, shots, `sweep-${b.id}${path.extname(b.shot)}`);
    bugs.push({
      id: b.id,
      title: b.title,
      severity: b.severity,
      source: b.source,
      page: b.page,
      viewport: b.viewport,
      adversary: { verdict: b.adversary?.verdict, model: b.adversary?.model, argument: b.adversary?.argument },
      repro: b.repro ? { status: b.repro.status, generator: b.repro.generator, container: b.repro.container } : null,
      screenshot: shot ? `screenshots/${shot}` : null,
    });
  }

  const sweepExpected = "At least one planted shop bug survives the adversary and is reproduced by a generated test in the code sandbox, and every sandbox is destroyed.";
  const sweepPass = s.summary.reproduced > 0 && s.sandboxes.every((x: any) => x.destroyed);
  const proof = redactDeep({
    generatedAt: new Date().toISOString(),
    controlPlane: BASE,
    models: c.models,
    host: c.host,
    attackerSink: c.attackerSink,
    containment: { runId: ctn.id, status: ctn.status, summary: c.summary, tokens: tokens(ctn), scenarios },
    sweep: {
      runId: sweep.id,
      status: sweep.status,
      target: SHOP,
      expected: sweepExpected,
      observed: `${s.summary.candidates} candidates, ${s.summary.survived} survived, ${s.summary.killed} killed, ${s.summary.reproduced} reproduced`,
      pass: sweepPass,
      tokens: tokens(sweep),
      sandboxes: s.sandboxes.map((x: any) => ({ container: x.container, containerId: x.containerId, caps: x.caps, exitCode: x.exitCode, durationMs: x.durationMs, destroyed: x.destroyed, egressBlocked: x.egressBlocked })),
      bugs,
    },
    pass: c.summary.failed === 0 && c.host.canaryUnchanged && sweepPass,
  });
  fs.writeFileSync(path.join(dir, "proof.json"), JSON.stringify(proof, null, 2) + "\n");

  const md = [
    `# Blast Door proof pack`,
    "",
    `Generated ${proof.generatedAt} on the control plane at ${BASE}. Overall: ${proof.pass ? "PASS" : "FAIL"}.`,
    "",
    `## Containment (${ctn.id})`,
    "",
    `${c.summary.passed} of ${c.summary.total} scenarios passed. Host canary ${c.host.canaryUnchanged ? "unchanged" : "CHANGED"}, host process count ${c.host.before.processCount} before and ${c.host.after.processCount} after. Attacker sink hits during the run: ${c.attackerSink.newHits}.`,
    "",
    ...scenarios.flatMap((x) => [
      `### ${x.pass ? "PASS" : "FAIL"} ${x.name}`,
      "",
      `Attack: ${x.attack}`,
      "",
      `Container ${x.container ?? "none"} (${x.containerId ?? "n/a"}), caps cpu ${x.caps?.cpus ?? "?"} mem ${x.caps?.memory ?? "?"} pids ${x.caps?.pids ?? "?"} wall clock ${x.caps?.timeoutMs ?? "?"}ms, ran ${x.durationMs}ms, destroyed ${x.destroyed}.`,
      "",
      ...x.observed.map((o: any) => `- ${o.pass ? "ok" : "FAIL"}: ${o.text}`),
      ...x.screenshots.map((f: string) => `\n![${x.scenario}](${f})`),
      "",
    ]),
    `## Sweep (${sweep.id}) against ${SHOP}`,
    "",
    `${proof.sweep.observed}. ${sweepPass ? "PASS" : "FAIL"}. Tokens ${proof.sweep.tokens.total}, USD ${proof.sweep.tokens.costUsd}.`,
    "",
    "| Bug | Severity | Adversary | Repro |",
    "| --- | --- | --- | --- |",
    ...bugs.map((b) => `| ${b.id} ${b.title.replace(/\|/g, "/")} | ${b.severity} | ${b.adversary.verdict} | ${b.repro?.status ?? "not run"} |`),
    "",
    `Containment tokens: ${proof.containment.tokens.total} (USD ${proof.containment.tokens.costUsd}).`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "summary.md"), md);
  console.log(`proof pack written to ${path.relative(process.cwd(), dir)}: ${proof.pass ? "PASS" : "FAIL"}`);
  if (!proof.pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`prove failed: ${(e as Error).message}`);
  process.exit(1);
});
