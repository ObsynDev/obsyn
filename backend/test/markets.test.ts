import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nacl from "tweetnacl";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { createReferencePrices, MARKETS, parseYahoo, type Range } from "../src/markets.ts";
import type { Relayer } from "../src/relayer.ts";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const USDG = "0x00000000000000000000000000000000000000A1";
const TSLA = MARKETS.find((m) => m.symbol === "TSLA")!.address;
const clock = 1_800_000_000;

const yahooBody = (price: number, prev: number, rangeStart = prev / 2) => ({
  chart: {
    result: [
      {
        meta: { currency: "USD", regularMarketPrice: price, previousClose: prev, chartPreviousClose: rangeStart, regularMarketTime: clock, fullExchangeName: "NasdaqGS" },
        timestamp: [clock - 120, clock - 60, clock],
        indicators: { quote: [{ open: [1, null, 3], high: [2, null, 4], low: [0.5, null, 2.5], close: [1.5, null, 3.5], volume: [10, null, 30] }] },
      },
    ],
    error: null,
  },
});

const relayer: Relayer = {
  info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "0", usdg: "0" } }),
  async relayDeposit() {
    throw new Error("unused");
  },
};

function setup(refQuote: (t: string, r: Range) => Promise<any>) {
  return createApp({
    cfg: loadConfig({ USDG_ADDRESS: USDG, PUBLIC_URL: "https://otc.example" }),
    db: openDb(":memory:"),
    relayer,
    readPrice: async () => {
      throw new Error("unused");
    },
    refQuote,
    now: () => clock,
  });
}

async function get(app: ReturnType<typeof setup>, path: string) {
  const res = await app.request(path);
  return { status: res.status, json: (await res.json()) as any };
}

describe("market board", () => {
  it("parses a Yahoo chart and skips gap candles", () => {
    const q = parseYahoo("TSLA", yahooBody(390, 400));
    assert.equal(q.price, 390);
    assert.equal(q.prevClose, 400);
    assert.equal(q.changePct, -2.5); // vs yesterday's close, not the start of the chart range
    assert.equal(q.rangeChangePct, 95);
    assert.equal(q.candles.length, 2);
    assert.deepEqual(q.candles[1], { t: clock, o: 3, h: 4, l: 2.5, c: 3.5, v: 30 });
    assert.throws(() => parseYahoo("X", { chart: { result: null, error: { description: "No data found" } } }), /No data found/);
  });

  it("caches reference quotes and does not cache failures", async () => {
    let calls = 0;
    let fail = true;
    const quote = createReferencePrices(async () => {
      calls++;
      if (fail) throw new Error("down");
      return yahooBody(10, 10);
    });
    await assert.rejects(quote("TSLA", "5d"), /down/);
    fail = false;
    assert.equal((await quote("TSLA", "5d")).price, 10); // the failure was not cached
    await quote("TSLA", "5d");
    assert.equal(calls, 2);
  });

  it("lists every market with reference prices and open desk blocks", async () => {
    const app = setup(async (ticker) => {
      if (ticker === "NVDA") throw new Error("source down");
      return parseYahoo(ticker, yahooBody(100, 80));
    });
    const keys = nacl.box.keyPair();
    const post = await app.request("/rfqs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "sell", token: TSLA, payToken: "USDG", amount: "1000000000000000000", replySeconds: 3600, encPubKey: b64(keys.publicKey) }),
    });
    assert.equal(post.status, 201);

    const { status, json } = await get(app, "/markets");
    assert.equal(status, 200);
    assert.equal(json.length, MARKETS.length);
    const tsla = json.find((m: any) => m.symbol === "TSLA");
    assert.equal(tsla.ref.price, 100);
    assert.equal(tsla.ref.changePct, 25);
    assert.equal(tsla.ref.weekChangePct, 150);
    assert.deepEqual(tsla.ref.spark, [1.5, 3.5]);
    assert.deepEqual(tsla.desk, { open: 1, buy: 0, sell: 1 });
    // one source failure leaves that market without a price, not the whole board
    assert.equal(json.find((m: any) => m.symbol === "NVDA").ref, null);
    // PONS has no listed underlying
    assert.equal(json.find((m: any) => m.symbol === "PONS").ref, null);
  });

  it("serves candles and validates symbol and range", async () => {
    const app = setup(async (ticker) => parseYahoo(ticker, yahooBody(5, 4)));
    const ok = await get(app, "/markets/tsla/chart?range=1mo");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.symbol, "TSLA");
    assert.equal(ok.json.candles.length, 2);
    assert.equal((await get(app, "/markets/NOPE/chart")).status, 404);
    assert.equal((await get(app, "/markets/PONS/chart")).status, 404);
    assert.equal((await get(app, "/markets/TSLA/chart?range=10y")).status, 400);
  });
});
