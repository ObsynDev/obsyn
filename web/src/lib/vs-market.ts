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
}): number | null {
  const { market, amount, tokenDecimals, price, payToken, payDecimals } = opts;
  if (!market?.priceUsd || amount <= 0n) return null;
  const payUsd = payToken === zeroAddress ? market.ethUsd : 1; // USDG is a dollar
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
