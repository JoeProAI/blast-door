"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PRESETS = [
  { label: "Gearbox Supply (planted bugs)", url: "http://shop.blastdoor.local/", goal: "Add two tools to the cart, check the subtotal, and try to check out." },
];

export function LaunchForm() {
  const router = useRouter();
  const [target, setTarget] = useState(PRESETS[0].url);
  const [goal, setGoal] = useState(PRESETS[0].goal);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");
  const invalid = state === "error" && /url|target|scheme/i.test(error);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "x-operator-key": key } : {}) },
        body: JSON.stringify({ target, goal }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Control plane answered ${res.status}.`);
      router.push(`/runs/${body.id}`);
    } catch (err) {
      setState("error");
      setError(err instanceof TypeError ? "The control plane did not answer. Check your connection and try again." : (err as Error).message);
    }
  }

  return (
    <form className="panel rivets" onSubmit={submit} noValidate aria-describedby={error ? "launch-error" : undefined}>
      <div className="panel-head">
        <span className="label">Load target into the bay</span>
        <span className="label">01</span>
      </div>
      <div className="panel-body">
        <div className="field">
          <label className="label" htmlFor="target">Target URL</label>
          <input id="target" name="target" inputMode="url" autoComplete="off" spellCheck={false} value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={invalid} required />
          <div className="chips" role="group" aria-label="Planted targets">
            {PRESETS.map((p) => (
              <button type="button" key={p.url} className="chip" aria-pressed={target === p.url} onClick={() => { setTarget(p.url); setGoal(p.goal); }}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="field-hint">Any public http or https site works: 3 sweeps a day per visitor, 3 pages each, private and internal addresses refused. The operator key lifts the limits.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="goal">What should the agent try</label>
          <input id="goal" name="goal" maxLength={300} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Sign up, then change the password" />
        </div>
        <div className="field">
          <label className="label" htmlFor="opkey">Operator key (optional)</label>
          <input id="opkey" name="opkey" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={state === "sending" || !target.trim()} data-loading={state === "sending"} data-loading-label="SEALING">
          Seal the door and sweep
        </button>
        {error && (
          <p className="alert" id="launch-error" role="alert"><strong>REFUSED</strong> {error}</p>
        )}
      </div>
    </form>
  );
}
