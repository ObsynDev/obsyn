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
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>BlockOTC</title>");
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
  assert.match(await res.text(), /<title>BlockOTC<\/title>/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});

it("never serves files outside the build folder", async () => {
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt"]) {
    const body = await (await setup().request(p)).text();
    assert.doesNotMatch(body, /do not serve/, p);
  }
});
