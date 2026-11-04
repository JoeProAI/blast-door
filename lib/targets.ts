import { config } from "./config";

export type TargetCheck = { ok: true; url: string } | { ok: false; error: string };

/** Public visitors may only sweep the planted fixtures. Operators (with the operator key) may sweep any http(s) URL. */
export function checkTarget(raw: unknown, operator: boolean): TargetCheck {
  if (typeof raw !== "string" || raw.length > 500) return { ok: false, error: "Target must be a URL under 500 characters." };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That is not a URL. Include the scheme, for example http://shop.blastdoor.local/." };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "Only http and https targets can be swept." };
  if (u.username || u.password) return { ok: false, error: "Credentials in the URL are not accepted." };
  const normalized = u.toString();
  if (operator) return { ok: true, url: normalized };
  const allowed = config.publicTargets.map((t) => new URL(t).hostname);
  if (!allowed.includes(u.hostname)) return { ok: false, error: `Public runs are limited to the planted targets: ${config.publicTargets.join(", ")}` };
  return { ok: true, url: normalized };
}

export function isOperator(key: string | null | undefined): boolean {
  if (!config.operatorKey || !key) return false;
  if (key.length !== config.operatorKey.length) return false;
  let d = 0;
  for (let i = 0; i < key.length; i++) d |= key.charCodeAt(i) ^ config.operatorKey.charCodeAt(i);
  return d === 0;
}
