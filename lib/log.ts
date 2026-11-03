import { redact } from "./redact";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, scope: string, msg: string, extra?: unknown) {
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(extra === undefined ? {} : { extra }),
  };
  const text = redact(JSON.stringify(line));
  if (level === "error" || level === "warn") process.stderr.write(text + "\n");
  else process.stdout.write(text + "\n");
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => process.env.BLASTDOOR_DEBUG && emit("debug", scope, m, e),
    info: (m: string, e?: unknown) => emit("info", scope, m, e),
    warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
    error: (m: string, e?: unknown) => emit("error", scope, m, e instanceof Error ? { message: e.message, stack: e.stack } : e),
  };
}
