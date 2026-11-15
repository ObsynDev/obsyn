import { existsSync, readFileSync, statSync } from "node:fs";
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
 * One public origin: the API under /api, the built web app everywhere else.
 * Unknown paths fall back to index.html so client-side routes (/bid/…, /rfq/…) work on reload.
 */
export function createSite(api: Hono, webDist: string | null) {
  const site = new Hono();

  site.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
  });

  site.route("/api", api);

  const root = webDist ? resolve(webDist) : null;
  if (!root || !existsSync(join(root, "index.html"))) {
    site.get("/", (c) => c.text("API is running at /api. Web app not built."));
    return site;
  }
  // Read per request (it is tiny) so a rebuilt dist never serves a stale index pointing at deleted assets.
  const index = () => readFileSync(join(root, "index.html"));

  site.get("*", (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    const file = resolve(root, "." + rel);
    // path traversal guard: never serve outside the build folder
    if ((file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile()) {
      const immutable = rel.startsWith("/assets/"); // hashed filenames from vite
      return c.body(readFileSync(file), 200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
      });
    }
    return c.body(index(), 200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
  });

  return site;
}
