import { existsSync, readFileSync, statSync } from "node:fs";
import { renderIndex } from "./seo.ts";
import { extname, join, resolve, sep } from "node:path";
import { Hono } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Content Security Policy for the web app. Scripts only from our own origin (Vite bundles
 * everything); styles allow inline because React and the wallet modal set style attributes;
 * network calls may go to https/wss because wallets reach their own relays and RPCs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://keys.coinbase.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * One public origin: the API under /api, the built web app everywhere else.
 * Unknown paths fall back to index.html so client-side routes (/bid/…, /rfq/…) work on reload.
 */
export function createSite(api: Hono, webDist: string | null, publicUrl = "") {
  const site = new Hono();

  site.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    // wallet SDKs (Coinbase, WalletConnect) open popups and need to talk back to us
    c.header("cross-origin-opener-policy", "same-origin-allow-popups");
    c.header("content-security-policy", CSP);
  });

  site.route("/api", api);

  const root = webDist ? resolve(webDist) : null;
  if (!root || !existsSync(join(root, "index.html"))) {
    site.get("/", (c) => c.text("API is running at /api. Web app not built."));
    return site;
  }
  // Read per request (it is tiny) so a rebuilt dist never serves a stale index pointing at deleted assets.
  const index = (path: string) => renderIndex(readFileSync(join(root, "index.html"), "utf8"), path, publicUrl.replace(/\/+$/, ""));

  site.get("*", (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("bad request", 400); // malformed percent-encoding
    }
    const file = resolve(root, "." + rel);
    // path traversal guard: never serve outside the build folder
    if ((file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile()) {
      const immutable = rel.startsWith("/assets/"); // hashed filenames from vite
      return c.body(readFileSync(file), 200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      });
    }
    return c.body(index(rel), 200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
  });

  return site;
}
