import { notFound, redirect } from "next/navigation";
import { RunView } from "@/components/RunView";
import { getRun } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) notFound();
  if (run.kind === "containment") redirect(`/containment?run=${run.id}`);
  return <RunView id={run.id} target={run.target} goal={run.goal} initialStatus={run.status} />;
}
