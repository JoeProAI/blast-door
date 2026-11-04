import { clientKey, publicUrlQuota } from "@/lib/quota";
import { guardPublicUrl } from "@/lib/ssrf";
import { NextRequest, NextResponse } from "next/server";
import { activeRunCount, createRun, listRuns, publicRunsToday, tokensToday } from "@/lib/db";
import { config } from "@/lib/config";
import { checkTarget, isOperator } from "@/lib/targets";

export const dynamic = "force-dynamic";

export function GET() {
  const runs = listRuns(30).map(({ report, ...r }) => ({ ...r, hasReport: !!report }));
  return NextResponse.json({ runs, tokensToday: tokensToday(), dailyCap: config.budget.dailyTokens });
}

export async function POST(req: NextRequest) {
  let body: { target?: unknown; goal?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const operator = isOperator(req.headers.get("x-operator-key"));
  const kind = body.kind === "containment" ? "containment" : "sweep";
  const t = checkTarget(body.target, operator);
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 });
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 300) || null : null;
  const publicUrl = !operator && !t.fixture;
  const client = clientKey(req.headers);
  if (publicUrl) {
    if (kind === "containment") return NextResponse.json({ error: "The containment drill only runs against the planted hostile page." }, { status: 400 });
    const g = await guardPublicUrl(t.url);
    if (!g.ok) return NextResponse.json({ error: g.error }, { status: 400 });
    const q = publicUrlQuota(client);
    if (!q.ok) return NextResponse.json({ error: q.error }, { status: 429 });
  }
  if (!operator && !publicUrl && publicRunsToday() >= config.publicRunsPerDay)
    return NextResponse.json({ error: "The public run quota for today is spent. Replays of earlier runs are still open." }, { status: 429 });
  if (activeRunCount() >= 3) return NextResponse.json({ error: "Three runs are already queued. Wait for the bay to clear." }, { status: 429 });
  if (tokensToday() >= config.budget.dailyTokens) return NextResponse.json({ error: "Daily inference budget reached. Runs resume tomorrow." }, { status: 429 });
  const run = createRun({
    kind,
    target: t.url,
    goal,
    source: operator ? "operator" : publicUrl ? "public-url" : "public",
    tokenBudget: publicUrl ? config.publicAny.runTokens : undefined,
    client,
  });
  return NextResponse.json({ id: run.id }, { status: 201 });
}
