import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getRun } from "@/lib/db";
import { toMarkdown } from "@/lib/report-md";
import { dedashDeep } from "@/lib/text";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No run with that id." }, { status: 404 });
  if (!run.report) return NextResponse.json({ error: "This run has no report yet." }, { status: 409 });
  const report = dedashDeep(JSON.parse(run.report));
  const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "json";
  const body = format === "md" ? toMarkdown(report, config.publicUrl) : JSON.stringify(report, null, 2);
  return new NextResponse(body, {
    headers: {
      "content-type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="blast-door-${id}.${format}"`,
      "cache-control": "no-store",
    },
  });
}
