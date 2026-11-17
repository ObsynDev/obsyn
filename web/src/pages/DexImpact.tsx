import type { TokenMarket } from "../lib/api.ts";
import { dexImpact } from "../lib/vs-market.ts";

/**
 * "The same size as a DEX market order" next to the OTC desk: an estimate from the deepest pool's
 * liquidity, so traders can see what size would cost them on the chart.
 */
export function DexImpact({ side, sizeUsd, market }: { side: "buy" | "sell"; sizeUsd: number | null; market: TokenMarket | null }) {
  if (!sizeUsd || !market?.liquidityUsd) return null;
  const pct = dexImpact(side, sizeUsd, market.liquidityUsd);
  if (pct === null) return null;
  const cost = (sizeUsd * pct) / 100;
  const tone = pct >= 5 ? "hot" : pct >= 1 ? "warm" : "cool";
  const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2)}`;
  return (
    <div className={`dex-impact ${tone}`} title="Estimate from the deepest DEX pool's liquidity (constant-product model). Real pools can be deeper or thinner near the price.">
      <span>
        Same size as a DEX market order: {side === "buy" ? "≈ " : "≈ "}
        <b>{pct >= 100 ? "more than the pool can fill" : `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}% ${side === "buy" ? "worse" : "less"}`}</b>
        {pct < 100 && <i> (≈ {money(cost)})</i>}
      </span>
      <span className="muted small">OTC fills at the price you agree, off the chart. Estimate from {money(market.liquidityUsd)} pool liquidity.</span>
    </div>
  );
}
