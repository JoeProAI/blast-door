import { ContainmentView } from "@/components/ContainmentView";
import { getRun, latestRun } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ContainmentPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: requested } = await searchParams;
  const picked = requested ? getRun(requested) : latestRun("containment");
  const run = picked && picked.kind === "containment" ? picked : undefined;
  return <ContainmentView runId={run?.id ?? null} initialStatus={run?.status ?? null} missing={!!requested && !run} />;
}
