import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openapi } from "./openapi.ts";
import type { Config } from "./config.ts";
import type { QuoteRow, RfqRow } from "./db.ts";
import { parseSource, type PriceQuote, type PriceSource, type TokenInfo } from "./price.ts";
import { createTokenMarkets, type TokenMarket } from "./dexmarket.ts";
import type { DealReceipt } from "./receipt.ts";
import { createStats, type StatsChain } from "./stats.ts";
import { createReferencePrices, findMarket, MARKETS, RANGES, type Range, type RefQuote } from "./markets.ts";
import { NO_PERMIT, RelayError, type Relayer } from "./relayer.ts";
import { hashToken, isB64, newId, newToken, tokenMatches } from "./secrets.ts";
import { dealId, termsToJson, TermsSchema } from "./terms.ts";
import { openVsDexStore, vsDex } from "./vsdex.ts";
import type { ControlReport } from "./control.ts";
import { openActivity } from "./activity.ts";

export interface Deps {
  cfg: Config;
  db: DatabaseSync;
  relayer: Relayer;
  readPrice: (token: Address, src: PriceSource) => Promise<PriceQuote>;
  readToken?: (token: Address) => Promise<TokenInfo>;
  /** delayed reference price of a market's underlying listing (defaults to a cached Yahoo reader) */
  refQuote?: (ticker: string, range: Range) => Promise<RefQuote>;
  /** DEX market snapshot of any token (defaults to cached DexScreener lookups) */
  tokenMarket?: (token: Address) => Promise<TokenMarket>;
  /** rebuild a settled deal's receipt from its settlement transaction */
  readReceipt?: (txHash: Hex) => Promise<DealReceipt>;
  /** a deal's state on an escrow: 0 none, 1 open, 2 settled, 3 refunded, and which sides have deposited */
  readDeal?: (escrow: Address, id: Hex) => Promise<{ status: number; buyerFunded: boolean; sellerFunded: boolean }>;
  /** on-chain reads for the stats and referral pages (deal status, fees, the fee vault) */
  statsChain?: StatsChain;
  /** live read of who controls the fee vault (owner, keeper, Safe, timelock and its queue) */
  controlReader?: () => Promise<ControlReport>;
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

function publicRfq(r: RfqRow, quoteCount: number, fills: { count: number; amount: string | null } = { count: 0, amount: null }) {
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
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.status,
    quoteCount,
    /** several answers can each fill part of this block */
    partial: !!r.partial,
    /** accepted fills so far, and (for a fixed size) how much of it they cover, in token base units */
    filled: fills.count,
    filledAmount: fills.amount,
  };
}

