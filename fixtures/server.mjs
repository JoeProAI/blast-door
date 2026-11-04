// Planted fixture sites. Bound to 127.0.0.1 only; sandboxes reach them through the egress proxy
// under fixture hostnames (shop.blastdoor.local, hostile.blastdoor.local).
import http from "node:http";
import { shop } from "./shop/app.mjs";

const host = process.env.BLASTDOOR_FIXTURE_HOST || "127.0.0.1";
const ports = {
  shop: Number(process.env.BLASTDOOR_SHOP_PORT || 8801),
};

http.createServer(shop).listen(ports.shop, host, () => console.log(JSON.stringify({ fixture: "shop", host, port: ports.shop })));
