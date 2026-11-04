// Gearbox Supply: a deliberately buggy demo shop. Every bug here is planted and listed in
// fixtures/shop/BUGS.md so the proof pack can score what the pipeline found.
const products = [
  { id: "p1", name: "Torque Wrench 3/8in", price: 64.0, img: "/img/wrench.svg", stock: 12 },
  { id: "p2", name: "Hex Driver Set", price: 29.5, img: "/img/hex.svg", stock: 40 },
  { id: "p3", name: "Shop Lamp 2000 lm", price: 89.0, img: "/img/lamp-missing.png", stock: 3 },
  { id: "p4", name: "Bench Vise 5in Heavy Duty Cast Iron Swivel Base", price: 119.0, img: "/img/vise.svg", stock: 0 },
];

const css = `
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Georgia,serif;background:#0f2a3d;color:#e9f1f7}
header{display:flex;gap:24px;align-items:center;padding:16px 24px;background:#081b28;border-bottom:4px solid #f2b705}
header a{color:#f2b705;text-decoration:none;font-weight:bold}
.brand{font-size:22px;letter-spacing:2px;margin-right:auto}
main{padding:24px;max-width:1100px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(4,260px);gap:20px}
.card{background:#163b54;padding:16px;border:2px solid #24597a}
.card img{width:100%;height:140px;object-fit:contain;background:#0b2232}
.card h3{margin:8px 0;white-space:nowrap}
.price{font-size:20px;color:#f2b705}
.promo{color:#1a4864;background:#163b54;padding:8px;font-size:13px}
button,.btn{background:#f2b705;color:#081b28;border:0;padding:10px 16px;font-weight:bold;cursor:pointer}
input{padding:8px;border:2px solid #24597a;background:#0b2232;color:#e9f1f7;width:100%;max-width:360px}
form label{display:block;margin-top:12px}
.err{color:#ff7b7b}
footer{padding:24px;color:#8fb3cc;font-size:13px}
`;

function page(title, body, extraHead = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style>${extraHead}</head><body>
<header><span class="brand">GEARBOX SUPPLY</span><a href="/">Shop</a><a href="/cart">Cart</a><a href="/contact">Contact</a><a href="/returns">Returns</a></header>
<main>${body}</main>
<footer>Gearbox Supply Co. <a href="/terms" style="color:#8fb3cc">Terms</a> <a href="/careers" style="color:#8fb3cc">Careers</a></footer>
</body></html>`;
}

const svg = (label, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140"><rect width="240" height="140" fill="#0b2232"/><rect x="60" y="30" width="120" height="80" fill="${color}"/><text x="120" y="128" fill="#e9f1f7" font-size="14" text-anchor="middle" font-family="monospace">${label}</text></svg>`;

const carts = new Map();
function cartOf(req) {
  const id = /cart=([a-z0-9]+)/.exec(req.headers.cookie || "")?.[1];
  return id && carts.has(id) ? { id, items: carts.get(id) } : null;
}

function readBody(req) {
  return new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c).length > 1e5 && req.destroy());
    req.on("end", () => r(Object.fromEntries(new URLSearchParams(b))));
  });
}

