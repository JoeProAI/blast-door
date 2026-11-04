import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config";
import { redactDeep } from "./redact";

export type RunKind = "sweep" | "containment";
export type RunStatus = "queued" | "running" | "done" | "failed";

export interface RunRow {
  id: string;
  kind: RunKind;
  target: string;
  goal: string | null;
  status: RunStatus;
  stage: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  token_budget: number;
  tokens_prompt: number;
  tokens_completion: number;
  cost_usd: number;
  report: string | null;
  error: string | null;
  source: string;
}

export interface EventRow {
  id: number;
  run_id: string;
  ts: number;
  stage: string;
  kind: string;
  data: string;
}

const g = globalThis as unknown as { __bdDb?: Database.Database };

export function db(): Database.Database {
  if (g.__bdDb) return g.__bdDb;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const d = new Database(path.join(config.dataDir, "blast-door.sqlite"));
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      goal TEXT,
      status TEXT NOT NULL,
      stage TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      token_budget INTEGER NOT NULL,
      tokens_prompt INTEGER NOT NULL DEFAULT 0,
      tokens_completion INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      report TEXT,
      error TEXT,
      source TEXT NOT NULL DEFAULT 'public'
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      stage TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      stage TEXT,
      purpose TEXT,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cached INTEGER NOT NULL DEFAULT 0,
      ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS llm_calls_day ON llm_calls(created_at);
    CREATE TABLE IF NOT EXISTS inference_cache (
      key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  try {
    d.exec(`ALTER TABLE runs ADD COLUMN client TEXT`);
  } catch {}
  g.__bdDb = d;
  return d;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

export function createRun(input: { kind: RunKind; target: string; goal?: string | null; source: string; tokenBudget?: number; client?: string | null }): RunRow {
  const id = newId(input.kind === "containment" ? "ctn" : "run");
  db()
    .prepare(
      `INSERT INTO runs (id, kind, target, goal, status, created_at, token_budget, source, client) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .run(id, input.kind, input.target, input.goal ?? null, Date.now(), input.tokenBudget ?? config.budget.runTokens, input.source, input.client ?? null);
  return getRun(id)!;
}

export function getRun(id: string): RunRow | undefined {
  return db().prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
}

export function listRuns(limit = 25): RunRow[] {
  return db().prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit) as RunRow[];
}

export function latestRun(kind: RunKind, status: RunStatus = "done"): RunRow | undefined {
  return db().prepare(`SELECT * FROM runs WHERE kind = ? AND status = ? ORDER BY created_at DESC LIMIT 1`).get(kind, status) as
    | RunRow
    | undefined;
}

export function claimNextRun(): RunRow | undefined {
  const d = db();
  return d.transaction(() => {
    const row = d.prepare(`SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as RunRow | undefined;
    if (!row) return undefined;
    d.prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ?`).run(Date.now(), row.id);
    return getRun(row.id);
  })();
}

export function updateRun(id: string, patch: Partial<Pick<RunRow, "status" | "stage" | "finished_at" | "report" | "error">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(", ");
  db()
    .prepare(`UPDATE runs SET ${sets} WHERE id = @id`)
    .run({ ...patch, id });
}

export function addRunTokens(id: string, prompt: number, completion: number, cost: number) {
  db()
    .prepare(`UPDATE runs SET tokens_prompt = tokens_prompt + ?, tokens_completion = tokens_completion + ?, cost_usd = cost_usd + ? WHERE id = ?`)
    .run(prompt, completion, cost, id);
}

export function addEvent(runId: string, stage: string, kind: string, data: unknown): number {
  const safe = redactDeep(data);
  const r = db()
    .prepare(`INSERT INTO events (run_id, ts, stage, kind, data) VALUES (?, ?, ?, ?, ?)`)
    .run(runId, Date.now(), stage, kind, JSON.stringify(safe ?? {}));
  return Number(r.lastInsertRowid);
}

export function eventsSince(runId: string, afterId: number, limit = 500): EventRow[] {
  return db()
    .prepare(`SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?`)
    .all(runId, afterId, limit) as EventRow[];
}

export function tokensToday(): number {
  const since = Date.now() - 24 * 3600 * 1000;
  const r = db()
    .prepare(`SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS t FROM llm_calls WHERE created_at > ? AND cached = 0`)
    .get(since) as { t: number };
  return r.t;
}

export function publicRunsToday(): number {
  const since = Date.now() - 24 * 3600 * 1000;
  const r = db().prepare(`SELECT COUNT(*) AS n FROM runs WHERE created_at > ? AND source = 'public'`).get(since) as { n: number };
  return r.n;
}

export function activeRunCount(): number {
  const r = db().prepare(`SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued','running')`).get() as { n: number };
  return r.n;
}

export function runDir(runId: string): string {
  if (!/^[a-z]+_[a-z0-9]+$/.test(runId)) throw new Error("bad run id");
  return path.join(config.dataDir, "runs", runId);
}
