import Link from "next/link";
import type { RunRow } from "@/lib/db";

export function RunTable({ runs }: { runs: Omit<RunRow, "report">[] }) {
  if (!runs.length) return <p className="empty">The run log is empty. Load a target above and the first sweep lands here.</p>;
  return (
    <table className="table run-table">
      <thead>
        <tr><th scope="col">Run</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Tokens</th><th scope="col">Started</th></tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td data-label="Run"><Link className="run-link" href={`/runs/${r.id}`}>{r.id}</Link></td>
            <td data-label="Target" className="run-target">{r.target}</td>
            <td data-label="Status"><span className={`status status-${r.status}`}>{r.status}{r.status === "running" && r.stage ? ` / ${r.stage}` : ""}</span></td>
            <td data-label="Tokens">{(r.tokens_prompt + r.tokens_completion).toLocaleString("en-US")}</td>
            <td data-label="Started">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
