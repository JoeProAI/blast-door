# Setup

## What you need

- One Vultr VM. The demo runs on vc2-2c-4gb (2 vCPU, 4 GB) in ewr with Ubuntu 24.04. Nothing else is billable: no block storage, no load balancer, no extra instance.
- Docker, Node 22 and rsync on the VM. The cloud-init on the demo VM installs Docker and Node; `deploy/install.sh` installs Caddy if it is missing.
- A Vultr Serverless Inference subscription and its API key.
- ufw allowing 22, 80 and 443.

## Secrets

The app reads one secret, `VULTR_INFERENCE_API_KEY`. On the VM it lives in a root-only file:

```bash
install -d -m 755 /etc/blast-door
printf 'VULTR_INFERENCE_API_KEY=%s\n' "$KEY" > /etc/blast-door/env
chmod 600 /etc/blast-door/env
```

Only the worker unit reads that file. The app unit reads `/etc/blast-door/app.env`, which holds no secrets, and no container ever receives either. `lib/redact.ts` strips any value that looks like a key out of logs, events and the proof pack, and CI runs gitleaks on every push.

## Deploy

From a checkout with the VM address and an SSH key:

```bash
export BLASTDOOR_VM_IP=203.0.113.10
export BLASTDOOR_SSH_KEY_FILE=~/.ssh/blastdoor
bash deploy/deploy.sh
```

`deploy.sh` rsyncs the tree to `/opt/blast-door` and runs `deploy/install.sh` on the VM, which:

1. creates the `blastdoor` user and `/var/lib/blast-door`,
2. writes `/etc/blast-door/app.env` if it does not exist,
3. installs Caddy and writes a site block for `<ip-with-dashes>.sslip.io`, so HTTPS is automatic with no domain,
4. builds the Next.js app and the `blastdoor/sandbox:1` image,
5. installs and restarts four systemd units: `blast-door-net` (Docker network and iptables rules), `blast-door-fixtures` (the planted shop, hostile page and attacker sink on 127.0.0.1), `blast-door-worker` (orchestrator, broker, egress proxy) and `blast-door-app` (Next.js on 127.0.0.1:3000).

Check it:

```bash
curl -s https://<ip-with-dashes>.sslip.io/api/health
systemctl status blast-door-worker --no-pager
```

## Environment

| Variable | Default | What it does |
| --- | --- | --- |
| `VULTR_INFERENCE_API_KEY` | none | Bearer token for `https://api.vultrinference.com/v1`. Worker only. |
| `BLASTDOOR_DATA_DIR` | `.data` | SQLite database, run directories, screenshots, host canary. |
| `BLASTDOOR_PUBLIC_URL` | `http://localhost:3000` | Used in exported reports. |
| `BLASTDOOR_OPERATOR_KEY` | none | Lets a caller sweep any URL. Without it the UI accepts only the planted targets. |
| `BLASTDOOR_MODEL_*` | see `lib/config.ts` | Planner, agent, judge, judge fallback, adversary and safety models. Verified against `/v1/models` at worker startup. |
| `BLASTDOOR_RUN_TOKEN_BUDGET` | 250000 | Per-run token cap. |
| `BLASTDOOR_DAILY_TOKEN_CAP` | 4000000 | Daily token cap across runs. |
| `BLASTDOOR_SANDBOX_*` | see `lib/config.ts` | Image, network, subnet, IP pool, cpus, memory, pids, tmpfs, wall clock, reaper interval. |
| `BLASTDOOR_FIXTURE_ROUTES` | none | Maps fixture hostnames to loopback ports for the egress proxy. |

## Run it locally

```bash
npm install
npm run sandbox:build      # builds blastdoor/sandbox:1
sudo bash scripts/net-setup.sh
npm run fixtures &         # planted shop, hostile page, attacker sink
npm run worker &           # orchestrator, broker, egress proxy
npm run dev                # http://localhost:3000
```

The worker needs Docker access and the ability to bind the sandbox gateway address, so run it as a user in the `docker` group on the machine that owns the `bd-sandbox` network.

## Tests

```bash
npm test            # unit: redaction, broker tokens, agent validation, egress, candidates, repro templates
npm run typecheck
npm run lint:copy
npm run test:sandbox    # real containers: lifecycle, caps, no secrets, egress, pids, OOM. Needs Docker.
```

`npm run test:sandbox` starts its own broker and proxy on 8792 and 8793 and labels its containers with its own owner, so it can run while the live worker is up.

## Proof pack

```bash
npm run prove
```

On the VM this runs every containment scenario against the planted hostile page plus one sweep against the planted shop, then writes `proof/<timestamp>/` with `proof.json`, `summary.md` and the screenshots. It uses the running control plane through its API, so the services must be up. The committed pack under `proof/` was generated on the demo VM.
