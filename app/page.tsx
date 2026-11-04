import { LaunchForm } from "@/components/LaunchForm";
import { RunTable } from "@/components/RunTable";
import { listRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Home() {
  const runs = listRuns(8).map(({ report: _r, ...r }) => r);
  return (
    <div className="bay">
      <section className="bay-hero" aria-labelledby="hero-title">
        <p className="label">QA sweep / vision judge / adversary / receipts</p>
        <h1 className="display" id="hero-title">Point it at<br />a web app.<br /><em>Seal the door.</em></h1>
        <p>
          A browser agent sweeps the target inside a throwaway Docker container on a Vultr VM. It holds no keys, it can only reach the
          target, and the container is destroyed the moment it finishes. You get screenshots, signals, and a receipt for every call it made.
        </p>
      </section>
      <section className="bay-console" aria-label="Start a run">
        <LaunchForm />
      </section>
      <section className="bay-log" aria-labelledby="log-title">
        <h2 className="section-title" id="log-title">Run log</h2>
        <RunTable runs={runs} />
      </section>
    </div>
  );
}
