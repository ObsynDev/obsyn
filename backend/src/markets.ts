import { getAddress, type Address } from "viem";

/**
 * The desk's featured markets. Every address was read on Robinhood Chain (4663): the stock
 * tokens report "<Company> • Robinhood Token", 18 decimals, EIP-2612 permit.
 * Any other ERC-20 still trades by address; this list only powers the market board.
 *
 * `ref` is the underlying listing used as a reference price (delayed, from Yahoo Finance,
 * fetched and cached by this server so visitors never call a third party).
 * The on-chain token can trade away from it.
 */
export const MARKETS: { symbol: string; name: string; address: Address; kind: "stock" | "etf" | "crypto"; ref: string | null }[] = [
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", kind: "stock", ref: "TSLA" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", kind: "stock", ref: "NVDA" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", kind: "stock", ref: "AAPL" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", kind: "stock", ref: "AMZN" },
  { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", kind: "stock", ref: "META" },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", kind: "stock", ref: "MSFT" },
  { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", kind: "stock", ref: "GOOGL" },
  { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", kind: "stock", ref: "COIN" },
  { symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", kind: "stock", ref: "AMD" },
  { symbol: "NFLX", name: "Netflix", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", kind: "stock", ref: "NFLX" },
  { symbol: "PLTR", name: "Palantir", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", kind: "stock", ref: "PLTR" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", kind: "etf", ref: "SPY" },
  { symbol: "QQQ", name: "Invesco QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", kind: "etf", ref: "QQQ" },
  { symbol: "PONS", name: "Pons", address: "0x39dBED3a2bd333467115dE45665cC57F813C4571", kind: "crypto", ref: null },
];

export const RANGES = {
  "1d": "5m",
  "5d": "30m",
  "1mo": "1d",
  "6mo": "1d",
  "1y": "1wk",
} as const;
export type Range = keyof typeof RANGES;

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
export interface RefQuote {
  source: "yahoo";
  ticker: string;
  exchange: string | null;
  currency: string;
  price: number;
  /** previous session's close */
  prevClose: number | null;
  /** change vs the previous session's close */
  changePct: number | null;
  /** change over the whole requested range (first candle's reference close → now) */
  rangeChangePct: number | null;
  /** unix seconds of the last trade the source reports */
  time: number;
  candles: Candle[];
}

export type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; desk-reference-price/1.0)", accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`reference source answered ${res.status}`);
  return res.json();
};

type YahooChart = {
  chart?: {
    result?: {
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        fullExchangeName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
};

export function parseYahoo(ticker: string, body: unknown): RefQuote {
  const r = (body as YahooChart).chart?.result?.[0];
  const m = r?.meta;
  if (!r || !m || typeof m.regularMarketPrice !== "number") {
    throw new Error((body as YahooChart).chart?.error?.description ?? "no reference price");
  }
  const q = r.indicators?.quote?.[0] ?? {};
  const ts = r.timestamp ?? [];
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // gaps (halts, pre-open)
    candles.push({ t: ts[i], o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  // previousClose = last session's close; chartPreviousClose = the close before the range starts
  const prev = m.previousClose ?? null;
  const rangeStart = m.chartPreviousClose ?? null;
  return {
    source: "yahoo",
    ticker,
    exchange: m.fullExchangeName ?? null,
    currency: m.currency ?? "USD",
    price: m.regularMarketPrice,
    prevClose: prev,
    changePct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
    rangeChangePct: rangeStart ? ((m.regularMarketPrice - rangeStart) / rangeStart) * 100 : null,
    time: m.regularMarketTime ?? 0,
    candles,
  };
}

/** Reference quotes with a small TTL cache; concurrent misses share one request. */
export function createReferencePrices(fetchJson: FetchJson = defaultFetchJson, ttlMs = 60_000, nowMs = () => Date.now()) {
  const cache = new Map<string, { at: number; p: Promise<RefQuote> }>();
  return function quote(ticker: string, range: Range): Promise<RefQuote> {
    const key = `${ticker}:${range}`;
    const hit = cache.get(key);
    if (hit && nowMs() - hit.at < ttlMs) return hit.p;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${RANGES[range]}&includePrePost=false`;
    const p = fetchJson(url).then((b) => parseYahoo(ticker, b));
    cache.set(key, { at: nowMs(), p });
    // don't keep a failure around for the whole TTL
    p.catch(() => {
      if (cache.get(key)?.p === p) cache.delete(key);
    });
    return p;
  };
}

export function findMarket(symbol: string) {
  return MARKETS.find((m) => m.symbol === symbol.toUpperCase());
}

export function marketByAddress(address: string) {
  const a = getAddress(address);
  return MARKETS.find((m) => m.address === a);
}
