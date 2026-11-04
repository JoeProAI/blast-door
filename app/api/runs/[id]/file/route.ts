import fs from "node:fs";
import path from "node:path";
import { getRun, runDir } from "@/lib/db";

export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return new Response("not found", { status: 404 });
  const rel = new URL(req.url).searchParams.get("p") ?? "";
  const base = runDir(id);
  const full = path.resolve(base, rel);
  const ext = path.extname(full).toLowerCase();
  if (!full.startsWith(base + path.sep) || !TYPES[ext] || rel.includes("task.json")) return new Response("refused", { status: 403 });
  try {
    const buf = fs.readFileSync(full);
    return new Response(buf, { headers: { "content-type": TYPES[ext], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
