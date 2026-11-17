/**
 * Links out to a DEX for small trades. Obsyn never routes these swaps: the user trades on
 * Uniswap directly, from their own wallet. Big size belongs on the desk (no slippage).
 * `chain=robinhood` is the Uniswap interface's URL name for Robinhood Chain.
 */
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** Uniswap swap page for `token`, paying ETH (crypto) or USDG (stock tokens and ETFs). */
export function swapUrl(token: string, kind: "stock" | "etf" | "crypto" | "pay" = "crypto") {
  const input = kind === "stock" || kind === "etf" ? USDG : "ETH";
  return `https://app.uniswap.org/swap?chain=robinhood&inputCurrency=${input}&outputCurrency=${token}`;
}
