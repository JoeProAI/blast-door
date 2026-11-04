import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Why Blast Door | Who pays for sandboxed QA",
  description: "QA teams, agencies and agent platforms pay for browser QA that cannot be hijacked. Measured cost per sweep from real runs on the demo VM.",
};

// Completed full-pipeline sweeps on the demo VM (planner, sweep, judge, adversary, repro). Spend is Vultr inference only.
const RUNS = [
  { id: "run_mw1fgtfh8603c4f8", target: "example.com", tokens: 10209, usd: 0.0026, note: "public any-URL mode, 3-page cap" },
  { id: "run_mw1ckoou070b9393", target: "planted shop", tokens: 9213, usd: 0.0037, note: "cached recon" },
  { id: "run_mw1f8zok70c3cf7e", target: "planted shop", tokens: 12700, usd: 0.0041, note: "the committed proof pack sweep" },
  { id: "run_mw1bucwnade2f67b", target: "planted shop", tokens: 35476, usd: 0.0069, note: "7 bugs reproduced" },
  { id: "run_mw1f4ihvcd4e5711", target: "the-internet.herokuapp.com", tokens: 45911, usd: 0.0101, note: "10 candidates, all killed" },
  { id: "run_mw1fse7od9db569d", target: "planted shop", tokens: 56474, usd: 0.0119, note: "desktop and mobile, 19 frames" },
];

const BUYERS = [
  {
    who: "QA teams shipping weekly",
    pain: "Flaky end-to-end suites cover the happy path. Nobody re-checks every page on a phone after each release.",
    buys: "A sweep on every pull request through the GitHub Action. Only claims that survive the adversary and come with a failing repro test can fail the build.",
  },
  {
    who: "Agencies running client sites",
    pain: "Dozens of sites, each launch checked by hand, and no paper trail when a client asks what was tested.",
    buys: "A scheduled sweep per client with an exportable report: screenshots, repro steps, the adversary's argument and a Playwright test the client's developers can run.",
  },
  {
    who: "Agent platforms that browse for users",
    pain: "Their agents read hostile pages. One prompt injection or one leaked key is an incident.",
    buys: "The containment layer itself: throwaway capped containers, an egress allowlist with connect-time IP checks, a broker that keeps keys out of the sandbox, and receipts for every session.",
  },
];

const TIERS = [
  { name: "Public bay", price: "Free", detail: "3 sweeps a day per visitor, 3 pages, 60k tokens. The demo you can run right now." },
  { name: "Team", price: "$49 / month", detail: "500 sweeps, the CI gate, 90 days of reports. Inference at this volume costs about $2 to $7." },
  { name: "Agency", price: "$199 / month", detail: "3,000 sweeps across client sites, scheduled runs, branded Markdown and JSON exports." },
  { name: "Platform", price: "$0.02 / sandboxed session", detail: "Containment as an API for other agents: capped container, egress policy, broker, receipts." },
];

const lo = Math.min(...RUNS.map((r) => r.usd));
const hi = Math.max(...RUNS.map((r) => r.usd));

export default function WhyPage() {
  return (
    <article className="why" aria-labelledby="why-title">
      <header className="why-head">
        <div>
          <p className="label">Who pays for this</p>
          <h1 className="display" id="why-title">A full QA sweep costs<br /><em>about a cent.</em></h1>
          <p>
            Every number on this page comes from runs on the demo control plane: one $20 a month Vultr VM, with every model call
            billed by Vultr Serverless Inference. The expensive part of QA is the person clicking through pages and the bug report
            nobody can reproduce. Blast Door does both, and it cannot be talked out of its job by the page it is testing.
          </p>
        </div>
        <dl className="why-meter" aria-label="Measured cost per sweep">
          <div><dt>Cheapest sweep</dt><dd>${lo.toFixed(4)}</dd></div>
          <div><dt>Most expensive</dt><dd>${hi.toFixed(4)}</dd></div>
          <div><dt>Sweeps per dollar</dt><dd>{Math.round(1 / hi)} to {Math.round(1 / lo)}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="buyers-title" className="why-section">
        <h2 className="section-title" id="buyers-title">Three buyers</h2>
        <ol className="why-buyers">
          {BUYERS.map((b, i) => (
            <li key={b.who}>
              <span className="why-n">{String(i + 1).padStart(2, "0")}</span>
              <h3>{b.who}</h3>
              <p><strong>The problem.</strong> {b.pain}</p>
              <p><strong>What they buy.</strong> {b.buys}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="ledger-title" className="why-section">
        <h2 className="section-title" id="ledger-title">Measured runs</h2>
        <div className="why-scroll">
          <table className="table">
            <thead><tr><th scope="col">Run</th><th scope="col">Target</th><th scope="col">Tokens</th><th scope="col">Inference cost</th><th scope="col">Notes</th></tr></thead>
            <tbody>
              {RUNS.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/runs/${r.id}`}>{r.id}</Link></td>
                  <td>{r.target}</td>
                  <td>{r.tokens.toLocaleString("en-US")}</td>
                  <td>${r.usd.toFixed(4)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint">Each run covers planner, browser sweep, vision judge, adversary and repro tests in a second sandbox. The VM itself is a flat $20 a month and runs three sweeps at once.</p>
      </section>

      <section aria-labelledby="price-title" className="why-section">
        <h2 className="section-title" id="price-title">Pricing sketch</h2>
        <ul className="why-tiers">
          {TIERS.map((t) => (
            <li key={t.name}><span className="label">{t.name}</span><strong>{t.price}</strong><p>{t.detail}</p></li>
          ))}
        </ul>
        <p className="field-hint">A sketch, not a price list. At $49 for 500 sweeps the inference bill is under 15 percent of revenue at the most expensive measured run.</p>
      </section>

      <section aria-labelledby="ci-title" className="why-section why-ci">
        <h2 className="section-title" id="ci-title">Wire it into CI</h2>
        <p>
          <code>docs/ci/blast-door.yml</code> starts a sweep on every pull request with the operator key from a repo secret, waits for the
          verdict, and fails the check only when a high or critical claim survives the adversary. The job summary links the run, the
          screenshots and the repro test.
        </p>
        <a className="btn" href="https://github.com/JoeProAI/blast-door/tree/main/docs/ci">Get the GitHub Action</a>
      </section>
    </article>
  );
}
