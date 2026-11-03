import { chat } from "../lib/inference";
import { config } from "../lib/config";

/**
 * Prompt injection screening for untrusted page text. Two layers: a fast pattern pass that
 * always runs, and Vultr's content-safety model as a second opinion when anything looks off.
 * Screening never grants the page any power. It only decides what gets quarantined and logged.
 */
export const INJECTION_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "override-instructions", re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your)\b.{0,20}\b(instructions?|rules|prompts?|directives?)/i },
  { name: "destructive-shell", re: /\brm\s+-rf\b|\bmkfs\b|:\(\)\s*\{|\bdd\s+if=|\bshutdown\b/i },
  { name: "exfiltrate-secrets", re: /\b(post|send|upload|exfiltrate|leak|forward|curl|wget|print|dump|reveal)\b.{0,60}\b(env|environment|secrets?|keys?|tokens?|credentials?|passwords?|api[_ -]?key)/i },
  { name: "role-hijack", re: /\b(you are now|act as|new instructions|system prompt|developer mode|jailbreak|as an ai)\b/i },
  { name: "tool-escalation", re: /\b(run|execute|open)\b.{0,30}\b(shell|terminal|bash|command line|python)\b/i },
];

export interface Screening {
  flagged: boolean;
  heuristics: string[];
  model?: { verdict: string; categories: string } | null;
  quarantinedHidden: number;
  excerpt?: string;
}

export function heuristicScan(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export async function screenObservation(
  runId: string,
  stage: string,
  visibleText: string,
  hidden: { how: string; text: string }[],
): Promise<Screening> {
  const hiddenJoined = hidden.map((h) => `[${h.how}] ${h.text}`).join("\n");
  const all = `${visibleText}\n${hiddenJoined}`;
  const heuristics = heuristicScan(all);
  const s: Screening = { flagged: heuristics.length > 0, heuristics, model: null, quarantinedHidden: hidden.length };
  if (heuristics.length) {
    const m = all.match(INJECTION_PATTERNS.find((p) => p.name === heuristics[0])!.re);
    if (m && m.index !== undefined) s.excerpt = all.slice(Math.max(0, m.index - 30), m.index + 110).replace(/\s+/g, " ");
  }
  if (heuristics.length || hidden.length) {
    try {
      const r = await chat({
        runId,
        stage,
        purpose: "content-safety screen",
        model: config.models.safety,
        messages: [{ role: "user", content: all.slice(0, 2500) }],
        maxTokens: 40,
        reasoningEffort: null,
      });
      const verdict = /unsafe/i.test(r.text) ? "unsafe" : /safe/i.test(r.text) ? "safe" : "unknown";
      const cats = (r.text.match(/Categor(?:y|ies):\s*([^\n]+)/i) || [])[1] ?? "";
      s.model = { verdict, categories: cats.trim() };
      if (verdict === "unsafe") s.flagged = true;
    } catch {
      s.model = { verdict: "unavailable", categories: "" };
    }
  }
  return s;
}
