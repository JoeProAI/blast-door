"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Ev = { id: number; ts: number; stage: string; kind: string; data: Record<string, any> };
type RunState = { status?: string; stage?: string; tokens?: number; cost?: number; budget?: number; error?: string | null };

const STAGES = [
  { key: "recon", name: "Recon", note: "Sandbox loads the target once" },
  { key: "plan", name: "Plan", note: "Planner writes pages and flows" },
  { key: "sweep", name: "Sweep", note: "Agent drives the browser" },
  { key: "judge", name: "Judge", note: "Vision rubric per screenshot" },
  { key: "adversary", name: "Adversary", note: "Second model attacks each claim" },
];

function describe(e: Ev): { text: string; tone?: "bad" | "good" | "warn" } {
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
    case "runner_done": return { text: `runner ${d.mode} done${d.shots !== undefined ? `: ${d.shots} shots, ${d.signals} signals` : ""}`, tone: "good" };
    case "runner_error": return { text: `runner error: ${d.message}`, tone: "bad" };
    case "run_start": return { text: `run started against ${d.target}` };
    case "run_done": return { text: `run sealed: ${d.shots} screenshots, ${d.signals} signals`, tone: "good" };
    case "run_failed": return { text: `run failed: ${d.message}`, tone: "bad" };
    default: return { text: `${e.kind} ${JSON.stringify(d).slice(0, 160)}` };
  }
}

function fileUrl(id: string, p: string) {
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

  const shots = useMemo(() => events.filter((e) => e.kind === "shot").map((e) => e.data as { file: string; label: string; viewport: string; page: string }), [events]);
  const stageState = (key: string) => {
    if (events.some((e) => e.stage === key && e.kind === "stage_failed")) return "failed";
    if (events.some((e) => e.stage === key && e.kind === "stage_done")) return "done";
    if (events.some((e) => e.stage === key && e.kind === "stage_start")) return "active";
    return "idle";
  };
  const t0 = events[0]?.ts ?? 0;
  const pct = run.budget ? Math.min(100, ((run.tokens ?? 0) / run.budget) * 100) : 0;
  const live = events.filter((e) => e.kind === "sandbox_created").length - events.filter((e) => e.kind === "sandbox_destroyed").length;
  const signals: any[] = report?.sweep?.signals ?? [];

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
              <span className="label">{st === "idle" ? (s.key === "judge" || s.key === "adversary" ? "Next milestone" : "Waiting") : st}</span>
              <div className="stage-name">{s.name}</div>
              <span className="field-hint">{s.note}</span>
            </li>
          );
        })}
      </ol>

      <div className="run-grid">
        <section aria-labelledby="shots-title">
          <h2 className="section-title" id="shots-title">Screenshot trail</h2>
          {shots.length ? (
            <div className="shots">
              {shots.map((s) => (
                <figure className="shot" key={s.file} data-vp={s.viewport}>
                  <a href={fileUrl(id, s.file)} target="_blank" rel="noreferrer"><img src={fileUrl(id, s.file)} alt={`${s.label} at ${s.page}`} loading="lazy" /></a>
                  <figcaption title={s.page}>{s.viewport.toUpperCase()} / {s.label}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="empty">{run.status === "queued" ? "Queued. The worker picks up one run at a time; this one starts when the bay clears." : run.status === "failed" ? "No screenshots were captured before the run failed." : "No frames yet. The first screenshot lands when recon loads the target."}</p>
          )}
          {report && !report.error && (
            <>
              <h2 className="section-title">Signals</h2>
              {signals.length ? (
                <ul className="signals">
                  {signals.slice(0, 80).map((s, i) => (
                    <li key={i}><span className="tag">{s.kind.replace("_", " ")}</span><span className="tag">{s.viewport ?? "desktop"}</span>{s.message}</li>
                  ))}
                </ul>
              ) : <p className="empty">The sweep recorded no console errors, failed requests, broken links, overflow, or accessibility signals.</p>}
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
