import type { Bug } from "./types";

const REPRO_TEXT: Record<string, string> = {
  reproduced: "REPRODUCED. The generated test fails on the live target.",
  not_reproduced: "NOT REPRODUCED. The generated test passes on the live target.",
  inconclusive: "INCONCLUSIVE. The test errored before its assertion ran.",
  not_run: "NOT RUN.",
};

export function reproText(status?: string) {
  return REPRO_TEXT[status ?? "not_run"] ?? status ?? "NOT RUN.";
}

function bugMd(b: Bug, fileBase: string) {
  const out = [`### ${b.id} [${b.severity.toUpperCase()}] ${b.title}`, "", `Page: ${b.page} (${b.viewport}). Source: ${b.source}. Category: ${b.category}.`, ""];
  if (b.shot) out.push(`Screenshot: ${fileBase}${encodeURIComponent(b.shot)}`, "");
  out.push("Repro steps:", ...b.steps.map((s, i) => `${i + 1}. ${s}`), "", "Evidence:", ...b.evidence.map((e) => `- ${e}`));
  if (b.logs?.length) out.push("", "Logs:", ...b.logs.slice(0, 6).map((l) => `- \`${l.replace(/`/g, "'")}\``));
  out.push("", `Adversary (${b.adversary.model ?? "unavailable"}): ${b.adversary.verdict.toUpperCase()}. ${b.adversary.argument}`);
  if (b.adversary.counter) out.push(`Strongest counter: ${b.adversary.counter}`);
  if (b.repro) {
    out.push("", `Repro test (${b.repro.generator}): ${reproText(b.repro.status)}`);
    if (b.repro.error) out.push("", "```text", b.repro.error.split("\n").slice(0, 8).join("\n"), "```");
    if (b.repro.code) out.push("", "```js", b.repro.code.trim(), "```");
  }
  return out.join("\n");
}

export function toMarkdown(report: any, publicUrl: string): string {
  const bugs: Bug[] = report.bugs ?? [];
  const survived = bugs.filter((b) => b.adversary?.verdict === "survived");
  const killed = bugs.filter((b) => b.adversary?.verdict !== "survived");
  const fileBase = `${publicUrl}/api/runs/${report.runId}/file?p=`;
  const s = report.summary ?? {};
  const lines = [
    `# Blast Door report: ${report.target}`,
    "",
    `Run ${report.runId}. Goal: ${report.goal ?? "none given"}.`,
    "",
    `${s.candidates ?? bugs.length} candidate claims, ${s.survived ?? survived.length} survived the adversary, ${s.killed ?? killed.length} were killed, ${s.reproduced ?? 0} reproduced by a generated test run in a separate sandbox.`,
    "",
    `Tokens: ${(report.tokens?.prompt ?? 0) + (report.tokens?.completion ?? 0)} (USD ${Number(report.tokens?.costUsd ?? 0).toFixed(4)}). Models: judge ${report.models?.judge}, adversary ${report.models?.adversary}, agent ${report.models?.agent}.`,
    "",
    "## Bugs that survived",
    "",
    survived.length ? survived.map((b) => bugMd(b, fileBase)).join("\n\n") : "None. Every claim was killed or none were raised.",
    "",
    "## Claims the adversary killed",
    "",
    killed.length ? killed.map((b) => `- ${b.id} ${b.title}: ${b.adversary?.argument}`).join("\n") : "None.",
    "",
    "## Sandboxes",
    "",
    ...(report.sandboxes ?? []).map((x: any) => `- ${x.container ?? x.name}: ${x.label ?? x.stage}, exit ${x.exitCode}, ${x.durationMs}ms, destroyed ${x.destroyed}`),
    "",
  ];
  return lines.join("\n");
}
