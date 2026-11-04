// Fails CI if user-facing copy contains em dashes, en dashes used as dashes, or emoji.
import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components", "fixtures", "docs", "README.md"];
const exts = new Set([".ts", ".tsx", ".mjs", ".md", ".css", ".html"]);
const bad = [
  { name: "em dash", re: /\u2014/ },
  { name: "en dash", re: /\u2013/ },
  { name: "emoji", re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u },
];
const hits = [];
function walk(p) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) if (f !== "node_modules" && !f.startsWith(".")) walk(path.join(p, f));
    return;
  }
  if (!exts.has(path.extname(p))) return;
  fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    for (const b of bad) if (b.re.test(line)) hits.push(`${p}:${i + 1}: ${b.name}`);
  });
}
roots.forEach(walk);
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("copy lint clean");
