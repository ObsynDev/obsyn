import { useEffect, useMemo, useState } from "react";
import { useMarket } from "../lib/market.ts";
import { PAY_TITLE, useKeepPayValid, usePayOptions, type PaySymbol } from "../lib/pay.ts";
import { DexImpact } from "./DexImpact.tsx";
import { BRAND } from "../lib/brand.tsx";
import { MARKETS, market } from "../lib/tokens.ts";
import { getAddress, isAddress, parseUnits, type Address } from "viem";
import { api, type Rfq } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { newBoxKeys, sideOf, toUrl } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Err, Link, navigate, useAction } from "../lib/ui.tsx";
import { DotWave } from "./DotWave.tsx";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { compact, TokenAvatar } from "./Terminal.tsx";
import { toast } from "../lib/toast.tsx";

const WINDOWS = [
  { label: "15 min", s: 900 },
  { label: "1 hour", s: 3600 },
  { label: "6 hours", s: 21600 },
  { label: "24 hours", s: 86400 },
];

/** Known real tokens on Robinhood Chain, plus whatever is being traded on the desk right now. */
const KNOWN: Address[] = MARKETS.map((m) => m.address);

// ───────────────────────── token picker ─────────────────────────

function TokenPicker({ onPick, onClose }: { onPick: (t: TokenInfo) => void; onClose: () => void }) {
  const [list, setList] = useState<TokenInfo[]>([]);
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "ok" | "err"; t?: TokenInfo; msg?: string }>({ state: "idle" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // tokens from open blocks + known tokens, resolved through our server
  useEffect(() => {
    let alive = true;
    api
      .listRfqs()
      .catch(() => [])
      .then((rows) => {
        const addrs = [...new Set([...rows.map((r) => r.token), ...KNOWN].map((a) => getAddress(a)))];
        return Promise.all(addrs.map((a) => tokenInfo(a).catch(() => null)));
      })
      .then(async (ts) => {
        // USDG is the payment currency here, not something to trade
        const usdg = (await api.config().catch(() => null))?.usdg;
        if (alive) setList(ts.filter((t): t is TokenInfo => !!t && t.address !== usdg));
      });
    return () => {
      alive = false;
    };
  }, []);

  // pasted contract address → look it up on-chain, and pick it as soon as it resolves
  // (a full address is unambiguous; waiting for a second click lost users while the read took a few seconds)
  useEffect(() => {
    const v = q.trim();
    if (!isAddress(v)) return setLookup({ state: "idle" });
    let alive = true;
    setLookup({ state: "loading" });
    tokenInfo(getAddress(v)).then(
      (t) => {
        if (!alive) return;
        setLookup({ state: "ok", t });
        onPick(t);
      },
      (e) => {
        if (!alive) return;
        const m = String(e?.message ?? "");
        // our own clear messages pass through; raw RPC errors become a plain sentence
        setLookup({
          state: "err",
          msg: m.startsWith("No token contract") ? m : "Couldn't read this token from Robinhood Chain right now. Check the address, or try again in a moment.",
        });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle && !isAddress(q.trim()) ? list.filter((t) => `${t.symbol} ${t.name}`.toLowerCase().includes(needle)) : list),
    [list, needle, q],
  );

  return (
    <div className="sheet-backdrop center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-modal="true" aria-label="Select a token">
        <div className="picker-head">
          <b>Select a token</b>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <input
          autoFocus
          className="picker-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter picks: the pasted token (it auto-picks once read) or the first match
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (lookup.state === "ok" && lookup.t) onPick(lookup.t);
            else if (!isAddress(q.trim()) && shown[0]) onPick(shown[0]);
          }}
          placeholder="Search, or paste a contract address"
          spellCheck={false}
        />
        {lookup.state === "loading" && <p className="muted small picker-note">Reading the contract on Robinhood Chain… it's selected automatically when ready.</p>}
        {lookup.state === "err" && <p className="err small picker-note">{lookup.msg}</p>}
        <div className="picker-list">
          {lookup.state === "ok" && lookup.t && (
            <button className="picker-row" onClick={() => onPick(lookup.t!)}>
              <TokenAvatar address={lookup.t.address} symbol={lookup.t.symbol} size={34} />
              <span>
                <b>{lookup.t.symbol}</b>
                <i>{lookup.t.name}</i>
              </span>
              <em className="mono dim">pasted</em>
            </button>
          )}
          {shown.map((t) => (
            <button key={t.address} className="picker-row" onClick={() => onPick(t)}>
              <TokenAvatar address={t.address} symbol={t.symbol} size={34} />
              <span>
                <b>{t.symbol}</b>
                <i>{t.name}</i>
              </span>
              <em className="mono dim">
                {t.address.slice(0, 6)}…{t.address.slice(-4)}
              </em>
            </button>
          ))}
          {!shown.length && lookup.state === "idle" && <p className="muted small picker-note">No match. Paste the token's contract address.</p>}
        </div>
        <p className="fine picker-note">Any ERC-20 on Robinhood Chain. Always check the contract address.</p>
      </div>
    </div>
  );
}

// ───────────────────────── atmosphere (bull-style floating coins) ─────────────────────────

const BOKEH: { sym: string; x: number; y: number; s: number; blur: number; d: number }[] = [
  { sym: "TSLA", x: 9, y: 22, s: 54, blur: 6, d: 0 },
  { sym: "NVDA", x: 84, y: 14, s: 72, blur: 2, d: -3 },
  { sym: "PONS", x: 22, y: 64, s: 40, blur: 3, d: -6 },
  { sym: "AAPL", x: 88, y: 58, s: 46, blur: 8, d: -2 },
  { sym: "META", x: 74, y: 82, s: 34, blur: 4, d: -8 },
  { sym: "COIN", x: 4, y: 84, s: 62, blur: 10, d: -5 },
];

function Bokeh() {
  return (
    <div className="bokeh" aria-hidden="true">
      {BOKEH.map((b) => (
        <span key={b.sym} style={{ left: `${b.x}%`, top: `${b.y}%`, filter: `blur(${b.blur}px)`, animationDelay: `${b.d}s` }}>
          <TokenAvatar address={market(b.sym).address} symbol={b.sym} size={b.s} />
        </span>
      ))}
    </div>
  );
}

// ───────────────────────── below the fold (bull /otc) ─────────────────────────

function OtcSections({ onBuy, onSell }: { onBuy: () => void; onSell: () => void }) {
  const [open, setOpen] = useState<Rfq[] | null>(null);
  const [toks, setToks] = useState<Record<string, TokenInfo>>({});
  useEffect(() => {
    api.listRfqs().then(
      (r) => {
        const live = r.filter((x) => x.expiresAt > Date.now() / 1000);
        setOpen(live);
        for (const a of new Set(live.map((x) => x.token))) tokenInfo(a).then((t) => setToks((s) => ({ ...s, [a]: t })), () => {});
      },
      () => setOpen([]),
    );
  }, []);

  return (
    <div className="otc-more">
      {/* move size */}
      <section className="om-sect om-move">
        <div>
          <h2>
            Move size.
            <br />
            <span className="copper">Not the price.</span>
          </h2>
          <p className="muted">{BRAND.name} brings buyers, sellers, teams and agents together for private block trades on Robinhood Chain.</p>
          <div className="om-ctas">
            <KeyButton onClick={onBuy} glyph="↵">
              PLACE A BID
            </KeyButton>
            <SlotButton onClick={onSell}>SELL PRIVATELY</SlotButton>
          </div>
        </div>
        <div className="om-offers">
          {[
            ["NVDA", "4,000", "sealed"],
            ["TSLA", "2,500", "sealed"],
            ["PONS", "750,000", "sealed"],
          ].map(([s, a, v], i) => (
            <div key={s} className="om-offer" style={{ animationDelay: `${i * 0.12}s` }}>
              <TokenAvatar address={market(s).address} symbol={s} size={34} />
              <b>{s}</b>
              <span className="mono">{a}</span>
              <span className="mono om-price">{v}</span>
              <span className="redact-mini" />
            </div>
          ))}
          <p className="fine">Example · sealed offers · only the buyer can read them</p>
        </div>
      </section>

      {/* where demand is forming */}
      <section className="om-sect">
        <div className="om-head">
          <h2>Where demand is forming.</h2>
          <span className="mono dim small">Robinhood Chain · open blocks, live</span>
        </div>
        <div className="om-demand">
          {open === null && <p className="muted">Loading…</p>}
          {open && open.length === 0 && (
            <div className="om-empty">
              <p>No open blocks right now. Post the first one.</p>
              <KeyButton onClick={onBuy} glyph="↵">
                PLACE A BID
              </KeyButton>
            </div>
          )}
          {open?.slice(0, 12).map((r) => {
            const t = toks[r.token];
            const side = sideOf(r);
            return (
              <Link key={r.id} to={`/rfq/${r.id}`} className="om-row">
                <TokenAvatar address={r.token} symbol={t?.symbol} size={30} />
                <b>{t?.symbol ?? `${r.token.slice(0, 6)}…`}</b>
                <span className="dim small">{t?.name}</span>
                <span className="mono">{r.amount && t ? compact(r.amount, t.decimals) : r.sizeUsd ? `~$${compact(BigInt(Math.round(r.sizeUsd)), 0)}` : ""}</span>
                <span className={`side-chip ${side === "buy" ? "buy" : "sell"}`}>{side === "buy" ? "BID" : "FOR SALE"}</span>
                <span className="om-act">{side === "buy" ? "Sell into →" : "Bid →"}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* bid. offer. swap. */}
      <section className="om-sect">
        <div className="om-head">
          <h2>
            Bid. Offer. <span className="green">Swap.</span>
          </h2>
        </div>
        <div className="om-cards">
          <div className="om-card">
            <span className="mono green">01</span>
            <b>Buyer demand</b>
            <p>Set your size. Sellers come to you.</p>
            <div className="om-chips mono">
              <span>$250K</span>
              <span>$1M</span>
              <span>$5M</span>
              <span className="dim">+ your size</span>
            </div>
            <button className="text-link" onClick={onBuy}>
              Place a bid →
            </button>
          </div>
          <div className="om-card">
            <span className="mono green">02</span>
            <b>Private offers</b>
            <p>One buyer sees it. Nobody else.</p>
            <div className="om-sealed mono">
              Offer <span className="copper">••••••</span> <i className="dim">visible to the buyer only</i>
            </div>
            <button className="text-link" onClick={onSell}>
              Sell OTC →
            </button>
          </div>
          <div className="om-card">
            <span className="mono green">03</span>
            <b>Settlement contract</b>
            <p>One transaction swaps both sides. Or everyone gets their funds back.</p>
            <div className="om-steps mono small">
              <span>payment locks</span>
              <i>→</i>
              <span>tokens in</span>
              <i>→</i>
              <span className="green">swap</span>
            </div>
            <Link to="/how" className="text-link">
              How it works →
            </Link>
          </div>
          <div className="om-card">
            <span className="mono copper">04</span>
            <b>Ghost mode</b>
            <p>Sell from a one-time wallet. Gas paid for you.</p>
            <div className="om-sealed mono">
              0x7a…c01d <span className="copper">→</span> 0x9b…07fa
            </div>
            <Link to="/security" className="text-link">
              Privacy details →
            </Link>
          </div>
        </div>
      </section>

      {/* nothing links back to you */}
      <section className="om-sect om-ghost">
        <div className="om-head">
          <h2>
            Nothing links back to <span className="copper">you.</span>
          </h2>
          <p className="muted">Sell from a one-time wallet. Get paid to a fresh address. The buyer never sees your main wallet.</p>
        </div>
        <div className="ghost-flow">
          <div className="gf-node">
            <span className="mono dim small">SELLER</span>
            <b>one-time wallet</b>
            <i className="mono">tokens →</i>
          </div>
          <div className="gf-line" />
          <div className="gf-node core">
            <span className="mono dim small">CONTRACT</span>
            <b>smart contract</b>
            <i className="mono">no owner · no admin key</i>
          </div>
          <div className="gf-line" />
          <div className="gf-node">
            <span className="mono dim small">BUYER</span>
            <b>tokens arrive</b>
            <i className="mono">one atomic swap</i>
          </div>
          <div className="gf-pay mono">
            payment → <span className="copper">fresh payout address</span>
          </div>
        </div>
        <p className="fine">Private, not anonymous: moving tokens into the one-time wallet is still a public transfer. It is not a mixer.</p>
      </section>
    </div>
  );
}

// ───────────────────────── page ─────────────────────────

export function Otc() {
  const [side, setSide] = useState<"buy" | "sell">(() => (new URLSearchParams(window.location.search).get("side") === "sell" ? "sell" : "buy"));
  // /otc?usd=50000 or ?side=sell&amount=... (from the slippage calculator) prefills the size
  const [usd, setUsd] = useState(() => {
    const v = Number(new URLSearchParams(window.location.search).get("usd"));
    return Number.isFinite(v) && v > 0 ? String(v) : "";
  });
  const [amount, setAmount] = useState(() => {
    const v = Number(new URLSearchParams(window.location.search).get("amount"));
    return Number.isFinite(v) && v > 0 ? String(v) : "";
  });
  const [pay, setPay] = useState<PaySymbol>("USDG");
  const [token, setToken] = useState<TokenInfo | null>(null);
  // /otc?token=0x… (from the market board) preselects the token
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t && isAddress(t)) tokenInfo(getAddress(t)).then(setToken, () => {});
  }, []);
  const [win, setWin] = useState(86400);
  const [picking, setPicking] = useState(false);
  const [partial, setPartial] = useState(true);
  const market = useMarket(token?.address);
  const payOpts = usePayOptions(["ETH", "USDG"], token?.address);
  useKeepPayValid(pay, payOpts.options, setPay);
  const usdNum = Number(usd.replace(/[,\s$]/g, ""));
  const sellUsd = market?.priceUsd && Number(amount.replace(/[,\s]/g, "")) > 0 ? Number(amount.replace(/[,\s]/g, "")) * market.priceUsd : null;

  const submit = useAction(async () => {
    if (!token) throw new Error("Select the token first.");
    const keys = newBoxKeys();
    const encPubKey = btoa(String.fromCharCode(...keys.publicKey));
    let body: Parameters<typeof api.createRfq>[0];
    if (side === "buy") {
      const v = Number(usd.replace(/[,\s$]/g, ""));
      if (!isFinite(v) || v < 5) throw new Error("Minimum $5.");
      body = { side, token: token.address, payToken: pay, sizeUsd: v, replySeconds: win, encPubKey, allowPartial: partial };
    } else {
      const base = parseUnits(amount.replace(/[,\s]/g, "") || "0", token.decimals);
      if (base <= 0n) throw new Error("Enter how many tokens you are selling.");
      body = { side, token: token.address, payToken: pay, amount: base.toString(), replySeconds: win, encPubKey, allowPartial: partial };
    }
    const res = await api.createRfq(body);
    const link = `/bid/${res.id}#t=${res.manageToken}&k=${toUrl(keys.secretKey)}`;
    saved.addBid({ id: res.id, side, link, token: token.symbol, createdAt: Date.now() });
    toast({ tone: "ok", title: side === "buy" ? "Bid posted" : "Listing posted", body: "Sealed answers arrive on your private page. Keep its link.", key: `post:${res.id}` });
    navigate(link);
  });

  const TokenButton = (
    <button type="button" className={`tok-btn ${token ? "set" : ""}`} onClick={() => setPicking(true)}>
      {token ? (
        <>
          <TokenAvatar address={token.address} symbol={token.symbol} size={24} />
          {token.symbol}
        </>
      ) : (
        "Select token"
      )}
      <span aria-hidden="true">▾</span>
    </button>
  );

  return (
    <div className="otc">
      <DotWave height={260} />
      <Bokeh />
      <div className="otc-glow" aria-hidden="true" />
      <div className="otc-head">
        <h1>
          Private block trades. <span className="copper">Sealed until settled.</span>
        </h1>
      </div>

      <form
        className={`otc-card ${side}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit.run();
        }}
      >
        <div className="otc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on buy" : ""} onClick={() => setSide("buy")}>
            Buy
          </button>
          <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>

        {side === "buy" ? (
          <>
            <div className="otc-box">
              <span className="otc-k">You pay</span>
              <div className="otc-row">
                <span className="otc-dollar">$</span>
                <input className="otc-amt" value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Amount in USD" />
                <span className="otc-unit">USD</span>
              </div>
              <DexImpact side="buy" sizeUsd={isFinite(usdNum) && usdNum > 0 ? usdNum : null} market={market} />
              <div className="otc-sub">
                <span className="dim">Minimum $5</span>
                <span className="otc-pay">
                  Pay with
                  {payOpts.options.map((p) => (
                    <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)} title={PAY_TITLE[p]}>
                      {p}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <div className="otc-arrow" aria-hidden="true">
              ↓
            </div>
            <div className="otc-box">
              <span className="otc-k">You buy</span>
              <div className="otc-row">
                <span className="otc-amt otc-sealed mono">sealed offers</span>
                {TokenButton}
              </div>
              <div className="otc-sub dim">{token ? `Sellers answer with how many ${token.symbol} and a price, sealed to you.` : "Pick the token you want to buy."}</div>
            </div>
          </>
        ) : (
          <>
            <div className="otc-box">
              <span className="otc-k">You sell</span>
              <div className="otc-row">
                <input className="otc-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Amount of tokens" />
                {TokenButton}
              </div>
              <div className="otc-sub dim">{token ? `${token.name}` : "Pick the token you want to sell."}</div>
              <DexImpact side="sell" sizeUsd={sellUsd} market={market} />
            </div>
            <div className="otc-arrow" aria-hidden="true">
              ↓
            </div>
            <div className="otc-box">
              <span className="otc-k">You get</span>
              <div className="otc-row">
                <span className="otc-amt otc-sealed mono">sealed bids</span>
                <span className="otc-pay">
                  {payOpts.options.map((p) => (
                    <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)} title={PAY_TITLE[p]}>
                      {p}
                    </button>
                  ))}
                </span>
              </div>
              <div className="otc-sub dim">Buyers answer with a price, sealed to you. You pick the best one.</div>
            </div>
          </>
        )}

        <div className="otc-window">
          <span className="dim">Open for</span>
          <span className="otc-chips">
            {WINDOWS.map((w) => (
              <button type="button" key={w.s} className={win === w.s ? "on" : ""} onClick={() => setWin(w.s)}>
                {w.label}
              </button>
            ))}
          </span>
        </div>
        <label className="otc-partial">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
          <span>Allow partial fills: {side === "buy" ? "several sellers can each fill part" : "several buyers can each take part"}</span>
        </label>

        <Err msg={submit.error} />
        <KeyButton type="submit" block tone={side === "buy" ? "green" : "red"} disabled={submit.busy}>
          {submit.busy ? "CREATING…" : side === "buy" ? "CREATE PRIVATE BID" : "LIST PRIVATELY"}
        </KeyButton>
      </form>

      <p className="otc-foot">
        <span className="green">Non-custodial.</span> Settled on-chain in one transaction. <span className="copper">Prices sealed to you.</span>
      </p>

      {/* what happens next (bull /trade) */}
      <ol className="next-steps">
        {[
          ["Post your size", "Token and size. No account; you get a private link."],
          [side === "buy" ? "Sellers quote privately" : "Buyers bid privately", "Only you can read the answers. No public order book."],
          ["Settle in one transaction", "Payment locks in the contract first. The swap completes atomically or not at all."],
        ].map(([t, d], i) => (
          <li key={t}>
            <span className="mono">{i + 1}</span>
            <div>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="scroll-hint mono">SCROLL TO LEARN MORE ↓</div>

      <OtcSections onBuy={() => (window.scrollTo({ top: 0, behavior: "smooth" }), setSide("buy"))} onSell={() => (window.scrollTo({ top: 0, behavior: "smooth" }), setSide("sell"))} />

      {picking && (
        <TokenPicker
          onClose={() => setPicking(false)}
          onPick={(t) => {
            setToken(t);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
