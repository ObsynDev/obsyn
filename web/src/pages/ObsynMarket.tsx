import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import type { TokenMarket } from "../lib/api.ts";
import { fomoUrl, PLATFORM_TOKEN } from "../lib/brand.tsx";
import { balanceOf, connectWallet } from "../lib/chain.ts";
import { useMarket } from "../lib/market.ts";
import { Err, short, useAction } from "../lib/ui.tsx";

/** "$0.00005567", "$1.23". Small prices keep 4 significant digits. */
export function fmtPrice(n: number) {
  if (n >= 1) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return "$" + n.toPrecision(4).replace(/0+$/, "");
}
/** "$55.3K", "$1.2M" */
export function fmtCompactUsd(n: number) {
  return "$" + n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

/** The platform token's market from its deepest pool. Reference only. */
export function useObsynMarket(): TokenMarket | null {
  return useMarket(PLATFORM_TOKEN.address as Address | null);
}

/** One line of $OBSYN market facts: price, market cap, liquidity, 24h change. */
export function ObsynMarketStrip({ m }: { m: TokenMarket | null }) {
  const T = PLATFORM_TOKEN.symbol;
  if (!PLATFORM_TOKEN.address) return null;
  const ch = m?.change24h ?? null;
  return (
    <div className="obm-strip mono" aria-label={`$${T} market`}>
      <span className="obm-k">${T}</span>
      <span>
        <i>PRICE</i> <b>{m?.priceUsd != null ? fmtPrice(m.priceUsd) : "…"}</b>
      </span>
      <span>
        <i>MCAP</i> <b>{m?.marketCap != null ? fmtCompactUsd(m.marketCap) : "…"}</b>
      </span>
      <span>
        <i>LIQUIDITY</i> <b>{m?.liquidityUsd != null ? fmtCompactUsd(m.liquidityUsd) : "…"}</b>
      </span>
      <span>
        <i>24H</i>{" "}
        <b className={ch == null ? "" : ch >= 0 ? "obm-up" : "obm-down"}>{ch == null ? "…" : `${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`}</b>
      </span>
      {m?.pairUrl && (
        <a href={m.pairUrl} target="_blank" rel="noreferrer">
          Uniswap v4 pool ↗
        </a>
      )}
      <span className="obm-ref">Reference only, from the pool.</span>
    </div>
  );
}

/**
 * Holder discount check: does this wallet hold enough $OBSYN for 0.5% off? Reads the balance
 * on-chain; the same rule the escrow applies at settlement (either side holding is enough).
 */
export function HolderCheck({ m }: { m: TokenMarket | null }) {
  const T = PLATFORM_TOKEN.symbol;
  const token = PLATFORM_TOKEN.address as Address | null;
  // the server sends it formatted ("1,000,000")
  const minWhole = PLATFORM_TOKEN.discountMin ? Number(PLATFORM_TOKEN.discountMin.replace(/,/g, "")) : null;
  const { address: connected } = useAccount();
  const [typed, setTyped] = useState("");
  const who = isAddress(typed.trim()) ? getAddress(typed.trim()) : connected ?? null;
  const [bal, setBal] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBal(null);
    setErr(null);
    if (!who || !token) return;
    let alive = true;
    balanceOf(token, who).then(
      (b) => alive && setBal(b),
      (e) => alive && setErr((e as Error).message.split("\n")[0]),
    );
    return () => {
      alive = false;
    };
  }, [who, token]);

  const connect = useAction(async () => {
    await connectWallet();
  });

  if (!token || !minWhole) return null;
  const held = bal === null ? null : Number(formatUnits(bal, 18));
  const ok = held !== null && held >= minWhole;
  const missing = held === null ? null : Math.max(0, minWhole - held);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div className="hold">
      <span className="tk-label mono">CHECK YOUR WALLET</span>
      {!who ? (
        <div className="hold-row">
          <button className="btn primary sm" disabled={connect.busy} onClick={() => connect.run()}>
            {connect.busy ? "Connecting…" : "Connect wallet"}
          </button>
          <span className="muted small">or paste any address below</span>
        </div>
      ) : held === null ? (
        <p className="muted small">{err ? `Couldn't read the balance: ${err}` : `Reading ${short(who)}…`}</p>
      ) : ok ? (
        <p className="hold-ok">
          ✓ <span className="mono">{short(who)}</span> holds {fmt(held)} ${T}. Every deal it's part of pays <b>0.5% less</b>.
        </p>
      ) : (
        <p className="hold-no">
          <span className="mono">{short(who)}</span> holds {fmt(held)} ${T}.{" "}
          <b>
            {fmt(missing!)} more
            {m?.priceUsd ? ` (≈ ${fmtCompactUsd(missing! * m.priceUsd)})` : ""}
          </b>{" "}
          for 0.5% off every deal.
        </p>
      )}
      {who && !ok && held !== null && (
        <div className="hold-buy mono">
          {PLATFORM_TOKEN.ponsUrl && (
            <a href={PLATFORM_TOKEN.ponsUrl} target="_blank" rel="noreferrer">
              Buy on Pons ↗
            </a>
          )}
          {fomoUrl() && (
            <a href={fomoUrl()!} target="_blank" rel="noreferrer">
              Buy on fomo ↗
            </a>
          )}
        </div>
      )}
      <input
        className="hold-input mono"
        placeholder="0x… check another wallet"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        spellCheck={false}
      />
      <Err msg={connect.error} />
    </div>
  );
}
