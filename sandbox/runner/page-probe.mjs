// Functions evaluated inside the page. They only read the DOM; they never execute page-provided code.

export function snapshotInPage(maxEls) {
  const cssPath = (el) => {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    const tid = el.getAttribute("data-testid");
    if (tid) return `[data-testid="${tid}"]`;
    const nm = el.getAttribute("name");
    if (nm && document.querySelectorAll(`${el.tagName.toLowerCase()}[name="${nm}"]`).length === 1) return `${el.tagName.toLowerCase()}[name="${nm}"]`;
    const href = el.tagName === "A" ? el.getAttribute("href") : null;
    if (href && document.querySelectorAll(`a[href="${href}"]`).length === 1) return `a[href="${href}"]`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
      let sel = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      const sibs = cur.parentElement ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName) : [];
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      parts.unshift(sel);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  const isShown = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
  };
  document.querySelectorAll("[data-bd-ref]").forEach((e) => e.removeAttribute("data-bd-ref"));
  const els = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=link], [onclick]"));
  const elements = [];
  let ref = 0;
  for (const el of els) {
    if (!isShown(el)) continue;
    if (el.tagName === "INPUT" && el.type === "hidden") continue;
    ref++;
    el.setAttribute("data-bd-ref", String(ref));
    const label = (el.labels && el.labels[0] && el.labels[0].innerText) || "";
    const name = (
      el.getAttribute("aria-label") ||
      el.innerText ||
      (el.tagName === "INPUT" && ["submit", "button"].includes(el.type) ? el.value : "") ||
      el.getAttribute("placeholder") ||
      label ||
      el.getAttribute("title") ||
      el.getAttribute("name") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    elements.push({
      ref,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || undefined,
      name,
      href: el.getAttribute("href") || undefined,
      label: label.trim().slice(0, 60) || undefined,
      selector: cssPath(el),
      options: el.tagName === "SELECT" ? Array.from(el.options).slice(0, 8).map((o) => o.value) : undefined,
    });
    if (elements.length >= maxEls) break;
  }
  const visibleText = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim().slice(0, 2000);

  // Text a human cannot see but a naive agent would read: hidden nodes, tiny or transparent text, comments.
  const hidden = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  let n;
  let budget = 3000;
  while ((n = walker.nextNode()) && budget > 0) {
    const txt = (n.nodeValue || "").replace(/\s+/g, " ").trim();
    if (txt.length < 12) continue;
    if (n.nodeType === Node.COMMENT_NODE) {
      hidden.push({ how: "html-comment", text: txt.slice(0, 400) });
      budget -= txt.length;
      continue;
    }
    const p = n.parentElement;
    if (!p || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(p.tagName)) continue;
    const st = getComputedStyle(p);
    const r = p.getBoundingClientRect();
    let how = null;
    if (st.display === "none" || p.closest("[hidden]")) how = "display-none";
    else if (st.visibility === "hidden") how = "visibility-hidden";
    else if (Number(st.opacity) < 0.05) how = "transparent";
    else if (parseFloat(st.fontSize) < 3) how = "tiny-font";
    else if (r.right < 0 || r.bottom < 0 || r.left > 5000) how = "off-screen";
    else if (p.closest("[aria-hidden=true]")) how = "aria-hidden";
    else if (st.color === st.backgroundColor && st.color !== "rgba(0, 0, 0, 0)") how = "same-color";
    if (how) {
      hidden.push({ how, text: txt.slice(0, 400) });
      budget -= txt.length;
    }
  }
  return { url: location.href, title: document.title, elements, visibleText, hiddenText: hidden.slice(0, 12) };
}

