import { RunTable } from "@/components/RunTable";
import { listRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Runs() {
  const runs = listRuns(100).map(({ report: _r, ...r }) => r);
  return (
    <section aria-labelledby="t">
      <p className="label">Every sweep this control plane has run</p>
      <h1 className="section-title" id="t">Run log</h1>
      <RunTable runs={runs} />
    </section>
  );
}
