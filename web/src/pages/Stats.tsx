import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { api, type DeskStats, type ServerConfig } from "../lib/api.ts";
import { PLATFORM_TOKEN } from "../lib/brand.tsx";
import { explorerAddr } from "../lib/chain.ts";
import { Link, short } from "../lib/ui.tsx";
import { fmtCompactUsd, fmtPrice, useObsynMarket } from "./ObsynMarket.tsx";

const num = (v: string, decimals: number, max = 2) => Number(formatUnits(BigInt(v), decimals)).toLocaleString("en-US", { maximumFractionDigits: max });
const usd = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 });

/** Amount per pay currency: "1.2 ETH + 3,400 USDG + 50,000 OBSYN", or "0" when all are zero. */
function both(a: { eth: string; usdg: string; obsyn?: string }) {
  const parts = [];
  if (BigInt(a.eth) > 0n) parts.push(`${num(a.eth, 18, 4)} ETH`);
  if (BigInt(a.usdg) > 0n) parts.push(`${num(a.usdg, 6)} USDG`);
  if (BigInt(a.obsyn ?? "0") > 0n) parts.push(`${num(a.obsyn!, 18, 0)} OBSYN`);
  return parts.length ? parts.join(" + ") : "0";
}

/**
 * /stats — what the desk has done, read from the deals this server saw accepted and checked
 * against the escrow on-chain, plus the fee vault's buy-and-burn of $OBSYN.
 */
export function Stats() {
  const [s, setS] = useState<DeskStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const m = useObsynMarket();
  useEffect(() => {
    const load = () => api.stats().then(setS, (e) => setErr(e.message));
    load();
    api.config().then(setCfg, () => {});
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const sym = "$" + (PLATFORM_TOKEN.symbol ?? "OBSYN").replace(/^\$/, "");
  const sum = (k: "eth" | "usdg" | "obsyn") => (BigInt(s?.fees.protocol[k] ?? "0") + BigInt(s?.fees.referrer[k] ?? "0")).toString();
  const fees = s ? { eth: sum("eth"), usdg: sum("usdg"), obsyn: sum("obsyn") } : null;
  const burnedOnSettle = BigInt(s?.burnedOnSettle ?? "0");

  return (
    <div className="doc stats">
      <span className="label">Stats</span>
      <h1>
        The desk, <span className="copper">in numbers.</span>
      </h1>
      <p className="lede">
        Deals, settled volume, fees and the {sym} buy-and-burn. Every settled deal and every burn is a public transaction you can check on
        Robinhood Chain. Prices of open postings stay sealed and are never counted here.
      </p>

      {err && <p className="err">Couldn't load the stats: {err}</p>}
      {!s && !err && <p className="muted">Reading the desk and the contracts…</p>}

      {s && fees && (
        <>
          <section className="stat-grid">
            <Tile label="Settled volume" value={s.volumeUsd === null ? both(s.volume) : usd(s.volumeUsd)} sub={s.volumeUsd === null || both(s.volume) === "0" ? "paid by buyers in ETH, USDG and $OBSYN" : both(s.volume)} />
            <Tile
              label="Saved vs DEX"
              value={s.vsDex && s.vsDex.deals > 0 ? usd(s.vsDex.buyersSavedUsd + s.vsDex.sellersGainedUsd) : "–"}
              sub={
                s.vsDex && s.vsDex.deals > 0
                  ? `buyers ${usd(s.vsDex.buyersSavedUsd)} · sellers ${usd(s.vsDex.sellersGainedUsd)}, vs DEX market orders`
                  : "vs a DEX market order of the same size, per deal"
              }
            />
            <Tile label="Deals settled" value={s.deals.settled.toLocaleString("en-US")} sub={`${s.deals.accepted} accepted · ${s.deals.refunded} refunded`} />
            <Tile label="Fees at settlement" value={both(fees)} sub={both(s.fees.referrer) !== "0" ? `of which to referrers: ${both(s.fees.referrer)}` : "to the buy-and-burn vault, or burned when paid in $OBSYN"} />
            <Tile label="Tokens traded" value={String(s.tokensTraded)} sub="distinct tokens in settled deals" />
            <Tile label="Blocks posted" value={s.postings.total.toLocaleString("en-US")} sub={`${s.postings.open} open now`} />
            <Tile label="Sealed answers" value={s.postings.answers.toLocaleString("en-US")} sub="encrypted offers and bids sent" />
          </section>

          {PLATFORM_TOKEN.address && (
            <section className="doc-sect">
              <h2>{sym} market</h2>
              <section className="stat-grid">
                <Tile label="Price" value={m?.priceUsd != null ? fmtPrice(m.priceUsd) : "…"} sub="from its Uniswap v4 pool" />
                <Tile label="Market cap" value={m?.marketCap != null ? fmtCompactUsd(m.marketCap) : "…"} sub="1B fixed supply" />
                <Tile label="Liquidity" value={m?.liquidityUsd != null ? fmtCompactUsd(m.liquidityUsd) : "…"} sub="in the pool" />
                <Tile
                  label="24h"
                  value={m?.change24h != null ? `${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(1)}%` : "…"}
                  sub={m?.volume24h != null ? `${fmtCompactUsd(m.volume24h)} volume` : " "}
                />
              </section>
              <p className="muted small">
                Reference only, read from the pool through DexScreener.{" "}
                {m?.pairUrl && (
                  <a href={m.pairUrl} target="_blank" rel="noreferrer">
                    See the pool ↗
                  </a>
                )}
              </p>
            </section>
          )}

          <section className="doc-sect">
            <h2>{sym} buy-and-burn</h2>
            {s.vault ? (
              <>
                <section className="stat-grid">
                  <Tile label={`Burned by the fee vault`} value={`${num(s.vault.totalBurned, 18, 0)} ${sym}`} sub="bought with desk fees, sent to the burn address" />
                  {burnedOnSettle > 0n && (
                    <Tile label="Burned at settlement" value={`${num(burnedOnSettle.toString(), 18, 0)} ${sym}`} sub={`fees on deals paid in ${sym}, burned by the escrow`} />
                  )}
                  <Tile label="Fees waiting to burn" value={both({ eth: s.vault.ethWaiting, usdg: s.vault.usdgWaiting })} sub="in the vault now" />
                  {s.vault.burnedAtDead !== null && (
                    <Tile label="At the burn address" value={`${num(s.vault.burnedAtDead, 18, 0)} ${sym}`} sub="all sources, including the vault" />
                  )}
                </section>
                <p className="muted small">
                  Fees go to the{" "}
                  <a href={explorerAddr(s.vault.address as `0x${string}`)} target="_blank" rel="noreferrer" className="mono">
                    fee vault {short(s.vault.address)}
                  </a>
                  , which can only spend them buying {sym} and sending it to 0x…dEaD. Nobody can withdraw them.{" "}
                  <Link to="/docs#fees">How it works →</Link>
                </p>
              </>
            ) : (
              <p className="muted">The vault couldn't be read right now. Try again in a minute.</p>
            )}
          </section>

          <p className="muted small">
            Counts deals accepted through this desk (the site, the SDK and the MCP server), each checked against the{" "}
            {cfg?.escrow ? (
              <a href={explorerAddr(cfg.escrow)} target="_blank" rel="noreferrer">
                escrow contract
              </a>
            ) : (
              "escrow contract"
            )}
            . USD uses the ETH price at the time you load this page. Updated {new Date(s.updatedAt * 1000).toUTCString().replace("GMT", "UTC")}.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
