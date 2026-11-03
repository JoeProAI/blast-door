import { NextResponse } from "next/server";
import { getRun } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No run with that id." }, { status: 404 });
  const { report, ...rest } = run;
  return NextResponse.json({ ...rest, report: report ? JSON.parse(report) : null });
}
