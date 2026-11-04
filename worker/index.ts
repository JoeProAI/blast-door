import { config } from "../lib/config";
import { claimNextRun, db, updateRun } from "../lib/db";
import { verifyModels } from "../lib/inference";
import { logger } from "../lib/log";
import { createBroker } from "./broker";
import { createEgressProxy } from "./egress-proxy";
import { executeRun } from "./orchestrator";
import { reapOrphans, startDockerEvents } from "./sandbox";

const log = logger("worker");

async function main() {
  db();
  const orphaned = db().prepare(`UPDATE runs SET status = 'failed', error = 'worker restarted mid-run', finished_at = ? WHERE status = 'running'`).run(Date.now());
  if (orphaned.changes) log.warn("marked interrupted runs as failed", { count: orphaned.changes });
  try {
    log.info("models verified against Vultr /v1/models", await verifyModels());
  } catch (e) {
    log.warn("could not verify models at startup", { message: (e as Error).message });
  }
  startDockerEvents();
  const reaped = await reapOrphans();
  log.info("startup reaper finished", { reaped: reaped.length });
  setInterval(() => void reapOrphans(), config.sandbox.reapIntervalMs);

  const host = config.sandbox.gateway;
  await new Promise<void>((r) => createBroker().listen(config.broker.port, host, r));
  await new Promise<void>((r) => createEgressProxy().listen(config.proxy.port, host, r));
  log.info("broker and egress proxy listening on sandbox gateway", { host, broker: config.broker.port, proxy: config.proxy.port });

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const run = claimNextRun();
    if (!run) return;
    busy = true;
    try {
      await executeRun(run);
    } catch (e) {
      log.error("run crashed", e);
      updateRun(run.id, { status: "failed", error: (e as Error).message.slice(0, 500), finished_at: Date.now() });
    } finally {
      busy = false;
    }
  }, 1000);
}

main().catch((e) => {
  log.error("worker failed to start", e);
  process.exit(1);
});