export function createApp(deps: Deps) {
  const { cfg, db, relayer } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono();

  // Open CORS is safe here: there are no cookies or ambient credentials, every privileged
  // call carries its own bearer capability. It lets the SDK run on any site.
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "authorization"], maxAge: 600 }));

  // Requests are capped in size before anything parses them (the largest valid body, a sealed
  // answer, is well under this).
  app.use("*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }));

  // ── tiny per-client rate limits: writes, and the routes that cost an RPC call ──
  // The client IP comes from the proxy: X-Real-IP, else the LAST X-Forwarded-For entry (the one the
  // proxy appended). The first entry is whatever the client sent, so it can't be trusted.
  const clientIp = (c: Context) =>
    c.req.header("x-real-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",").pop()?.trim() || "local";
  const hits = new Map<string, { n: number; reset: number }>();
  let lastPrune = 0;
  const limited = (key: string, max: number) => {
    const t = now();
    if (t - lastPrune > 60) {
      // forget expired windows so the map can't grow without bound
      for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      lastPrune = t;
    }
    const h = hits.get(key);
    if (!h || h.reset <= t) {
      hits.set(key, { n: 1, reset: t + 60 });
      return false;
    }
    return ++h.n > max;
  };
  app.use("*", async (c, next) => {
    const ip = clientIp(c);
    if (c.req.method === "POST" && limited(`w:${ip}`, 60)) return c.json({ error: "rate limited" }, 429);
    if (c.req.method === "GET" && /^\/(api\/)?(token|price|stats|referrals)/.test(c.req.path) && limited(`r:${ip}`, 120)) {
      return c.json({ error: "rate limited" }, 429);
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
  const acceptedQuotes = db.prepare("SELECT * FROM quotes WHERE rfq_id = ? AND status = 'accepted' ORDER BY created_at");
  /** accepted fills of a posting and how much of a fixed size they cover */
  /** The escrow a stored deal settles on: recorded at accept, else the legacy one it predates. */
  const escrowOf = (row: { escrow?: string | null } | undefined) =>
    (row?.escrow ? getAddress(row.escrow) : null) ?? cfg.escrowLegacy ?? cfg.escrow;
  const fillsOf = (r: RfqRow) => {
    const rows = acceptedQuotes.all(r.id) as unknown as QuoteRow[];
    let sum = 0n;
    for (const q of rows) if (q.terms_json) sum += BigInt(JSON.parse(q.terms_json).amount);
    return { rows, count: rows.length, amount: rows.length ? sum.toString() : null, sum };
  };
  /** public desk activity for the site's live notifications (no prices, no addresses) */
  const activity = openActivity(db);

  const pub = (r: RfqRow) => {
    const f = fillsOf(r);
    return publicRfq(r, quoteCount(r.id), { count: f.count, amount: f.amount });
  };

  /** The platform token, when the escrow accepts it as payment (OtcEscrowV2). */
  const burnPay = cfg.escrowBurnToken ?? null;
  const payTokenFor = (v: string): Address => {
    if (v === "ETH") return zeroAddress;
    if (v === "USDG") {
      if (!cfg.usdg) throw new BadRequest("USDG is not configured on this server");
      return cfg.usdg;
    }
    if (v.toUpperCase() === "OBSYN") {
      if (!burnPay) throw new BadRequest("Paying in OBSYN isn't available on this server");
      return burnPay;
    }
    const a = isAddress(v) ? getAddress(v) : null;
    if (a === null || (a !== zeroAddress && a !== cfg.usdg && a !== burnPay)) throw new BadRequest(burnPay ? "payToken must be ETH, USDG or OBSYN" : "payToken must be ETH or USDG");
    return a;
  };

  app.get("/health", (c) =>
    c.json({
      ok: true,
      chainId: cfg.chainId,
      rpcUrl: cfg.rpcUrl,
      escrow: cfg.escrow,
      usdg: cfg.usdg,
      walletConnectProjectId: cfg.walletConnectProjectId,
      platformToken: cfg.platformToken ?? { address: null, ponsUrl: null, discountMin: null },
      /** What deals can be paid in. OBSYN only with an escrow that burns its fees (OtcEscrowV2). */
      payTokens: [
        { symbol: "ETH", address: zeroAddress, decimals: 18 },
        ...(cfg.usdg ? [{ symbol: "USDG", address: cfg.usdg, decimals: 6 }] : []),
        ...(burnPay ? [{ symbol: "OBSYN", address: burnPay, decimals: 18, feeBps: 150, feeBurned: true }] : []),
      ],
      relayer: relayer.info(),
    }),
  );

  // ─────────────────────────── RFQs (buyer bids) ───────────────────────────

  const CreateRfq = z
    .object({
      side: z.enum(["buy", "sell"]).default("buy"),
      token: z.string().refine(isAddress, "invalid token address"),
      payToken: z.string(),
      amount: z.string().regex(/^[1-9]\d*$/).optional(),
      sizeUsd: z.number().min(5, "minimum size is $5").max(1e12).optional(),
      replySeconds: z.number().int().min(MIN_REPLY).max(MAX_REPLY),
      encPubKey: z.string().refine((s) => isB64(s, 32), "must be a base64 32-byte NaCl box public key").optional(),
      buyerEncPubKey: z.string().refine((s) => isB64(s, 32), "must be a base64 32-byte NaCl box public key").optional(),
      note: z.string().max(280).optional(),
      /** let several answers each fill part of the block (each becomes its own deal) */
      allowPartial: z.boolean().optional(),
    })
    .refine((v) => v.encPubKey || v.buyerEncPubKey, "give encPubKey")
    .refine((v) => v.amount || (v.side === "buy" && v.sizeUsd), "give amount (token base units); buy bids may give sizeUsd instead");

  app.post("/rfqs", async (c) => {
    const body = CreateRfq.parse(await c.req.json());
    // The escrow refuses deals where the traded token is USDG itself; catch it here, not at deposit time.
    if (cfg.usdg && getAddress(body.token) === cfg.usdg) throw new BadRequest("USDG is a payment currency here; pick the token you want to trade.");
    const payToken = payTokenFor(body.payToken);
    // ...and deals where the token is paid for in itself (e.g. OBSYN for OBSYN)
    if (getAddress(body.token) === payToken) throw new BadRequest("Pick a different payment currency than the token you're trading.");
    const id = newId();
    const manageToken = newToken();
    const t = now();
    db.prepare(
      `INSERT INTO rfqs (id, side, manage_hash, token, pay_token, amount, size_usd, buyer_enc_pubkey, note, expires_at, created_at, partial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.side,
      hashToken(manageToken),
      getAddress(body.token),
      payToken,
      body.amount ?? null,
      body.sizeUsd ?? null,
      (body.encPubKey ?? body.buyerEncPubKey)!,
      body.note ?? null,
      t + body.replySeconds,
      t,
      body.allowPartial ? 1 : 0,
    );
    activity.add({ kind: "posted", ref: id, rfqId: id, side: body.side, token: getAddress(body.token), payToken, amount: body.amount ?? null, sizeUsd: body.sizeUsd ?? null, at: t });
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
    return c.json(rows.map(pub));
  });

  app.get("/rfqs/:id", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    return c.json(pub(r));
  });

  /** A 1200x630 share card for an open block: side, size, token, pay token, answers, time left. Never a price. */
  app.get("/rfqs/:id/card.png", async (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    const p = pub(r) as { side?: "buy" | "sell"; quoteCount: number; status: string };
    const [tok, pm] = await Promise.all([tokenMeta(getAddress(r.token)), tokenMeta(getAddress(r.pay_token))]);
    const amount = r.amount ? Number(BigInt(r.amount)) / 10 ** tok.decimals : null;
    const size = amount !== null ? `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${tok.symbol}` : `~$${Math.round(r.size_usd ?? 0).toLocaleString("en-US")} of ${tok.symbol}`;
    let renderBlockCard: typeof import("./card.ts").renderBlockCard;
    try {
      ({ renderBlockCard } = await import("./card.ts"));
    } catch {
      return c.json({ error: "share cards are unavailable on this server" }, 503);
    }
    const png = renderBlockCard({
      side: p.side === "sell" ? "sell" : "buy",
      size,
      paySymbol: pm.symbol,
      answers: p.quoteCount,
      secondsLeft: r.expires_at - now(),
      open: r.status === "open",
      id: r.id,
    });
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "cache-control": "public, max-age=60" });
  });

  app.post("/rfqs/:id/cancel", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    if (r.status !== "open") return c.json({ error: `rfq is ${r.status}` }, 409);
    db.prepare("UPDATE rfqs SET status = 'cancelled' WHERE id = ?").run(r.id);
    db.prepare("UPDATE quotes SET status = 'rejected' WHERE rfq_id = ? AND status = 'pending'").run(r.id);
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
    activity.add({ kind: "answered", ref: id, rfqId: r.id, side: r.side, token: r.token, payToken: r.pay_token, amount: r.amount, sizeUsd: r.size_usd, at: now() });
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
    if (q.status !== "pending") return c.json({ error: `that answer is already ${q.status}` }, 409);
    const partial = !!r.partial;
    const fills = fillsOf(r);

    const problems: string[] = [];
    if (terms.token !== r.token) problems.push("terms.token differs from the rfq token");
    if (terms.payToken !== r.pay_token) problems.push("terms.payToken differs from the rfq payToken");
    if (r.amount && !partial && terms.amount !== BigInt(r.amount)) problems.push("terms.amount differs from the rfq amount");
    if (r.amount && partial && terms.amount > BigInt(r.amount) - fills.sum) problems.push("terms.amount is more than what's left to fill");
    if (terms.deadline <= BigInt(now() + 60)) problems.push("terms.deadline must be at least 60s away");
    if (terms.deadline > BigInt(now() + MAX_DEAL_WINDOW)) problems.push("terms.deadline is more than 7 days away");
    if (terms.buyer === terms.seller) problems.push("buyer and seller must differ");
    // A party naming itself as referrer would take back half the protocol fee. The contract can't stop a
    // second wallet, but the obvious self-referral is refused here.
    const zero = "0x0000000000000000000000000000000000000000";
    if (terms.referrer !== zero && [terms.buyer, terms.seller, terms.sellerPayout].includes(terms.referrer))
      problems.push("terms.referrer can't be the buyer, the seller or the seller's payout address");
    if (problems.length) return c.json({ error: "invalid terms", problems }, 400);

    const id = dealId(terms);
    const termsJson = JSON.stringify(termsToJson(terms));
    // A fixed size is complete once fills cover it; a whole-block posting is complete at its first deal.
    const complete = !partial || (r.amount !== null && fills.sum + terms.amount >= BigInt(r.amount));
    db.exec("BEGIN");
    try {
      // the first deal also goes on the posting itself, for clients that read a single deal
      const first = fills.count === 0;
      const res = db
        .prepare(
          `UPDATE rfqs SET status = ?, accepted_quote_id = CASE WHEN ? THEN ? ELSE accepted_quote_id END,
             deal_id = CASE WHEN ? THEN ? ELSE deal_id END, terms_json = CASE WHEN ? THEN ? ELSE terms_json END,
             escrow = CASE WHEN ? THEN ? ELSE escrow END
           WHERE id = ? AND status = 'open'`,
        )
        .run(complete ? "accepted" : "open", first ? 1 : 0, q.id, first ? 1 : 0, id, first ? 1 : 0, termsJson, first ? 1 : 0, cfg.escrow, r.id);
      if (Number(res.changes) !== 1) throw new Error("race");
      const won = db
        .prepare("UPDATE quotes SET status = 'accepted', deal_id = ?, terms_json = ?, escrow = ? WHERE id = ? AND status = 'pending'")
        .run(id, termsJson, cfg.escrow, q.id);
      if (Number(won.changes) !== 1) throw new Error("race");
      if (complete) db.prepare("UPDATE quotes SET status = 'rejected' WHERE rfq_id = ? AND status = 'pending'").run(r.id);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      return c.json({ error: "rfq is no longer open" }, 409);
    }
    activity.add({ kind: "accepted", ref: id, rfqId: r.id, side: r.side, token: r.token, payToken: r.pay_token, amount: terms.amount.toString(), sizeUsd: null, at: now() });
    return c.json({ dealId: id, terms: termsToJson(terms), escrow: cfg.escrow, chainId: cfg.chainId, quoteId: q.id, complete });
  });

  /** The poster re-reads the accepted deal (e.g. after reopening their private link). */
  app.get("/rfqs/:id/deal", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    if (!r.terms_json) return c.json({ error: "no accepted deal yet" }, 404);
    return c.json({
      dealId: r.deal_id,
      quoteId: r.accepted_quote_id,
      terms: JSON.parse(r.terms_json),
      escrow: escrowOf(r),
      chainId: cfg.chainId,
    });
  });

  /** Every deal on this posting: one per accepted answer (partial fills), oldest first. */
  app.get("/rfqs/:id/deals", (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    if (!tokenMatches(bearer(c), r.manage_hash)) return c.json({ error: "unauthorized" }, 401);
    const f = fillsOf(r);
    return c.json({
      partial: !!r.partial,
      complete: r.status === "accepted",
      filledAmount: f.amount,
      /** where new fills settle; each deal below carries its own escrow */
      escrow: cfg.escrow,
      chainId: cfg.chainId,
      deals: f.rows.map((q) => ({
        quoteId: q.id,
        dealId: q.deal_id,
        terms: q.terms_json ? JSON.parse(q.terms_json) : null,
        settleTx: q.settle_tx ?? null,
        escrow: escrowOf(q),
      })),
    });
  });

  // ─────────────────────────── deal receipts ───────────────────────────
  // Public and read from the chain: the settlement tx carries the terms, its Settled event the fees.
  const receipts = new Map<string, DealReceipt>(); // settled txs never change
  const receiptFor = async (hash: Hex) => {
    const k = hash.toLowerCase();
    const hit = receipts.get(k);
    if (hit) return hit;
    if (!deps.readReceipt) throw new Error("receipts not configured");
    const r = await deps.readReceipt(hash);
    if (receipts.size > 5000) receipts.clear();
    receipts.set(k, r);
    return r;
  };
  const isHash = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v);

  // ─────────────────────────── "saved vs DEX" and share cards ───────────────────────────
  const vsDexStore = openVsDexStore(db);
  const metaCache = new Map<string, Promise<{ symbol: string; decimals: number }>>();
  const tokenMeta = (a: Address) => {
    const k = a.toLowerCase();
    if (a === zeroAddress) return Promise.resolve({ symbol: "ETH", decimals: 18 });
    if (cfg.usdg && k === cfg.usdg.toLowerCase()) return Promise.resolve({ symbol: "USDG", decimals: 6 });
    let p = metaCache.get(k);
    if (!p) {
      const listed = MARKETS.find((m) => m.address.toLowerCase() === k);
      p = (deps.readToken ? deps.readToken(getAddress(a)) : Promise.reject(new Error("no token reads")))
        .then((t) => ({ symbol: t.symbol ?? listed?.symbol ?? "TOKEN", decimals: t.decimals ?? 18 }))
        .catch(() => ({ symbol: listed?.symbol ?? "TOKEN", decimals: 18 }));
      if (metaCache.size > 2000) metaCache.clear();
      metaCache.set(k, p);
    }
    return p;
  };
  const payUsdOf = async (pay: Address): Promise<number | null> => {
    if (pay === zeroAddress) return refQuote("ETH-USD", "5d").then((q) => q.price, () => null);
    if (cfg.usdg && pay.toLowerCase() === cfg.usdg.toLowerCase()) return 1;
    return tokenMarket(pay).then((m) => m.priceUsd, () => null);
  };
  /**
   * Snapshot the DEX price and liquidity for a settled deal, once, and only while the settlement is recent
   * (within an hour), so the comparison reflects the market when the deal happened.
   */
  const ensureVsDex = async (rec: DealReceipt) => {
    if (vsDexStore.get(rec.dealId)) return;
    if (now() - rec.timestamp > 3600) return;
    const token = getAddress(rec.terms.token);
    const pay = getAddress(rec.terms.payToken);
    const [tm, payUsd, tok, pm] = await Promise.all([tokenMarket(token), payUsdOf(pay), tokenMeta(token), tokenMeta(pay)]);
    if (!tm.priceUsd || !tm.liquidityUsd || !payUsd) return;
    const v = vsDex({
      amount: Number(BigInt(rec.terms.amount)) / 10 ** tok.decimals,
      paid: Number(BigInt(rec.terms.price)) / 10 ** pm.decimals,
      tokenUsd: tm.priceUsd,
      payUsd,
      liquidityUsd: tm.liquidityUsd,
    });
    if (v) vsDexStore.put(rec.dealId, rec.txHash, rec.timestamp, v);
  };

  app.get("/receipts/:tx", async (c) => {
    const tx = c.req.param("tx");
    if (!isHash(tx)) return c.json({ error: "invalid transaction hash" }, 400);
    try {
      const rec = await receiptFor(tx as Hex);
      await ensureVsDex(rec).catch(() => {});
      return c.json({ ...rec, vsDex: vsDexStore.get(rec.dealId) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404);
    }
  });

  /** A 1200x630 share card for a settled deal (link previews on X and elsewhere). Public data only. */
  app.get("/receipts/:tx/card.png", async (c) => {
    const tx = c.req.param("tx");
    if (!isHash(tx)) return c.json({ error: "invalid transaction hash" }, 400);
    let rec: DealReceipt;
    try {
      rec = await receiptFor(tx as Hex);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404);
    }
    await ensureVsDex(rec).catch(() => {});
    const pay = getAddress(rec.terms.payToken);
    const [tok, pm] = await Promise.all([tokenMeta(getAddress(rec.terms.token)), tokenMeta(pay)]);
    // loaded on first use: the image library is native, and a missing build must never take the API down
    let renderCard: typeof import("./card.ts").renderCard;
    try {
      ({ renderCard } = await import("./card.ts"));
    } catch {
      return c.json({ error: "share cards are unavailable on this server" }, 503);
    }
    const png = renderCard({
      tokenSymbol: tok.symbol,
      amount: Number(BigInt(rec.terms.amount)) / 10 ** tok.decimals,
      paySymbol: pm.symbol,
      paid: Number(BigInt(rec.terms.price)) / 10 ** pm.decimals,
      fee: { amount: Number(BigInt(rec.protocolFee)) / 10 ** pm.decimals, symbol: pm.symbol, burned: !!burnPay && pay.toLowerCase() === burnPay.toLowerCase() },
      vs: vsDexStore.get(rec.dealId),
      timestamp: rec.timestamp,
      txHash: rec.txHash,
      block: rec.block,
    });
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "cache-control": "public, max-age=300" });
  });

  /**
   * A deal's state read on-chain by the server, so the deal page works whatever network the visitor's
   * wallet is on and wherever their own RPC is blocked. Only our escrows; cached for a few seconds.
   */
  const dealReads = new Map<string, { at: number; p: Promise<{ status: number; buyerFunded: boolean; sellerFunded: boolean }> }>();
  app.get("/deals/:dealId/state", async (c) => {
    const id = c.req.param("dealId").toLowerCase();
    if (!isHash(id)) return c.json({ error: "invalid deal id" }, 400);
    if (!deps.readDeal) return c.json({ error: "not configured" }, 503);
    const known = [cfg.escrow, cfg.escrowLegacy].filter((a): a is Address => !!a);
    const q = c.req.query("escrow");
    const escrow = q ? known.find((a) => a.toLowerCase() === q.toLowerCase()) : cfg.escrow;
    if (!escrow) return c.json({ error: "unknown escrow" }, 400);
    const k = `${escrow.toLowerCase()}:${id}`;
    let hit = dealReads.get(k);
    if (!hit || now() - hit.at >= 4) {
      if (dealReads.size > 5000) dealReads.clear();
      hit = { at: now(), p: deps.readDeal(escrow, id as Hex) };
      dealReads.set(k, hit);
      hit.p.catch(() => dealReads.delete(k));
    }
    try {
      const s = await hit.p;
      c.header("cache-control", "no-store");
      return c.json({ escrow, dealId: id, ...s });
    } catch (e) {
      return c.json({ error: (e as Error).message.slice(0, 200) }, 502);
    }
  });

  /** Find a deal's receipt by its id (once a party has reported the settlement transaction). */
  app.get("/deals/:dealId/receipt", (c) => {
    const id = c.req.param("dealId").toLowerCase();
    if (!isHash(id)) return c.json({ error: "invalid deal id" }, 400);
    const row = (db.prepare("SELECT settle_tx FROM quotes WHERE deal_id = ? AND settle_tx IS NOT NULL").get(id) ??
      db.prepare("SELECT settle_tx FROM rfqs WHERE deal_id = ? AND settle_tx IS NOT NULL").get(id)) as { settle_tx: string } | undefined;
    if (!row) return c.json({ error: "no receipt yet" }, 404);
    return c.json({ txHash: row.settle_tx });
  });

  /**
   * Either side reports the transaction that settled their deal. No token needed: the server reads the
   * chain and only records it if that transaction really settled this posting's deal.
   */
  app.post("/rfqs/:id/settled", async (c) => {
    const r = rfq(c.req.param("id"));
    if (!r) return c.json({ error: "not found" }, 404);
    const dealIds = new Set([r.deal_id, ...fillsOf(r).rows.map((q) => q.deal_id)].filter(Boolean).map((d) => d!.toLowerCase()));
    if (!dealIds.size) return c.json({ error: "no accepted deal" }, 409);
    const body = (await c.req.json().catch(() => null)) as { txHash?: unknown } | null;
    const tx = typeof body?.txHash === "string" ? body.txHash : "";
    if (!isHash(tx)) return c.json({ error: "invalid transaction hash" }, 400);
    let rec: DealReceipt;
    try {
      rec = await receiptFor(tx as Hex);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const settled = rec.dealId.toLowerCase();
    if (!dealIds.has(settled)) return c.json({ error: "that transaction settled a different deal" }, 400);
    db.prepare("UPDATE quotes SET settle_tx = ? WHERE rfq_id = ? AND lower(deal_id) = ?").run(tx.toLowerCase(), r.id, settled);
    if (r.deal_id && r.deal_id.toLowerCase() === settled) db.prepare("UPDATE rfqs SET settle_tx = ? WHERE id = ?").run(tx.toLowerCase(), r.id);
    const rt = (rec.terms ?? {}) as Record<string, string | undefined>;
    activity.add({
      kind: "settled",
      ref: settled,
      rfqId: r.id,
      side: r.side,
      token: rt.token && isAddress(rt.token) ? getAddress(rt.token) : r.token,
      payToken: rt.payToken && isAddress(rt.payToken) ? getAddress(rt.payToken) : r.pay_token,
      amount: rt.amount && /^\d+$/.test(rt.amount) ? rt.amount : r.amount,
      sizeUsd: rt.amount ? null : r.size_usd,
      tx: tx.toLowerCase(),
      at: now(),
    });
    await ensureVsDex(rec).catch(() => {});
    return c.json({ ok: true, txHash: tx.toLowerCase() });
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
      rfq: pub(r),
      dealId: won ? (q.deal_id ?? r.deal_id) : null,
      terms: won ? JSON.parse(q.terms_json ?? r.terms_json ?? "null") : null,
      escrow: won ? escrowOf(q.escrow ? q : r) : cfg.escrow,
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
    /** the escrow the deal is on; defaults to the current one */
    escrow: z
      .string()
      .refine((s) => isAddress(s), "invalid escrow address")
      .transform((s) => getAddress(s))
      .optional(),
  });

  app.post("/relay/deposit", async (c) => {
    const body = RelayBody.parse(await c.req.json());
    const res = await relayer.relayDeposit(body.terms, body.permit ?? NO_PERMIT, body.sellerSig, body.escrow);
    return c.json(res, 202);
  });

  // ─────────────────────────── docs & SDK ───────────────────────────

  app.get("/openapi.json", (c) => c.json(openapi));

  const sdk = (c: Context) => {
    try {
      const js = readFileSync(new URL("../dist/sdk/obsyn.mjs", import.meta.url), "utf8");
      return c.body(js, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" });
    } catch {
      return c.json({ error: "SDK not built; run npm run build:sdk" }, 404);
    }
  };
  app.get("/sdk/obsyn.mjs", sdk);
  app.get("/sdk/blockotc.mjs", sdk); // deprecated alias

  // ─────────────────────────── on-chain reference price ───────────────────────────

  /** ERC-20 facts read on-chain by the server (useful when a client's own RPC is blocked). */
  const tokenCache = new Map<string, { at: number; p: Promise<TokenInfo> }>();
  app.get("/token/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid address" }, 400);
    if (!deps.readToken) return c.json({ error: "token reads not configured" }, 503);
    const key = getAddress(a);
    const hit = tokenCache.get(key);
    if (hit && now() - hit.at < 300) {
      try {
        return c.json(await hit.p);
      } catch {
        tokenCache.delete(key);
      }
    }
    if (tokenCache.size > 1000) tokenCache.clear();
    const p = deps.readToken(key);
    tokenCache.set(key, { at: now(), p });
    p.catch(() => tokenCache.delete(key));
    try {
      return c.json(await p);
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

  // ─────────────────────────── market board ───────────────────────────

  const refQuote = deps.refQuote ?? createReferencePrices();
  const tokenMarket = deps.tokenMarket ?? createTokenMarkets();

  // Price, market cap and logo of any token for the trade page, plus ETH/USD to size ETH payments.
  // Reference only: deals settle at the sealed price.
  app.get("/token/:address/market", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid address" }, 400);
    const [m, eth] = await Promise.allSettled([tokenMarket(getAddress(a)), refQuote("ETH-USD", "5d")]);
    if (m.status === "rejected") return c.json({ error: (m.reason as Error).message }, 502);
    return c.json({ ...m.value, ethUsd: eth.status === "fulfilled" ? eth.value.price : null });
  });
  // ─────────────────────────── stats and referrals ───────────────────────────

  const stats = createStats({
    db,
    chain: deps.statsChain ?? null,
    usdg: cfg.usdg,
    burnToken: burnPay,
    ethUsd: () => refQuote("ETH-USD", "5d").then((q) => q.price, () => null),
    burnTokenUsd: burnPay ? () => tokenMarket(burnPay).then((m) => m.priceUsd, () => null) : undefined,
    now,
  });

  /** Who controls what, read live from the chain: escrow (no owner), vault owner and keeper, the Safe, the timelock and its queue. */
  let control: { at: number; p: Promise<ControlReport> } | null = null;
  app.get("/control", async (c) => {
    if (!deps.controlReader) return c.json({ error: "not configured" }, 503);
    if (!control || now() - control.at >= 30) {
      // never let a stuck chain read hang every visitor: give up after 25 s and try again on the next request
      let t: ReturnType<typeof setTimeout> | undefined;
      const p = Promise.race([
        deps.controlReader(),
        new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error("reading the chain timed out")), 25_000))),
      ]).finally(() => clearTimeout(t));
      control = { at: now(), p };
      p.catch(() => (control = null));
    }
    try {
      c.header("cache-control", "public, max-age=30");
      return c.json(await control.p);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  /** Desk totals: deals and settled volume, fees, and the fee vault's buy-and-burn. */
  /**
   * Live desk activity, for the site's small notifications. Without `after`: just the current cursor.
   * With it: what happened since, oldest first. Public facts only; never prices or addresses.
   */
  app.get("/activity", (c) => {
    const a = c.req.query("after");
    const cursor = a !== undefined && /^\d{1,15}$/.test(a) ? Number(a) : null;
    c.header("cache-control", "no-store");
    return c.json(activity.since(cursor));
  });

  app.get("/stats", async (c) => {
    try {
      return c.json({ ...(await stats.summary()), vsDex: vsDexStore.totals() });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  /** Deals a wallet referred and what it earned (half the protocol fee, paid by the escrow at settlement). */
  app.get("/referrals/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid address" }, 400);
    try {
      return c.json(await stats.referrals(getAddress(a)));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  const openByToken = db.prepare(
    "SELECT token, side, COUNT(*) AS n FROM rfqs WHERE status = 'open' AND expires_at > ? GROUP BY token, side",
  );
  const deskCounts = () => {
    const out = new Map<string, { buy: number; sell: number }>();
    for (const r of openByToken.all(now()) as unknown as { token: string; side: string; n: number }[]) {
      const k = getAddress(r.token);
      const v = out.get(k) ?? { buy: 0, sell: 0 };
      if (r.side === "sell") v.sell += Number(r.n);
      else v.buy += Number(r.n);
      out.set(k, v);
    }
    return out;
  };

  /** Featured markets: reference price + 5-day sparkline, and how many blocks are open on this desk. */
  app.get("/markets", async (c) => {
    const desk = deskCounts();
    const refs = await Promise.allSettled(MARKETS.map((m) => (m.ref ? refQuote(m.ref, "5d") : Promise.reject(new Error("no reference listing")))));
    c.header("cache-control", "public, max-age=30");
    return c.json(
      MARKETS.map((m, i) => {
        const r = refs[i];
        const d = desk.get(m.address) ?? { buy: 0, sell: 0 };
        return {
          symbol: m.symbol,
          name: m.name,
          address: m.address,
          kind: m.kind,
          ref:
            r.status === "fulfilled"
              ? {
                  source: r.value.source,
                  ticker: r.value.ticker,
                  exchange: r.value.exchange,
                  currency: r.value.currency,
                  price: r.value.price,
                  prevClose: r.value.prevClose,
                  changePct: r.value.changePct,
                  weekChangePct: r.value.rangeChangePct,
                  time: r.value.time,
                  spark: r.value.candles.map((k) => k.c),
                }
              : null,
          desk: { open: d.buy + d.sell, buy: d.buy, sell: d.sell },
        };
      }),
    );
  });

  /** OHLC candles of a market's reference listing. range: 1d | 5d | 1mo | 6mo | 1y */
  app.get("/markets/:symbol/chart", async (c) => {
    const m = findMarket(c.req.param("symbol"));
    if (!m) return c.json({ error: "unknown market" }, 404);
    if (!m.ref) return c.json({ error: "this market has no reference listing" }, 404);
    const range = (c.req.query("range") ?? "1d") as Range;
    if (!(range in RANGES)) return c.json({ error: "range must be one of " + Object.keys(RANGES).join(", ") }, 400);
    try {
      const q = await refQuote(m.ref, range);
      c.header("cache-control", "public, max-age=30");
      return c.json({ symbol: m.symbol, range, ...q });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  return app;
}
