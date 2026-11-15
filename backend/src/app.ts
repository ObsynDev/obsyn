import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openapi } from "./openapi.ts";
import type { Config } from "./config.ts";
import type { QuoteRow, RfqRow } from "./db.ts";
import { parseSource, type PriceQuote, type PriceSource, type TokenInfo } from "./price.ts";
import { NO_PERMIT, RelayError, type Relayer } from "./relayer.ts";
import { hashToken, isB64, newId, newToken, tokenMatches } from "./secrets.ts";
import { dealId, termsToJson, TermsSchema } from "./terms.ts";

export interface Deps {
  cfg: Config;
  db: DatabaseSync;
  relayer: Relayer;
  readPrice: (token: Address, src: PriceSource) => Promise<PriceQuote>;
  readToken?: (token: Address) => Promise<TokenInfo>;
  now?: () => number; // unix seconds, injectable for tests
}

const MIN_REPLY = 15 * 60;
const MAX_REPLY = 24 * 60 * 60;
const ACCEPT_GRACE = 24 * 60 * 60; // buyer may accept up to 24h after the reply window closes
const MAX_DEAL_WINDOW = 7 * 24 * 60 * 60;
const MAX_QUOTES_PER_RFQ = 100;
const MAX_CIPHERTEXT_B64 = 4096;

class BadRequest extends Error {}

const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

function publicRfq(r: RfqRow, quoteCount: number) {
  return {
    id: r.id,
    side: r.side,
    token: r.token,
    payToken: r.pay_token,
    amount: r.amount,
    sizeUsd: r.size_usd,
    note: r.note,
    /** The poster's NaCl box key: encrypt answers to this. */
    encPubKey: r.buyer_enc_pubkey,
    /** @deprecated same as encPubKey (kept for older clients) */
    buyerEncPubKey: r.buyer_enc_pubkey,
    expiresAt: r.expires_at,
    status: r.status,
    quoteCount,
  };
}

