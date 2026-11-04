import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../lib/config";

const ROOTS = ["app", "components", "lib", "worker", "sandbox", "scripts"];
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mjs|js|sh)$/.test(e.name) ? [p] : [];
  });
const source = ROOTS.flatMap(files).map((f) => ({ f, s: fs.readFileSync(f, "utf8") }));

test("the only inference endpoint is Vultr Serverless Inference", () => {
  assert.equal(new URL(config.inference.baseUrl).host, "api.vultrinference.com");
});

test("no other LLM provider appears anywhere in the product code", () => {
  const other = /api\.openai\.com|anthropic\.com|openrouter\.ai|generativelanguage\.googleapis|api\.groq\.com|api\.mistral\.ai|api\.together\.xyz|api\.cohere|from ["'](openai|@anthropic-ai\/sdk|@google\/generative-ai)["']/i;
  assert.deepEqual(source.filter(({ s }) => other.test(s)).map(({ f }) => f), []);
});

test("chat completions are called from lib/inference.ts and nowhere else", () => {
  assert.deepEqual(source.filter(({ s }) => s.includes("/chat/completions")).map(({ f }) => f), [path.join("lib", "inference.ts")]);
});
