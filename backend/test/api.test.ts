import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import nacl from "tweetnacl";
import { zeroAddress, type Address } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { RelayError, type Relayer } from "../src/relayer.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

const USDG = "0x00000000000000000000000000000000000000A1";
const ESCROW = "0x00000000000000000000000000000000000000E5";
const TOKEN = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const PAYOUT = "0x4444444444444444444444444444444444444444";

let clock = 1_800_000_000;
let relayCalls = 0;

const fakeRelayer: Relayer = {
  info: () => ({ enabled: true, address: "0x5555555555555555555555555555555555555555", problem: null, minFee: { eth: "1", usdg: "1" } }),
  async relayDeposit(terms) {
    relayCalls++;
    if (terms.relayerFee === 0n) throw new RelayError(400, "relayerFee below minimum 1");
    return { txHash: `0x${"ab".repeat(32)}`, dealId: `0x${"cd".repeat(32)}` };
  },
};

function setup() {
  const cfg = loadConfig({ ESCROW_ADDRESS: ESCROW, USDG_ADDRESS: USDG, PUBLIC_URL: "https://otc.example" });
  return createApp({
    cfg,
    db: openDb(":memory:"),
    relayer: fakeRelayer,
    readPrice: async (token) => ({ token, quote: "ETH", price: 0.001, source: "test", blockNumber: "1" }),
    now: () => clock,
  });
}

async function call(app: ReturnType<typeof setup>, method: string, path: string, body?: unknown, token?: string) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

function termsFor(over: Partial<Record<string, string>> = {}) {
  return {
    buyer: BUYER,
    seller: SELLER,
    token: TOKEN,
    amount: "1000000000000000000000",
    payToken: USDG,
    price: "25000000000",
    sellerPayout: PAYOUT,
    relayerFee: "0",
    deadline: String(clock + 3600),
    salt: `0x${"01".repeat(32)}`,
    ...over,
  };
}

