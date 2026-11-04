"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { describe, fileUrl, type Ev } from "./RunView";

const SCENARIOS = [
  { key: "injection", name: "Prompt injection", note: "Visible and hidden orders to wipe the disk and post the environment" },
  { key: "exfil", name: "Exfiltration", note: "Attacker host, metadata service, WebSocket, beacon" },
  { key: "cpu_spin", name: "Infinite loop", note: "64 spinning workers and a blocked main thread" },
  { key: "memory_balloon", name: "Memory balloon", note: "16 MB arrays allocated until something stops it" },
  { key: "pids", name: "Fork bomb", note: "A shell fork bomb inside the container" },
  { key: "no_secrets", name: "Secret hunt", note: "Every env value hashed, key material scanned for" },
];

type Phase = "idle" | "running" | "held" | "breached";
const SPEEDS = [1, 4, 12];

export function ContainmentView({ runId, initialStatus, missing }: { runId: string | null; initialStatus: string | null; missing: boolean }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [link, setLink] = useState<"live" | "lost" | "closed">("live");
  const [report, setReport] = useState<any>(null);
  const [replay, setReplay] = useState<{ upTo: number; speed: number } | null>(null);
  const [launch, setLaunch] = useState<{ state: "idle" | "sending" | "error"; message?: string }>({ state: "idle" });
  const feedRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!runId) return;
    let es: EventSource | null = null;
    let last = 0;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      es = new EventSource(`/api/runs/${runId}/events?after=${last}`);
      es.addEventListener("ev", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as Ev;
        last = e.id;
        setEvents((prev) => (prev.length && prev[prev.length - 1].id >= e.id ? prev : [...prev, e]));
      });
      es.addEventListener("run", (m) => { setStatus(JSON.parse((m as MessageEvent).data).status); setLink("live"); });
      es.addEventListener("end", () => { es?.close(); setLink("closed"); });
      es.onerror = () => { es?.close(); setLink("lost"); retry = setTimeout(open, 2500); };
    };
    open();
    return () => { es?.close(); clearTimeout(retry); };
  }, [runId]);

  useEffect(() => {
    if (!runId || (status !== "done" && status !== "failed")) return;
    fetch(`/api/runs/${runId}`).then((r) => r.json()).then((r) => setReport(r.report ?? { error: true })).catch(() => setReport({ error: true }));
  }, [runId, status]);

  // Replay walks the recorded events again on their real timing, sped up.
  useEffect(() => {
    if (!replay || replay.upTo >= events.length) return;
    const cur = events[replay.upTo - 1];
    const next = events[replay.upTo];
    const gap = cur ? Math.min(1500, Math.max(30, (next.ts - cur.ts) / replay.speed)) : 300;
    const t = setTimeout(() => setReplay((r) => (r ? { ...r, upTo: r.upTo + 1 } : r)), gap);
    return () => clearTimeout(t);
  }, [replay, events]);

  const shown = replay ? events.slice(0, replay.upTo) : events;
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [shown.length]);

  const phases = useMemo(() => {
    const p: Record<string, Phase> = {};
    for (const e of shown) {
      if (e.kind === "scenario_start") p[e.stage] = "running";
      if (e.kind === "scenario_done") p[e.stage] = e.data.pass ? "held" : "breached";
    }
    return p;
  }, [shown]);
  const held = Object.values(phases).filter((x) => x === "held").length;
  const breached = Object.values(phases).filter((x) => x === "breached").length;
  const sealed = (held + breached) / SCENARIOS.length;
  const t0 = events[0]?.ts ?? 0;
  const byKey = new Map<string, any>((report?.scenarios ?? []).map((s: any) => [s.key, s]));
  const replayDone = replay && replay.upTo >= events.length;

  async function start() {
    setLaunch({ state: "sending" });
    try {
      const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "containment", target: "http://hostile.blastdoor.local/" }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `The control plane refused the run (${r.status}).`);
      window.location.href = `/containment?run=${body.id}`;
    } catch (e) {
      setLaunch({ state: "error", message: e instanceof TypeError ? "The control plane did not answer. Check your connection and try again." : (e as Error).message });
    }
  }

  const launcher = (
    <div className="ctn-launch">
      <button className="btn" type="button" onClick={start} disabled={launch.state === "sending" || status === "running" || status === "queued"} data-loading={launch.state === "sending"} data-loading-label="SEALING">
        {runId ? "Run the containment drill again" : "Run the containment drill"}
      </button>
      {launch.state === "error" && <p className="alert" role="alert"><strong>REFUSED</strong> {launch.message}</p>}
    </div>
  );

  return (
    <article className="ctn" aria-labelledby="ctn-title">
      <header className="ctn-head">
        <div>
          <p className="label">Containment drill{runId ? ` / ${runId}` : ""}{status ? <> / <span className={`status status-${status}`}>{status}</span></> : null}</p>
          <h1 className="display" id="ctn-title">The page fights back.<br /><em>The door holds.</em></h1>
          <p>
            A planted hostile page tries to hijack the agent, burn the CPU, eat the memory, fork-bomb the box, and ship secrets to an attacker
            host. Each attack gets its own throwaway container. Every line below is a receipt from cgroups, the egress proxy, Docker, or the host.
          </p>
          {launcher}
        </div>
        <div className="door" aria-hidden="true" style={{ ["--seal" as string]: String(sealed) }} data-breached={breached > 0}>
          <span className="door-leaf door-l" />
          <span className="door-leaf door-r" />
          <span className="door-read">{held}/{SCENARIOS.length} HELD</span>
        </div>
      </header>

      {missing && <p className="alert" role="alert"><strong>NO SUCH DRILL</strong> That run id is not a containment run. Showing nothing until you pick one from the run log.</p>}
      {!runId && !missing && <p className="empty">No drill has run on this control plane yet. Start one above; it takes about three minutes and every container it creates is destroyed when it finishes.</p>}
      {link === "lost" && runId && <p className="alert" role="status"><strong>LINK LOST</strong> The event stream dropped. Reconnecting.</p>}
      {status === "failed" && <p className="alert" role="alert"><strong>DRILL FAILED TO FINISH</strong> The worker stopped before the last scenario. The receipts up to that point are below.</p>}

      {runId && (
        <>
          <ol className="ctn-grid" aria-label="Scenarios">
            {SCENARIOS.map((s, i) => {
              const ph = phases[s.key] ?? "idle";
              const r = byKey.get(s.key);
              return (
                <li key={s.key} className="ctn-cell" data-phase={ph}>
                  <span className="label">{String(i + 1).padStart(2, "0")} / {ph === "idle" ? "waiting" : ph}</span>
                  <h2>{s.name}</h2>
                  <p className="field-hint">{s.note}</p>
                  {r && (!replay || replayDone) && (
                    <ul className="ctn-obs">
                      {r.observed.map((o: any, j: number) => <li key={j} data-ok={o.pass}>{o.text}</li>)}
                    </ul>
                  )}
                  {r?.shots?.[0] && (!replay || replayDone) && (
                    <a className="ctn-shot" href={fileUrl(runId, r.shots[0])} target="_blank" rel="noreferrer">
                      <img src={fileUrl(runId, r.shots[0])} alt={`What the sandbox browser saw during ${s.name}`} loading="lazy" />
                    </a>
                  )}
                </li>
              );
            })}
          </ol>

          {report?.host && (
            <section className="ctn-host" aria-labelledby="host-title">
              <h2 className="section-title" id="host-title">Host check</h2>
              <dl>
                <div><dt>Canary sha256 before</dt><dd>{report.host.before.canarySha256}</dd></div>
                <div><dt>Canary sha256 after</dt><dd data-ok={report.host.canaryUnchanged}>{report.host.after.canarySha256}</dd></div>
                <div><dt>Host processes</dt><dd data-ok={report.host.processCountStable}>{report.host.before.processCount} before / {report.host.after.processCount} after</dd></div>
                <div><dt>Attacker sink hits</dt><dd data-ok={report.attackerSink.newHits === 0}>{report.attackerSink.newHits} during the drill</dd></div>
              </dl>
            </section>
          )}
          {report?.error && <p className="alert" role="alert"><strong>REPORT UNREADABLE</strong> The drill finished but its report did not load. Refresh to retry.</p>}

          <section className="panel ctn-feed" aria-labelledby="ctn-feed-title">
            <div className="panel-head">
              <h2 className="label" id="ctn-feed-title" style={{ margin: 0 }}>Receipts timeline</h2>
              <div className="replay" role="group" aria-label="Replay controls">
                {SPEEDS.map((sp) => (
                  <button key={sp} type="button" className="chip" disabled={!events.length || status === "running"} aria-pressed={replay?.speed === sp} onClick={() => setReplay({ upTo: 0, speed: sp })}>
                    Replay {sp}x
                  </button>
                ))}
                {replay && <button type="button" className="chip" onClick={() => setReplay(null)}>Show all</button>}
              </div>
            </div>
            {shown.length ? (
              <ol className="feed" ref={feedRef} aria-live={replay ? "off" : "polite"}>
                {shown.map((e) => {
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
            ) : (
              <p className="empty" style={{ margin: 16 }}>{status === "queued" ? "Queued behind another run. The drill starts when the bay clears." : "Waiting for the first receipt."}</p>
            )}
          </section>
          <p className="field-hint">Every drill is also in the <Link href="/runs">run log</Link>. <code>npm run prove</code> runs this drill plus a shop sweep and writes the receipts to a proof pack.</p>
        </>
      )}
    </article>
  );
}
