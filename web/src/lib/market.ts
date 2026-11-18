import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { api, type TokenMarket } from "./api.ts";
import { PAY_TOKENS } from "./tokens.ts";

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

const USDG = PAY_TOKENS.find((p) => p.symbol === "USDG")!.address.toLowerCase();

/**
 * USD price of what a deal is paid in when that isn't ETH or USDG (a deal paid in $OBSYN), for
 * comparing it with the market. undefined for ETH and USDG (vsMarket prices those itself).
 */
export function usePayUsd(payToken: Address | null | undefined): number | null | undefined {
  const other = payToken && payToken !== zeroAddress && payToken.toLowerCase() !== USDG ? payToken : null;
  const m = useMarket(other);
  return other ? (m?.priceUsd ?? null) : undefined;
}

export { vsLabel, vsMarket } from "./vs-market.ts";
