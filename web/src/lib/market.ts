import { useEffect, useState } from "react";
import type { Address } from "viem";
import { api, type TokenMarket } from "./api.ts";

/**
 * Reference price of a token, from its deepest on-chain DEX pool (via our server).
 * Reference only: a block settles at the price the two sides agreed.
 */
const cache = new Map<string, Promise<TokenMarket | null>>();
export function marketOf(token: Address): Promise<TokenMarket | null> {
  const k = token.toLowerCase();
  let p = cache.get(k);
  if (!p) {
    p = api.tokenMarket(token).then(
      (m) => m,
      () => null,
    );
    p.then((m) => m === null && cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

export function useMarket(token: Address | null | undefined) {
  const [m, setM] = useState<TokenMarket | null>(null);
  useEffect(() => {
    setM(null);
    if (!token) return;
    let alive = true;
    marketOf(token).then((v) => alive && setM(v));
    return () => {
      alive = false;
    };
  }, [token]);
  return m;
}

export { vsLabel, vsMarket } from "./vs-market.ts";
