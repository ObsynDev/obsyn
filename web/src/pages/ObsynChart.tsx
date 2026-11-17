import { useEffect, useRef, useState } from "react";
import { PLATFORM_TOKEN } from "../lib/brand.tsx";

/** $OBSYN's Uniswap v4 pool (OBSYN/ETH) on Robinhood Chain. */
const POOL = "0x9fe79f5726a87aa2758f14ba929e6fe4277a7718d6862aa039d61974c0542355";
const EMBED = `https://dexscreener.com/robinhood/${POOL}?embed=1&theme=dark&chartTheme=dark&trades=0&info=0&tabs=0&chartLeftToolbar=0&chartType=usd&interval=15`;

/**
 * Live $OBSYN chart, embedded from DexScreener. It only loads when the section scrolls into
 * view, so a visitor who never gets there never contacts DexScreener.
 */
export function ObsynChart() {
  const T = PLATFORM_TOKEN.symbol;
  const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!PLATFORM_TOKEN.address) return null;
  return (
    <div className="obc" ref={box}>
      <div className="obc-head">
        <span className="tk-label mono">${T} · LIVE CHART · UNISWAP V4</span>
        <a className="mono" href={`https://dexscreener.com/robinhood/${POOL}`} target="_blank" rel="noreferrer">
          Open full chart ↗
        </a>
      </div>
      <div className="obc-frame">
        {show ? (
          <iframe title={`$${T} live price chart`} src={EMBED} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
        ) : (
          <span className="obc-wait mono">Loading chart…</span>
        )}
      </div>
      <p className="obc-note mono">Chart by DexScreener, read from the pool. Reference only.</p>
    </div>
  );
}
