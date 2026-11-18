import { formatUnits, zeroAddress, type Address } from "viem";
import type { TokenMarket } from "./api.ts";

/**
 * How a total price for an amount compares with the market, as a percent.
 * Negative = cheaper than market. null when there's no usable market price.
 */
export function vsMarket(opts: {
  market: TokenMarket | null;
  amount: bigint;
  tokenDecimals: number;
  price: bigint;
  payToken: Address;
  payDecimals: number;
  /** USD price of the pay token when it isn't ETH or USDG (e.g. $OBSYN); null = unknown */
  payUsd?: number | null;
}): number | null {
  const { market, amount, tokenDecimals, price, payToken, payDecimals } = opts;
  if (!market?.priceUsd || amount <= 0n) return null;
  // ETH at its market price, $OBSYN at the price passed in, USDG is a dollar
  const payUsd = payToken === zeroAddress ? market.ethUsd : opts.payUsd !== undefined ? opts.payUsd : 1;
  if (!payUsd) return null;
  const unitUsd = (Number(formatUnits(price, payDecimals)) * payUsd) / Number(formatUnits(amount, tokenDecimals));
  if (!isFinite(unitUsd) || unitUsd <= 0) return null;
  return (unitUsd / market.priceUsd - 1) * 100;
}

/** "4.2% under market" / "1.1% over market" / "at market". */
export function vsLabel(pct: number): string {
  const a = Math.abs(pct);
  if (a < 0.05) return "at market";
  return `${a < 10 ? a.toFixed(1) : a.toFixed(0)}% ${pct < 0 ? "under" : "over"} market`;
}

/**
 * Estimated cost of doing the same size as a market order on the token's deepest DEX pool, as a percent
 * versus the current price. Constant-product model on that pool's liquidity (half of it per side):
 *   buying Δ dollars: average price is (1 + Δ/Y) times spot, so impact = Δ/Y
 *   selling Δ dollars at spot: you receive Y·Δ/(Y+Δ), so impact = Δ/(Y+Δ)
 * Concentrated-liquidity pools can be deeper or thinner near the price, so this is an estimate.
 */
export function dexImpact(side: "buy" | "sell", sizeUsd: number, liquidityUsd: number | null | undefined): number | null {
  if (!liquidityUsd || liquidityUsd <= 0 || !isFinite(sizeUsd) || sizeUsd <= 0) return null;
  const y = liquidityUsd / 2;
  return (side === "buy" ? sizeUsd / y : sizeUsd / (y + sizeUsd)) * 100;
}
