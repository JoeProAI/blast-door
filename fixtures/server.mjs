// Planted fixture sites. Bound to 127.0.0.1 only; sandboxes reach them through the egress proxy
// under fixture hostnames (shop.blastdoor.local, hostile.blastdoor.local, attacker.blastdoor.local).
import http from "node:http";
import { shop } from "./shop/app.mjs";
import { attacker, hostile } from "./hostile/app.mjs";

const host = process.env.BLASTDOOR_FIXTURE_HOST || "127.0.0.1";
const ports = {
  shop: Number(process.env.BLASTDOOR_SHOP_PORT || 8801),
  hostile: Number(process.env.BLASTDOOR_HOSTILE_PORT || 8802),
  attacker: Number(process.env.BLASTDOOR_ATTACKER_PORT || 8803),
};
const apps = { shop, hostile, attacker };

for (const [name, app] of Object.entries(apps)) {
  http.createServer(app).listen(ports[name], host, () => console.log(JSON.stringify({ fixture: name, host, port: ports[name] })));
}
