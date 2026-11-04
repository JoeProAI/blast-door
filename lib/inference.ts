import { dedash } from "./text";
import crypto from "node:crypto";
import { config } from "./config";
import { addEvent, addRunTokens, db, getRun, tokensToday } from "./db";
import { logger } from "./log";
import { redact } from "./redact";

/**
 * The only LLM client in Blast Door. Every model call in the product goes through
 * chat() and therefore through Vultr Serverless Inference. There is no other provider.
 */
const log = logger("inference");

export class BudgetExceeded extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BudgetExceeded";
  }
}

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatOptions {
  runId?: string;
  stage: string;
  purpose: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  schema?: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "minimal" | "low" | "medium" | null;
  cache?: boolean;
}

export interface ChatResult {
  text: string;
  json?: unknown;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
  cached: boolean;
  ms: number;
}

interface Price {
  prompt: number;
  completion: number;
}

const FALLBACK_PRICES: Record<string, Price> = {
  "qwen3.8-flash-next": { prompt: 0.0000001, completion: 0.0000002 },
  "qwen3.8-27b": { prompt: 0.00000015, completion: 0.000001 },
  "glm-5.3-flash": { prompt: 0.0000001, completion: 0.00000035 },
  "mimo-v2.6-flash": { prompt: 0.0000001, completion: 0.00000025 },
  "mimo-v2.6-pro": { prompt: 0.0000004, completion: 0.0000008 },
  "nemotron-3-nano-omni-30b-a3b-reasoning": { prompt: 0.0000001, completion: 0.00000025 },
  "nemotron-3.5-content-safety": { prompt: 0.00000005, completion: 0.00000015 },
};

let prices: Record<string, Price> = { ...FALLBACK_PRICES };
let modelIds: Set<string> | null = null;

export async function listModels(): Promise<{ id: string; image: boolean; price?: Price }[]> {
  const res = await fetch(`${config.inference.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.inference.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET /models failed: ${res.status}`);
  const body = (await res.json()) as { data: any[] };
  const out = body.data.map((m) => {
    const ins: any[] = m.input_modalities ?? [];
    const outs: any[] = m.output_modalities ?? [];
    const p = Number(ins.flatMap((i) => i.pricing ?? []).find((x: any) => x.type === "prompt")?.cost_usd ?? NaN);
    const c = Number(outs.flatMap((o) => o.pricing ?? []).find((x: any) => x.type === "completion")?.cost_usd ?? NaN);
    return {
      id: String(m.id),
      image: ins.some((i) => i.type === "image"),
      text: outs.some((o) => o.type === "text"),
      price: Number.isFinite(p) && Number.isFinite(c) ? { prompt: p, completion: c } : undefined,
    };
  });
  return out.filter((m) => m.text);
}

/** Confirms configured models exist on Vultr at startup and refreshes pricing. */
export async function verifyModels(): Promise<Record<string, string>> {
  const models = await listModels();
  modelIds = new Set(models.map((m) => m.id));
  for (const m of models) if (m.price) prices[m.id] = m.price;
  const resolved: Record<string, string> = {};
  for (const [role, id] of Object.entries(config.models)) {
    if (modelIds.has(id)) resolved[role] = id;
    else log.warn(`configured model for ${role} not listed by Vultr`, { id });
  }
  if (!modelIds.has(config.models.judge) && modelIds.has(config.models.judgeFallback)) {
    (config.models as Record<string, string>).judge = config.models.judgeFallback;
    resolved.judge = config.models.judgeFallback;
    log.warn("judge model missing, using fallback", { id: config.models.judgeFallback });
  }
  return resolved;
}

export function priceOf(model: string): Price {
  return prices[model] ?? { prompt: 0.0000003, completion: 0.000001 };
}

function cacheKey(o: ChatOptions): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify([o.model, o.messages, o.maxTokens, o.temperature ?? 0, o.schema?.name, o.reasoningEffort]));
  return h.digest("hex");
}

/** Pulls a JSON object out of model text that may contain think blocks, fences or leading whitespace. */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model output");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON in model output");
}

function checkBudget(runId: string | undefined) {
  const today = tokensToday();
  if (today >= config.budget.dailyTokens) throw new BudgetExceeded(`daily token cap reached (${today}/${config.budget.dailyTokens})`);
  if (!runId) return;
  const run = getRun(runId);
  if (!run) return;
  const used = run.tokens_prompt + run.tokens_completion;
  if (used >= run.token_budget) throw new BudgetExceeded(`run token budget reached (${used}/${run.token_budget})`);
}

