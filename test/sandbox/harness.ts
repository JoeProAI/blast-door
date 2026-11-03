// Shared setup for tests that start real containers. Run on the VM (or any host after
// `npm run net:setup` and `npm run sandbox:build`). Uses the test ports 8792/8793 so it can run
// next to a live worker without colliding with its broker and proxy.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.BLASTDOOR_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "bd-test-"));
process.env.BLASTDOOR_BROKER_PORT = process.env.BLASTDOOR_TEST_BROKER_PORT ?? "8792";
process.env.BLASTDOOR_PROXY_PORT = process.env.BLASTDOOR_TEST_PROXY_PORT ?? "8793";
process.env.BLASTDOOR_SANDBOX_OWNER = `test-${process.pid}`;
process.env.BLASTDOOR_SANDBOX_IP_START = "200";
process.env.BLASTDOOR_SANDBOX_IP_END = "240";
// A fake secret in the orchestrator's own env. The no-secrets test proves it never crosses into a container.
process.env.VULTR_INFERENCE_API_KEY ||= "bd-test-canary-" + Math.random().toString(36).slice(2);
process.env.BD_TEST_CANARY_SECRET = "canary-" + Math.random().toString(36).slice(2) + "-secret";

const target = http.createServer((_q, s) => s.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>t</title><h1>target ok</h1>"));
await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
const port = (target.address() as { port: number }).port;
process.env.BLASTDOOR_FIXTURE_ROUTES = `target.blastdoor.test=127.0.0.1:${port}`;

export const TARGET = "http://target.blastdoor.test/";
export const { config } = await import("../../lib/config");
export const { createRun } = await import("../../lib/db");
export const sandbox = await import("../../worker/sandbox");
const { createBroker } = await import("../../worker/broker");
const { createEgressProxy } = await import("../../worker/egress-proxy");

const broker = createBroker();
const proxy = createEgressProxy();
await new Promise<void>((r) => broker.listen(config.broker.port, config.sandbox.gateway, r));
await new Promise<void>((r) => proxy.listen(config.proxy.port, config.sandbox.gateway, r));
sandbox.startDockerEvents();

export function newRunId() {
  return createRun({ kind: "sweep", target: TARGET, source: "test" }).id;
}

export async function shutdown() {
  sandbox.stopDockerEvents();
  broker.closeAllConnections();
  proxy.closeAllConnections();
  broker.close();
  proxy.close();
  target.close();
}

export async function leftovers() {
  const containers = (await sandbox.docker(["ps", "-aq", "--filter", "label=blastdoor.managed=1"])).trim();
  const volumes = (await sandbox.docker(["volume", "ls", "-q", "--filter", "dangling=true"])).trim();
  const networks = (await sandbox.docker(["network", "ls", "-q", "--filter", "label=blastdoor.network=1"])).trim().split("\n").filter(Boolean);
  return { containers, volumes, networks: networks.length };
}
