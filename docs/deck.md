---
marp: true
size: 16:9
paginate: true
title: Blast Door
description: Sandboxed browser QA on Vultr with receipts
style: |
  @import url("https://fonts.googleapis.com/css2?family=Saira+Stencil+One&family=JetBrains+Mono:wght@400;700&family=Instrument+Sans:wght@400;600&display=swap");
  section { background: #0a1014; color: #e6eef2; font-family: "Instrument Sans", sans-serif; font-size: 26px; padding: 64px 80px; border-top: 14px solid; border-image: repeating-linear-gradient(-45deg, #ffc400 0 18px, #0a1014 18px 36px) 14; }
  h1, h2 { font-family: "Saira Stencil One", sans-serif; text-transform: uppercase; letter-spacing: .02em; color: #e6eef2; margin: 0 0 24px; }
  h1 { font-size: 72px; line-height: 1; } h2 { font-size: 48px; }
  strong, em { color: #ffc400; font-style: normal; }
  code, table { font-family: "JetBrains Mono", monospace; font-size: 20px; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #2a3a44; padding: 8px 12px; background: #111b21; text-align: left; } th { color: #ffc400; }
  section::after { font-family: "JetBrains Mono", monospace; color: #7f939e; }
  .label { font-family: "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase; color: #7f939e; font-size: 18px; }
  .big { font-family: "JetBrains Mono", monospace; font-size: 64px; color: #ffc400; font-weight: 700; line-height: 1.1; }
  img { border: 2px solid #2a3a44; }
---

<!-- _paginate: false -->

![bg](cover.png)

---

<p class="label">Blast Door / Vultr Agent Rush 2026</p>

# Point it at any web app.<br>Get bugs with receipts.

A browser agent QA-sweeps the site inside throwaway Docker sandboxes on a Vultr VM. A vision judge grades every frame. An adversary from a different model family tries to kill every claim. What survives ships with a Playwright test that already failed in a second sandbox.

Live: `https://66-135-31-133.sslip.io`

---

## The problem

- AI QA agents **flood you with false positives**. A judge that flags everything is a judge nobody reads.
- A browsing agent **reads hostile pages**. One prompt injection, one leaked key, one runaway tab, and the agent is the incident.
- Bug reports **without repro steps** cost more engineering time than the bug.

Blast Door attacks all three: adversarial review, hard containment, and a repro test run for every surviving claim.

---

## Demo: what one sweep found

![bg right:58% fit](img/deck/findings.png)

Planted shop, run `run_mw1bucwnade2f67b`: **10 candidates, 8 survived, 7 reproduced** by a failing Playwright test. 35,476 tokens, $0.0069.

---

## Architecture: one VM runs everything

| Layer | On the vc2-2c-4gb VM |
| --- | --- |
| Control plane | Next.js app and API, SSE live feed, SQLite run state |
| Worker | Orchestrator, reaper, broker with chained one-time tokens |
| Sandboxes | Pinned Playwright image, `--cap-drop ALL`, read-only root, pids, CPU and memory caps |
| Egress | Allowlist proxy, DNS and connect-time IP checks, iptables `DOCKER-USER` |
| Inference | Every call to `api.vultrinference.com/v1`, keys never enter a container |

Planner `qwen3.8-flash-next`, judge `qwen3.8-27b`, adversary `glm-5.3-flash`.

---

## Containment receipts

![bg right:58% fit](img/deck/containment.png)

Six attacks, six throwaway containers: prompt injection, hidden text, infinite loop, memory balloon, fork bomb, exfiltration. **6 of 6 held.** Host canary unchanged, attacker sink 0 hits, every container destroyed and verified gone.

---

## Vultr requirements map

| Requirement | Where | Proof |
| --- | --- | --- |
| VM is the control plane | `app/`, `worker/`, `deploy/` | `/api/health` live build SHA |
| All LLM calls via Vultr | `lib/inference.ts` | one base URL, `GET /v1/models` at boot |
| Sandboxes are containers | `worker/sandbox.ts` | `docker events` receipts per scenario |
| Public repo and setup | `README.md`, `docs/SETUP.md` | MIT, `npm run prove` |
| Architecture | `docs/ARCHITECTURE.md` | Mermaid diagrams |

Proof packs committed: `proof/2026-11-04T01-11-09-065Z` generated on the VM, PASS.

---

## Who pays for this

<div class="big">$0.0026 to $0.0119</div>

<p class="label">measured Vultr inference cost per full sweep, six real runs</p>

- **QA teams**: a sweep on every pull request, the GitHub Action fails only on surviving high-severity claims.
- **Agencies**: scheduled sweeps per client with exportable reports.
- **Agent platforms**: containment as an API for agents that browse hostile pages.

Sketch: free public bay, Team $49 a month, Agency $199 a month, Platform $0.02 per sandboxed session.

---

## Roadmap

1. **Authenticated sweeps**: seeded test accounts handed to the sandbox through the broker, never as env.
2. **Diff sweeps**: compare a pull request preview against production and report only regressions.
3. **Containment API**: sell the sandbox, egress policy and receipts to other agent builders.
4. **Scheduled runs and alerts** for agencies.
5. **Accessibility depth**: axe-core results judged next to the screenshots.

---

<!-- _paginate: false -->

# Blast Door

The page tried to hijack the agent. The door held, and you get the receipts.

`https://66-135-31-133.sslip.io`<br>`https://github.com/JoeProAI/blast-door`