function record(o: ChatOptions, r: ChatResult) {
  db()
    .prepare(
      `INSERT INTO llm_calls (run_id, stage, purpose, model, prompt_tokens, completion_tokens, reasoning_tokens, cost_usd, cached, ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(o.runId ?? null, o.stage, o.purpose, r.model, r.promptTokens, r.completionTokens, r.reasoningTokens, r.costUsd, r.cached ? 1 : 0, r.ms, Date.now());
  if (o.runId) {
    if (!r.cached) addRunTokens(o.runId, r.promptTokens, r.completionTokens, r.costUsd);
    addEvent(o.runId, o.stage, "llm_call", {
      purpose: o.purpose,
      model: r.model,
      prompt_tokens: r.promptTokens,
      completion_tokens: r.completionTokens,
      reasoning_tokens: r.reasoningTokens,
      cost_usd: r.costUsd,
      cached: r.cached,
      ms: r.ms,
    });
  }
}

async function post(body: Record<string, unknown>): Promise<any> {
  if (!config.inference.apiKey) throw new Error("VULTR_INFERENCE_API_KEY is not set");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${config.inference.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.inference.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.inference.timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`inference ${res.status}: ${redact((await res.text()).slice(0, 200))}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`inference ${res.status}: ${redact((await res.text()).slice(0, 300))}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if ((e as Error).name === "TimeoutError" && attempt < 1) continue;
      if (!(e instanceof TypeError)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function chat(o: ChatOptions): Promise<ChatResult> {
  const useCache = o.cache !== false;
  const key = cacheKey(o);
  if (useCache) {
    const hit = db().prepare(`SELECT response FROM inference_cache WHERE key = ?`).get(key) as { response: string } | undefined;
    if (hit) {
      const r = { ...(JSON.parse(hit.response) as ChatResult), cached: true, ms: 0, costUsd: 0 };
      record(o, r);
      return r;
    }
  }
  checkBudget(o.runId);

  const maxTokens = Math.min(o.maxTokens ?? 800, config.budget.maxCompletionTokens);
  const body: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    max_tokens: maxTokens,
    temperature: o.temperature ?? 0,
  };
  if (o.reasoningEffort !== null) body.reasoning_effort = o.reasoningEffort ?? "minimal";
  if (o.schema) body.response_format = { type: "json_schema", json_schema: { name: o.schema.name, strict: true, schema: o.schema.schema } };

  const started = Date.now();
  let data = await post(body);
  let msg = data?.choices?.[0]?.message ?? {};
  let text: string = dedash((msg.content ?? "").toString());
  let usage = data?.usage ?? {};
  // Reasoning models can spend the whole allowance thinking. One bounded retry with more room.
  if (!text.trim() && data?.choices?.[0]?.finish_reason === "length") {
    const retry = await post({ ...body, max_tokens: Math.min(maxTokens * 2, config.budget.maxCompletionTokens * 2) });
    const u2 = retry?.usage ?? {};
    usage = {
      prompt_tokens: (usage.prompt_tokens ?? 0) + (u2.prompt_tokens ?? 0),
      completion_tokens: (usage.completion_tokens ?? 0) + (u2.completion_tokens ?? 0),
      completion_tokens_details: { reasoning_tokens: (usage.completion_tokens_details?.reasoning_tokens ?? 0) + (u2.completion_tokens_details?.reasoning_tokens ?? 0) },
    };
    data = retry;
    msg = data?.choices?.[0]?.message ?? {};
    text = dedash((msg.content ?? "").toString());
  }
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const price = priceOf(o.model);
  const result: ChatResult = {
    text: text.trim(),
    model: o.model,
    promptTokens,
    completionTokens,
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0),
    costUsd: promptTokens * price.prompt + completionTokens * price.completion,
    cached: false,
    ms: Date.now() - started,
  };
  if (o.schema) {
    try {
      result.json = extractJson(result.text);
    } catch (e) {
      record(o, result);
      throw new Error(`${o.purpose}: unparseable model output (${(e as Error).message})`);
    }
  }
  record(o, result);
  if (useCache) {
    db()
      .prepare(`INSERT OR REPLACE INTO inference_cache (key, model, response, created_at) VALUES (?, ?, ?, ?)`)
      .run(key, o.model, JSON.stringify(result), Date.now());
  }
  return result;
}
