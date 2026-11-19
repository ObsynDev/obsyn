import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nacl from "tweetnacl";
import { getAddress } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";
import { dealId, termsFromJson } from "../src/terms.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const USDG = getAddress("0x00000000000000000000000000000000000000A1");
const ESCROW = getAddress("0x00000000000000000000000000000000000000E5");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const BUYER = getAddress("0x2222222222222222222222222222222222222222");
const SELLER = getAddress("0x3333333333333333333333333333333333333333");
const PAYOUT = getAddress("0x4444444444444444444444444444444444444444");
const SETTLE_TX = `0x${"11".repeat(32)}`;

describe("GET /activity", () => {
  let clock = 1_800_000_000;
  let settledDeal = `0x${"00".repeat(32)}`;
  const relayer: Relayer = { info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }), relayDeposit: async () => Promise.reject(new Error("unused")) };
  const app = createApp({
    cfg: loadConfig({ ESCROW_ADDRESS: ESCROW, USDG_ADDRESS: USDG }),
    db: openDb(":memory:"),
    relayer,
    readPrice: async () => Promise.reject(new Error("n/a")),
    readReceipt: async (tx) => {
      if (tx !== SETTLE_TX) throw new Error("not a settlement");
      return { txHash: tx, dealId: settledDeal as `0x${string}`, block: "1", timestamp: 1, settledBy: "depositTokens", terms: { token: TOKEN, payToken: USDG, amount: "1000000000000000000000" } as any, protocolFee: "0", referrerFee: "0", relayerFee: "0", sellerProceeds: "0" };
    },
    now: () => clock,
  });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any, text: "" };
  };

  it("starts with only a cursor, then reports posted, answered, accepted and settled once each, with no prices", async () => {
    const first = await call("GET", "/activity");
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { cursor: 0, events: [] });

    const kp = nacl.box.keyPair();
    const post = await call("POST", "/rfqs", { side: "buy", token: TOKEN, payToken: "USDG", amount: "1000000000000000000000", replySeconds: 3600, encPubKey: b64(kp.publicKey) });
    assert.equal(post.status, 201);
    const rfqId = post.json.id;
    const quote = await call("POST", `/rfqs/${rfqId}/quotes`, { sellerEncPubKey: b64(nacl.box.keyPair().publicKey), nonce: b64(nacl.randomBytes(24)), ciphertext: b64(nacl.randomBytes(80)) });
    assert.equal(quote.status, 201);

    clock += 10;
    const terms = { buyer: BUYER, seller: SELLER, token: TOKEN, amount: "1000000000000000000000", payToken: USDG, price: "25000000000", sellerPayout: PAYOUT, referrer: "0x0000000000000000000000000000000000000000", relayerFee: "0", deadline: String(clock + 3600), salt: `0x${"01".repeat(32)}` };
    const acc = await call("POST", `/rfqs/${rfqId}/accept`, { quoteId: quote.json.quoteId, terms }, post.json.manageToken);
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    settledDeal = dealId(termsFromJson(terms));

    assert.equal((await call("POST", `/rfqs/${rfqId}/settled`, { txHash: SETTLE_TX })).status, 200);
    // the other side reports the same settlement: no second event
    assert.equal((await call("POST", `/rfqs/${rfqId}/settled`, { txHash: SETTLE_TX })).status, 200);

    const feed = await call("GET", `/activity?after=${first.json.cursor}`);
    assert.deepEqual(
      feed.json.events.map((e: any) => [e.kind, e.rfqId, e.side, e.token, e.amount]),
      [
        ["posted", rfqId, "buy", TOKEN, "1000000000000000000000"],
        ["answered", rfqId, "buy", TOKEN, "1000000000000000000000"],
        ["accepted", rfqId, "buy", TOKEN, "1000000000000000000000"],
        ["settled", rfqId, "buy", TOKEN, "1000000000000000000000"],
      ],
    );
    assert.equal(feed.json.events[3].tx, SETTLE_TX);
    assert.equal(feed.json.events[3].dealId, settledDeal.toLowerCase());
    assert.equal(feed.json.events[0].dealId, null);
    assert.equal(feed.json.cursor, feed.json.events[3].id);
    // nothing private: no price, no party, no sealed answer
    const blob = JSON.stringify(feed.json).toLowerCase();
    for (const secret of ["25000000000", BUYER.toLowerCase(), SELLER.toLowerCase(), PAYOUT.toLowerCase(), quote.json.quoteId.toLowerCase(), post.json.manageToken.toLowerCase()])
      assert.ok(!blob.includes(secret), `leaks ${secret}`);

    // nothing new since the cursor
    assert.deepEqual((await call("GET", `/activity?after=${feed.json.cursor}`)).json.events, []);
  });

  it("treats a bad or future cursor as a fresh start", async () => {
    const now = (await call("GET", "/activity")).json.cursor;
    assert.deepEqual((await call("GET", "/activity?after=abc")).json, { cursor: now, events: [] });
    assert.deepEqual((await call("GET", "/activity?after=999999")).json, { cursor: now, events: [] });
    assert.equal((await call("GET", "/activity?after=0")).json.events.length, 4);
  });
});
