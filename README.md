# Blast Door

Point it at a web app. A browser agent QA-sweeps it inside throwaway Docker sandboxes on a Vultr VM, a vision judge grades every screenshot, an adversary tries to break every bug claim, and you get a repro report with receipts. A planted hostile page tries to hijack the agent on camera, and the sandbox shrugs it off.

Live demo: https://66-135-31-133.sslip.io

- Bay: start a sweep against the planted Gearbox Supply shop.
- Containment: https://66-135-31-133.sslip.io/containment replays the hostile page drill.
- Run log: every run, its receipts, and its exported report.

![The bay](docs/img/bay.png)

## What a run does

1. **Recon.** A sandbox loads the target once and reports links, forms, headings and visible text.
2. **Plan.** `qwen3.8-flash-next` writes pages, flows and checks: broken links, console errors, failed requests, layout, accessibility basics, form validation and the mobile viewport.
3. **Sweep.** A fresh sandbox runs Playwright. Every page is captured at 1280x800 and 390x844, the agent drives each flow one validated action at a time, and console errors, page errors, failed requests, broken links, overflow and a11y findings are logged with a HAR summary and DOM excerpts.
4. **Judge.** `qwen3.8-27b` grades each screenshot on a fixed rubric (layout integrity, visual bugs, readability and contrast, broken media, responsive, error states, 0 to 10) with evidence boxes and a confidence. Fallback: `nemotron-3-nano-omni-30b-a3b-reasoning`.
5. **Adversary.** `glm-5.3-flash`, a different model family, argues each claim is not a bug. It sees the screenshot, logs, steps, a DOM excerpt and the claims it already reviewed. A claim survives only if the adversary concedes and the claim has a screenshot, a log and repro steps.
6. **Repro.** Each surviving claim gets a Playwright test that asserts correct behavior: a fixed template when a signal pins the bug down, otherwise one written by the agent model and checked by a validator. All tests run in a second throwaway container. A failing assertion means reproduced.

The report shows severity, the screenshot with the evidence box drawn on it, exact steps, evidence, the adversary's argument, and the repro result with the test source. It exports as JSON or Markdown.

![Claims that survived](docs/img/claims.png)

On the planted shop, a typical run raises 10 claims, the adversary kills the duplicates, and 7 survivors are reproduced: the cart subtotal ignoring the second item, a 404 careers link, a missing product image, a 500 from `/api/reviews`, a product grid that overflows at desktop width, and a promo banner at 1.2:1 contrast. Planted bugs are listed in [fixtures/shop/BUGS.md](fixtures/shop/BUGS.md).

## How containment works

Every browser task gets a new container from `blastdoor/sandbox:1` (pinned `mcr.microsoft.com/playwright:v1.64.1-noble` by digest), and the container is destroyed when the task ends, whether it succeeded, failed, timed out or crashed.

| Control | Setting |
| --- | --- |
| CPU | `--cpus 1.0` |
| Memory | `--memory 1g --memory-swap 1g` |
| Processes | `--pids-limit 256` |
| Filesystem | `--read-only`, 256 MB tmpfs on `/tmp`, only the task directory mounted |
| Privileges | `--cap-drop ALL`, `no-new-privileges`, default seccomp, uid 1001, no Docker socket |
| Secrets | none. The environment holds 7 variables, none of them keys |
| Model access | a broker on the host with a one-time chained token per call |
| Network | private bridge, no masquerade, no inter-container traffic, iptables drop by default, egress proxy allows only the target host |
| Time | wall clock enforced by the orchestrator, then kill, remove, and verify with `docker inspect` |
| Orphans | a reaper at startup and every minute |

The containment drill sends six attacks at that box and records what stopped each one:

- **Prompt injection.** Visible and hidden text orders the agent to run `rm -rf /`, post its environment to an attacker host and reveal its prompt. The broker flags it, hidden text is quarantined, the agent stays on the target, and it has no shell to run anything with.
- **Exfiltration.** The page posts to an attacker host, hits the metadata service, loads an off-list HTTPS origin, opens a WebSocket and fires a beacon. The proxy logs every block and the attacker sink records nothing.
- **Infinite loop.** 64 spinning workers. cgroup throttling and the wall clock end it.
- **Memory balloon.** The kernel OOM kills inside the cgroup.
- **Fork bomb.** The pids cap refuses forks and the host process count does not move.
- **Secret hunt.** Every env value is hashed and compared with the host's secrets, and the filesystem is scanned for key material.

A host canary file is hashed before and after the drill.

![The containment drill](docs/img/containment.png)

## Threat model

Assume the target page is hostile and the model can be talked into anything. The defenses do not rely on the model behaving: it has no tools beyond seven browser actions, every action is validated against the element list and the host allowlist, and even a fully hijacked browser can only reach the target and the broker. The broker never returns the key, only an action. Generated test code is treated the same way: it is validated, then run in its own capped container that can only reach the target.

Out of scope: kernel or container runtime escapes, denial of service against the target itself, and targets that need authentication. Operators can sweep any URL with the operator key; public visitors can only sweep the planted fixtures.

## Models and cost

All model calls go to Vultr Serverless Inference at `https://api.vultrinference.com/v1`. The worker checks the configured models against `GET /v1/models` at startup.

| Role | Model |
| --- | --- |
| Planner and browser agent | `qwen3.8-flash-next` |
| Vision judge | `qwen3.8-27b`, fallback `nemotron-3-nano-omni-30b-a3b-reasoning` |
| Adversary | `glm-5.3-flash` |
| Page text safety screen | `nemotron-3.5-content-safety` |

A full sweep of the planted shop uses about 35,000 tokens, about $0.007. Each run has a token budget (250,000 by default) and there is a daily cap, both shown in the UI. Results are cached by request hash, `max_tokens` is capped per call, and every agent flow has a step limit, so no loop calls the model unboundedly. The VM is a $20 a month vc2-2c-4gb, and it is the only billable resource.

## Quick start

See [docs/SETUP.md](docs/SETUP.md) for provisioning, environment variables and deployment, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the diagrams.

```bash
npm install
npm test                # unit tests
npm run test:sandbox    # real containers, needs Docker
npm run prove           # on the VM: containment drill plus a shop sweep, writes proof/<timestamp>/
```

## Proof

`proof/` holds a proof pack generated on the demo VM: `proof.json` with every scenario's expected and observed results, container ids, caps, cgroup numbers, timings and token spend, plus `summary.md` and screenshots.

License: MIT
