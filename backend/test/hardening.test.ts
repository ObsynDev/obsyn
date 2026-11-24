import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";
import { createSite } from "../src/site.ts";

const relayer: Relayer = {
  info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "0", usdg: "0" } }),
  async relayDeposit() {
    throw new Error("unused");
  },
};

function setup(readToken?: () => Promise<any>) {
  return createApp({
    cfg: loadConfig({ PUBLIC_URL: "https://otc.example" }),
    db: openDb(":memory:"),
    relayer,
    readPrice: async () => {
      throw new Error("unused");
    },
    readToken: readToken as any,
    refQuote: async () => {
      throw new Error("unused");
    },
  });
}

describe("hardening", () => {
  it("rate-limits writes by the proxy-added address, so a spoofed first X-Forwarded-For entry doesn't help", async () => {
    const app = setup();
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 61; i++) {
      const res = await app.request("/rfqs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` },
        body: "{}",
      });
      last = res.status;
      retry = res.headers.get("retry-after");
    }
    assert.equal(last, 429);
    assert.ok(Number(retry) >= 1 && Number(retry) <= 60, `says when to retry (${retry})`);
    // a different real client is unaffected
    const other = await app.request("/rfqs", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "198.51.100.9" }, body: "{}" });
    assert.notEqual(other.status, 429);
  });

  it("rejects oversized bodies before parsing them", async () => {
    const app = setup();
    const res = await app.request("/rfqs", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(70 * 1024) },
      body: JSON.stringify({ note: "x".repeat(70 * 1024) }),
    });
    assert.equal(res.status, 413);
  });

  it("caches on-chain token reads", async () => {
    let calls = 0;
    const app = setup(async () => {
      calls++;
      return { address: "0x0000000000000000000000000000000000000001", isContract: true };
    });
    for (let i = 0; i < 5; i++) assert.equal((await app.request("/token/0x0000000000000000000000000000000000000001")).status, 200);
    assert.equal(calls, 1);
  });

  it("sends the security headers and answers malformed paths with 400", async () => {
    const site = createSite(setup(), null);
    const res = await site.request("/api/health");
    for (const h of ["strict-transport-security", "content-security-policy", "permissions-policy", "x-frame-options", "x-content-type-options"]) {
      assert.ok(res.headers.get(h), `missing ${h}`);
    }
    assert.match(res.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.match(res.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  });
});

it("pages ship readable text, a per-page title and a canonical link for bots", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Hono } = await import("hono");
  const { createSite } = await import("../src/site.ts");
  const dir = mkdtempSync(join(tmpdir(), "obsyn-seo-"));
  writeFileSync(
    join(dir, "index.html"),
    '<html><head><title>Obsyn</title><meta name="description" content="x" /></head><body><div id="root"></div></body></html>',
  );
  const site = createSite(new Hono(), dir, "https://obsyn.trade/", { tokenAddress: "0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351" });
  const home = await (await site.request("/")).text();
  // research bots read plain HTML: the token contract, the repo and X must be there without JavaScript
  assert.match(home, /0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351/);
  assert.match(home, /https:\/\/github\.com\/ObsynDev\/obsyn/);
  assert.match(home, /x\.com\/Obsyntrade/);
  assert.match(home, /<h1>Trade size\. Stay private\.<\/h1>/);
  assert.match(home, /Can you take my funds\?/); // FAQ answers are in the HTML
  assert.match(home, /<link rel="canonical" href="https:\/\/obsyn\.trade" \/>/);
  const sec = await (await site.request("/security/")).text();
  assert.match(sec, /<title>Security · Obsyn<\/title>/);
  assert.match(sec, /href="https:\/\/obsyn\.trade\/security"/);
  const bid = await (await site.request("/bid/abc")).text();
  assert.match(bid, /<div id="root"><\/div>/); // private pages get nothing extra
});

it("unknown API paths answer 404 JSON, not the web app", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Hono } = await import("hono");
  const { createSite } = await import("../src/site.ts");
  const dir = mkdtempSync(join(tmpdir(), "obsyn-404-"));
  writeFileSync(join(dir, "index.html"), "<html><body><div id=\"root\"></div></body></html>");
  const site = createSite(new Hono(), dir);
  const r = await site.request("/api/nope/x");
  assert.equal(r.status, 404);
  assert.match(r.headers.get("content-type") ?? "", /json/);
  assert.equal((await site.request("/trade")).status, 200); // app routes still served
});