describe("sealed RFQ flow", () => {
  let app: ReturnType<typeof setup>;
  const buyerKeys = nacl.box.keyPair();
  const sellerKeys = nacl.box.keyPair();

  beforeEach(() => {
    clock = 1_800_000_000;
    relayCalls = 0;
    app = setup();
  });

  async function createRfq(extra: Record<string, unknown> = {}) {
    return call(app, "POST", "/rfqs", {
      token: TOKEN,
      payToken: "USDG",
      amount: "1000000000000000000000",
      replySeconds: 3600,
      buyerEncPubKey: b64(buyerKeys.publicKey),
      ...extra,
    });
  }

  it("runs bid → sealed offer → accept → seller sees terms", async () => {
    const rfq = await createRfq({ note: "size only, no slippage" });
    assert.equal(rfq.status, 201);
    assert.ok(rfq.json.manageToken);
    assert.equal(rfq.json.shareUrl, `https://otc.example/rfq/${rfq.json.id}`);

    // demand feed
    const list = await call(app, "GET", "/rfqs");
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].payToken, USDG);
    assert.equal(list.json[0].manage_hash, undefined, "never leak the token hash");

    // seller encrypts an offer to the buyer
    const offer = { price: "25000000000", seller: SELLER, sellerPayout: PAYOUT, ghost: false };
    const nonce = nacl.randomBytes(24);
    const box = nacl.box(enc(offer), nonce, unb64(list.json[0].buyerEncPubKey), sellerKeys.secretKey);
    const q = await call(app, "POST", `/rfqs/${rfq.json.id}/quotes`, {
      sellerEncPubKey: b64(sellerKeys.publicKey),
      nonce: b64(nonce),
      ciphertext: b64(box),
    });
    assert.equal(q.status, 201);

    // public view only exposes the count
    const pub = await call(app, "GET", `/rfqs/${rfq.json.id}`);
    assert.equal(pub.json.quoteCount, 1);

    // only the buyer can list quotes, and the server stored ciphertext only
    assert.equal((await call(app, "GET", `/rfqs/${rfq.json.id}/quotes`)).status, 401);
    assert.equal((await call(app, "GET", `/rfqs/${rfq.json.id}/quotes`, undefined, q.json.quoteToken)).status, 401);
    const quotes = await call(app, "GET", `/rfqs/${rfq.json.id}/quotes`, undefined, rfq.json.manageToken);
    const opened = nacl.box.open(
      unb64(quotes.json[0].ciphertext),
      unb64(quotes.json[0].nonce),
      unb64(quotes.json[0].sellerEncPubKey),
      buyerKeys.secretKey,
    );
    assert.deepEqual(JSON.parse(new TextDecoder().decode(opened!)), offer);

    // seller sees pending
    const before = await call(app, "GET", `/quotes/${q.json.quoteId}`, undefined, q.json.quoteToken);
    assert.equal(before.json.status, "pending");
    assert.equal(before.json.terms, null);

    // buyer accepts
    const acc = await call(app, "POST", `/rfqs/${rfq.json.id}/accept`, { quoteId: q.json.quoteId, terms: termsFor() }, rfq.json.manageToken);
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    assert.match(acc.json.dealId, /^0x[0-9a-f]{64}$/);
    assert.equal(acc.json.escrow, ESCROW);

    // buyer can re-read the deal from their private link
    const deal = await call(app, "GET", `/rfqs/${rfq.json.id}/deal`, undefined, rfq.json.manageToken);
    assert.equal(deal.json.dealId, acc.json.dealId);
    assert.equal((await call(app, "GET", `/rfqs/${rfq.json.id}/deal`)).status, 401);

    // seller now gets the exact terms
    const after = await call(app, "GET", `/quotes/${q.json.quoteId}`, undefined, q.json.quoteToken);
    assert.equal(after.json.status, "accepted");
    assert.equal(after.json.dealId, acc.json.dealId);
    assert.equal(after.json.terms.price, "25000000000");

    // can't accept twice, and the rfq leaves the demand feed
    const again = await call(app, "POST", `/rfqs/${rfq.json.id}/accept`, { quoteId: q.json.quoteId, terms: termsFor() }, rfq.json.manageToken);
    assert.equal(again.status, 409);
    assert.equal((await call(app, "GET", "/rfqs")).json.length, 0);
  });

  it("rejects terms that don't match the bid", async () => {
    const rfq = await createRfq();
    const nonce = nacl.randomBytes(24);
    const q = await call(app, "POST", `/rfqs/${rfq.json.id}/quotes`, {
      sellerEncPubKey: b64(sellerKeys.publicKey),
      nonce: b64(nonce),
      ciphertext: b64(nacl.box(enc({}), nonce, buyerKeys.publicKey, sellerKeys.secretKey)),
    });
    const bad = await call(
      app,
      "POST",
      `/rfqs/${rfq.json.id}/accept`,
      { quoteId: q.json.quoteId, terms: termsFor({ payToken: zeroAddress, amount: "5", deadline: String(clock + 30) }) },
      rfq.json.manageToken,
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.json.problems.length, 3);
  });

  it("closes quoting when the reply window ends", async () => {
    const rfq = await createRfq({ replySeconds: 900 });
    clock += 901;
    const nonce = nacl.randomBytes(24);
    const q = await call(app, "POST", `/rfqs/${rfq.json.id}/quotes`, {
      sellerEncPubKey: b64(sellerKeys.publicKey),
      nonce: b64(nonce),
      ciphertext: b64(nonce),
    });
    assert.equal(q.status, 409);
    assert.equal((await call(app, "GET", "/rfqs")).json.length, 0);
  });

  it("validates input", async () => {
    assert.equal((await createRfq({ replySeconds: 60 })).status, 400); // below 15 min
    assert.equal((await createRfq({ payToken: TOKEN })).status, 400); // not ETH/USDG
    assert.equal((await createRfq({ buyerEncPubKey: "abc" })).status, 400);
    assert.equal((await createRfq({ amount: undefined })).status, 400); // no size at all
    assert.equal((await createRfq({ amount: undefined, sizeUsd: 25_000, payToken: "ETH" })).status, 201);
    assert.equal((await createRfq({ amount: undefined, sizeUsd: 2, payToken: "ETH" })).status, 400); // $5 minimum
    assert.equal((await createRfq({ token: USDG })).status, 400); // USDG is the payment currency, not a tradable token
  });

  it("buyer can cancel; others cannot", async () => {
    const rfq = await createRfq();
    assert.equal((await call(app, "POST", `/rfqs/${rfq.json.id}/cancel`, {}, "wrong")).status, 401);
    assert.equal((await call(app, "POST", `/rfqs/${rfq.json.id}/cancel`, {}, rfq.json.manageToken)).status, 200);
    assert.equal((await call(app, "GET", `/rfqs/${rfq.json.id}`)).json.status, "cancelled");
  });
});

