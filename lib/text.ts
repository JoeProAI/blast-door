// Model text sometimes carries em and en dashes. House copy has none, so strip them from
// anything the app renders or exports.
export function dedash(s: string): string {
  return s
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/(\d)\s*\u2013\s*(\d)/g, "$1-$2")
    .replace(/\s*\u2013\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}

export function dedashDeep<T>(v: T): T {
  if (typeof v === "string") return dedash(v) as T;
  if (Array.isArray(v)) return v.map(dedashDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dedashDeep(x)])) as T;
  return v;
}
