import { MARKETS, PAY_TOKENS } from "../lib/tokens.ts";
import { TokenAvatar } from "./Terminal.tsx";

/**
 * Mobbin-style side columns: app-icon tiles of the real market logos drifting
 * vertically in a loop, two columns per side. The outer column sits further back
 * (smaller, blurred), the inner one is sharp. Left drifts up, right drifts down.
 */
const ALL = [...MARKETS, ...PAY_TOKENS];
const pick = (offset: number, n: number) => Array.from({ length: n }, (_, i) => ALL[(i * 3 + offset) % ALL.length]);

function Column({ items, dir, depth, delay }: { items: typeof ALL; dir: "up" | "down"; depth: "near" | "far"; delay: number }) {
  return (
    <div className={`ic-col ${depth}`}>
      <div className={`ic-track ${dir}`} style={{ animationDelay: `${delay}s` }}>
        {[0, 1].map((k) => (
          <div key={k} className="ic-set" aria-hidden={k === 1}>
            {items.map((t, i) => (
              <div key={`${t.symbol}-${i}`} className="ic-tile" style={{ ["--r" as string]: `${((i % 3) - 1) * 5}deg` }}>
                <TokenAvatar address={t.address} symbol={t.symbol} size={depth === "near" ? 104 : 84} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function IconColumns() {
  return (
    <>
      <div className="ic-side left" aria-hidden="true">
        <Column items={pick(0, 6)} dir="up" depth="far" delay={-6} />
        <Column items={pick(1, 6)} dir="up" depth="near" delay={-14} />
      </div>
      <div className="ic-side right" aria-hidden="true">
        <Column items={pick(2, 6)} dir="down" depth="near" delay={-3} />
        <Column items={pick(4, 6)} dir="down" depth="far" delay={-11} />
      </div>
    </>
  );
}
