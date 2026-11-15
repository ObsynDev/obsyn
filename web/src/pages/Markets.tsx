import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Candle, type ChartRange, type MarketChart, type MarketRow } from "../lib/api.ts";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { MARKETS, type KnownToken } from "../lib/tokens.ts";
import { Copy, short } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

/**
 * The market board: every featured market with its delayed reference price, a chart of the
 * underlying listing, what is open on this desk, and a ticket into the private desk.
 * All numbers come from /api/markets (server-side, cached); nothing here is made up.
 */

const EXPLORER = "https://robinhoodchain.blockscout.com";
const RANGES: [ChartRange, string][] = [
  ["1d", "1D"],
  ["5d", "5D"],
  ["1mo", "1M"],
  ["6mo", "6M"],
  ["1y", "1Y"],
];

type Row = KnownToken & { live: MarketRow | null };

const usd = (n: number) => (n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : n.toFixed(2));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n == null ? "" : n >= 0 ? "up" : "down");

function useMarkets() {
  const [rows, setRows] = useState<MarketRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.markets().then(
        (r) => alive && (setRows(r), setFailed(false)),
        () => alive && setFailed(true),
      );
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const merged: Row[] = useMemo(() => MARKETS.map((m) => ({ ...m, live: rows?.find((r) => r.symbol === m.symbol) ?? null })), [rows]);
  return { rows: merged, loaded: rows !== null, failed };
}

// ───────────────────────── small sparkline ─────────────────────────

