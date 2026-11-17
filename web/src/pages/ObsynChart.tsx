import { useEffect, useRef, useState } from "react";
import { PLATFORM_TOKEN } from "../lib/brand.tsx";

/** $OBSYN's Uniswap v4 pool (OBSYN/ETH) on Robinhood Chain. */
const OBSYN_PAIR = "https://dexscreener.com/robinhood/0x9fe79f5726a87aa2758f14ba929e6fe4277a7718d6862aa039d61974c0542355";
const EMBED_OPTS = "embed=1&theme=dark&chartTheme=dark&trades=0&info=0&tabs=0&chartLeftToolbar=0&chartType=usd&interval=15";

/** A DexScreener pair page as an embeddable chart URL (only dexscreener.com pairs are accepted). */
export function embedUrl(pairUrl: string): string | null {
  try {
    const u = new URL(pairUrl);
    if (u.hostname !== "dexscreener.com") return null;
    return `https://dexscreener.com${u.pathname}?${EMBED_OPTS}`;
  } catch {
    return null;
  }
}

/**
 * Live chart of a token's pool, embedded from DexScreener. With `lazy`, it only loads when it
 * scrolls into view, so a visitor who never gets there never contacts DexScreener.
 */
export function DexChart({ pairUrl, title, lazy = false, className = "" }: { pairUrl: string; title: string; lazy?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(!lazy);
  const src = embedUrl(pairUrl);

  useEffect(() => {
    if (!lazy) return;
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
  }, [lazy]);

  return (
    <div className={`obc-frame ${className}`} ref={box}>
      {show && src ? (
        <iframe key={src} title={title} src={src} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
      ) : (
        <span className="obc-wait mono">{src ? "Loading chart…" : "No chart for this pool"}</span>
      )}
    </div>
  );
}

/** The live $OBSYN chart block in the homepage's token section. */
export function ObsynChart() {
  const T = PLATFORM_TOKEN.symbol;
  if (!PLATFORM_TOKEN.address) return null;
  return (
    <div className="obc">
      <div className="obc-head">
        <span className="tk-label mono">${T} · LIVE CHART · UNISWAP V4</span>
        <a className="mono" href={OBSYN_PAIR} target="_blank" rel="noreferrer">
          Open full chart ↗
        </a>
      </div>
      <DexChart pairUrl={OBSYN_PAIR} title={`$${T} live price chart`} lazy />
      <p className="obc-note mono">Chart by DexScreener, read from the pool. Reference only.</p>
    </div>
  );
}
