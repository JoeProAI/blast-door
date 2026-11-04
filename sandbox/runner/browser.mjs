import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { emit, withTimeout } from "./emit.mjs";
import { auditInPage, domDigestInPage, formsInPage, linksInPage, overflowInPage, snapshotInPage } from "./page-probe.mjs";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

export async function launch(task) {
  const browser = await chromium.launch({
    proxy: { server: task.proxy },
    args: [
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-default-apps",
      "--metrics-recording-only",
      "--dns-prefetch-disable",
    ],
  });
  browser.on("disconnected", () => emit("log", { level: "warn", msg: "browser disconnected" }));
  return browser;
}

/** Wires network, console and crash instrumentation onto a page. Everything lands in `sink`. */
export function instrument(page, sink, viewport) {
  const pageUrl = () => page.url();
  page.on("console", (m) => {
    if (m.type() === "error") sink.signals.push({ kind: "console_error", page: pageUrl(), viewport, message: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => sink.signals.push({ kind: "page_error", page: pageUrl(), viewport, message: String(e.message || e).slice(0, 400) }));
  page.on("crash", () => sink.signals.push({ kind: "unresponsive", page: pageUrl(), viewport, message: "renderer process crashed" }));
  page.on("response", async (r) => {
    sink.har.requests++;
    const type = r.request().resourceType();
    sink.har.byType[type] = (sink.har.byType[type] || 0) + 1;
    try {
      const host = new URL(r.url()).host;
      sink.har.hosts[host] = (sink.har.hosts[host] || 0) + 1;
    } catch {}
    const len = Number(r.headers()["content-length"] || 0);
    if (Number.isFinite(len)) sink.har.bytes += len;
    if (r.status() >= 400) {
      const blocked = r.headers()["x-blast-door"] === "egress-blocked";
      sink.signals.push({
        kind: blocked ? "blocked_egress" : "http_error",
        page: pageUrl(),
        viewport,
        message: `${r.status()} ${r.request().method()} ${r.url()}`.slice(0, 300),
        detail: { status: r.status(), url: r.url(), resourceType: type },
      });
    }
  });
  page.on("requestfailed", (req) => {
    sink.har.failed++;
    const failure = req.failure()?.errorText || "failed";
    const blocked = /TUNNEL_CONNECTION_FAILED|PROXY|ERR_BLOCKED/i.test(failure);
    sink.signals.push({
      kind: blocked ? "blocked_egress" : "request_failed",
      page: pageUrl(),
      viewport,
      message: `${failure} ${req.method()} ${req.url()}`.slice(0, 300),
      detail: { url: req.url(), failure, resourceType: req.resourceType() },
    });
  });
}

export function newSink() {
  return {
    pages: [],
    flows: [],
    signals: [],
    shots: [],
    links: [],
    har: { requests: 0, failed: 0, bytes: 0, byType: {}, hosts: {} },
    dom: {},
  };
}

let shotCounter = 0;
export async function shoot(page, sink, meta) {
  const dir = "/work/out/shots";
  fs.mkdirSync(dir, { recursive: true });
  const file = `${String(++shotCounter).padStart(3, "0")}-${meta.viewport}-${meta.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.jpg`;
  try {
    const height = await withTimeout(page.evaluate(() => document.documentElement.scrollHeight), 4000, "measure");
    const vp = page.viewportSize();
    const opts = { path: path.join(dir, file), type: "jpeg", quality: 72, timeout: 8000 };
    if (meta.full && height > vp.height) Object.assign(opts, { fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: Math.min(height, 2400) } });
    await withTimeout(page.screenshot(opts), 10000, "screenshot");
    const shot = { file, page: page.url(), viewport: meta.viewport, label: meta.label, step: meta.step, flow: meta.flow };
    sink.shots.push(shot);
    emit("shot", shot);
    return file;
  } catch (e) {
    emit("log", { level: "warn", msg: `screenshot failed: ${e.message}` });
    return undefined;
  }
}

export async function safeEval(page, fn, arg, ms = 5000) {
  return withTimeout(page.evaluate(fn, arg), ms, "page evaluate");
}

/** Visit one page at one viewport and run every deterministic check. */
export async function visit(context, sink, url, viewport, label) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORTS[viewport]);
  instrument(page, sink, viewport);
  const started = Date.now();
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: 20000 });
    status = res ? res.status() : null;
    await page.waitForTimeout(700);
    const title = await safeEval(page, () => document.title).catch(() => "");
    sink.pages.push({ url, status, title, ms: Date.now() - started, viewport });
    emit("page", { url, status, title, viewport, ms: Date.now() - started });
    await shoot(page, sink, { viewport, label, full: true });
    if (viewport === "desktop") {
      for (const f of await safeEval(page, auditInPage).catch(() => [])) sink.signals.push({ ...f, page: url, viewport });
      sink.dom[url] = await safeEval(page, domDigestInPage).catch(() => "");
      for (const l of await safeEval(page, linksInPage).catch(() => [])) sink.links.push({ url: l.href, status: null, from: url, text: l.text });
    } else {
      const ov = await safeEval(page, overflowInPage).catch(() => null);
      if (ov)
        sink.signals.push({
          kind: "overflow",
          page: url,
          viewport,
          message: `horizontal overflow at ${ov.viewport}px: content is ${ov.scrollWidth}px wide${ov.culprits.length ? " (" + ov.culprits.map((c) => c.selector).join(", ") + ")" : ""}`,
          detail: ov,
        });
    }
  } catch (e) {
    sink.signals.push({ kind: "unresponsive", page: url, viewport, message: `page did not settle: ${e.message.split("\n")[0]}`.slice(0, 300) });
    emit("page", { url, status, viewport, error: e.message.split("\n")[0] });
  } finally {
    await withTimeout(page.close({ runBeforeUnload: false }), 5000, "close").catch(() => {});
  }
}

export async function snapshot(page) {
  return safeEval(page, snapshotInPage, 40, 6000);
}

export { formsInPage, linksInPage };
