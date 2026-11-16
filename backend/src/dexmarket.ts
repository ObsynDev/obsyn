import { getAddress, type Address } from "viem";

/**
 * Market snapshot for any Robinhood Chain token, from DexScreener's public API
 * (the same numbers DEX screeners show). Reference only: deals settle at the sealed price.
 * The deepest pool where the token is the base asset wins.
 */

export interface TokenMarket {
  address: Address;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  imageUrl: string | null;
  pairUrl: string | null;
  pools: number;
}

const CHAIN = "robinhood";
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Pick the deepest Robinhood Chain pool for this token and normalise it. Pure, for tests. */
export function parseDexScreener(address: Address, body: unknown): TokenMarket {
  const want = getAddress(address);
  const pairs = (body as { pairs?: unknown[] } | null)?.pairs;
  const mine = (Array.isArray(pairs) ? pairs : []).filter((p): p is Record<string, any> => {
    if (!p || typeof p !== "object") return false;
    const q = p as Record<string, any>;
    try {
      return q.chainId === CHAIN && getAddress(String(q.baseToken?.address)) === want;
    } catch {
      return false;
    }
  });
  mine.sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0));
  const top = mine[0];
  // only https image links from DexScreener's own CDN go to the page
  const img = typeof top?.info?.imageUrl === "string" && /^https:\/\/[\w.-]*dexscreener\.com\//.test(top.info.imageUrl) ? top.info.imageUrl : null;
  return {
    address: want,
    symbol: top ? String(top.baseToken?.symbol ?? "").slice(0, 32) || null : null,
    name: top ? String(top.baseToken?.name ?? "").slice(0, 80) || null : null,
    priceUsd: top ? num(top.priceUsd) : null,
    marketCap: top ? (num(top.marketCap) ?? num(top.fdv)) : null,
    liquidityUsd: top ? num(top.liquidity?.usd) : null,
    change24h: top ? num(top.priceChange?.h24) : null,
    volume24h: top ? num(top.volume?.h24) : null,
    imageUrl: img,
    pairUrl: typeof top?.url === "string" && top.url.startsWith("https://dexscreener.com/") ? top.url : null,
    pools: mine.length,
  };
}

type Fetch = (url: string) => Promise<unknown>;
const defaultFetch: Fetch = async (url) => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`market data unavailable (${r.status})`);
  return r.json();
};

/** Cached lookups (60s), bounded so a flood of addresses can't grow memory. */
export function createTokenMarkets(fetchJson: Fetch = defaultFetch, ttlMs = 60_000) {
  const cache = new Map<string, { at: number; p: Promise<TokenMarket> }>();
  return function market(address: Address): Promise<TokenMarket> {
    const key = getAddress(address);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.p;
    if (cache.size > 2000) cache.clear();
    const p = fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${key}`).then((b) => parseDexScreener(key, b));
    cache.set(key, { at: Date.now(), p });
    p.catch(() => cache.delete(key));
    return p;
  };
}
