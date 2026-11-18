import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nacl from "tweetnacl";
import { getAddress, type Address, type Hex } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";
import type { StatsChain } from "../src/stats.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

const USDG = "0x00000000000000000000000000000000000000A1";
const V1 = getAddress("0x00000000000000000000000000000000000000E1");
const V2 = getAddress("0x00000000000000000000000000000000000000E2");
const OBSYN = "0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351";
const TOKEN = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SELLER = "0x3333333333333333333333333333333333333333";
const PAYOUT = "0x4444444444444444444444444444444444444444";

const relayer: Relayer = {
  info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }),
  relayDeposit: async () => {
    throw new Error("unused");
  },
};

/** a fake chain with two escrows: a deal only exists on the escrow it was made on */
const onChain = new Map<string, number>(); // `${escrow}:${dealId}` → status
const reads: (string | null)[] = [];
const chain: StatsChain = {
  async dealStatus(id, escrow) {
    reads.push(escrow ?? null);
    return onChain.get(`${(escrow ?? V1).toLowerCase()}:${id.toLowerCase()}`) ?? 0;
  },
  async fees(t, escrow) {
    // v2 charges 1.5% on $OBSYN-paid deals (burned); 2% otherwise
    const bps = (escrow ?? V1).toLowerCase() === V2.toLowerCase() && t.payToken.toLowerCase() === OBSYN.toLowerCase() ? 150n : 200n;
    return { protocol: (t.price * bps) / 10_000n, referrer: 0n };
  },
  async vault() {
    return { address: "0x00000000000000000000000000000000000000F7", totalBurned: 0n, eth: 0n, usdg: 0n, tokenBurnedAtDead: null };
  },
};

let clock = 1_800_000_000;

function app(db: ReturnType<typeof openDb>, env: Record<string, string>) {
  return createApp({
    cfg: loadConfig({ USDG_ADDRESS: USDG, PUBLIC_URL: "https://otc.example", ...env }),
    db,
    relayer,
    readPrice: async (token) => ({ token, quote: "ETH", price: 0.001, source: "test", blockNumber: "1" }),
    refQuote: async () => ({ symbol: "ETH-USD", price: 3000, currency: "USD", time: 1 }) as never,
    tokenMarket: async (a: Address) => ({ address: a, priceUsd: 0.002 }) as never,
    statsChain: chain,
    now: () => clock,
  });
}

async function call(a: ReturnType<typeof app>, method: string, path: string, body?: unknown, token?: string) {
  const res = await a.request(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** bid → sealed offer → accept */
async function deal(a: ReturnType<typeof app>, pay: "USDG" | "OBSYN", price: string, salt: string) {
  const buyerKeys = nacl.box.keyPair();
  const sellerKeys = nacl.box.keyPair();
  const rfq = await call(a, "POST", "/rfqs", { token: TOKEN, payToken: pay, amount: "1000", replySeconds: 3600, buyerEncPubKey: b64(buyerKeys.publicKey) });
  assert.equal(rfq.status, 201, JSON.stringify(rfq.json));
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(enc({ price, seller: SELLER, sellerPayout: PAYOUT, ghost: false }), nonce, unb64(rfq.json.buyerEncPubKey ?? b64(buyerKeys.publicKey)), sellerKeys.secretKey);
  const q = await call(a, "POST", `/rfqs/${rfq.json.id}/quotes`, { sellerEncPubKey: b64(sellerKeys.publicKey), nonce: b64(nonce), ciphertext: b64(box) });
  const terms = {
    buyer: BUYER,
    seller: SELLER,
    token: TOKEN,
    amount: "1000",
    payToken: pay === "USDG" ? USDG : OBSYN,
    price,
    sellerPayout: PAYOUT,
    relayerFee: "0",
    deadline: String(clock + 3600),
    salt: `0x${salt.repeat(32)}`,
  };
  const acc = await call(a, "POST", `/rfqs/${rfq.json.id}/accept`, { quoteId: q.json.quoteId, terms }, rfq.json.manageToken);
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  return { rfqId: rfq.json.id as string, manage: rfq.json.manageToken as string, quoteId: q.json.quoteId as string, quoteToken: q.json.quoteToken as string, dealId: acc.json.dealId as Hex, escrow: acc.json.escrow as string };
}

describe("switching ESCROW_ADDRESS from OtcEscrow to OtcEscrowV2", () => {
  it("keeps old deals on the old escrow and puts new ones on the new escrow", async () => {
    const db = openDb(":memory:");

    // before the switch: a deal made on v1
    const before = app(db, { ESCROW_ADDRESS: V1 });
    const old = await deal(before, "USDG", "100000000", "01");
    assert.equal(old.escrow, V1);
    // rows from before the escrow was recorded have no escrow at all
    db.exec("UPDATE rfqs SET escrow = NULL; UPDATE quotes SET escrow = NULL;");

    // after the switch
    const after = app(db, { ESCROW_ADDRESS: V2, ESCROW_LEGACY_ADDRESS: V1, ESCROW_BURN_TOKEN: OBSYN });
    const fresh = await deal(after, "OBSYN", "500000000000000000000000", "02"); // 500k OBSYN
    assert.equal(fresh.escrow, V2);

    // the poster's and the answerer's pages point each deal at its own escrow
    assert.equal((await call(after, "GET", `/rfqs/${old.rfqId}/deal`, undefined, old.manage)).json.escrow, V1);
    assert.equal((await call(after, "GET", `/rfqs/${fresh.rfqId}/deal`, undefined, fresh.manage)).json.escrow, V2);
    assert.equal((await call(after, "GET", `/quotes/${old.quoteId}`, undefined, old.quoteToken)).json.escrow, V1);
    assert.equal((await call(after, "GET", `/quotes/${fresh.quoteId}`, undefined, fresh.quoteToken)).json.escrow, V2);
    // new postings settle on the new escrow
    assert.equal((await call(after, "GET", "/health")).json.escrow, V2);

    // both settle, each on its own escrow; stats read each from the right contract
    onChain.set(`${V1.toLowerCase()}:${old.dealId.toLowerCase()}`, 2);
    onChain.set(`${V2.toLowerCase()}:${fresh.dealId.toLowerCase()}`, 2);
    const s = (await call(after, "GET", "/stats")).json;
    assert.deepEqual(s.deals, { accepted: 2, settled: 2, refunded: 0, open: 0 });
    assert.ok(reads.includes(null) && reads.includes(V2), `escrows read: ${reads.join(",")}`);
    assert.equal(s.volume.usdg, "100000000");
    assert.equal(s.volume.obsyn, "500000000000000000000000");
    assert.equal(s.fees.protocol.obsyn, "7500000000000000000000"); // 1.5% of 500k = 7,500 OBSYN
    assert.equal(s.burnedOnSettle, "7500000000000000000000");
    assert.equal(s.volumeUsd, 100 + 500_000 * 0.002); // 100 USDG + 500k OBSYN at $0.002
  });

  it("before any switch, behaves as before (no legacy escrow set)", async () => {
    const db = openDb(":memory:");
    const a = app(db, { ESCROW_ADDRESS: V1 });
    const d = await deal(a, "USDG", "100000000", "03");
    db.exec("UPDATE rfqs SET escrow = NULL; UPDATE quotes SET escrow = NULL;");
    assert.equal((await call(a, "GET", `/rfqs/${d.rfqId}/deal`, undefined, d.manage)).json.escrow, V1);
  });
});
