import { existsSync, readFileSync, statSync } from "node:fs";
import { renderIndex, type SiteFacts } from "./seo.ts";
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
  // dexscreener.com: the live $OBSYN chart embedded in the token section
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://keys.coinbase.com https://dexscreener.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=Dct4VSoOa08JLHyDCwe3AkUWvq47drFCWm5XXQegNI4=";

/**
 * One public origin: the API under /api, the built web app everywhere else.
 * Unknown paths fall back to index.html so client-side routes (/bid/…, /rfq/…) work on reload.
 */
export function createSite(api: Hono, webDist: string | null, publicUrl = "", facts: SiteFacts = {}) {
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

  // Proof that obsyn.trade owns the trade.obsyn/* names in the official MCP Registry.
  // Public key only; the signing key never leaves the publisher's machine.
  site.get("/.well-known/mcp-registry-auth", (c) => c.text(MCP_REGISTRY_AUTH));

  site.route("/api", api);
  // an unknown API path is a 404 in JSON, never the web app's HTML
  site.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  const root = webDist ? resolve(webDist) : null;
  if (!root || !existsSync(join(root, "index.html"))) {
    site.get("/", (c) => c.text("API is running at /api. Web app not built."));
    return site;
  }
  // Read per request (it is tiny) so a rebuilt dist never serves a stale index pointing at deleted assets.
  const index = (path: string) => renderIndex(readFileSync(join(root, "index.html"), "utf8"), path, publicUrl.replace(/\/+$/, ""), facts);

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
    let html = index(rel);
    // a deal receipt previews as its own share card on X and elsewhere
    const rx = /^\/receipt\/(0x[0-9a-fA-F]{64})\/?$/.exec(rel);
    if (rx) {
      const origin = publicUrl.replace(/\/+$/, "") || new URL(c.req.url).origin;
      const card = `${origin}/api/receipts/${rx[1]}/card.png`;
      const title = "Private block settled on Obsyn";
      const desc = "One price, no slippage, settled in one transaction on Robinhood Chain. See how it compares with a DEX market order.";
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
        .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${title}`)
        .replace(/(<meta property="og:description" content=")[^"]*/, `$1${desc}`)
        .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${desc}`)
        .replace(/(<meta property="og:url" content=")[^"]*/, `$1${origin}${rel}`)
        .replace(/(<meta property="og:image" content=")[^"]*/, `$1${card}`)
        .replace(/(<meta name="twitter:image" content=")[^"]*/, `$1${card}`);
    }
    // an open block's share link previews as its own card (size and token, never a price)
    const bx = /^\/rfq\/([\w-]{6,64})\/?$/.exec(rel);
    if (bx) {
      const origin = publicUrl.replace(/\/+$/, "") || new URL(c.req.url).origin;
      const card = `${origin}/api/rfqs/${bx[1]}/card.png`;
      const title = "Private OTC block on Obsyn";
      const desc = "Answer with a sealed price. Only the poster reads it; the deal settles in one transaction through an escrow with no admin key.";
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
        .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
        .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${title}`)
        .replace(/(<meta property="og:description" content=")[^"]*/, `$1${desc}`)
        .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${desc}`)
        .replace(/(<meta property="og:url" content=")[^"]*/, `$1${origin}${rel}`)
        .replace(/(<meta property="og:image" content=")[^"]*/, `$1${card}`)
        .replace(/(<meta name="twitter:image" content=")[^"]*/, `$1${card}`);
    }
    return c.body(html, 200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
  });

  return site;
}
