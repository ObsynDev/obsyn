import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nacl from "tweetnacl";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { answeredDeals, makerMessage, makerStats, type DealRef } from "../src/makers.ts";
import type { Relayer } from "../src/relayer.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const USDG = getAddress("0x00000000000000000000000000000000000000A1");
const ESCROW = getAddress("0x00000000000000000000000000000000000000E5");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const relayer: Relayer = { info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }), relayDeposit: async () => Promise.reject(new Error("unused")) };

function setup(chain: Record<string, number> = {}) {
  let clock = 1_800_000_000;
  const db = openDb(":memory:");
  const app = createApp({
    cfg: loadConfig({ ESCROW_ADDRESS: ESCROW, USDG_ADDRESS: USDG }),
    db,
    relayer,
    readPrice: async () => Promise.reject(new Error("n/a")),
    readDeal: async (_e, id) => ({ status: chain[id.toLowerCase()] ?? 1, buyerFunded: false, sellerFunded: false }),
    now: () => clock,
  });
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { app, db, call, tick: (s: number) => (clock += s), now: () => clock };
}

async function signed(key: `0x${string}`, action: "list" | "unlist", name: string, issuedAt: number) {
  const acct = privateKeyToAccount(key);
  return { action, address: acct.address, name, issuedAt, signature: await acct.signMessage({ message: makerMessage(action, acct.address, name, issuedAt) }) };
}

describe("maker listing", () => {
  it("lists a maker from a signed message and shows it", async () => {
    const t = setup();
    const key = generatePrivateKey();
    const r = await t.call("POST", "/makers", await signed(key, "list", "Night Desk", t.now()));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const list = (await t.call("GET", "/makers")).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Night Desk");
    assert.equal(list[0].address, privateKeyToAccount(key).address);
    assert.deepEqual(list[0].stats, { accepted: 0, settled: 0, open: 0, unsettled: 0, settleRate: null });
  });

  it("refuses expired, forged, replayed and misleading listings", async () => {
    const t = setup();
    const key = generatePrivateKey();
    const other = generatePrivateKey();
    assert.match((await t.call("POST", "/makers", await signed(key, "list", "Desk A", t.now() - 601))).json.error, /expired/);
    const forged = { ...(await signed(other, "list", "Desk A", t.now())), address: privateKeyToAccount(key).address };
    assert.match((await t.call("POST", "/makers", forged)).json.error, /doesn't match/);
    assert.match((await t.call("POST", "/makers", await signed(key, "list", "Obsyn Official", t.now()))).json.error, /can't contain/);
    assert.match((await t.call("POST", "/makers", await signed(key, "list", "x", t.now()))).json.error, /2-24/);
    assert.match((await t.call("POST", "/makers", { ...(await signed(key, "list", "Desk A", t.now())), action: "promote" })).json.error, /action/);

    const msg = await signed(key, "list", "Desk A", t.now());
    assert.equal((await t.call("POST", "/makers", msg)).status, 200);
    assert.match((await t.call("POST", "/makers", msg)).json.error, /already used/, "the same signed message can't be replayed");
    t.tick(1);
    assert.match((await t.call("POST", "/makers", await signed(other, "list", "desk  a", t.now()))).json.error, /taken/, "names are unique, ignoring case and spacing");
  });

  it("unlists, and an old listing signature can't bring it back", async () => {
    const t = setup();
    const key = generatePrivateKey();
    const first = await signed(key, "list", "Desk B", t.now());
    await t.call("POST", "/makers", first);
    t.tick(5);
    assert.equal((await t.call("POST", "/makers", await signed(key, "unlist", "Desk B", t.now()))).status, 200);
    assert.equal((await t.call("GET", "/makers")).json.length, 0);
    assert.match((await t.call("POST", "/makers", first)).json.error, /already used/);
    t.tick(5);
    assert.equal((await t.call("POST", "/makers", await signed(key, "list", "Desk B", t.now()))).status, 200);
    assert.equal((await t.call("GET", "/makers")).json.length, 1);
  });
});

describe("maker track record", () => {
  it("counts settled, open and unsettled deals, checked on-chain", async () => {
    const now = 1_800_000_000;
    const m = "0x00000000000000000000000000000000000000aa";
    const deals: DealRef[] = [
      { dealId: "0x01", escrow: null, answerer: m, deadline: now - 10, settleTx: "0xabc" }, // reported settled
      { dealId: "0x02", escrow: null, answerer: m, deadline: now - 10, settleTx: null }, // settled on-chain, never reported
      { dealId: "0x03", escrow: null, answerer: m, deadline: now - 10, settleTx: null }, // expired unfunded
      { dealId: "0x04", escrow: null, answerer: m, deadline: now - 10, settleTx: null }, // refunded
      { dealId: "0x05", escrow: null, answerer: m, deadline: now + 600, settleTx: null }, // still open
      { dealId: "0x06", escrow: null, answerer: m, deadline: now - 10, settleTx: null }, // chain unreadable
      { dealId: "0x07", escrow: null, answerer: "0xbb", deadline: now - 10, settleTx: null }, // someone else
    ];
    const chain: Record<string, number> = { "0x02": 2, "0x03": 0, "0x04": 3, "0x05": 1 };
    const s = (await makerStats([m], deals, async (_e, id) => {
      if (id === "0x06") throw new Error("rpc down");
      return chain[id];
    }, now)).get(m)!;
    assert.deepEqual(s, { accepted: 6, settled: 2, open: 2, unsettled: 2, settleRate: 0.5 });
  });

  it("knows who answered from the accepted terms, on bids and on listings", async () => {
    const t = setup();
    const maker = privateKeyToAccount(generatePrivateKey()).address;
    const poster = privateKeyToAccount(generatePrivateKey()).address;
    const terms = (buyer: string, seller: string, salt: string) => ({ buyer, seller, token: TOKEN, amount: "1000", payToken: USDG, price: "5000000", sellerPayout: seller, referrer: "0x0000000000000000000000000000000000000000", relayerFee: "0", deadline: String(t.now() + 3600), salt });
    for (const [side, tm] of [["buy", terms(poster, maker, `0x${"01".repeat(32)}`)], ["sell", terms(maker, poster, `0x${"02".repeat(32)}`)]] as const) {
      const post = await t.call("POST", "/rfqs", { side, token: TOKEN, payToken: "USDG", amount: "1000", replySeconds: 3600, encPubKey: b64(nacl.box.keyPair().publicKey) });
      const q = await t.call("POST", `/rfqs/${post.json.id}/quotes`, { sellerEncPubKey: b64(nacl.box.keyPair().publicKey), nonce: b64(nacl.randomBytes(24)), ciphertext: b64(nacl.randomBytes(80)) });
      const acc = await t.call("POST", `/rfqs/${post.json.id}/accept`, { quoteId: q.json.quoteId, terms: tm }, post.json.manageToken);
      assert.equal(acc.status, 200, JSON.stringify(acc.json));
    }
    const deals = answeredDeals(t.db);
    assert.equal(deals.length, 2);
    assert.ok(deals.every((d) => d.answerer === maker.toLowerCase()), JSON.stringify(deals));
  });
});
