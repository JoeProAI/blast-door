import { NextResponse } from "next/server";
import { activeRunCount, tokensToday } from "@/lib/db";
import { revision } from "@/lib/revision";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ ok: true, active: activeRunCount(), tokensToday: tokensToday(), revision: revision() });
}
