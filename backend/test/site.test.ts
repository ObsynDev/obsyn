import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { Hono } from "hono";
import { createSite } from "../src/site.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Obsyn</title>");
  writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(join(dir, "secret.txt"), "do not serve");
  const api = new Hono();
  api.get("/health", (c) => c.json({ ok: true }));
  return createSite(api, dist);
}

it("serves the API under /api", async () => {
  const res = await setup().request("/api/health");
  assert.deepEqual(await res.json(), { ok: true });
});

it("serves built assets with long cache and the right type", async () => {
  const res = await setup().request("/assets/app-abc.js");
  assert.equal(res.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
});

it("falls back to index.html for client routes", async () => {
  const res = await setup().request("/bid/xyz");
  assert.match(await res.text(), /<title>Obsyn<\/title>/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});

it("never serves files outside the build folder", async () => {
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
    const body = await (await setup().request(p)).text();
    assert.doesNotMatch(body, /do not serve/, p);
  }
});

it("publishes the MCP Registry domain proof (a public key) for obsyn.trade", async () => {
  const res = await setup().request("/.well-known/mcp-registry-auth");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^v=MCPv1; k=ed25519; p=[A-Za-z0-9+/]{43}=$/);
});

it("previews a deal receipt with its own share card", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><title>Obsyn</title><meta property="og:image" content="https://obsyn.trade/brand/og.png" /><meta name="twitter:image" content="https://obsyn.trade/brand/og.png" />',
  );
  const site = createSite(new Hono(), dist, "https://obsyn.trade");
  const tx = `0x${"ab".repeat(32)}`;
  const html = await (await site.request(`/receipt/${tx}`)).text();
  assert.match(html, new RegExp(`og:image" content="https://obsyn.trade/api/receipts/${tx}/card.png`));
  assert.match(html, new RegExp(`twitter:image" content="https://obsyn.trade/api/receipts/${tx}/card.png`));
  assert.match(html, /<title>Private block settled on Obsyn<\/title>/);
  // an open block's public link previews with its own card
  const block = await (await site.request("/rfq/AbC-123_xyz")).text();
  assert.match(block, /og:image" content="https:\/\/obsyn.trade\/api\/rfqs\/AbC-123_xyz\/card.png/);
  assert.match(block, /<title>Private OTC block on Obsyn<\/title>/);
  // other pages keep the site image
  assert.match(await (await site.request("/bid/x")).text(), /brand\/og.png/);
});
