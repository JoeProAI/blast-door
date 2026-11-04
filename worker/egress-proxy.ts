import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { config } from "../lib/config";
import { logger } from "../lib/log";
import { leaseForIp, type Lease, type EgressRecord } from "./registry";

/**
 * The only way out of a sandbox. Chromium inside the container is pointed at this proxy; raw
 * egress from the bridge is dropped by iptables. Each request is checked against the task's
 * host allowlist, and hosts that resolve to private, loopback or link-local space (cloud metadata
 * included) are refused unless they are a configured fixture route.
 */
const log = logger("egress");

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivateAddress(l.slice(7));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("ff");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
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

export interface Decision {
  allowed: boolean;
  reason: string;
  upstreamHost?: string;
  upstreamPort?: number;
}

export async function decide(lease: Lease | undefined, host: string, port: number): Promise<Decision> {
  if (!lease) return { allowed: false, reason: "source is not a live sandbox" };
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!lease.allowHosts.includes(h)) return { allowed: false, reason: "host not on this task's allowlist" };
  const route = config.proxy.routes[h];
  if (route) {
    const [rh, rp] = route.split(":");
    return { allowed: true, reason: "fixture route", upstreamHost: rh, upstreamPort: rp ? Number(rp) : port };
  }
  if (port !== 80 && port !== 443) return { allowed: false, reason: `port ${port} not allowed` };
  let addrs: { address: string }[] = [];
  if (net.isIP(h)) addrs = [{ address: h }];
  else {
    try {
      addrs = await dns.lookup(h, { all: true });
    } catch {
      return { allowed: false, reason: "dns lookup failed" };
    }
  }
  if (!addrs.length) return { allowed: false, reason: "no address" };
  const bad = addrs.find((a) => isPrivateAddress(a.address));
  if (bad) return { allowed: false, reason: `resolves to private address ${bad.address}` };
  return { allowed: true, reason: "allowlisted", upstreamHost: addrs[0].address, upstreamPort: port };
}

function note(lease: Lease | undefined, method: string, host: string, port: number, d: Decision) {
  const rec: EgressRecord = { t: Date.now(), method, host, port, allowed: d.allowed, reason: d.reason };
  if (lease) {
    lease.egress.push(rec);
    if (lease.egress.length > 2000) lease.egress.shift();
    lease.onEgress?.(rec);
  }
  if (!d.allowed) log.info("egress blocked", { task: lease?.taskId, method, host, port, reason: d.reason });
}

const BLOCK_BODY = "Blocked by the Blast Door egress policy. This host is not on the task allowlist.\n";

export function createEgressProxy(): http.Server {
  const server = http.createServer(async (req, res) => {
    const lease = leaseForIp(req.socket.remoteAddress ?? "");
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("absolute URL required\n");
      return;
    }
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const d = url.protocol === "http:" ? await decide(lease, url.hostname, port) : { allowed: false, reason: "unsupported scheme" };
    note(lease, req.method ?? "GET", url.hostname, port, d);
    if (!d.allowed) {
      res.writeHead(403, { "content-type": "text/plain", "x-blast-door": "egress-blocked", "x-blast-door-reason": d.reason }).end(BLOCK_BODY);
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    headers.host = url.host;
    const up = http.request(
      { host: d.upstreamHost, port: d.upstreamPort, method: req.method, path: url.pathname + url.search, headers, timeout: 30000 },
      (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.on("data", (c: Buffer) => lease && (lease.bytesIn += c.length));
        ur.pipe(res);
      },
    );
    up.on("timeout", () => up.destroy(new Error("upstream timeout")));
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "x-blast-door": "upstream-error" });
      res.end();
    });
    req.on("data", (c: Buffer) => lease && (lease.bytesOut += c.length));
    req.pipe(up);
  });

  server.on("connect", async (req, clientSocket: net.Socket, head) => {
    const lease = leaseForIp(clientSocket.remoteAddress ?? "");
    const [host, portStr] = (req.url ?? "").split(":");
    const port = Number(portStr || 443);
    const d = await decide(lease, host ?? "", port);
    note(lease, "CONNECT", host ?? "", port, d);
    if (!d.allowed) {
      clientSocket.end(`HTTP/1.1 403 Forbidden\r\nX-Blast-Door: egress-blocked\r\nContent-Length: ${BLOCK_BODY.length}\r\n\r\n${BLOCK_BODY}`);
      return;
    }
    const up = net.connect({ host: d.upstreamHost!, port: d.upstreamPort! }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(clientSocket);
      clientSocket.pipe(up);
    });
    up.setTimeout(60000, () => up.destroy());
    up.on("data", (c: Buffer) => lease && (lease.bytesIn += c.length));
    clientSocket.on("data", (c: Buffer) => lease && (lease.bytesOut += c.length));
    up.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => up.destroy());
  });
  server.on("clientError", (_e, sock) => sock.destroy());
  return server;
}
