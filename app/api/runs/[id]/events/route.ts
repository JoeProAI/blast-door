import { eventsSince, getRun } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  let after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(ctrl) {
      const push = () => {
        try {
          for (const e of eventsSince(id, after)) {
            after = e.id;
            ctrl.enqueue(enc.encode(`id: ${e.id}\nevent: ev\ndata: ${JSON.stringify({ id: e.id, ts: e.ts, stage: e.stage, kind: e.kind, data: JSON.parse(e.data) })}\n\n`));
          }
          const run = getRun(id);
          ctrl.enqueue(enc.encode(`event: run\ndata: ${JSON.stringify({ status: run?.status, stage: run?.stage, tokens: (run?.tokens_prompt ?? 0) + (run?.tokens_completion ?? 0), cost: run?.cost_usd, budget: run?.token_budget, error: run?.error })}\n\n`));
          if (run && (run.status === "done" || run.status === "failed") && !eventsSince(id, after, 1).length) {
            ctrl.enqueue(enc.encode(`event: end\ndata: {}\n\n`));
            clearInterval(timer);
            ctrl.close();
          }
        } catch {
          clearInterval(timer);
          try {
            ctrl.close();
          } catch {}
        }
      };
      push();
      timer = setInterval(push, 700);
      req.signal.addEventListener("abort", () => clearInterval(timer));
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
}
