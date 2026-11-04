// SSRF guard for public any-URL runs. Checked twice: when a run is submitted (DNS resolved here)
// and again in the egress proxy, which connects only to the address it just checked, so a DNS
// rebind between the two lookups cannot reach private space.
import dns from "node:dns/promises";
import net from "node:net";

/** Loopback, RFC 1918, link-local and metadata, CGNAT, benchmark, multicast and reserved, IPv6 ULA and link-local. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivateAddress(l.slice(7));
    if (l.startsWith("64:ff9b::")) return isPrivateAddress(l.slice(9));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || /^fe[89ab]/.test(l) || l.startsWith("ff") || l.startsWith("2001:db8");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address);

const BLOCKED_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|metadata\.google\.internal)$/i;

export async function guardPublicUrl(raw: string, resolve: Resolver = systemResolver): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) return { ok: false, error: "Public runs can only reach ports 80 and 443." };
  if (BLOCKED_NAMES.test(host)) return { ok: false, error: "That hostname points inside a private network." };
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else {
    try {
      addrs = await resolve(host);
    } catch {
      return { ok: false, error: `Could not resolve ${host}.` };
    }
  }
  if (!addrs.length) return { ok: false, error: `${host} has no address.` };
  const bad = addrs.find(isPrivateAddress);
  if (bad) return { ok: false, error: `${host} resolves to a private or reserved address, so it cannot be swept.` };
  return { ok: true };
}
