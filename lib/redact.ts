/**
 * Redaction layer. Every string that reaches a log line, an event row, a receipt
 * or a proof pack passes through redact(). It removes the literal values of any
 * sensitive environment variable plus common credential shapes.
 */
const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL|SSH)/i;

let cachedValues: string[] | null = null;

export function sensitiveValues(): string[] {
  if (cachedValues) return cachedValues;
  const vals: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (SENSITIVE_ENV.test(k)) {
      vals.push(v);
      for (const line of v.split(/\r?\n/)) if (line.trim().length >= 16) vals.push(line.trim());
    }
  }
  cachedValues = Array.from(new Set(vals)).sort((a, b) => b.length - a.length);
  return cachedValues;
}

export function resetRedactionCache() {
  cachedValues = null;
}

const PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const p of PATTERNS) out = out.replace(p, "[REDACTED]");
  for (const v of sensitiveValues()) {
    if (out.includes(v)) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
