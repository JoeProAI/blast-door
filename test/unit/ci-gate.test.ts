import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain ESM script shipped for copy-paste into other repos
import { gate, summaryMarkdown } from "../../docs/ci/blast-door-gate.mjs";

const bug = (severity: string, verdict: string, id = "B01") => ({ id, title: `${severity} thing`, severity, adversary: { verdict }, repro: { status: "reproduced" } });

test("only surviving claims at or above the floor block the PR", () => {
  const report = { bugs: [bug("critical", "killed", "B01"), bug("high", "survived", "B02"), bug("medium", "survived", "B03"), bug("low", "survived", "B04")] };
  const g = gate(report, "high");
  assert.equal(g.pass, false);
  assert.deepEqual(g.blocking.map((b: any) => b.id), ["B02"]);
  assert.equal(g.survived, 3);
  assert.equal(gate(report, "critical").pass, true);
  assert.equal(gate(report, "low").blocking.length, 3);
});

test("zero-survivor and empty reports pass", () => {
  assert.equal(gate({ bugs: [bug("critical", "killed")] }).pass, true);
  assert.equal(gate(null).pass, true);
});

test("the job summary names the run and escapes table pipes", () => {
  const g = gate({ bugs: [{ ...bug("high", "survived"), title: "a | b" }] });
  const md = summaryMarkdown("https://bd.example", { id: "run_x", target: "https://t.example/" }, g, "high");
  assert.match(md, /\[run_x\]\(https:\/\/bd\.example\/runs\/run_x\)/);
  assert.match(md, /a \/ b/);
});
