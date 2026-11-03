// Structured output channel to the orchestrator. One JSON object per line on stdout.
export function emit(type, data = {}) {
  process.stdout.write("@@BD " + JSON.stringify({ type, t: Date.now(), ...data }) + "\n");
}

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