export function createApp(deps: Deps) {
  const { cfg, db, relayer } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono();

  // Open CORS is safe here: there are no cookies or ambient credentials, every privileged
  // call carries its own bearer capability. It lets the SDK run on any site.
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "authorization"], maxAge: 600 }));

  // ── tiny per-client rate limit on writes ──
  const hits = new Map<string, { n: number; reset: number }>();
  app.use("*", async (c, next) => {
    if (c.req.method === "POST") {
      const key = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const t = now();
      const h = hits.get(key);
      if (!h || h.reset <= t) hits.set(key, { n: 1, reset: t + 60 });
      else if (++h.n > 60) return c.json({ error: "rate limited" }, 429);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    if (err instanceof RelayError) return c.json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ error: "invalid JSON" }, 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  const getRfq = db.prepare("SELECT * FROM rfqs WHERE id = ?");
  const countQuotes = db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE rfq_id = ?");
  const rfq = (id: string) => getRfq.get(id) as unknown as RfqRow | undefined;
  const quoteCount = (id: string) => Number((countQuotes.get(id) as { n: number }).n);

  const payTokenFor = (v: string): Address => {
    if (v === "ETH") return zeroAddress;
    if (v === "USDG") {
      if (!cfg.usdg) throw new BadRequest("USDG is not configured on this server");
      return cfg.usdg;
    }
    const a = isAddress(v) ? getAddress(v) : null;
    if (a === null || (a !== zeroAddress && a !== cfg.usdg)) throw new BadRequest("payToken must be ETH or USDG");
    return a;
  };

  app.get("/health", (c) =>
    c.json({ ok: true, chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, escrow: cfg.escrow, usdg: cfg.usdg, relayer: relayer.info() }),
  );

  // ─────────────────────────── RFQs (buyer bids) ───────────────────────────

  const CreateRfq = z
    .object({
      side: z.enum(["buy", "sell"]).default("buy"),
      token: z.string().refine(isAddress, "invalid token address"),
      payToken: z.string(),
      amount: z.string().regex(/^[1-9]\d*$/).optional(),
      sizeUsd: z.number().positive().max(1e12).optional(),
      replySeconds: z.number().int().min(MIN_REPLY).max(MAX_REPLY),
      encPubKey: z.string().refine((s) => isB64(s, 32), "must be a base64 32-byte NaCl box public key").optional(),
      buyerEncPubKey: z.string().refine((s) => isB64(s, 32), "must be a base64 32-byte NaCl box public key").optional(),
      note: z.string().max(280).optional(),
    })
    .refine((v) => v.encPubKey || v.buyerEncPubKey, "give encPubKey")
    .refine((v) => v.amount || (v.side === "buy" && v.sizeUsd), "give amount (token base units); buy bids may give sizeUsd instead");

  app.post("/rfqs", async (c) => {
    const body = CreateRfq.parse(await c.req.json());
    const id = newId();
    const manageToken = newToken();
    const t = now();
    db.prepare(
      `INSERT INTO rfqs (id, side, manage_hash, token, pay_token, amount, size_usd, buyer_enc_pubkey, note, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.side,
      hashToken(manageToken),
      getAddress(body.token),
      payTokenFor(body.payToken),
      body.amount ?? null,
      body.sizeUsd ?? null,
      (body.encPubKey ?? body.buyerEncPubKey)!,
      body.note ?? null,
      t + body.replySeconds,
      t,
    );
    // The manage token is shown once. The share link carries no secret: the other side only needs the id.
    return c.json({ id, manageToken, shareUrl: `${cfg.publicUrl}/rfq/${id}`, expiresAt: t + body.replySeconds }, 201);
  });

  /** "Where demand is forming": open bids (side=buy) and sell listings (side=sell), newest first. */
  app.get("/rfqs", (c) => {
    const token = c.req.query("token");
    const side = c.req.query("side");
    const where = ["status = 'open'", "expires_at > ?"];
    const args: (string | number)[] = [now()];
    if (token && isAddress(token)) {
      where.push("token = ?");
      args.push(getAddress(token));
    }
    if (side === "buy" || side === "sell") {
      where.push("side = ?");
      args.push(side);
    }
    // where[] holds only fixed SQL fragments; all values go through placeholders.
    const rows = db
      .prepare(`SELECT * FROM rfqs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 100`)
      .all(...args) as unknown as RfqRow[];
    return c.json(rows.map((r) => publicRfq(r, quoteCount(r.id))));
  });

  app.get("/rfqs/:id", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    return c.json(publicRfq(r, quoteCount(r.id)));
  });

  app.post("/rfqs/:id/cancel", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    if (r.status !== "open") return c.json({ error: `rfq is ${r.status}` }, 409);
    db.prepare("UPDATE rfqs SET status = 'cancelled' WHERE id = ?").run(r.id);
    db.prepare("UPDATE quotes SET status = 'rejected' WHERE rfq_id = ?").run(r.id);
    return c.json({ ok: true });
  });

  // ─────────────────────────── sealed quotes (seller offers) ───────────────────────────

  const CreateQuote = z.object({
    sellerEncPubKey: z.string().refine((s) => isB64(s, 32), "must be a base64 32-byte NaCl box public key"),
    nonce: z.string().refine((s) => isB64(s, 24), "must be a base64 24-byte nonce"),
    ciphertext: z.string().max(MAX_CIPHERTEXT_B64).refine((s) => isB64(s), "must be base64"),
  });

  /**
   * The seller encrypts their offer to the buyer's public key (nacl.box) in the browser.
   * The server only ever sees ciphertext: it can't read prices, and nobody else can front-run them.
   */
  app.post("/rfqs/:id/quotes", async (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (r.status !== "open" || r.expires_at <= now()) return c.json({ error: "rfq is closed" }, 409);
    if (quoteCount(r.id) >= MAX_QUOTES_PER_RFQ) return c.json({ error: "too many quotes on this rfq" }, 409);
    const body = CreateQuote.parse(await c.req.json());
    const id = newId();
    const quoteToken = newToken();
    db.prepare(
      `INSERT INTO quotes (id, rfq_id, quote_hash, seller_enc_pubkey, nonce, ciphertext, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, r.id, hashToken(quoteToken), body.sellerEncPubKey, body.nonce, body.ciphertext, now());
    return c.json({ quoteId: id, quoteToken }, 201);
  });

  /** The poster reads the sealed answers (still encrypted; decrypted client-side). */
  app.get("/rfqs/:id/quotes", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    const rows = db.prepare("SELECT * FROM quotes WHERE rfq_id = ? ORDER BY created_at").all(r.id) as unknown as QuoteRow[];
    return c.json(
      rows.map((q) => ({
        id: q.id,
        sellerEncPubKey: q.seller_enc_pubkey,
        nonce: q.nonce,
        ciphertext: q.ciphertext,
        createdAt: q.created_at,
        status: q.status,
      })),
    );
  });

  const Accept = z.object({ quoteId: z.string().min(1), terms: TermsSchema });

  /** The poster picks an answer and fixes the on-chain terms both sides will deposit against. */
  app.post("/rfqs/:id/accept", async (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    if (r.status !== "open") return c.json({ error: `rfq is ${r.status}` }, 409);
    if (now() > r.expires_at + ACCEPT_GRACE) return c.json({ error: "acceptance window has passed" }, 409);

    const { quoteId, terms } = Accept.parse(await c.req.json());
    const q = db.prepare("SELECT * FROM quotes WHERE id = ? AND rfq_id = ?").get(quoteId, r.id) as unknown as
      | QuoteRow
      | undefined;
    if (!q) return c.json({ error: "quote not found" }, 404);

    const problems: string[] = [];
    if (terms.token !== r.token) problems.push("terms.token differs from the rfq token");
    if (terms.payToken !== r.pay_token) problems.push("terms.payToken differs from the rfq payToken");
    if (r.amount && terms.amount !== BigInt(r.amount)) problems.push("terms.amount differs from the rfq amount");
    if (terms.deadline <= BigInt(now() + 60)) problems.push("terms.deadline must be at least 60s away");
    if (terms.deadline > BigInt(now() + MAX_DEAL_WINDOW)) problems.push("terms.deadline is more than 7 days away");
    if (terms.buyer === terms.seller) problems.push("buyer and seller must differ");
    if (problems.length) return c.json({ error: "invalid terms", problems }, 400);

    const id = dealId(terms);
    const termsJson = JSON.stringify(termsToJson(terms));
    db.exec("BEGIN");
    try {
      const res = db
        .prepare("UPDATE rfqs SET status = 'accepted', accepted_quote_id = ?, deal_id = ?, terms_json = ? WHERE id = ? AND status = 'open'")
        .run(q.id, id, termsJson, r.id);
      if (Number(res.changes) !== 1) throw new Error("race");
      db.prepare("UPDATE quotes SET status = CASE WHEN id = ? THEN 'accepted' ELSE 'rejected' END WHERE rfq_id = ?").run(q.id, r.id);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      return c.json({ error: "rfq is no longer open" }, 409);
    }
    return c.json({ dealId: id, terms: termsToJson(terms), escrow: cfg.escrow, chainId: cfg.chainId });
  });

  /** The poster re-reads the accepted deal (e.g. after reopening their private link). */
  app.get("/rfqs/:id/deal", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    if (r.status !== "accepted" || !r.terms_json) return c.json({ error: "no accepted deal yet" }, 404);
    return c.json({
      dealId: r.deal_id,
      quoteId: r.accepted_quote_id,
      terms: JSON.parse(r.terms_json),
      escrow: cfg.escrow,
      chainId: cfg.chainId,
    });
  });

  /** The responder checks on their quote; once accepted they get the exact terms to deposit against. */
  app.get("/quotes/:id", (c) => {
    const q = db.prepare("SELECT * FROM quotes WHERE id = ?").get(c.req.param("id")) as unknown as QuoteRow | undefined;
    if (!q) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), q.quote_hash)) return c.json({ error: "unauthorized" }, 401);
    const r = rfq(q.rfq_id)!;
    const won = q.status === "accepted";
    return c.json({
      id: q.id,
      status: q.status,
      rfq: publicRfq(r, quoteCount(r.id)),
      dealId: won ? r.deal_id : null,
      terms: won && r.terms_json ? JSON.parse(r.terms_json) : null,
      escrow: cfg.escrow,
      chainId: cfg.chainId,
    });
  });

  // ─────────────────────────── ghost-mode relayer ───────────────────────────

  app.get("/relay", (c) => c.json(relayer.info()));

  const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as Hex);
  const RelayBody = z.object({
    terms: TermsSchema,
    sellerSig: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "65-byte hex signature").transform((s) => s as Hex),
    permit: z
      .object({
        deadline: z.union([z.string().regex(/^\d+$/), z.number().int()]).transform((v) => BigInt(v)),
        v: z.number().int().min(27).max(28),
        r: hex32,
        s: hex32,
      })
      .optional(),
  });

  app.post("/relay/deposit", async (c) => {
    const body = RelayBody.parse(await c.req.json());
    const res = await relayer.relayDeposit(body.terms, body.permit ?? NO_PERMIT, body.sellerSig);
    return c.json(res, 202);
  });

  // ─────────────────────────── docs & SDK ───────────────────────────

  app.get("/openapi.json", (c) => c.json(openapi));

  app.get("/sdk/blockotc.mjs", (c) => {
    try {
      const js = readFileSync(new URL("../dist/sdk/blockotc.mjs", import.meta.url), "utf8");
      return c.body(js, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
    } catch {
      return c.json({ error: "SDK not built; run npm run build:sdk" }, 404);
    }
  });

  // ─────────────────────────── on-chain reference price ───────────────────────────

  /** ERC-20 facts read on-chain by the server (useful when a client's own RPC is blocked). */
  app.get("/token/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid address" }, 400);
    if (!deps.readToken) return c.json({ error: "token reads not configured" }, 503);
    try {
      return c.json(await deps.readToken(getAddress(a)));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.get("/price/:token", async (c) => {
    const token = c.req.param("token");
    if (!isAddress(token)) return c.json({ error: "invalid token address" }, 400);
    let src: PriceSource;
    try {
      src = parseSource(c.req.query("source") ?? "");
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    try {
      return c.json(await deps.readPrice(getAddress(token), src));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}