export async function shop(req, res) {
  const url = new URL(req.url, "http://shop.blastdoor.local");
  const send = (code, body, type = "text/html; charset=utf-8", headers = {}) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...headers });
    res.end(body);
  };
  const p = url.pathname;

  if (p === "/img/wrench.svg") return send(200, svg("WRENCH", "#c0392b"), "image/svg+xml");
  if (p === "/img/hex.svg") return send(200, svg("HEX SET", "#2e86de"), "image/svg+xml");
  if (p === "/img/vise.svg") return send(200, svg("VISE", "#7f8c8d"), "image/svg+xml");
  if (p === "/api/reviews") return send(500, JSON.stringify({ error: "reviews service unavailable" }), "application/json");
  if (p === "/api/stock") return send(200, JSON.stringify(Object.fromEntries(products.map((x) => [x.id, x.stock]))), "application/json");

  if (p === "/") {
    const cards = products
      .map(
        (x) => `<div class="card"><img src="${x.img}"${x.id === "p2" ? "" : ` alt="${x.name}"`}><h3>${x.name}</h3><div class="price">$${x.price.toFixed(2)}</div>
<form method="post" action="/cart/add"><input type="hidden" name="id" value="${x.id}"><button type="submit">Add to cart</button></form></div>`,
      )
      .join("");
    const script = `<script>
fetch('/api/reviews').then(r=>r.json()).then(d=>{document.getElementById('reviews').textContent=d.items.length+' reviews'}).catch(e=>console.error('reviews widget crashed: '+e.message));
window.addEventListener('load',()=>{ document.querySelector('.hero-cta').addEventListener('click',()=>{ trackClick('hero') }) });
</script>`;
    return send(
      200,
      page(
        "Gearbox Supply",
        `<h1>Tools that outlast the job</h1><p class="promo">FREE SHIPPING ON ORDERS OVER $100 THIS WEEK ONLY</p>
<p><a class="btn hero-cta" href="/cart">Go to cart</a> <span id="reviews">loading reviews</span></p><div class="grid">${cards}</div>${script}`,
      ),
    );
  }

  if (p === "/cart/add" && req.method === "POST") {
    const body = await readBody(req);
    const prod = products.find((x) => x.id === body.id);
    let c = cartOf(req);
    const headers = {};
    if (!c) {
      c = { id: Math.random().toString(36).slice(2, 10), items: [] };
      carts.set(c.id, c.items);
      headers["set-cookie"] = `cart=${c.id}; Path=/; HttpOnly; SameSite=Lax`;
    }
    if (prod) c.items.push(prod.id);
    return send(303, "", "text/plain", { ...headers, location: "/cart" });
  }

  if (p === "/cart") {
    const c = cartOf(req);
    const items = (c?.items ?? []).map((id) => products.find((x) => x.id === id));
    // Planted bug: subtotal drops the last item when the cart has more than one line.
    const subtotal = items.slice(0, items.length > 1 ? -1 : undefined).reduce((s, x) => s + x.price, 0);
    const rows = items.map((x) => `<li>${x.name} <span class="price">$${x.price.toFixed(2)}</span></li>`).join("");
    return send(
      200,
      page(
        "Cart | Gearbox Supply",
        items.length
          ? `<h1>Your cart</h1><ul>${rows}</ul><p>Subtotal: <strong id="subtotal">$${subtotal.toFixed(2)}</strong></p><a class="btn" href="/checkout">Checkout</a>`
          : `<h1>Your cart</h1><p>Your cart is empty.</p><a class="btn" href="/">Back to shop</a>`,
      ),
    );
  }

  if (p === "/checkout") {
    if (req.method === "POST") {
      const b = await readBody(req);
      // Planted bug: any non-empty email is accepted, and a bad zip crashes the order page.
      if (!b.email || !b.name) return send(200, page("Checkout", `<h1>Checkout</h1><p class="err">Something went wrong.</p>${checkoutForm()}`));
      if (!/^\d{5}$/.test(b.zip || "")) return send(500, page("Error", `<h1>Internal Server Error</h1><pre>TypeError: Cannot read properties of undefined (reading 'zone')\n    at shippingFor (/srv/shop/checkout.js:41:22)</pre>`));
      return send(200, page("Order placed", `<h1>Order placed</h1><p>Confirmation sent to ${escapeHtml(b.email)}.</p>`));
    }
    return send(200, page("Checkout | Gearbox Supply", `<h1>Checkout</h1>${checkoutForm()}`));
  }

  if (p === "/contact") {
    return send(
      200,
      page(
        "Contact | Gearbox Supply",
        `<h1>Contact</h1><form method="post" action="/contact/send"><input name="name" placeholder="Name"><label>Email<input name="email" type="email"></label><label>Message<textarea name="msg" rows="4" style="width:100%;max-width:360px"></textarea></label><button type="submit">Send</button></form>`,
      ),
    );
  }
  if (p === "/contact/send") return send(404, page("Not found", `<h1>404</h1><p>Page not found.</p>`));
  if (p === "/returns") return send(200, page("Returns | Gearbox Supply", `<h1>Returns</h1><p>Return any unused tool within 30 days. See our <a href="/returns/policy.pdf">full policy</a>.</p>`));
  if (p === "/terms") return send(200, page("Terms", `<h1>Terms</h1><p>All sales are subject to these terms.</p>`));
  return send(404, page("Not found", `<h1>404</h1><p>Page not found.</p>`));
}

function checkoutForm() {
  return `<form method="post" action="/checkout"><label>Full name<input name="name"></label><label>Email<input name="email" type="text"></label><label>ZIP code<input name="zip"></label><button type="submit">Place order</button></form>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
