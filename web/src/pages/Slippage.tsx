import { useEffect, useMemo, useState } from "react";
import { marketOf } from "../lib/market.ts";
import { MARKETS, type KnownToken } from "../lib/tokens.ts";
import type { TokenMarket } from "../lib/api.ts";
import { dexImpact } from "../lib/vs-market.ts";
import { Link } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

const SIZES = [1_000, 10_000, 50_000, 100_000];
const money = (n: number) => "$" + (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 0.01 ? n.toFixed(2) : n.toPrecision(3));
const compact = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : money(n));

type Row = { t: KnownToken; m: TokenMarket | null; pct: number | null };

/**
 * /slippage: what a block costs as a DEX market order on Robinhood Chain, for every listed market,
 * from each token's deepest pool. The estimate the desk shows on every order, as one table.
 */
export function Slippage() {
  const q = new URLSearchParams(window.location.search);
  const [side, setSide] = useState<"buy" | "sell">(q.get("side") === "sell" ? "sell" : "buy");
  const [size, setSize] = useState(() => {
    const v = Number(q.get("size"));
    return Number.isFinite(v) && v >= 100 ? String(v) : "50000";
  });
  const [markets, setMarkets] = useState<Record<string, TokenMarket | null>>({});

  useEffect(() => {
    let alive = true;
    for (const t of MARKETS) marketOf(t.address).then((m) => alive && setMarkets((s) => ({ ...s, [t.address]: m })));
    return () => {
      alive = false;
    };
  }, []);

  // keep the URL shareable: /slippage?size=50000&side=buy
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("size", String(Number(size) || 0));
    if (side === "sell") p.set("side", "sell");
    const url = `/slippage?${p}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [size, side]);

  const sizeNum = Number(size.replace(/[,\s$]/g, ""));
  const rows: Row[] = useMemo(() => {
    const out = MARKETS.map((t) => {
      const m = markets[t.address] ?? null;
      const pct = m?.liquidityUsd && sizeNum > 0 ? dexImpact(side, sizeNum, m.liquidityUsd) : null;
      return { t, m, pct };
    });
    // the most expensive to fill on a DEX first; markets with no pool data last
    return out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [markets, sizeNum, side]);
  const loaded = Object.keys(markets).length;
  // the headline uses the deepest stock pool, so it's the most conservative number on the page
  const worst = rows
    .filter((r) => r.pct !== null && r.pct < 100 && r.t.kind !== "crypto")
    .sort((a, b) => (b.m?.liquidityUsd ?? 0) - (a.m?.liquidityUsd ?? 0))[0];

  const tweet = (r: Row) => {
    const verb = side === "buy" ? "Buying" : "Selling";
    const cost = r.pct !== null && r.pct < 100 ? `~${r.pct.toFixed(1)}% (~${money((sizeNum * r.pct) / 100)})` : "more than the pool can fill";
    return `${verb} ${compact(sizeNum)} of ${r.t.symbol} as a DEX market order on Robinhood Chain costs ${cost} in price impact.\n\nOn @Obsyntrade it's one sealed price, settled in one transaction.`;
  };
  const shareUrl = (r: Row) =>
    `https://x.com/intent/post?text=${encodeURIComponent(tweet(r))}&url=${encodeURIComponent(`${window.location.origin}/slippage?size=${sizeNum}${side === "sell" ? "&side=sell" : ""}`)}`;
  const postUrl = (r: Row) => {
    if (side === "buy") return `/otc?token=${r.t.address}&usd=${sizeNum}`;
    const tokens = r.m?.priceUsd ? sizeNum / r.m.priceUsd : null;
    return `/otc?token=${r.t.address}&side=sell${tokens ? `&amount=${Number(tokens.toPrecision(6))}` : ""}`;
  };

  return (
    <div className="doc slip">
      <span className="label">Slippage</span>
      <h1>
        The cost of size, <span className="copper">on-chain.</span>
      </h1>
      <p className="lede">
        What a block costs as a market order on Robinhood Chain's DEX pools, for every market we list. On {""}
        <Link to="/otc">the desk</Link> the same size trades at one price both sides agree, settled in one transaction.
      </p>

      <section className="slip-controls card">
        <div className="seg">
          <button type="button" className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>
            Buy
          </button>
          <button type="button" className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>
        <label className="slip-size">
          <span className="muted small">Size (USD)</span>
          <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" aria-label="Block size in USD" />
        </label>
        <div className="slip-presets">
          {SIZES.map((s) => (
            <button type="button" key={s} className={sizeNum === s ? "on" : ""} onClick={() => setSize(String(s))}>
              {compact(s)}
            </button>
          ))}
        </div>
      </section>

      {worst && (
        <p className="slip-headline">
          {side === "buy" ? "Buying" : "Selling"} {compact(sizeNum)} of {worst.t.symbol} on a DEX costs about <b>{money((sizeNum * worst.pct!) / 100)}</b> in price impact (
          {worst.pct!.toFixed(1)}%).
        </p>
      )}

      <div className="slip-table" role="table" aria-label="Price impact by market">
        <div className="slip-row head" role="row">
          <span>Market</span>
          <span>DEX price</span>
          <span>Pool liquidity</span>
          <span>{side === "buy" ? "Buy" : "Sell"} impact</span>
          <span>Cost</span>
          <span />
        </div>
        {rows.map((r) => {
          const cost = r.pct !== null && r.pct < 100 ? (sizeNum * r.pct) / 100 : null;
          const tone = r.pct === null ? "" : r.pct >= 5 ? "hot" : r.pct >= 1 ? "warm" : "cool";
          return (
            <div className="slip-row" role="row" key={r.t.address}>
              <span className="slip-mk">
                <TokenAvatar address={r.t.address} symbol={r.t.symbol} size={28} />
                <span>
                  <b>{r.t.symbol}</b>
                  <i className="muted small">{r.t.name}</i>
                </span>
              </span>
              <span className="mono">{r.m?.priceUsd ? money(r.m.priceUsd) : "–"}</span>
              <span className="mono">{r.m?.liquidityUsd ? compact(r.m.liquidityUsd) : loaded < MARKETS.length ? "…" : "no pool"}</span>
              <span className={`mono slip-pct ${tone}`}>{r.pct === null ? "–" : r.pct >= 100 ? "pool too thin" : `${r.pct < 10 ? r.pct.toFixed(2) : r.pct.toFixed(1)}%`}</span>
              <span className="mono">{cost === null ? "–" : money(cost)}</span>
              <span className="slip-acts">
                <Link to={postUrl(r)} className="btn primary sm">
                  Post OTC
                </Link>
                {r.pct !== null && (
                  <a className="btn ghost sm" href={shareUrl(r)} target="_blank" rel="noreferrer" aria-label={`Share ${r.t.symbol} on X`}>
                    Share
                  </a>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="muted small">
        Estimate from each token's deepest DEX pool (via DexScreener), constant-product model with half the pool's liquidity on each side: buying $S costs about S/Y more
        than the pool price, selling returns about S/(Y+S) less. Concentrated-liquidity pools can be deeper or thinner near the price, and fees and gas come on top. Reference
        only, not a quote.
      </p>
    </div>
  );
}
