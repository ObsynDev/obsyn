import { useEffect, useState } from "react";
import { api, type MarketRow } from "../lib/api.ts";
import { reducedMotion } from "../lib/motion.tsx";
import { market } from "../lib/tokens.ts";
import { TokenAvatar } from "./Terminal.tsx";

/**
 * Hero visual: the desk's own block ticket, tilted, with a second card stacked behind it.
 * The market and its reference price are live; the answers are sealed (that is the point).
 */
const CYCLE = [
  { sym: "TSLA", size: "2,500", side: "buy" as const },
  { sym: "NVDA", size: "4,000", side: "buy" as const },
  { sym: "AAPL", size: "1,200", side: "sell" as const },
];

export function HeroTicket() {
  const [i, setI] = useState(0);
  const [rows, setRows] = useState<MarketRow[] | null>(null);
  useEffect(() => {
    api.markets().then(setRows, () => {});
  }, []);
  useEffect(() => {
    if (reducedMotion()) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % CYCLE.length), 4200);
    return () => clearInterval(id);
  }, []);

  const c = CYCLE[i];
  const t = market(c.sym);
  const ref = rows?.find((r) => r.symbol === c.sym)?.ref ?? null;

  return (
    <div className="ht" aria-label="Example block ticket">
      <div className="ht-back" aria-hidden="true" />
      <div className="ht-card" key={c.sym}>
        <div className="ht-top">
          <TokenAvatar address={t.address} symbol={t.symbol} size={30} />
          <b>{t.symbol}</b>
          <span className="dim">{t.name} · Stock token</span>
          <span className="ht-tag mono">BLOCK TICKET</span>
        </div>

        <div className="ht-seg">
          <span className={c.side === "buy" ? "on" : ""}>Buy block</span>
          <span className={c.side === "sell" ? "on sell" : ""}>Sell block</span>
        </div>

        <div className="ht-rows">
          <div>
            <span>Size</span>
            <b className="mono">
              {c.size} {t.symbol}
            </b>
          </div>
          <div>
            <span>Reference</span>
            <b className="mono">
              {ref ? `$${ref.price.toFixed(2)}` : "…"}
              {ref?.changePct != null && (
                <i className={ref.changePct >= 0 ? "up" : "down"}>
                  {ref.changePct >= 0 ? "+" : "−"}
                  {Math.abs(ref.changePct).toFixed(2)}%
                </i>
              )}
            </b>
          </div>
          <div>
            <span>Pay in</span>
            <b className="mono">USDG</b>
          </div>
        </div>

        <div className="ht-answers">
          <span className="mono dim small">SEALED ANSWERS · ONLY YOU CAN READ THEM</span>
          {[0, 1, 2].map((k) => (
            <div key={k} className="ht-ans" style={{ animationDelay: `${0.25 + k * 0.35}s` }}>
              <span className="redact" />
              <span className="mono small">{k < 2 ? "signed" : "unverified"}</span>
            </div>
          ))}
        </div>

        <div className="ht-foot mono">
          <i className="ht-led" aria-hidden="true" /> Settles in one escrow transaction
        </div>
      </div>
    </div>
  );
}