describe("sell listings (seller posts first)", () => {
  const sellerKeys = nacl.box.keyPair();
  const buyerKeys = nacl.box.keyPair();

  it("runs listing → sealed buyer bid → seller accepts → buyer sees terms", async () => {
    clock = 1_800_000_000;
    const app = setup();
    const listing = await call(app, "POST", "/rfqs", {
      side: "sell",
      token: TOKEN,
      payToken: "USDG",
      amount: "1000000000000000000000",
      replySeconds: 3600,
      encPubKey: b64(sellerKeys.publicKey),
    });
    assert.equal(listing.status, 201);

    const sells = await call(app, "GET", "/rfqs?side=sell");
    assert.equal(sells.json.length, 1);
    assert.equal(sells.json[0].side, "sell");
    assert.equal((await call(app, "GET", "/rfqs?side=buy")).json.length, 0);

    // buyer answers with a sealed bid
    const bid = { amount: "1000000000000000000000", price: "25500000000", buyer: BUYER };
    const nonce = nacl.randomBytes(24);
    const q = await call(app, "POST", `/rfqs/${listing.json.id}/quotes`, {
      sellerEncPubKey: b64(buyerKeys.publicKey),
      nonce: b64(nonce),
      ciphertext: b64(nacl.box(enc(bid), nonce, unb64(sells.json[0].encPubKey), buyerKeys.secretKey)),
    });
    assert.equal(q.status, 201);

    // only the seller can read it
    const quotes = await call(app, "GET", `/rfqs/${listing.json.id}/quotes`, undefined, listing.json.manageToken);
    const opened = nacl.box.open(unb64(quotes.json[0].ciphertext), unb64(quotes.json[0].nonce), unb64(quotes.json[0].sellerEncPubKey), sellerKeys.secretKey);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(opened!)), bid);

    // seller accepts and fixes the terms
    const acc = await call(app, "POST", `/rfqs/${listing.json.id}/accept`, { quoteId: q.json.quoteId, terms: termsFor({ price: bid.price }) }, listing.json.manageToken);
    assert.equal(acc.status, 200, JSON.stringify(acc.json));

    const mine = await call(app, "GET", `/quotes/${q.json.quoteId}`, undefined, q.json.quoteToken);
    assert.equal(mine.json.status, "accepted");
    assert.equal(mine.json.rfq.side, "sell");
    assert.equal(mine.json.terms.price, bid.price);
  });

  it("a sell listing needs a fixed amount", async () => {
    const app = setup();
    const r = await call(app, "POST", "/rfqs", {
      side: "sell",
      token: TOKEN,
      payToken: "ETH",
      sizeUsd: 50_000,
      replySeconds: 3600,
      encPubKey: b64(sellerKeys.publicKey),
    });
    assert.equal(r.status, 400);
  });

  it("an existing production database (no side column) is migrated on startup", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mig-")), "old.db");
    const old = new DatabaseSync(file);
    // schema as deployed before sell listings existed
    old.exec(`CREATE TABLE rfqs (id TEXT PRIMARY KEY, manage_hash TEXT NOT NULL, token TEXT NOT NULL, pay_token TEXT NOT NULL,
      amount TEXT, size_usd REAL, buyer_enc_pubkey TEXT NOT NULL, note TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', accepted_quote_id TEXT, deal_id TEXT, terms_json TEXT)`);
    old.exec("INSERT INTO rfqs (id, manage_hash, token, pay_token, buyer_enc_pubkey, expires_at, created_at) VALUES ('x','h','t','p','k',1,1)");
    old.close();

    const db = openDb(file);
    assert.equal((db.prepare("SELECT side FROM rfqs WHERE id = 'x'").get() as { side: string }).side, "buy");
    db.close();
    openDb(file).close(); // running it again is a no-op
  });
});

