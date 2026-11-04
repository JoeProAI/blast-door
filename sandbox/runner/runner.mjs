import fs from "node:fs";
import { emit, withTimeout } from "./emit.mjs";
import { launch, newSink, visit, snapshot, shoot, instrument, safeEval, VIEWPORTS, formsInPage, linksInPage } from "./browser.mjs";
import { runProbe } from "./probes.mjs";
import { spawn } from "node:child_process";

const task = JSON.parse(fs.readFileSync("/work/task.json", "utf8"));
fs.mkdirSync("/work/out", { recursive: true });

let token = task.broker?.token;
async function broker(pathname, body) {
  const res = await fetch(task.broker.url + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, ...body }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (data.nextToken) token = data.nextToken;
  if (!res.ok) throw new Error(`broker ${res.status}: ${data.error || "error"}`);
  return data;
}

function write(name, obj) {
  fs.writeFileSync(`/work/out/${name}`, JSON.stringify(obj, null, 2));
}

async function recon() {
  const browser = await launch(task);
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const sink = newSink();
  const page = await context.newPage();
  instrument(page, sink, "desktop");
  let status = null;
  try {
    const res = await page.goto(task.target, { waitUntil: "load", timeout: 25000 });
    status = res ? res.status() : null;
    await page.waitForTimeout(500);
  } catch (e) {
    emit("log", { level: "warn", msg: `recon load: ${e.message.split("\n")[0]}` });
  }
  await shoot(page, sink, { viewport: "desktop", label: "recon" });
  const snap = await snapshot(page).catch(() => ({ title: "", elements: [], visibleText: "", hiddenText: [] }));
  const links = await safeEval(page, linksInPage).catch(() => []);
  const forms = await safeEval(page, formsInPage).catch(() => []);
  const headings = await safeEval(page, () => Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 15).map((h) => h.innerText.trim().slice(0, 80))).catch(() => []);
  const out = {
    target: task.target,
    finalUrl: page.url(),
    status,
    title: snap.title,
    headings,
    links: links.slice(0, 60),
    forms,
    elements: snap.elements.slice(0, 30).map(({ ref, tag, type, name, href }) => ({ ref, tag, type, name, href })),
    visibleText: snap.visibleText.slice(0, 1500),
    hiddenText: snap.hiddenText,
    signals: sink.signals,
    shots: sink.shots,
  };
  write("recon.json", out);
  emit("done", { mode: "recon", links: out.links.length, forms: forms.length });
  await browser.close().catch(() => {});
}

async function runFlow(context, sink, flow, maxSteps) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORTS.desktop);
  instrument(page, sink, "desktop");
  const record = { name: flow.name, goal: flow.goal, startUrl: flow.startUrl, steps: [], outcome: "incomplete" };
  sink.flows.push(record);
  emit("flow", { name: flow.name, goal: flow.goal });
  try {
    await page.goto(flow.startUrl, { waitUntil: "load", timeout: 20000 });
  } catch (e) {
    record.outcome = `start page failed: ${e.message.split("\n")[0]}`;
    await page.close().catch(() => {});
    return;
  }
  await shoot(page, sink, { viewport: "desktop", label: `${flow.name} start`, flow: flow.name, step: 0 });
  const history = [];
  for (let i = 1; i <= maxSteps; i++) {
    let snap;
    try {
      snap = await snapshot(page);
    } catch (e) {
      record.outcome = `page unresponsive, agent abandoned it: ${e.message}`;
      sink.signals.push({ kind: "unresponsive", page: page.url(), viewport: "desktop", message: record.outcome });
      emit("unresponsive", { url: page.url(), flow: flow.name });
      break;
    }
    let resp;
    try {
      resp = await broker("/v1/agent-step", { flow: { name: flow.name, goal: flow.goal }, step: i, maxSteps, observation: snap, history: history.slice(-4) });
    } catch (e) {
      record.outcome = `broker refused: ${e.message}`;
      emit("log", { level: "warn", msg: record.outcome });
      break;
    }
    const action = resp.action;
    const el = action.ref ? snap.elements.find((e) => e.ref === action.ref) : undefined;
    const step = { index: i, url: page.url(), action, ok: true, selector: el?.selector, target: el ? { tag: el.tag, name: el.name, href: el.href } : undefined };
    emit("step", { flow: flow.name, index: i, action, screening: resp.screening });
    if (action.action === "done") {
      record.steps.push(step);
      record.outcome = action.reason || "done";
      break;
    }
    try {
      const loc = action.ref ? page.locator(`[data-bd-ref="${action.ref}"]`).first() : null;
      if (action.action === "click") await loc.click({ timeout: 5000 });
      else if (action.action === "fill") await loc.fill(String(action.value ?? ""), { timeout: 5000 });
      else if (action.action === "select") await loc.selectOption(String(action.value ?? ""), { timeout: 5000 });
      else if (action.action === "goto") await page.goto(action.url, { waitUntil: "load", timeout: 15000 });
      else if (action.action === "scroll") await safeEval(page, () => window.scrollBy(0, window.innerHeight * 0.8));
      else if (action.action === "back") await page.goBack({ timeout: 10000 });
      await withTimeout(page.waitForLoadState("load", { timeout: 8000 }), 9000, "settle").catch(() => {});
      await page.waitForTimeout(400);
    } catch (e) {
      step.ok = false;
      step.error = e.message.split("\n")[0].slice(0, 200);
    }
    step.shot = await shoot(page, sink, { viewport: "desktop", label: `${flow.name} step ${i}`, flow: flow.name, step: i });
    record.steps.push(step);
    history.push({ step: i, action: action.action, ref: action.ref, value: action.value, url: action.url, ok: step.ok, error: step.error });
  }
  await withTimeout(page.close({ runBeforeUnload: false }), 5000, "close").catch(() => {});
}

