// Host-side checks that prove the sandbox did not reach past its container.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { config } from "../lib/config";

const exec = promisify(execFile);

export interface HostSnapshot {
  canaryPath: string;
  canarySha256: string;
  processCount: number;
  loadAvg: number;
  t: number;
}

const CANARY_BODY = "blast-door host canary. If a sandbox can change this file, containment failed.\n";

export function canaryPath(): string {
  return path.join(config.dataDir, "host-canary.txt");
}

export async function snapshotHost(): Promise<HostSnapshot> {
  const p = canaryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, CANARY_BODY, { mode: 0o644 });
  let processCount = 0;
  try {
    const { stdout } = await exec("ps", ["-e", "--no-headers"], { maxBuffer: 8 * 1024 * 1024 });
    processCount = stdout.split("\n").filter((l) => l.trim()).length;
  } catch {}
  return {
    canaryPath: p,
    canarySha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
    processCount,
    loadAvg: Number(os.loadavg()[0].toFixed(2)),
    t: Date.now(),
  };
}

export function hostVerdict(before: HostSnapshot, after: HostSnapshot) {
  const drift = after.processCount - before.processCount;
  return {
    before,
    after,
    canaryUnchanged: before.canarySha256 === after.canarySha256,
    processDrift: drift,
    // The control plane itself spawns short-lived docker CLI processes, so allow a small margin.
    processCountStable: Math.abs(drift) <= 25,
  };
}