export function Spark({ values, w = 72, h = 24 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <svg className="spark" width={w} height={h} aria-hidden="true" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className={`spark ${up ? "up" : "down"}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ───────────────────────── candle chart ─────────────────────────

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    setW(Math.floor(ref.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const timeLabel = (t: number, range: ChartRange) =>
  range === "1d" || range === "5d"
    ? new Date(t * 1000).toLocaleString("en-US", {
        timeZone: "America/New_York",
        ...(range === "5d" ? { weekday: "short" } : {}),
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    : new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(range === "1y" ? { year: "2-digit" } : {}) });

function CandleChart({ candles, range, prevClose }: { candles: Candle[]; range: ChartRange; prevClose: number | null }) {
  const [box, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 330;
  const AX = 64; // right axis
  const VOL = 44; // volume band
  const plotW = Math.max(0, W - AX);
  const plotH = H - VOL - 22;

  const { lo, hi, maxV } = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity,
      maxV = 0;
    for (const k of candles) {
      lo = Math.min(lo, k.l);
      hi = Math.max(hi, k.h);
      maxV = Math.max(maxV, k.v);
    }
    if (range === "1d" && prevClose) {
      lo = Math.min(lo, prevClose);
      hi = Math.max(hi, prevClose);
    }
    const pad = (hi - lo) * 0.08 || 1;
    return { lo: lo - pad, hi: hi + pad, maxV };
  }, [candles, range, prevClose]);

  if (!candles.length) return <div className="mb-chart empty mono">No candles for this range.</div>;

  const step = plotW / candles.length;
  const bw = Math.max(1, Math.min(10, step * 0.62));
  const y = (p: number) => 8 + (1 - (p - lo) / (hi - lo)) * plotH;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 5);
  const k = hover != null ? candles[hover] : candles[candles.length - 1];
  // fewer time labels on narrow charts so they never collide
  const nLabels = plotW < 460 ? 3 : 4;
  const labelsAt = Array.from({ length: nLabels }, (_, i) => Math.round((i * (candles.length - 1)) / (nLabels - 1)));

  return (
    <div className="mb-chart" ref={box}>
      <div className="mb-ohlc mono">
        <span>{timeLabel(k.t, range)}</span>
        <span>O {usd(k.o)}</span>
        <span>H {usd(k.h)}</span>
        <span>L {usd(k.l)}</span>
        <span className={k.c >= k.o ? "up" : "down"}>C {usd(k.c)}</span>
      </div>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          onPointerMove={(e) => {
            const x = e.clientX - (e.currentTarget.getBoundingClientRect().left ?? 0);
            const i = Math.floor(x / step);
            setHover(i >= 0 && i < candles.length ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="grid" />
              <text x={plotW + 10} y={y(t) + 4} className="axis">
                {usd(t)}
              </text>
            </g>
          ))}
          {range === "1d" && prevClose && (
            <g>
              <line x1={0} x2={plotW} y1={y(prevClose)} y2={y(prevClose)} className="prev" />
              <text x={plotW - 6} y={y(prevClose) - 6} textAnchor="end" className="axis dim">
                prev close {usd(prevClose)}
              </text>
            </g>
          )}
          {candles.map((c, i) => {
            const x = i * step + step / 2;
            const up = c.c >= c.o;
            const top = y(Math.max(c.o, c.c));
            const bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
            const vh = maxV ? (c.v / maxV) * (VOL - 6) : 0;
            return (
              <g key={c.t} className={up ? "up" : "down"} opacity={hover == null || hover === i ? 1 : 0.55}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} className="wick" />
                <rect x={x - bw / 2} y={top} width={bw} height={bh} rx={0.6} className="body" />
                <rect x={x - bw / 2} y={H - 22 - vh} width={bw} height={vh} className="vol" />
              </g>
            );
          })}
          {hover != null && <line x1={hover * step + step / 2} x2={hover * step + step / 2} y1={0} y2={H - 22} className="cross" />}
          <line x1={0} x2={plotW} y1={y(candles[candles.length - 1].c)} y2={y(candles[candles.length - 1].c)} className="last" />
          <g transform={`translate(${plotW + 2}, ${y(candles[candles.length - 1].c) - 9})`}>
            <rect width={AX - 4} height={18} rx={3} className="last-tag" />
            <text x={8} y={13} className="last-text">
              {usd(candles[candles.length - 1].c)}
            </text>
          </g>
          {labelsAt.map((i) => (
            <text
              key={i}
              x={i === 0 ? 0 : i === candles.length - 1 ? plotW : i * step + step / 2}
              textAnchor={i === 0 ? "start" : i === candles.length - 1 ? "end" : "middle"}
              y={H - 6}
              className="axis"
            >
              {timeLabel(candles[i].t, range)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function useChart(symbol: string, hasRef: boolean, range: ChartRange) {
  const [chart, setChart] = useState<MarketChart | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!hasRef) return;
    let alive = true;
    setErr(null);
    api.marketChart(symbol, range).then(
      (c) => alive && setChart(c),
      (e: Error) => alive && setErr(e.message),
    );
    return () => {
      alive = false;
    };
  }, [symbol, hasRef, range]);
  return { chart: chart && chart.symbol === symbol && chart.range === range ? chart : null, err };
}

// ───────────────────────── board ─────────────────────────

export function MarketBoard({ initial = "TSLA" }: { initial?: string }) {
  const { rows, loaded, failed } = useMarkets();
  const [sel, setSel] = useState(initial);
  const [range, setRange] = useState<ChartRange>("1d");
  const [q, setQ] = useState("");
  const m = rows.find((r) => r.symbol === sel) ?? rows[0];
  const ref = m.live?.ref ?? null;
  const hasRef = m.kind !== "crypto";
  const { chart, err } = useChart(m.symbol, hasRef, range);
  const list = rows.filter((r) => !q || `${r.symbol} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
  const desk = m.live?.desk;

  return (
    <div className="mb">
      <div className="mb-bar">
        <label className="mb-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets" aria-label="Search markets" />
        </label>
        <span className="mb-note mono">
          {failed ? "Prices unavailable right now" : "Reference prices of the listed stock · delayed"}
          <i className={`mb-dot ${failed ? "off" : loaded ? "on" : ""}`} aria-hidden="true" />
        </span>
      </div>

      <div className="mb-grid">
        {/* list */}
        <div className="mb-list" role="listbox" aria-label="Markets">
          {list.map((r) => {
            const p = r.live?.ref;
            return (
              <button
                key={r.symbol}
                role="option"
                aria-selected={r.symbol === m.symbol}
                className={`mb-row ${r.symbol === m.symbol ? "on" : ""}`}
                onClick={() => setSel(r.symbol)}
              >
                <TokenAvatar address={r.address} symbol={r.symbol} size={28} />
                <span className="mb-name">
                  <b>{r.symbol}</b>
                  <i>{r.name}</i>
                </span>
                <Spark values={p?.spark ?? []} w={52} h={20} />
                <span className="mb-px mono">
                  <b>{p ? usd(p.price) : r.kind === "crypto" ? "OTC" : loaded ? "—" : "…"}</b>
                  <i className={tone(p?.changePct)}>{p ? pct(p.changePct) : r.kind === "crypto" ? "no listing" : ""}</i>
                </span>
              </button>
            );
          })}
          {!list.length && <p className="mb-empty mono">No market matches “{q}”. Any ERC-20 still works on the desk by address.</p>}
        </div>

        {/* main */}
        <div className="mb-main">
          <div className="mb-head">
            <TokenAvatar address={m.address} symbol={m.symbol} size={44} />
            <div className="mb-title">
              <h3>
                {m.symbol} <span>{m.name}</span>
              </h3>
              <span className="mono dim small">
                {m.kind === "crypto" ? "Robinhood Chain token" : `${ref?.exchange ?? "Listed"} · Robinhood stock token`}
              </span>
            </div>
            {ref && (
              <div className="mb-quote">
                <b className="mono">${usd(ref.price)}</b>
                <span className="mono">
                  <i className={tone(ref.changePct)}>{pct(ref.changePct)} today</i>
                  <i className={tone(ref.weekChangePct)}>{pct(ref.weekChangePct)} 5D</i>
                </span>
              </div>
            )}
          </div>

          {hasRef ? (
            <>
              <div className="mb-tabs" role="tablist">
                {RANGES.map(([r, l]) => (
                  <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                    {l}
                  </button>
                ))}
                <span className="mono dim small">
                  {ref ? `as of ${new Date(ref.time * 1000).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET` : ""}
                </span>
              </div>
              {chart ? (
                <CandleChart candles={chart.candles} range={range} prevClose={chart.prevClose} />
              ) : (
                <div className="mb-chart empty mono">{err ? `Chart unavailable: ${err}` : "Loading chart…"}</div>
              )}
            </>
          ) : (
            <div className="mb-chart empty pons">
              <p>
                <b>No listed underlying.</b> {m.symbol} trades on Pons and Robinhood Chain. On this desk the price is whatever the sealed
                answers to your block say, and only you read them.
              </p>
              <a className="mono" href="https://www.ponsfamily.com/" target="_blank" rel="noreferrer">
                View on Pons ↗
              </a>
            </div>
          )}

          <dl className="mb-facts">
            <div>
              <dt>Token contract</dt>
              <dd className="mono">
                <a href={`${EXPLORER}/token/${m.address}`} target="_blank" rel="noreferrer">
                  {short(m.address)} ↗
                </a>
                <Copy text={m.address} />
              </dd>
            </div>
            <div>
              <dt>Gasless deposit</dt>
              <dd className="mono">{m.kind === "crypto" ? "approve + deposit" : "yes (permit)"}</dd>
            </div>
            <div>
              <dt>Open on this desk</dt>
              <dd className="mono">{desk ? `${desk.buy} bids · ${desk.sell} listings` : loaded ? "0 bids · 0 listings" : "…"}</dd>
            </div>
            <div>
              <dt>Settles in</dt>
              <dd className="mono">ETH or USDG</dd>
            </div>
          </dl>
        </div>

        {/* ticket */}
        <aside className="mb-ticket">
          <span className="mono dim small">PRIVATE BLOCK · {m.symbol}</span>
          <h4>Move {m.symbol} size without showing your price.</h4>
          <ol className="mb-steps">
            <li>
              <b>Post the size.</b> Others see {m.symbol} and the size, nothing else.
            </li>
            <li>
              <b>Read sealed answers.</b> Prices are encrypted to you.
            </li>
            <li>
              <b>Settle once.</b> Both sides swap in one escrow transaction.
            </li>
          </ol>
          <div className="mb-cta">
            <KeyButton to={`/otc?side=buy&token=${m.address}`} block glyph="↵">
              BID FOR {m.symbol}
            </KeyButton>
            <SlotButton to={`/otc?side=sell&token=${m.address}`}>SELL {m.symbol}</SlotButton>
          </div>
          <p className="mono dim small">Max fee 2.5%, set in the contract. Reference price only; your block settles at the price you accept.</p>
        </aside>
      </div>
    </div>
  );
}

// ───────────────────────── /markets page ─────────────────────────

export function Markets() {
  const initial = new URLSearchParams(window.location.search).get("m")?.toUpperCase() ?? "TSLA";
  return (
    <div className="mk-page">
      <header className="mk-head">
        <span className="eyebrow mono">MARKETS</span>
        <h1>
          {MARKETS.length} markets. <span className="tone">One sealed desk.</span>
        </h1>
        <p className="muted">
          Robinhood stock tokens, two index ETFs and PONS, each checked on Robinhood Chain. Prices shown are the listed stock's,
          delayed. Your block settles at the price you accept. Any other ERC-20 works by address.
        </p>
      </header>
      <MarketBoard initial={MARKETS.some((m) => m.symbol === initial) ? initial : "TSLA"} />
    </div>
  );
}