export function auditInPage() {
  const out = [];
  const short = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
  };
  if (!document.documentElement.getAttribute("lang")) out.push({ kind: "a11y", message: "html element has no lang attribute", detail: { rule: "html-lang" } });
  for (const img of Array.from(document.images)) {
    if (!shown(img)) continue;
    if (!img.hasAttribute("alt") && img.getAttribute("role") !== "presentation")
      out.push({ kind: "a11y", message: `image has no alt text: ${img.getAttribute("src") || ""}`.slice(0, 160), detail: { rule: "img-alt", selector: short(img) } });
    if (img.complete && img.naturalWidth === 0)
      out.push({ kind: "broken_media", message: `image failed to render: ${img.getAttribute("src") || ""}`.slice(0, 160), detail: { selector: short(img), src: img.currentSrc || img.src } });
  }
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    if (!shown(el) || ["hidden", "submit", "button", "reset", "image"].includes(el.type)) continue;
    const named = (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title");
    if (!named) out.push({ kind: "a11y", message: `form field has no label: ${short(el)}${el.name ? " name=" + el.name : ""}`, detail: { rule: "label", selector: short(el) } });
  }
  for (const el of Array.from(document.querySelectorAll("button, a[href], [role=button]"))) {
    if (!shown(el)) continue;
    const name = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    const hasImgAlt = Array.from(el.querySelectorAll("img[alt]")).some((i) => i.alt.trim());
    if (!name && !hasImgAlt) out.push({ kind: "a11y", message: `interactive element has no accessible name: ${short(el)}`, detail: { rule: "name", selector: short(el) } });
  }
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (el) => {
    let cur = el;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.5) return c;
      cur = cur.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  let contrastHits = 0;
  for (const el of Array.from(document.querySelectorAll("p, span, a, li, td, th, h1, h2, h3, h4, label, button, small, strong, em, div"))) {
    if (contrastHits >= 4) break;
    if (!shown(el)) continue;
    const direct = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.nodeValue.trim().length > 2);
    if (!direct) continue;
    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (!fg || fg.a < 0.5 || Number(st.opacity) < 0.5) continue;
    const bg = bgOf(el);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = parseFloat(st.fontSize) >= 24 || (parseFloat(st.fontSize) >= 18.6 && Number(st.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      contrastHits++;
      out.push({
        kind: "a11y",
        message: `low text contrast ${ratio.toFixed(2)}:1 on ${short(el)} "${el.innerText.trim().slice(0, 40)}"`,
        detail: { rule: "contrast", ratio: Number(ratio.toFixed(2)), selector: short(el), color: st.color },
      });
    }
  }
  const ids = {};
  for (const el of Array.from(document.querySelectorAll("[id]"))) ids[el.id] = (ids[el.id] || 0) + 1;
  const dups = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) out.push({ kind: "a11y", message: `duplicate id values: ${dups.slice(0, 5).join(", ")}`, detail: { rule: "duplicate-id" } });
  return out;
}

export function overflowInPage() {
  const vw = window.innerWidth;
  const sw = document.documentElement.scrollWidth;
  if (sw <= vw + 2) return null;
  const culprits = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
      const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2;
      if (!parentOver || el.parentElement === document.body) {
        const id = el.id ? "#" + el.id : "";
        const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : "";
        culprits.push({ selector: el.tagName.toLowerCase() + id + cls, right: Math.round(r.right), width: Math.round(r.width) });
      }
    }
    if (culprits.length >= 3) break;
  }
  return { viewport: vw, scrollWidth: sw, culprits };
}

export function linksInPage() {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((a) => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 60) }))
    .filter((l) => /^https?:/.test(l.href));
}

export function formsInPage() {
  return Array.from(document.forms)
    .slice(0, 6)
    .map((f) => ({
      action: f.getAttribute("action") || "",
      method: (f.getAttribute("method") || "get").toLowerCase(),
      fields: Array.from(f.elements)
        .slice(0, 12)
        .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || "", name: e.name || "", required: !!e.required })),
    }));
}

export function domDigestInPage() {
  const clone = document.body ? document.body.cloneNode(true) : document.createElement("body");
  clone.querySelectorAll("script, style, svg, noscript").forEach((e) => e.remove());
  return clone.outerHTML.replace(/\s+/g, " ").slice(0, 6000);
}
