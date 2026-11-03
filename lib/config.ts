import path from "node:path";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function list(name: string, fallback: string[] = []): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** host=upstreamHost:port pairs. The egress proxy uses these to route fixture hostnames. */
function routes(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of list(name)) {
    const [host, upstream] = pair.split("=");
    if (host && upstream) out[host.toLowerCase()] = upstream;
  }
  return out;
}

export const config = {
  inference: {
    baseUrl: str("BLASTDOOR_INFERENCE_BASE_URL", "https://api.vultrinference.com/v1"),
    // Read lazily so the Next.js process never needs the key in its environment.
    get apiKey(): string {
      return process.env.VULTR_INFERENCE_API_KEY ?? "";
    },
    timeoutMs: num("BLASTDOOR_INFERENCE_TIMEOUT_MS", 90_000),
  },
  models: {
    planner: str("BLASTDOOR_MODEL_PLANNER", "qwen3.8-flash-next"),
    agent: str("BLASTDOOR_MODEL_AGENT", "qwen3.8-flash-next"),
    judge: str("BLASTDOOR_MODEL_JUDGE", "qwen3.8-27b"),
    judgeFallback: str("BLASTDOOR_MODEL_JUDGE_FALLBACK", "nemotron-3-nano-omni-30b-a3b-reasoning"),
    adversary: str("BLASTDOOR_MODEL_ADVERSARY", "glm-5.3-flash"),
    safety: str("BLASTDOOR_MODEL_SAFETY", "nemotron-3.5-content-safety"),
  },
  budget: {
    runTokens: num("BLASTDOOR_RUN_TOKEN_BUDGET", 250_000),
    dailyTokens: num("BLASTDOOR_DAILY_TOKEN_CAP", 4_000_000),
    maxCompletionTokens: num("BLASTDOOR_MAX_COMPLETION_TOKENS", 1_500),
    agentStepsPerFlow: num("BLASTDOOR_AGENT_STEPS_PER_FLOW", 6),
    maxFlows: num("BLASTDOOR_MAX_FLOWS", 3),
    maxPages: num("BLASTDOOR_MAX_PAGES", 5),
    maxJudgedShots: num("BLASTDOOR_MAX_JUDGED_SHOTS", 8),
    maxCandidates: num("BLASTDOOR_MAX_CANDIDATES", 10),
    brokerCallsPerTask: num("BLASTDOOR_BROKER_CALLS_PER_TASK", 40),
  },
  dataDir: path.resolve(str("BLASTDOOR_DATA_DIR", path.join(process.cwd(), ".data"))),
  publicUrl: str("BLASTDOOR_PUBLIC_URL", "http://localhost:3000"),
  operatorKey: process.env.BLASTDOOR_OPERATOR_KEY ?? "",
  publicTargets: list("BLASTDOOR_PUBLIC_TARGETS", [
    "http://shop.blastdoor.local/",
    "http://hostile.blastdoor.local/",
  ]),
  publicRunsPerDay: num("BLASTDOOR_PUBLIC_RUNS_PER_DAY", 40),
  sandbox: {
    image: str("BLASTDOOR_SANDBOX_IMAGE", "blastdoor/sandbox:1"),
    // Each orchestrator only reaps containers it owns, so tests and the live worker never collide.
    owner: str("BLASTDOOR_SANDBOX_OWNER", "worker"),
    network: str("BLASTDOOR_SANDBOX_NET", "bd-sandbox"),
    bridge: str("BLASTDOOR_SANDBOX_BRIDGE", "bd0"),
    subnet: str("BLASTDOOR_SANDBOX_SUBNET", "172.31.250.0/24"),
    gateway: str("BLASTDOOR_SANDBOX_GATEWAY", "172.31.250.1"),
    ipPoolStart: num("BLASTDOOR_SANDBOX_IP_START", 10),
    ipPoolEnd: num("BLASTDOOR_SANDBOX_IP_END", 250),
    dnsSink: str("BLASTDOOR_SANDBOX_DNS_SINK", "192.0.2.1"),
    cpus: str("BLASTDOOR_SANDBOX_CPUS", "1.0"),
    memory: str("BLASTDOOR_SANDBOX_MEMORY", "1g"),
    pids: num("BLASTDOOR_SANDBOX_PIDS", 256),
    tmpfs: str("BLASTDOOR_SANDBOX_TMPFS", "256m"),
    shm: str("BLASTDOOR_SANDBOX_SHM", "256m"),
    timeoutMs: num("BLASTDOOR_SANDBOX_TIMEOUT_MS", 180_000),
    reapIntervalMs: num("BLASTDOOR_REAP_INTERVAL_MS", 60_000),
  },
  broker: { port: num("BLASTDOOR_BROKER_PORT", 8790) },
  proxy: {
    port: num("BLASTDOOR_PROXY_PORT", 8791),
    routes: routes("BLASTDOOR_FIXTURE_ROUTES"),
  },
  fixtures: {
    shopPort: num("BLASTDOOR_SHOP_PORT", 8801),
    hostilePort: num("BLASTDOOR_HOSTILE_PORT", 8802),
    attackerPort: num("BLASTDOOR_ATTACKER_PORT", 8803),
    attackerUrl: str("BLASTDOOR_ATTACKER_URL", "http://attacker.blastdoor.local/"),
  },
};

export type Config = typeof config;
