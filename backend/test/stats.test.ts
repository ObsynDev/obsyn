import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import nacl from "tweetnacl";
import type { Hex } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";
import type { StatsChain } from "../src/stats.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

const USDG = "0x00000000000000000000000000000000000000A1";
const ESCROW = "0x00000000000000000000000000000000000000E5";
const VAULT = "0x00000000000000000000000000000000000000F7";
const TOKEN = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const PAYOUT = "0x4444444444444444444444444444444444444444";
const PARTNER = "0x6666666666666666666666666666666666666666";

const relayer: Relayer = {
  info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }),
  relayDeposit: async () => {
    throw new Error("unused");
  },
};

let clock = 1_800_000_000;
let status = new Map<string, number>();
let statusReads = 0;

const chain: StatsChain = {
  async dealStatus(id) {
    statusReads++;
    return status.get(id.toLowerCase()) ?? 0;
  },
  // 2% fee; half to the referrer when there is one (mirrors OtcEscrow.quoteSettlement)
  async fees(t) {
    const fee = (t.price * 2n) / 100n;
    const referrer = t.referrer === "0x0000000000000000000000000000000000000000" ? 0n : fee / 2n;
    return { protocol: fee - referrer, referrer };
  },
  async vault() {
    return {
      address: VAULT,
      totalBurned: 5n * 10n ** 18n,
      eth: 7n,
      usdg: 9n,
      tokenBurnedAtDead: 6n * 10n ** 18n,
      route: { active: "0x0000000000000000000000000000000000000000", pending: "0x00000000000000000000000000000000000000A9", pendingEta: 1_800_172_800n },
    };
  },
};

function setup() {
  const cfg = loadConfig({ ESCROW_ADDRESS: ESCROW, USDG_ADDRESS: USDG, PUBLIC_URL: "https://otc.example" });
  return createApp({
    cfg,
    db: openDb(":memory:"),
    relayer,
    readPrice: async (token) => ({ token, quote: "ETH", price: 0.001, source: "test", blockNumber: "1" }),
    refQuote: async () => ({ symbol: "ETH-USD", price: 3000, currency: "USD", time: 1 }) as never,
    statsChain: chain,
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

describe("stats and referrals", () => {
  let app: ReturnType<typeof setup>;
  const buyerKeys = nacl.box.keyPair();
  const sellerKeys = nacl.box.keyPair();

  beforeEach(() => {
    clock = 1_800_000_000;
    status = new Map();
    statusReads = 0;
    app = setup();
  });

  /** bid → sealed offer → accept; returns the deal id */
  async function deal(price: string, referrer?: string, salt = "01") {
    const rfq = await call(app, "POST", "/rfqs", { token: TOKEN, payToken: "USDG", amount: "1000", replySeconds: 3600, buyerEncPubKey: b64(buyerKeys.publicKey) });
    const pub = (await call(app, "GET", `/rfqs/${rfq.json.id}`)).json.buyerEncPubKey;
    const nonce = nacl.randomBytes(24);
    const box = nacl.box(enc({ price, seller: SELLER, sellerPayout: PAYOUT, ghost: false }), nonce, unb64(pub), sellerKeys.secretKey);
    const q = await call(app, "POST", `/rfqs/${rfq.json.id}/quotes`, { sellerEncPubKey: b64(sellerKeys.publicKey), nonce: b64(nonce), ciphertext: b64(box) });
    const terms = {
      buyer: BUYER,
      seller: SELLER,
      token: TOKEN,
      amount: "1000",
      payToken: USDG,
      price,
      sellerPayout: PAYOUT,
      relayerFee: "0",
      deadline: String(clock + 3600),
      salt: `0x${salt.repeat(32)}`,
      ...(referrer ? { referrer } : {}),
    };
    const acc = await call(app, "POST", `/rfqs/${rfq.json.id}/accept`, { quoteId: q.json.quoteId, terms }, rfq.json.manageToken);
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    return acc.json.dealId as Hex;
  }

  it("counts only settled deals in volume and fees, and reports the vault's burns", async () => {
    const settled = await deal("100000000", PARTNER, "01"); // 100 USDG, referred
    const refunded = await deal("50000000", undefined, "02");
    await deal("70000000", undefined, "03"); // accepted, never funded
    status.set(settled.toLowerCase(), 2);
    status.set(refunded.toLowerCase(), 3);

    const s = await call(app, "GET", "/stats");
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.deepEqual(s.json.deals, { accepted: 3, settled: 1, refunded: 1, open: 1 });
    assert.equal(s.json.volume.usdg, "100000000");
    assert.equal(s.json.volume.eth, "0");
    assert.equal(s.json.volumeUsd, 100);
    assert.equal(s.json.fees.protocol.usdg, "1000000"); // 2% = 2 USDG, half to the partner
    assert.equal(s.json.fees.referrer.usdg, "1000000");
    assert.equal(s.json.tokensTraded, 1);
    assert.equal(s.json.postings.total, 3);
    assert.equal(s.json.vault.totalBurned, (5n * 10n ** 18n).toString());
    assert.equal(s.json.vault.usdgWaiting, "9");
    assert.deepEqual(s.json.vault.route, { active: "0x0000000000000000000000000000000000000000", pending: "0x00000000000000000000000000000000000000A9", pendingEta: 1_800_172_800 });
  });

  it("caches the summary and never re-reads a deal that is final", async () => {
    const id = await deal("100000000", undefined, "04");
    status.set(id.toLowerCase(), 2);
    await call(app, "GET", "/stats");
    const reads = statusReads;
    await call(app, "GET", "/stats"); // within the cache window
    assert.equal(statusReads, reads);
    clock += 120;
    await call(app, "GET", "/stats"); // rebuilt, but the settled deal is remembered
    assert.equal(statusReads, reads);
  });

  it("reports a referrer's settled deals and earnings, and nothing for other wallets", async () => {
    const a = await deal("100000000", PARTNER, "05");
    await deal("40000000", PARTNER, "06"); // accepted, not settled yet
    status.set(a.toLowerCase(), 2);

    const r = await call(app, "GET", `/referrals/${PARTNER.toLowerCase()}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.referrer, PARTNER);
    assert.deepEqual(r.json.deals, { accepted: 2, settled: 1 });
    assert.equal(r.json.earned.usdg, "1000000");
    assert.equal(r.json.recent.length, 1);
    assert.equal(r.json.recent[0].dealId, a.toLowerCase());

    const none = await call(app, "GET", `/referrals/${BUYER}`);
    assert.deepEqual(none.json.deals, { accepted: 0, settled: 0 });
    assert.equal((await call(app, "GET", "/referrals/nope")).status, 400);
  });
});
