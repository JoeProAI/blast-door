import crypto from "node:crypto";
import { config } from "./config";
import { db } from "./db";

export function clientKey(headers: Headers): string {
  // Caddy appends the real peer to X-Forwarded-For, so the last entry is the one it saw.
  const xff = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const ip = xff.at(-1) || headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(`blast-door:${ip}`).digest("hex").slice(0, 24);
}

export function publicUrlQuota(client: string, now = Date.now()): { ok: true } | { ok: false; error: string } {
  const since = now - 24 * 3600 * 1000;
  const mine = db().prepare(`SELECT COUNT(*) AS n FROM runs WHERE created_at > ? AND source = 'public-url' AND client = ?`).get(since, client) as { n: number };
  if (mine.n >= config.publicAny.perClientPerDay) return { ok: false, error: `You have used your ${config.publicAny.perClientPerDay} public sweeps for today. They reset 24 hours after each run.` };
  const all = db().prepare(`SELECT COUNT(*) AS n FROM runs WHERE created_at > ? AND source = 'public-url'`).get(since) as { n: number };
  if (all.n >= config.publicAny.globalPerDay) return { ok: false, error: "Today's public sweep allowance is spent. The planted shop and the containment drill are still open." };
  return { ok: true };
}
