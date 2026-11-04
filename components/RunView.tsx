"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type Ev = { id: number; ts: number; stage: string; kind: string; data: Record<string, any> };
type RunState = { status?: string; stage?: string; tokens?: number; cost?: number; budget?: number; error?: string | null };

const STAGES = [
  { key: "recon", name: "Recon", note: "Sandbox loads the target once" },
  { key: "plan", name: "Plan", note: "Planner writes pages and flows" },
  { key: "sweep", name: "Sweep", note: "Agent drives the browser" },
  { key: "judge", name: "Judge", note: "Vision rubric per screenshot" },
  { key: "adversary", name: "Adversary", note: "Second model attacks each claim" },
  { key: "repro", name: "Repro", note: "Generated tests run in a second sandbox" },
];

const REPRO_LABEL: Record<string, string> = {
  reproduced: "Reproduced: the generated test fails on the live target",
  not_reproduced: "Not reproduced: the generated test passes on the live target",
  inconclusive: "Inconclusive: the test errored before its assertion ran",
  not_run: "Not run",
};

function lowest(scores: Record<string, number> | null) {
  if (!scores) return null;
  const [k, v] = Object.entries(scores).sort((a, b) => a[1] - b[1])[0];
  return `${k.replace("_", " ")} ${v}/10`;
}

