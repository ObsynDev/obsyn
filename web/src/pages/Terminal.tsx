import { useEffect, useMemo, useState } from "react";
import { knownToken, type TokenIcon } from "../lib/tokens.ts";
import { formatUnits, zeroAddress, type Address } from "viem";
import { api, type Rfq } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { sideOf } from "../lib/sealed.ts";
import { exportBackup, importBackup, saved } from "../lib/store.ts";
import { Copy, Link, short, useNow, usePoll } from "../lib/ui.tsx";
import { NewBlock } from "./NewBlock.tsx";

// ───────────────────────── helpers ─────────────────────────

/** 250000 → "250K", 1234567 → "1.23M" */
export function compact(v: bigint | string, decimals: number) {
  const n = Number(formatUnits(BigInt(v), decimals));
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const [d, s] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const x = n / d;
  return (x >= 100 || s === "" ? x.toLocaleString("en-US", { maximumFractionDigits: s === "" ? 4 : 0 }) : x.toFixed(x >= 10 ? 1 : 2)).replace(/\.0+$/, "") + s;
}

function timeLeft(sec: number) {
  if (sec <= 0) return "closed";
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return `${sec}s`;
}

/** Deterministic avatar: hue from the contract address, initials from the symbol. */
export function TokenAvatar({ address, symbol, size = 52, side }: { address: Address; symbol?: string; size?: number; side?: "buy" | "sell" }) {
  const known = knownToken(address);
  if (known) return <LogoAvatar icon={known.icon} size={size} side={side} />;
  const h = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = (h + 50) % 360;
  const label = address === zeroAddress ? "Ξ" : (symbol ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      className={`avatar ${side ?? ""}`}
      style={{
        width: size,
        height: size,
        // a lit coin: highlight top-left, body colour, darker rim
        background: `radial-gradient(circle at 32% 26%, hsl(${h} 95% 78%) 0%, hsl(${h} 78% 52%) 34%, hsl(${h2} 82% 30%) 78%, hsl(${h2} 85% 18%) 100%)`,
        fontSize: size * 0.36,
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

/** The token's real logo on its brand colour. */
function LogoAvatar({ icon, size, side }: { icon: TokenIcon; size: number; side?: "buy" | "sell" }) {
  return (
    <span className={`avatar logo ${side ?? ""}`} style={{ width: size, height: size, background: icon.bg, color: icon.fg }} aria-hidden="true">
      {icon.img ? (
        <img src={icon.img} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : icon.text ? (
        <span className="logo-text" style={{ fontSize: size * (icon.text.length > 3 ? 0.24 : 0.28) }}>
          {icon.text}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56}>
          {icon.mark === "microsoft" ? (
            <>
              <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
              <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
              <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
              <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
            </>
          ) : icon.mark === "amazon" ? (
            <>
              <text x="12" y="14.5" textAnchor="middle" fontSize="17" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif" fill="#ffffff">
                a
              </text>
              <path d="M4.5 17.2c4.6 2.9 10.4 2.9 15 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M17.6 15.6l2.3 1.4-1.1 2.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : (
            <path d={icon.path} fill="currentColor" />
          )}
        </svg>
      )}
    </span>
  );
}

function useTok(addr: Address) {
  const [t, setT] = useState<TokenInfo | null>(null);
  useEffect(() => {
    tokenInfo(addr).then(setT, () => {});
  }, [addr]);
  return t;
}

// ───────────────────────── card ─────────────────────────

function BlockCard({ r, now }: { r: Rfq; now: number }) {
  const tok = useTok(r.token);
  const pay = useTok(r.payToken);
  const side = sideOf(r);
  const left = r.expiresAt - now;
  const total = r.createdAt ? r.expiresAt - r.createdAt : 3600;
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  const urgent = left > 0 && left < 600;

  return (
    <article className={`block ${side}`}>
      <div className="block-left">
        <TokenAvatar address={r.token} symbol={tok?.symbol} side={side} />
        <span className="addr" title={r.token}>
          {r.token.slice(0, 6)}…{r.token.slice(-3)}
        </span>
      </div>

      <div className="block-body">
        <div className="block-top">
          <span className="sym">{tok?.symbol ?? "…"}</span>
          <span className="name">{tok?.name && tok.name !== tok.symbol ? tok.name : ""}</span>
          <span className={`tag ${side}`}>{side === "buy" ? "BUYING" : "SELLING"}</span>
          <span className="spacer" />
          <span className="stat">
            <i>SIZE</i>
            <b>{r.amount && tok ? compact(r.amount, tok.decimals) : r.sizeUsd ? `~$${compact(BigInt(Math.round(r.sizeUsd)), 0)}` : "—"}</b>
          </span>
        </div>

        <div className="block-mid">
          <span className="pill pay">
            {r.payToken === zeroAddress ? "Ξ" : "$"} {pay?.symbol ?? "…"}
          </span>
          <span className="pill sealed" title="Answers are encrypted to the poster. Nobody else sees prices.">
            PRICE ••••••
          </span>
          <span className={`pill ${r.quoteCount > 0 ? "hot" : ""}`}>
            {r.quoteCount} {side === "buy" ? "offer" : "bid"}
            {r.quoteCount === 1 ? "" : "s"}
          </span>
          {r.note && (
            <span className="pill note" title={r.note}>
              ✎ {r.note.length > 26 ? r.note.slice(0, 26) + "…" : r.note}
            </span>
          )}
        </div>

        <div className="block-bottom">
          <span className={`clock ${urgent ? "urgent" : ""}`}>⏱ {timeLeft(left)}</span>
          <span className="bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <Copy text={`${window.location.origin}/rfq/${r.id}`} label="⧉" />
          <Link to={`/rfq/${r.id}`} className={`go ${side}`}>
            {side === "buy" ? "Sell into" : "Buy block"}
          </Link>
        </div>
      </div>
    </article>
  );
}

// ───────────────────────── column ─────────────────────────

type Sort = "new" | "ending" | "hot";

function Column({ title, hint, rows, now, empty, onNew }: { title: string; hint: string; rows: Rfq[]; now: number; empty: string; onNew?: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [symbols, setSymbols] = useState<Record<string, string>>({});

  // Resolve symbols for search (cached, so this is cheap).
  useEffect(() => {
    for (const r of rows) {
      if (symbols[r.token]) continue;
      tokenInfo(r.token).then((t) => setSymbols((s) => ({ ...s, [r.token]: `${t.symbol} ${t.name}`.toLowerCase() })), () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) => r.token.toLowerCase().includes(needle) || (symbols[r.token] ?? "").includes(needle) || (r.note ?? "").toLowerCase().includes(needle))
      : rows;
    const by: Record<Sort, (a: Rfq, b: Rfq) => number> = {
      new: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      ending: (a, b) => a.expiresAt - b.expiresAt,
      hot: (a, b) => b.quoteCount - a.quoteCount || a.expiresAt - b.expiresAt,
    };
    return [...filtered].sort(by[sort]);
  }, [rows, q, sort, symbols]);

  return (
    <section className="col">
      <header className="col-head">
        <h2 title={hint}>
          {title} <span className="count">{rows.length}</span>
        </h2>
        <label className="search">
          <span aria-hidden>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol, 0x…" aria-label={`Search ${title}`} />
        </label>
        <div className="seg-mini" role="group" aria-label="Sort">
          {(["new", "ending", "hot"] as Sort[]).map((s) => (
            <button key={s} className={sort === s ? "on" : ""} onClick={() => setSort(s)}>
              {s === "new" ? "New" : s === "ending" ? "Ending" : "Hot"}
            </button>
          ))}
        </div>
      </header>
      <div className="col-body">
        {shown.map((r) => (
          <BlockCard key={r.id} r={r} now={now} />
        ))}
        {shown.length === 0 && (
          <div className="col-empty">
            <p>{q ? "Nothing matches." : empty}</p>
            {!q && onNew && (
              <button className="ghost-cta" onClick={onNew}>
                + New block
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ───────────────────────── strip extras ─────────────────────────

function Marquee({ open, answers, live }: { open: number; answers: number; live: boolean }) {
  const items = [
    <>
      <b>Live</b> on Robinhood Chain
    </>,
    <>
      <b>{open}</b> open blocks
    </>,
    <>
      <b>{answers}</b> sealed answers
    </>,
    <>Offers encrypted in your browser</>,
    <>One-transaction contract settlement</>,
    <>No owner · no admin key · no pause</>,
    <>Pay in ETH or USDG</>,
    <>Ghost mode for sellers</>,
  ];
  // Rendered twice so the loop scrolls seamlessly.
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {[...items, ...items].map((x, i) => (
          <span key={i}>{x}</span>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── page ─────────────────────────

export function Terminal() {
  const now = useNow();
  const { data, error } = usePoll(api.listRfqs, 6000, []);
  // /?new=buy or /?new=sell opens the panel directly (handy for sharing "post a block" links).
  const [sheet, setSheet] = useState<null | "buy" | "sell">(() => {
    const v = new URLSearchParams(window.location.search).get("new");
    return v === "buy" || v === "sell" ? v : null;
  });
  const [tab, setTab] = useState<"new" | "buy" | "sell">("new");

  const all = (data ?? []).filter((r) => r.expiresAt > now);
  const bids = all.filter((r) => sideOf(r) === "buy");
  const listings = all.filter((r) => sideOf(r) === "sell");
  const answers = all.reduce((n, r) => n + r.quoteCount, 0);
  // "Live" only once the contract is configured; before that, say preview.
  const [live, setLive] = useState(false);
  useEffect(() => {
    api.config().then((c) => setLive(!!c.escrow), () => setLive(false));
  }, []);
  const mine = saved.bids().length + saved.offers().length;

  return (
    <div className="terminal">
      <Marquee open={all.length} answers={answers} live={live} />
      <section className="strip">
        <div className="strip-copy">
          <span className="label">Private OTC · Robinhood Chain</span>
          <h1>
            Trade size. <span className="copper">Stay private.</span>
          </h1>
          <p>Post a block. Get sealed answers only you can read. Settle both sides in one contract transaction.</p>
        </div>
        <div className="strip-stats">
          <span>
            <b>{all.length}</b>open
          </span>
          <span>
            <b>{bids.length}</b>buying
          </span>
          <span>
            <b>{listings.length}</b>selling
          </span>
          <span>
            <b>{answers}</b>sealed
          </span>
        </div>
        <div className="strip-actions">
          <button className="cta buy" onClick={() => setSheet("buy")}>
            BUY A BLOCK
          </button>
          <button className="cta sell" onClick={() => setSheet("sell")}>
            SELL PRIVATELY
          </button>
        </div>
      </section>

      {error && <p className="banner err">Can't reach the server: {error}</p>}

      <nav className="tabs" aria-label="Columns">
        {(
          [
            ["new", `New ${all.length}`],
            ["buy", `Buyers ${bids.length}`],
            ["sell", `Sellers ${listings.length}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <div className={`cols show-${tab}`}>
        <Column title="New" hint="Every open block, newest first" rows={all} now={now} empty="No blocks yet. Be the first." onNew={() => setSheet("buy")} />
        <Column
          title="Buyers"
          hint="Bids: someone wants to buy. Answer with a sealed offer to sell into them."
          rows={bids}
          now={now}
          empty="No open bids."
          onNew={() => setSheet("buy")}
        />
        <Column
          title="Sellers"
          hint="Listings: someone is offloading a block. Answer with a sealed bid to buy it."
          rows={listings}
          now={now}
          empty="No open listings."
          onNew={() => setSheet("sell")}
        />
      </div>

      {mine > 0 && (
        <p className="mine-hint">
          You have {mine} private link{mine === 1 ? "" : "s"} saved in this browser. <Link to="/mine">Open them</Link>
        </p>
      )}

      {sheet && <NewBlock initialSide={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** /mine: the private links this browser has saved. */
export function MyLinks() {
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bids = saved.bids();
  const offers = saved.offers();

  const download = () => {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `obsyn-private-links-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg({ ok: true, text: "Backup downloaded. Keep it private: whoever has this file controls your blocks." });
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 2_000_000) throw new Error("That file is too large to be a backup.");
      const r = importBackup(await f.text());
      setTick((t) => t + 1);
      setMsg({ ok: true, text: `Imported ${r.bids} block${r.bids === 1 ? "" : "s"} and ${r.offers} answer${r.offers === 1 ? "" : "s"}${r.skipped ? ` (skipped ${r.skipped} that didn't look like Obsyn links)` : ""}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="narrow">
      <section className="card backup">
        <div className="card-head">
          <h2>Backup</h2>
          <span className="muted">Move your private links to another browser or device.</span>
        </div>
        <div className="backup-actions">
          <button type="button" className="btn" onClick={download} disabled={!bids.length && !offers.length}>
            Download backup
          </button>
          <label className="btn ghost">
            Import backup
            <input type="file" accept="application/json,.json" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
        <p className="muted small">The file holds the keys to your blocks. Anyone who has it can read your answers and accept for you, so keep it like a password.</p>
        {msg && <p className={msg.ok ? "ok small" : "err small"}>{msg.text}</p>}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Your private links</h2>
          <span className="muted">Saved in this browser only. The links themselves are the keys.</span>
        </div>
        {!bids.length && !offers.length && <p className="muted">Nothing yet.</p>}
        <ul className="links">
          {bids.map((b) => (
            <li key={b.id}>
              <span className={`tag ${b.side ?? "buy"}`}>{b.side === "sell" ? "LISTING" : "BID"}</span> <Link to={b.link}>{b.token}</Link>{" "}
              <span className="muted">{new Date(b.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {offers.map((o) => (
            <li key={o.id}>
              <span className={`tag ${o.side === "sell" ? "buy" : "sell"}`}>{o.side === "sell" ? "MY BID" : "MY OFFER"}</span>{" "}
              <Link to={o.link}>{short(o.rfqId)}</Link> <span className="muted">{new Date(o.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