async function checkLinks(context, sink) {
  const origin = new URL(task.target).origin;
  const seen = new Map();
  for (const l of sink.links) {
    const u = l.url.split("#")[0];
    if (!u.startsWith(origin) || seen.has(u)) continue;
    seen.set(u, l.from);
  }
  const checked = [];
  for (const [u, from] of Array.from(seen).slice(0, 30)) {
    let status = null;
    try {
      const r = await context.request.get(u, { timeout: 8000, maxRedirects: 5 });
      status = r.status();
    } catch {
      status = null;
    }
    checked.push({ url: u, status, from });
    if (status === null || status >= 400)
      sink.signals.push({ kind: "broken_link", page: from, viewport: "desktop", message: `link to ${u} returns ${status ?? "no response"}`, detail: { url: u, status } });
  }
  sink.links = checked;
}

async function sweep() {
  const plan = task.plan;
  let browser = await launch(task);
  let context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  const sink = newSink();
  const ensure = async () => {
    if (browser.isConnected()) return;
    emit("log", { level: "warn", msg: "relaunching browser after crash" });
    browser = await launch(task);
    context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  };
  for (const [i, p] of plan.pages.entries()) {
    await ensure();
    await visit(context, sink, p.url, "desktop", `page ${i + 1} desktop`);
    await ensure();
    await visit(context, sink, p.url, "mobile", `page ${i + 1} mobile`);
    write("sweep.partial.json", sink);
  }
  for (const flow of plan.flows) {
    await ensure();
    await runFlow(context, sink, flow, task.maxSteps || 6);
    write("sweep.partial.json", sink);
  }
  await ensure();
  await checkLinks(context, sink).catch((e) => emit("log", { level: "warn", msg: `link check: ${e.message}` }));
  write("sweep.json", sink);
  emit("done", { mode: "sweep", shots: sink.shots.length, signals: sink.signals.length });
  await browser.close().catch(() => {});
}

async function repro() {
  try {
    fs.symlinkSync("/opt/runner/node_modules", "/work/node_modules");
  } catch {}
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["/opt/runner/node_modules/@playwright/test/cli.js", "test", "-c", "/work/playwright.config.mjs"], {
      cwd: "/work",
      env: { PATH: process.env.PATH, HOME: "/tmp", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright", PW_TEST_HTML_REPORT_OPEN: "never", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => process.stderr.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => resolve(c));
  });
  emit("done", { mode: "repro", exitCode: code });
}

const modes = { recon, sweep, repro, probe: () => runProbe(task) };
const fn = modes[task.mode];
if (!fn) {
  emit("error", { message: `unknown mode ${task.mode}` });
  process.exit(2);
}
fn()
  .then(() => process.exit(0))
  .catch((e) => {
    emit("error", { message: String(e && e.message ? e.message : e).slice(0, 500) });
    process.exit(1);
  });
