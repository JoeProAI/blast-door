import { config } from "./config";

export type TargetCheck = { ok: true; url: string; fixture: boolean } | { ok: false; error: string };

/** Shape check only. Public non-fixture URLs must also pass guardPublicUrl and the public quota. */
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
  const fixture = config.publicTargets.map((t) => new URL(t).hostname).includes(u.hostname);
  return { ok: true, url: normalized, fixture };
}

export function isOperator(key: string | null | undefined): boolean {
  if (!config.operatorKey || !key) return false;
  if (key.length !== config.operatorKey.length) return false;
  let d = 0;
  for (let i = 0; i < key.length; i++) d |= key.charCodeAt(i) ^ config.operatorKey.charCodeAt(i);
  return d === 0;
}
