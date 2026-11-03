import crypto from "node:crypto";
import { config } from "../lib/config";

/**
 * In-memory registry of live sandbox leases. The egress proxy identifies a container by its
 * source IP (static per task, inter-container traffic disabled). The broker identifies it by a
 * chained single-use token: every accepted call burns the token and returns the next one.
 */
export interface EgressRecord {
  t: number;
  method: string;
  host: string;
  port: number;
  allowed: boolean;
  reason: string;
}

export interface Lease {
  taskId: string;
  runId: string;
  stage: string;
  ip: string;
  allowHosts: string[];
  label: string;
  brokerCalls: number;
  context: Record<string, unknown>;
  egress: EgressRecord[];
  bytesOut: number;
  bytesIn: number;
  onEgress?: (r: EgressRecord) => void;
  onBroker?: (kind: string, data: Record<string, unknown>) => void;
}

const byIp = new Map<string, Lease>();
const byTask = new Map<string, Lease>();
const tokens = new Map<string, string>(); // sha256(token) -> taskId
const burned = new Map<string, string>(); // sha256(token) -> taskId, for replay receipts

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

function ipPool(): string[] {
  const base = config.sandbox.gateway.split(".").slice(0, 3).join(".");
  const out: string[] = [];
  for (let i = config.sandbox.ipPoolStart; i <= config.sandbox.ipPoolEnd; i++) out.push(`${base}.${i}`);
  return out;
}

export function allocateIp(): string {
  for (const ip of ipPool()) if (!byIp.has(ip)) return ip;
  throw new Error("sandbox IP pool exhausted");
}

export function registerLease(l: Omit<Lease, "brokerCalls" | "egress" | "bytesOut" | "bytesIn">): Lease {
  const lease: Lease = { ...l, brokerCalls: 0, egress: [], bytesOut: 0, bytesIn: 0 };
  byIp.set(lease.ip, lease);
  byTask.set(lease.taskId, lease);
  return lease;
}

export function leaseForIp(ip: string): Lease | undefined {
  return byIp.get(ip.replace(/^::ffff:/, ""));
}

export function leaseForTask(taskId: string): Lease | undefined {
  return byTask.get(taskId);
}

export function issueToken(taskId: string): string {
  const t = crypto.randomBytes(24).toString("base64url");
  tokens.set(hash(t), taskId);
  return t;
}

export type TokenCheck = { ok: true; lease: Lease } | { ok: false; reason: "replayed" | "unknown" | "revoked"; taskId?: string };

/** Burns the token. A token works exactly once, and only while its task is alive. */
export function consumeToken(t: unknown): TokenCheck {
  if (typeof t !== "string" || t.length < 16) return { ok: false, reason: "unknown" };
  const h = hash(t);
  const taskId = tokens.get(h);
  if (!taskId) {
    const prior = burned.get(h);
    return prior ? { ok: false, reason: "replayed", taskId: prior } : { ok: false, reason: "unknown" };
  }
  tokens.delete(h);
  burned.set(h, taskId);
  if (burned.size > 20000) burned.delete(burned.keys().next().value as string);
  const lease = byTask.get(taskId);
  if (!lease) return { ok: false, reason: "revoked", taskId };
  return { ok: true, lease };
}

export function releaseLease(taskId: string) {
  const lease = byTask.get(taskId);
  if (lease) byIp.delete(lease.ip);
  byTask.delete(taskId);
  for (const [h, id] of tokens) if (id === taskId) tokens.delete(h);
}

export function liveTaskIds(): string[] {
  return Array.from(byTask.keys());
}