describe("cors", () => {
  it("allows any origin to call the API with a bearer token", async () => {
    const app = setup();
    const res = await app.request("/rfqs", {
      method: "OPTIONS",
      headers: { origin: "https://some-dapp.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-headers") ?? "", /authorization/i);
  });
});

describe("openapi", () => {
  it("documents every route the app serves, and nothing else", async () => {
    const app = setup();
    const res = await call(app, "GET", "/openapi.json");
    assert.equal(res.status, 200);
    const documented = Object.entries(res.json.paths as Record<string, Record<string, unknown>>)
      .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`))
      .sort();
    const served = [
      ...new Set(
        app.routes
          .filter((r) => r.method !== "ALL")
          .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
      ),
    ].sort();
    assert.deepEqual(documented, served);
  });
});

describe("relay + price endpoints", () => {
  it("passes valid relay requests to the relayer and maps its errors", async () => {
    const app = setup();
    const sig = `0x${"11".repeat(65)}`;
    const ok = await call(app, "POST", "/relay/deposit", { terms: termsFor({ relayerFee: "5" }), sellerSig: sig });
    assert.equal(ok.status, 202);
    const low = await call(app, "POST", "/relay/deposit", { terms: termsFor(), sellerSig: sig });
    assert.equal(low.status, 400);
    const bad = await call(app, "POST", "/relay/deposit", { terms: termsFor(), sellerSig: "0x12" });
    assert.equal(bad.status, 400);
    assert.equal(relayCalls, 2);
  });

  it("requires a well-formed price source", async () => {
    const app = setup();
    assert.equal((await call(app, "GET", `/price/${TOKEN}`)).status, 400);
    const ok = await call(app, "GET", `/price/${TOKEN}?source=v3:${TOKEN}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.price, 0.001);
  });
});

export type { Address };

describe("config", () => {
  const k = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil test key
  it("accepts relayer keys with or without 0x, and quoted", () => {
    assert.equal(loadConfig({ RELAYER_PRIVATE_KEY: k }).relayerKey, `0x${k}`);
    assert.equal(loadConfig({ RELAYER_PRIVATE_KEY: `0x${k}` }).relayerKey, `0x${k}`);
    assert.equal(loadConfig({ RELAYER_PRIVATE_KEY: ` "${k}" ` }).relayerKey, `0x${k}`);
  });
  it("a malformed key disables the relayer without crashing or echoing it", () => {
    const bad = loadConfig({ RELAYER_PRIVATE_KEY: "abc123" });
    assert.equal(bad.relayerKey, null);
    assert.ok(bad.relayerKeyProblem && !bad.relayerKeyProblem.includes("abc123"));
    const addr = loadConfig({ RELAYER_PRIVATE_KEY: "0x2222222222222222222222222222222222222222" });
    assert.equal(addr.relayerKey, null);
    assert.match(addr.relayerKeyProblem!, /ADDRESS/);
    assert.equal(loadConfig({ RELAYER_PRIVATE_KEY: ` ${k}\n` }).relayerKey, `0x${k}`); // stray whitespace/newline from pasting
  });
});
