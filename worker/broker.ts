import http from "node:http";
import { config } from "../lib/config";
import { logger } from "../lib/log";
import { consumeToken, issueToken } from "./registry";
import { agentStep, type Observation } from "./agent";
import { screenObservation } from "./screen";

/**
 * The inference broker. Sandboxes hold no keys. They POST observations here with a single-use
 * token; the broker burns it, makes the Vultr call itself, and hands back an action plus the next
 * token. A replayed or foreign token is refused and logged.
 */
const log = logger("broker");
const MAX_BODY = 256 * 1024;

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export function createBroker(): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/agent-step") return send(res, 404, { error: "not found" });
    let body: any;
    try {
      body = await readJson(req);
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
    const check = consumeToken(body.token);
    if (!check.ok) {
      log.warn("broker token refused", { reason: check.reason, task: check.taskId });
      return send(res, 401, { error: `token ${check.reason}` });
    }
    const lease = check.lease;
    const nextToken = issueToken(lease.taskId);
    lease.brokerCalls++;
    if (lease.brokerCalls > config.budget.brokerCallsPerTask) {
      lease.onBroker?.("broker_limit", { calls: lease.brokerCalls });
      return send(res, 429, { error: "broker call limit for this task", nextToken });
    }
    const obs = body.observation as Observation;
    if (!obs || !Array.isArray(obs.elements)) return send(res, 400, { error: "observation required", nextToken });
    try {
      const screening = await screenObservation(lease.runId, lease.stage, obs.visibleText ?? "", obs.hiddenText ?? []);
      if (screening.flagged || screening.quarantinedHidden) lease.onBroker?.("screening", { url: obs.url, ...screening });
      const goal = String(body.flow?.goal ?? "").slice(0, 400);
      const v = await agentStep(lease.runId, lease.stage, goal, Number(body.step) || 1, Number(body.maxSteps) || 6, obs, body.history ?? [], lease.allowHosts);
      lease.onBroker?.("action", { url: obs.url, flow: body.flow?.name, step: body.step, action: v.action, rejected: v.rejected, flagged: screening.flagged });
      return send(res, 200, { action: v.action, nextToken, screening: { flagged: screening.flagged, heuristics: screening.heuristics, model: screening.model?.verdict } });
    } catch (e) {
      lease.onBroker?.("error", { message: (e as Error).message });
      return send(res, 502, { error: (e as Error).message.slice(0, 200), nextToken });
    }
  });
}
