import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTokenMarkets, parseDexScreener } from "../src/dexmarket.ts";

const ORBIO = "0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3";
const pair = (over: Record<string, unknown>) => ({
  chainId: "robinhood",
  url: "https://dexscreener.com/robinhood/0xpool",
  baseToken: { address: ORBIO, symbol: "ORBIO", name: "Orbio.so" },
  priceUsd: "0.01963",
  marketCap: 18651850,
  liquidity: { usd: 509383.73 },
  priceChange: { h24: -3.2 },
  volume: { h24: 12000 },
  info: { imageUrl: "https://dd.dexscreener.com/ds-data/tokens/robinhood/orbio.png" },
  ...over,
});

describe("DEX market snapshot", () => {
  it("picks the deepest Robinhood Chain pool where the token is the base", () => {
    const m = parseDexScreener(ORBIO, {
      pairs: [
        pair({ priceUsd: "0.0199", liquidity: { usd: 1000 } }),
        pair({}),
        pair({ chainId: "ethereum", liquidity: { usd: 9e9 } }), // other chain
        pair({ baseToken: { address: "0x0000000000000000000000000000000000000001" }, liquidity: { usd: 9e9 } }), // token is the quote
      ],
    });
    assert.equal(m.priceUsd, 0.01963);
    assert.equal(m.marketCap, 18651850);
    assert.equal(m.symbol, "ORBIO");
    assert.equal(m.pools, 2);
    assert.match(m.imageUrl!, /^https:\/\/dd\.dexscreener\.com\//);
  });

  it("drops image and pair links that aren't DexScreener's", () => {
    const m = parseDexScreener(ORBIO, { pairs: [pair({ info: { imageUrl: "javascript:alert(1)" }, url: "https://evil.example/x" })] });
    assert.equal(m.imageUrl, null);
    assert.equal(m.pairUrl, null);
  });

  it("returns nulls for an unlisted token or garbage", () => {
    for (const body of [{ pairs: null }, null, "nope", { pairs: [42, null] }]) {
      const m = parseDexScreener(ORBIO, body);
      assert.equal(m.priceUsd, null);
      assert.equal(m.pools, 0);
    }
  });

  it("caches lookups and retries after a failure", async () => {
    let calls = 0;
    let fail = true;
    const market = createTokenMarkets(async () => {
      calls++;
      if (fail) throw new Error("down");
      return { pairs: [pair({})] };
    });
    await assert.rejects(market(ORBIO));
    fail = false;
    assert.equal((await market(ORBIO)).priceUsd, 0.01963);
    await market(ORBIO);
    assert.equal(calls, 2);
  });
});
