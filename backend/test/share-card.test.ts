import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, zeroAddress } from "viem";
import { createApp } from "../src/app.ts";
import { blockCardSvg, cardSvg, fmtNum, renderBlockCard, renderCard } from "../src/card.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";
import { vsDex } from "../src/vsdex.ts";

describe("saved vs DEX", () => {
  it("prices both sides against a DEX market order of the same size", () => {
    // 100 tokens at $10 = $1,000 on a $20,000 pool (Y = $10,000 per side), block paid $1,000
    const v = vsDex({ amount: 100, paid: 1000, tokenUsd: 10, payUsd: 1, liquidityUsd: 20_000 })!;
    assert.equal(v.sizeUsd, 1000);
    assert.equal(v.dealUsd, 1000);
    assert.equal(v.buyImpactPct, 10); // 1,000 / 10,000
    assert.equal(v.buyerSavedUsd, 100); // DEX buy ~ $1,100
    assert.equal(v.sellerGainedUsd, 90.91); // DEX sell ~ 1000 * (1 - 1000/11000)
    assert.equal(v.thin, false);
  });

  it("shows a worse-than-DEX block as negative, not hidden", () => {
    const v = vsDex({ amount: 100, paid: 1200, tokenUsd: 10, payUsd: 1, liquidityUsd: 2_000_000 })!;
    assert.ok(v.buyerSavedUsd! < 0);
    assert.ok(v.sellerGainedUsd! > 0);
  });

  it("claims nothing when the pool is too thin or a price is missing", () => {
    const thin = vsDex({ amount: 100, paid: 1000, tokenUsd: 10, payUsd: 1, liquidityUsd: 1500 })!;
    assert.equal(thin.thin, true);
    assert.equal(thin.buyerSavedUsd, null);
    assert.equal(vsDex({ amount: 100, paid: 1000, tokenUsd: 0, payUsd: 1, liquidityUsd: 1e6 }), null);
  });
});

describe("share card", () => {
  const data = {
    tokenSymbol: "NVDA",
    amount: 0.25,
    paySymbol: "OBSYN",
    paid: 20000,
    fee: { amount: 300, symbol: "OBSYN", burned: true },
    vs: vsDex({ amount: 0.25, paid: 20000, tokenUsd: 180, payUsd: 0.0023, liquidityUsd: 400_000 }),
    timestamp: 1_794_980_000,
    txHash: `0x${"ab".repeat(32)}`,
    block: "117174692",
  };

  it("draws a 1200x630 PNG", () => {
    const png = renderCard(data);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  });

  it("escapes text and says when the fee was burned", () => {
    const svg = cardSvg({ ...data, tokenSymbol: "<x>" });
    assert.ok(!svg.includes("<x>"));
    assert.ok(svg.includes("FEE BURNED"));
    assert.ok(cardSvg({ ...data, fee: { amount: 1.125, symbol: "USDG", burned: false } }).includes("FEE TO BUY-AND-BURN"));
  });

  it("draws an open block's card without any price", () => {
    const svg = blockCardSvg({ side: "buy", size: "~$5,000 of NVDA", paySymbol: "USDG", answers: 2, secondsLeft: 3 * 3600 + 120, open: true, id: "abc123" });
    assert.ok(svg.includes("BUYING") && svg.includes("~$5,000 of NVDA") && svg.includes("sealed offers only") && svg.includes("3h 2m"));
    assert.ok(!/\$\d+(\.\d+)? (per|each)/.test(svg));
    const closed = blockCardSvg({ side: "sell", size: "1,000 TSLA", paySymbol: "OBSYN", answers: 0, secondsLeft: -5, open: true, id: "x" });
    assert.ok(closed.includes("CLOSED") && closed.includes("SELLING"));
    const png = renderBlockCard({ side: "buy", size: "10 NVDA", paySymbol: "ETH", answers: 1, secondsLeft: 600, open: true, id: "y" });
    assert.equal(png.subarray(1, 4).toString(), "PNG");
  });

  it("formats numbers compactly", () => {
    assert.equal(fmtNum(0.25), "0.25");
    assert.equal(fmtNum(20000), "20,000");
    assert.equal(fmtNum(1_500_000), "1.5M");
  });
});

describe("receipt API with vs DEX and card", () => {
  const USDG = "0x00000000000000000000000000000000000000A1";
  const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
  const TX = `0x${"11".repeat(32)}` as const;
  const relayer: Relayer = { info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }), relayDeposit: async () => Promise.reject(new Error("unused")) };
  const clock = 1_800_000_000;
  const app = createApp({
    cfg: loadConfig({ ESCROW_ADDRESS: "0x00000000000000000000000000000000000000E5", USDG_ADDRESS: USDG }),
    db: openDb(":memory:"),
    relayer,
    readPrice: async (token) => ({ token, quote: "ETH", price: 0.001, source: "test", blockNumber: "1" }),
    readToken: async (a) => ({ address: a, isContract: true, name: "Test Stock", symbol: "TSTK", decimals: 18, totalSupply: "0" }) as never,
    tokenMarket: async (a) => ({ address: a, symbol: "TSTK", name: null, priceUsd: 10, marketCap: null, liquidityUsd: 20_000, change24h: null, volume24h: null, imageUrl: null, pairUrl: null, pools: 1 }),
    readReceipt: async (tx) => ({
      txHash: tx,
      dealId: `0x${"cd".repeat(32)}`,
      block: "42",
      timestamp: clock - 60,
      settledBy: "depositTokens",
      terms: { buyer: TOKEN, seller: TOKEN, token: TOKEN, amount: (100n * 10n ** 18n).toString(), payToken: getAddress(USDG), price: "1000000000", sellerPayout: TOKEN, referrer: zeroAddress, relayerFee: "0", deadline: "0", salt: `0x${"01".repeat(32)}` },
      protocolFee: "25000000",
      referrerFee: "0",
      relayerFee: "0",
      sellerProceeds: "975000000",
    }),
    now: () => clock,
  });

  it("adds the vs-DEX numbers to the receipt and the stats", async () => {
    const r = (await (await app.request(`/receipts/${TX}`)).json()) as any;
    assert.equal(r.vsDex.buyerSavedUsd, 100);
    assert.equal(r.vsDex.sellerGainedUsd, 90.91);
  });

  it("serves the card as a PNG", async () => {
    const res = await app.request(`/receipts/${TX}/card.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString(), "PNG");
    assert.equal((await app.request(`/receipts/nope/card.png`)).status, 400);
  });
});
