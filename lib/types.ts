export interface QaPlan {
  summary: string;
  pages: { url: string; purpose: string }[];
  flows: { name: string; goal: string; startUrl: string }[];
  checks: string[];
}

export interface Signal {
  kind: "console_error" | "page_error" | "http_error" | "request_failed" | "broken_link" | "a11y" | "overflow" | "blocked_egress" | "unresponsive";
  page: string;
  viewport?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Shot {
  file: string;
  page: string;
  viewport: "desktop" | "mobile";
  label: string;
  step?: number;
  flow?: string;
}

export interface AgentAction {
  action: "click" | "fill" | "select" | "goto" | "scroll" | "back" | "done";
  ref?: number;
  value?: string;
  url?: string;
  reason: string;
}

export interface FlowStep {
  index: number;
  url: string;
  action: AgentAction;
  ok: boolean;
  error?: string;
  shot?: string;
  selector?: string;
}

export interface SweepOutput {
  pages: { url: string; status: number | null; title: string; ms: number; viewport: string }[];
  flows: { name: string; goal: string; startUrl: string; steps: FlowStep[]; outcome: string }[];
  signals: Signal[];
  shots: Shot[];
  links: { url: string; status: number | null; from: string }[];
  har: { requests: number; failed: number; bytes: number; byType: Record<string, number>; hosts: Record<string, number> };
  dom: Record<string, string>;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CandidateBug {
  id: string;
  title: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  source: "vision" | "signal" | "flow";
  page: string;
  viewport: string;
  shot?: string;
  region?: Region;
  evidence: string[];
  confidence: number;
  steps: string[];
  signalKinds?: string[];
  logs?: string[];
  flow?: string;
  detail?: Record<string, unknown>;
}

export type RubricKey = "layout_integrity" | "visual_bugs" | "readability_contrast" | "broken_media" | "responsive" | "error_states";

export interface JudgedShot {
  shot: Shot;
  scores: Record<RubricKey, number> | null;
  issues: { title: string; rubric: RubricKey; severity: CandidateBug["severity"]; region: Region; evidence: string; confidence: number }[];
  model: string | null;
  error?: string;
}

export interface AdversaryVerdict {
  verdict: "survived" | "killed";
  modelVerdict: "holds" | "killed" | "unavailable";
  argument: string;
  counter: string;
  gate: { screenshot: boolean; log: boolean; steps: boolean };
  model: string | null;
}

export interface ReproResult {
  status: "reproduced" | "not_reproduced" | "inconclusive" | "not_run";
  generator: "template" | "model" | "none";
  file?: string;
  code?: string;
  error?: string;
  durationMs?: number;
  artifacts?: string[];
  container?: string;
}

export interface Bug extends CandidateBug {
  adversary: AdversaryVerdict;
  repro?: ReproResult;
}