export function describe(e: Ev): { text: string; tone?: "bad" | "good" | "warn" } {
  const d = e.data;
  switch (e.kind) {
    case "stage_start": return { text: `stage ${e.stage} started` };
    case "stage_done": return { text: `stage ${e.stage} finished in ${(d.ms / 1000).toFixed(1)}s`, tone: "good" };
    case "stage_failed": return { text: `stage ${e.stage} failed: ${d.message}`, tone: "bad" };
    case "sandbox_created": return { text: `container ${d.container} created at ${d.ip}, caps cpu ${d.caps?.cpus} mem ${d.caps?.memory} pids ${d.caps?.pids}` };
    case "sandbox_exited": return { text: `container exited code ${d.exitCode}${d.timedOut ? " after wall clock kill" : ""}${d.oomKilled ? ", OOM killed" : ""}`, tone: d.exitCode === 0 ? undefined : "warn" };
    case "sandbox_destroyed": return { text: `container ${d.container} destroyed${d.verified ? ", inspect confirms it is gone" : ", NOT verified"}`, tone: d.verified ? "good" : "bad" };
    case "sandbox_wall_clock_kill": return { text: `wall clock limit ${d.limitMs}ms hit, container killed`, tone: "warn" };
    case "sandbox_docker_event": return { text: `docker event: ${d.action}` };
    case "egress_blocked": return { text: `egress blocked: ${d.method} ${d.host}:${d.port} (${d.reason})`, tone: "bad" };
    case "egress_allowed": return { text: `egress allowed: ${d.method} ${d.host}:${d.port}` };
    case "broker_screening": return { text: `screening: ${d.heuristics?.length ? `injection patterns ${d.heuristics.join(", ")}` : "clean"}${d.quarantinedHidden ? `, ${d.quarantinedHidden} hidden text blocks quarantined` : ""}${d.model ? `, safety model says ${d.model.verdict}` : ""}`, tone: d.flagged ? "warn" : undefined };
    case "broker_action": return { text: `agent ${d.flow ?? ""} step ${d.step}: ${d.action?.action}${d.action?.ref ? ` #${d.action.ref}` : ""}${d.action?.value ? ` "${d.action.value}"` : ""}${d.rejected ? ` (broker refused: ${d.rejected})` : ""}`, tone: d.rejected ? "warn" : undefined };
    case "broker_error": return { text: `broker error: ${d.message}`, tone: "bad" };
    case "llm_call": return { text: `${d.model} ${d.purpose}: ${d.promptTokens ?? 0}+${d.completionTokens ?? 0} tok${d.cached ? " (cache)" : ""}${d.ms ? ` ${d.ms}ms` : ""}` };
    case "plan": return { text: `plan: ${d.pages?.length} pages, ${d.flows?.length} flows${d.usedFallback ? " (fallback plan)" : ""}` };
    case "shot": return { text: `screenshot ${d.label} (${d.viewport})` };
    case "runner_flow": return { text: `flow "${d.name}": ${d.goal}` };
    case "runner_log": return { text: String(d.msg ?? ""), tone: d.level === "warn" ? "warn" : undefined };
    case "runner_probe": return { text: `probe ${d.probe} reported${d.result?.env ? `: ${d.result.env.length} env values hashed, ${d.result.fsScan?.filesScanned ?? 0} files scanned` : d.result?.threads ? `: ${d.result.threads} threads for ${d.result.wallMs}ms` : ""}` };
    case "runner_progress": return { text: `probe ${d.probe} ${(d.elapsedMs / 1000).toFixed(1)}s${d.runnerSpawnErrors !== undefined ? `, forks refused ${d.runnerSpawnErrors}` : ""}${d.mb !== undefined ? `, holding ${d.mb} MB` : ""}` };
    case "runner_done": return { text: `runner ${d.mode} done${d.shots !== undefined ? `: ${d.shots} shots, ${d.signals} signals` : ""}`, tone: "good" };
    case "runner_error": return { text: `runner error: ${d.message}`, tone: "bad" };
    case "judge_shot": return d.scores ? { text: `judge ${d.viewport} ${d.label}: lowest ${lowest(d.scores)}, ${d.issues?.length ?? 0} issues` } : { text: `judge ${d.label}: no verdict (${d.error})`, tone: "warn" };
    case "candidates": return { text: `${d.count} candidate claims: ${d.flow} from flows, ${d.vision} from vision, ${d.signal} from signals` };
    case "adversary_verdict": return { text: `${d.bug} ${d.verdict === "survived" ? "SURVIVED" : "KILLED"}: ${d.argument}`, tone: d.verdict === "survived" ? "warn" : undefined };
    case "repro_generated": return d.generator === "none" ? { text: `${d.bug} no test written: ${d.error}`, tone: "warn" } : { text: `${d.bug} repro test written by ${d.generator === "template" ? "a fixed template" : "the model"}, ${d.lines} lines` };
    case "repro_result": return { text: `${d.bug} repro ${String(d.status).replace("_", " ")}${d.ms ? ` in ${(d.ms / 1000).toFixed(1)}s` : ""}`, tone: d.status === "reproduced" ? "bad" : d.status === "not_reproduced" ? "good" : "warn" };
    case "scenario_start": return { text: `scenario ${e.stage}: ${d.name}` };
    case "scenario_done": return { text: `scenario ${e.stage} ${d.pass ? "HELD" : "BREACHED"} in ${(d.ms / 1000).toFixed(1)}s`, tone: d.pass ? "good" : "bad" };
    case "host_snapshot": return { text: `host ${d.phase}: canary sha256 ${String(d.canarySha256).slice(0, 12)}, ${d.processCount} processes${d.phase === "after" ? `, drift ${d.processDrift}, attacker sink hits ${d.newAttackerHits}` : ""}`, tone: d.phase === "after" ? (d.canaryUnchanged && d.newAttackerHits === 0 ? "good" : "bad") : undefined };
    case "run_start": return { text: `run started against ${d.target}` };
    case "run_done": if (d.scenarios !== undefined) return { text: `containment sealed: ${d.passed} of ${d.scenarios} scenarios held`, tone: d.failed ? "bad" : "good" };
      return { text: `run sealed: ${d.shots} screenshots, ${d.signals} signals${d.candidates !== undefined ? `, ${d.survived} of ${d.candidates} claims survived, ${d.reproduced} reproduced` : ""}`, tone: "good" };
    case "run_failed": return { text: `run failed: ${d.message}`, tone: "bad" };
    default: return { text: `${e.kind} ${JSON.stringify(d).slice(0, 160)}` };
  }
}

function killSummary(killed: any[]) {
  const argued = killed.filter((b) => b.adversary?.modelVerdict === "killed").length;
  const gated = killed.filter((b) => b.adversary?.modelVerdict === "holds").length;
  const down = killed.filter((b) => b.adversary?.modelVerdict === "unavailable").length;
  const parts = [argued && `the adversary argued ${argued} away as intended behavior, duplicates or setup artifacts`, gated && `${gated} failed the evidence gate (screenshot, log and steps)`, down && `${down} could not be challenged and were not reported`].filter(Boolean);
  return `Of the ${killed.length} claims, ${parts.join("; ")}. Each kill reason is listed below.`;
}

export function fileUrl(id: string, p: string) {
  return `/api/runs/${id}/file?p=${encodeURIComponent(p)}`;
}

export function RunView({ id, target, goal, initialStatus }: { id: string; target: string; goal: string | null; initialStatus: string }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [run, setRun] = useState<RunState>({ status: initialStatus });
  const [link, setLink] = useState<"live" | "lost" | "closed">("live");
  const [report, setReport] = useState<any>(null);
  const feedRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let last = 0;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      es = new EventSource(`/api/runs/${id}/events?after=${last}`);
      es.addEventListener("ev", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as Ev;
        last = e.id;
        setEvents((prev) => (prev.length && prev[prev.length - 1].id >= e.id ? prev : [...prev, e]));
      });
      es.addEventListener("run", (m) => { setRun(JSON.parse((m as MessageEvent).data)); setLink("live"); });
      es.addEventListener("end", () => { es?.close(); setLink("closed"); });
      es.onerror = () => { es?.close(); setLink("lost"); retry = setTimeout(open, 2500); };
    };
    open();
    return () => { es?.close(); clearTimeout(retry); };
  }, [id]);

  useEffect(() => {
    if (run.status !== "done") return;
    fetch(`/api/runs/${id}`).then((r) => r.json()).then((r) => setReport(r.report)).catch(() => setReport({ error: true }));
  }, [id, run.status]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const shots = useMemo(() => events.filter((e) => e.kind === "shot").map((e) => e.data as { file: string; thumb?: string; label: string; viewport: string; page: string }), [events]);
  const stageState = (key: string) => {
    if (events.some((e) => e.stage === key && e.kind === "stage_failed")) return "failed";
    if (events.some((e) => e.stage === key && e.kind === "stage_done")) return "done";
    if (events.some((e) => e.stage === key && e.kind === "stage_start")) return "active";
    return "idle";
  };
  const t0 = events[0]?.ts ?? 0;
  const pct = run.budget ? Math.min(100, ((run.tokens ?? 0) / run.budget) * 100) : 0;
  const live = events.filter((e) => e.kind === "sandbox_created").length - events.filter((e) => e.kind === "sandbox_destroyed").length;
  const allSignals: any[] = report?.sweep?.signals ?? [];
  const signals = allSignals.filter((s) => s.kind !== "blocked_egress");
  const blockedEgress = useMemo(() => {
    const m = new Map<string, { url: string; host: string; n: number; pages: Set<string> }>();
    for (const s of allSignals) {
      if (s.kind !== "blocked_egress") continue;
      const url = String(s.detail?.url || s.message.match(/https?:\/\/\S+/)?.[0] || "");
      let host = "unknown host";
      try { host = new URL(url).host; } catch {}
      const k = url.split("?")[0] || host;
      const e = m.get(k) ?? { url: k, host, n: 0, pages: new Set<string>() };
      e.n++;
      e.pages.add(s.page);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [allSignals]);
  const bugs: any[] = report?.bugs ?? [];
  const survived = bugs.filter((b) => b.adversary?.verdict === "survived");
  const killed = bugs.filter((b) => b.adversary?.verdict !== "survived");

  return (
    <article aria-labelledby="run-title">
      <header className="run-head">
        <div>
          <p className="label">Run {id} / <span className={`status status-${run.status}`}>{run.status}{run.status === "running" && run.stage ? ` / ${run.stage}` : ""}</span></p>
          <h1 id="run-title">{target}</h1>
          {goal && <p className="mono" style={{ color: "var(--color-muted)" }}>Goal: {goal}</p>}
        </div>
        <div className="gauges" aria-label="Run telemetry">
          <div className="gauge"><span className="label">Tokens</span><b>{(run.tokens ?? 0).toLocaleString("en-US")}</b>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={run.budget ?? 0} aria-valuenow={run.tokens ?? 0} aria-label="Token budget used"><i style={{ width: `${pct}%` }} /></div></div>
          <div className="gauge"><span className="label">Spend</span><b>${(run.cost ?? 0).toFixed(4)}</b></div>
          <div className="gauge"><span className="label">Live sandboxes</span><b style={{ color: live > 0 ? "var(--color-accent)" : undefined }}>{Math.max(0, live)}</b></div>
        </div>
      </header>

      {link === "lost" && <p className="alert" role="status"><strong>LINK LOST</strong> The event stream dropped. Reconnecting and resuming from event {events.at(-1)?.id ?? 0}.</p>}
      {run.status === "failed" && <p className="alert" role="alert"><strong>RUN FAILED</strong> {run.error ?? "No reason recorded."} Every container from this run was still destroyed; see the feed.</p>}

      <ol className="stages" aria-label="Pipeline stages">
        {STAGES.map((s) => {
          const st = stageState(s.key);
          return (
            <li key={s.key} className="stage" data-state={st} aria-current={st === "active" ? "step" : undefined} style={{ listStyle: "none" }}>
              <span className="label">{st === "idle" ? "Waiting" : st}</span>
              <div className="stage-name">{s.name}</div>
              <span className="field-hint">{s.note}</span>
            </li>
          );
        })}
      </ol>

      {report && !report.error && report.bugs && <Findings bugs={bugs} summary={report.summary} />}

      <nav className="run-nav" aria-label="Run sections">
        {report?.bugs && <a href="#findings">Findings</a>}
        {report?.bugs && <a href="#bugs-title">Claims</a>}
        <a href="#shots-title">Frames</a>
        {report && <a href="#signals-title">Signals</a>}
        <a href="#feed-title">Receipts</a>
      </nav>

      {report && !report.error && report.bugs && (
        <section aria-labelledby="bugs-title" className="bugs-section">
          <div className="bugs-head">
            <h2 className="section-title" id="bugs-title">Claims that survived</h2>
            <p className="mono bugs-tally">{survived.length} of {bugs.length} survived the adversary / {report.summary?.reproduced ?? 0} reproduced in the code sandbox</p>
            <div className="exports">
              <a className="btn btn-ghost" href={`/api/runs/${id}/export?format=md`} download>Export Markdown</a>
              <a className="btn btn-ghost" href={`/api/runs/${id}/export?format=json`} download>Export JSON</a>
            </div>
          </div>
          {survived.length ? (
            <div className="bugs">
              {survived.map((b, i) => (
                <details className="bug" key={b.id} data-sev={b.severity} open={i === 0} id={`claim-${b.id}`}>
                  <summary className="bug-head">
                    <span className="tag sev">{b.severity}</span>
                    <span className="tag">{b.id}</span>
                    <span className="tag">{b.source} / {b.viewport}</span>
                    <h3 id={`bug-${b.id}`}>{b.title}</h3>
                    <span className="repro bug-row-repro" data-status={b.repro?.status ?? "not_run"}>{REPRO_LABEL[b.repro?.status ?? "not_run"]}</span>
                  </summary>
                  {b.shot && (
                    <figure className="bug-shot">
                      <a href={fileUrl(id, b.shot)} target="_blank" rel="noreferrer">
                        <img src={fileUrl(id, b.shot)} alt={`Screenshot evidence for ${b.id}`} loading="lazy" />
                        {b.region && <i className="region" aria-hidden="true" style={{ left: `${b.region.x * 100}%`, top: `${b.region.y * 100}%`, width: `${b.region.w * 100}%`, height: `${b.region.h * 100}%` }} />}
                      </a>
                      <figcaption>{b.page}</figcaption>
                    </figure>
                  )}
                  <div className="bug-body">
                    <h4 className="label">Repro steps</h4>
                    <ol>{b.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
                    <h4 className="label">Evidence</h4>
                    <ul>{[...b.evidence, ...(b.logs ?? []).slice(0, 3)].map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
                    <h4 className="label">Adversary / {b.adversary.model ?? "unavailable"}</h4>
                    <p>{b.adversary.argument}</p>
                    {b.adversary.counter && <p className="field-hint">Best counter it found: {b.adversary.counter}</p>}
                    <h4 className="label">Repro test</h4>
                    <p className="repro" data-status={b.repro?.status ?? "not_run"}>{REPRO_LABEL[b.repro?.status ?? "not_run"]}</p>
                    {b.repro?.error && b.repro.status !== "not_reproduced" && <pre className="repro-err">{b.repro.error.split("\n").slice(0, 6).join("\n")}</pre>}
                    {b.repro?.artifacts?.map((a: string) => <a key={a} className="mono" href={fileUrl(id, a)} target="_blank" rel="noreferrer">Failure screenshot from the code sandbox</a>)}
                    {b.repro?.code && (
                      <details>
                        <summary>Generated test, written by {b.repro.generator === "template" ? "a fixed template" : "the model"}</summary>
                        <pre><code>{b.repro.code}</code></pre>
                      </details>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <div className="verdict" role="status">
              <span className="label">Verdict</span>
              <p className="verdict-head">{bugs.length ? `Nothing survived. ${bugs.length} claim${bugs.length === 1 ? "" : "s"} raised, ${bugs.length} killed.` : "Nothing to report. The judge and the sweep raised no claims."}</p>
              <p>{bugs.length ? killSummary(killed) : "Every page loaded, no console or network errors were logged, and the judge scored every frame above the reporting line."} A clean report is a result, not a failure: every claim had to beat an adversary from a different model family before it could reach this list.</p>
            </div>
          )}
          {killed.length > 0 && (
            <section className="killed" aria-labelledby="killed-title">
              <h3 className="label" id="killed-title">Killed by the adversary ({killed.length})</h3>
              <ul>
                {killed.map((b) => (
                  <li key={b.id}>
                    <span className="tag">{b.id}</span>
                    <b>{b.title}</b>
                    <span className="kill-why">{b.adversary?.argument}</span>
                    <span className="gate" aria-label="Evidence gate">
                      <span className="tag" data-ok={b.adversary?.modelVerdict === "holds"}>adversary {b.adversary?.modelVerdict ?? "n/a"}</span>
                      {(["screenshot", "log", "steps"] as const).map((g) => <span key={g} className="tag" data-ok={!!b.adversary?.gate?.[g]}>{g} {b.adversary?.gate?.[g] ? "yes" : "no"}</span>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      <div className="run-grid">
        <section aria-labelledby="shots-title">
          <h2 className="section-title" id="shots-title">Screenshot trail</h2>
          {shots.length ? (
            <ShotTrail id={id} shots={shots} />
          ) : (
            <p className="empty">{run.status === "queued" ? "Queued. The worker picks up one run at a time; this one starts when the bay clears." : run.status === "failed" ? "No screenshots were captured before the run failed." : "No frames yet. The first screenshot lands when recon loads the target."}</p>
          )}
          {report && !report.error && (
            <>
              <h2 className="section-title" id="signals-title">Signals</h2>
              {signals.length ? (
                <ul className="signals">
                  {signals.slice(0, 80).map((s, i) => (
                    <li key={i}><span className="tag">{s.kind.replace("_", " ")}</span><span className="tag">{s.viewport ?? "desktop"}</span>{s.message}</li>
                  ))}
                </ul>
              ) : <p className="empty">The sweep recorded no console errors, failed requests, broken links, overflow, or accessibility signals.</p>}
              <h3 className="label egress-title">Egress blocked by the sandbox ({blockedEgress.length})</h3>
              {blockedEgress.length ? (
                <>
                  <p className="field-hint">These requests left the page for hosts outside this run&apos;s allowlist, so the egress proxy refused them. They are a property of the sandbox, not bugs in the site, and never become claims.</p>
                  <ul className="signals egress-list">
                    {blockedEgress.slice(0, 40).map((e) => (
                      <li key={e.url}><span className="tag">{e.host}</span><span className="egress-url">{e.url}</span><span className="tag">x{e.n}</span></li>
                    ))}
                  </ul>
                </>
              ) : <p className="empty">The page made no requests outside the allowlist.</p>}
            </>
          )}
          {report?.error && <p className="alert" role="alert"><strong>REPORT UNREADABLE</strong> The run finished but the report did not load. Refresh to retry.</p>}
        </section>
        <section aria-labelledby="feed-title" className="panel">
          <div className="panel-head"><h2 className="label" id="feed-title" style={{ margin: 0 }}>Receipts feed</h2><span className="label">{link === "live" ? "LIVE" : link === "closed" ? "SEALED" : "RECONNECTING"}</span></div>
          {events.length ? (
            <ol className="feed" ref={feedRef} aria-live="polite" aria-relevant="additions">
              {events.map((e) => {
                const d = describe(e);
                return (
                  <li key={e.id} data-tone={d.tone}>
                    <span className="t">+{((e.ts - t0) / 1000).toFixed(1)}s</span>
                    <span className="s">{e.stage}</span>
                    <span>{d.text}</span>
                  </li>
                );
              })}
            </ol>
          ) : <p className="empty" style={{ margin: 16 }}>Waiting for the first receipt from the worker.</p>}
        </section>
      </div>
    </article>
  );
}

type TrailShot = { file: string; thumb?: string; label: string; viewport: string; page: string };

function ShotFrame({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <span className="frame" data-state={state}>
      {state === "error" ? <span className="frame-err">Frame missing from the run bay.</span> : null}
      <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setState("ready")} onError={() => setState("error")} />
    </span>
  );
}

function ShotTrail({ id, shots }: { id: string; shots: TrailShot[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);
  const cur = open !== null ? shots[open] : null;
  const step = (n: number) => setOpen((o) => (o === null ? o : (o + n + shots.length) % shots.length));
  return (
    <>
      <div className="shots">
        {shots.map((s, i) => (
          <figure className="shot" key={s.file} data-vp={s.viewport}>
            <button type="button" className="shot-open" onClick={() => setOpen(i)} aria-label={`Open frame ${i + 1}: ${s.label}`}>
              <ShotFrame src={fileUrl(id, s.thumb ?? s.file)} alt={`${s.label} at ${s.page}`} />
            </button>
            <figcaption title={s.page}>{s.viewport.toUpperCase()} / {s.label}</figcaption>
          </figure>
        ))}
      </div>
      <dialog
        ref={dlg}
        className="lightbox"
        aria-label="Screenshot viewer"
        onClose={() => setOpen(null)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}
        onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}
      >
        {cur && (
          <figure>
            <div className="lightbox-bar">
              <span className="label">Frame {open! + 1} of {shots.length} / {cur.viewport}</span>
              <span className="lightbox-actions">
                <button type="button" className="btn btn-ghost" onClick={() => step(-1)} aria-label="Previous frame">Prev</button>
                <button type="button" className="btn btn-ghost" onClick={() => step(1)} aria-label="Next frame">Next</button>
                <a className="btn btn-ghost" href={fileUrl(id, cur.file)} target="_blank" rel="noreferrer">Full size</a>
                <button type="button" className="btn" onClick={() => setOpen(null)} autoFocus>Close</button>
              </span>
            </div>
            <ShotFrame key={cur.file} src={fileUrl(id, cur.file)} alt={`${cur.label} at ${cur.page}`} />
            <figcaption>{cur.label} <span className="muted">{cur.page}</span></figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}

const SEVS = ["critical", "high", "medium", "low"] as const;

/** First viewport answer: what survived, how bad, and how the funnel narrowed. */
function Findings({ bugs, summary }: { bugs: any[]; summary?: { candidates: number; survived: number; killed: number; reproduced: number } }) {
  const survived = bugs.filter((b) => b.adversary?.verdict === "survived");
  const c = summary?.candidates ?? bugs.length;
  const funnel = [
    { k: "Candidates", n: c, note: "raised by flows, vision and signals" },
    { k: "Survived", n: summary?.survived ?? survived.length, note: "beat the adversary" },
    { k: "Reproduced", n: summary?.reproduced ?? 0, note: "failing test in the code sandbox" },
  ];
  return (
    <section className="findings" id="findings" aria-labelledby="findings-title">
      <h2 className="label" id="findings-title">What it found</h2>
      <div className="sev-tally" role="list" aria-label="Surviving claims by severity">
        {SEVS.map((s) => {
          const n = survived.filter((b) => b.severity === s).length;
          return (
            <div key={s} className="sev-cell" data-sev={s} data-zero={n === 0} role="listitem">
              <b>{n}</b>
              <span className="label">{s}</span>
            </div>
          );
        })}
      </div>
      <ol className="funnel" aria-label="Claim funnel">
        {funnel.map((f) => (
          <li key={f.k} style={{ ["--w" as string]: `${c ? Math.max(4, (f.n / c) * 100) : 4}%` }}>
            <span className="funnel-bar" aria-hidden="true" />
            <span className="funnel-n">{f.n}</span>
            <span className="label">{f.k}</span>
            <span className="field-hint">{f.note}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
