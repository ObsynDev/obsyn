import { useEffect, useState } from "react";
import { BRAND, PLATFORM_TOKEN } from "../lib/brand.tsx";
import { CountUp, Reveal, Scramble, SplitWords, reducedMotion, useInView, useScrollBoost, useScrollVar, useSpotlight, useTilt } from "../lib/motion.tsx";
import { Copy, Link, navigate } from "../lib/ui.tsx";
import { AsciiMark } from "./AsciiMark.tsx";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { PixelPipeline } from "./PixelPipeline.tsx";
import { EmberField } from "./EmberField.tsx";
import { PixelField } from "./PixelField.tsx";
import { IconColumns } from "./IconColumns.tsx";
import { HeroTicket } from "./HeroTicket.tsx";
import { TokenUtility } from "./TokenUtility.tsx";
import { MarketBoard } from "./Markets.tsx";
import { TokenAvatar } from "./Terminal.tsx";
import { MARKETS } from "../lib/tokens.ts";


// ───────────────────────── privacy: who sees what ─────────────────────────

const VIEWERS = ["Other traders", "Our server", "Counterparty", "You"] as const;
type Viewer = (typeof VIEWERS)[number];
const ROWS = ["Price", "Your wallet", "Size", "Deal terms"] as const;
const SEES: Record<Viewer, Record<(typeof ROWS)[number], string | null>> = {
  "Other traders": { Price: null, "Your wallet": null, Size: "2,500 TSLA", "Deal terms": null },
  "Our server": { Price: null, "Your wallet": null, Size: "2,500 TSLA", "Deal terms": "after acceptance" },
  Counterparty: { Price: "$978,050", "Your wallet": "one-time 0x9b1e…07fa", Size: "2,500 TSLA", "Deal terms": "fixed, signed" },
  You: { Price: "$978,050", "Your wallet": "0x7a3c…c01d", Size: "2,500 TSLA", "Deal terms": "fixed, signed" },
};
const NOTE: Record<Viewer, string> = {
  "Other traders": "They see that a block exists and its size. Nothing that lets them trade against you.",
  "Our server": "It relays ciphertext. It can't read a single price, and it never holds funds.",
  Counterparty: "Only the side you accept sees the price, and it can deal with a one-time wallet.",
  You: "Every answer decrypts in your browser, with a key that never leaves it.",
};

function WhoSees() {
  const [v, setV] = useState<Viewer>("Other traders");
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || reducedMotion()) return;
    const id = window.setInterval(() => setV((x) => VIEWERS[(VIEWERS.indexOf(x) + 1) % VIEWERS.length]), 3200);
    return () => clearInterval(id);
  }, [auto]);
  return (
    <div className="ws2" data-spot>
      <div className="ws2-tabs" role="tablist" aria-label="View as">
        <span className="mono dim small">VIEW AS</span>
        {VIEWERS.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={v === x}
            className={v === x ? "on" : ""}
            onClick={() => {
              setAuto(false);
              setV(x);
            }}
          >
            {x}
            {v === x && auto && <i className="ws2-timer" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="ws2-rows" key={v}>
        {ROWS.map((r, i) => {
          const val = SEES[v][r];
          return (
            <div key={r} className="ws2-row" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="ws2-k">{r}</span>
              {val ? (
                <Scramble text={val} className="ws2-v mono" duration={650} delay={i * 90} />
              ) : (
                <span className="ws2-redact" aria-label="hidden" />
              )}
              <span className={`ws2-tag mono ${val ? "open" : "sealed"}`}>{val ? "VISIBLE" : "SEALED"}</span>
            </div>
          );
        })}
      </div>
      <p className="ws2-note">{NOTE[v]}</p>
    </div>
  );
}

// ───────────────────────── scroll-scrubbed manifesto ─────────────────────────

/** Words light up one by one as the line scrolls through the viewport; [x] words become pills. */
const MANIFESTO = "Other traders see that a block exists, and its size. Never your [price], your [wallet] or your [intent].";
const manifestoProgress = (r: DOMRect, vh: number) => (vh * 0.9 - r.top) / (r.height + vh * 0.45);
const bandProgress = (r: DOMRect, vh: number) => (vh - r.top) / (vh * 0.75);

function Manifesto() {
  const ref = useScrollVar<HTMLParagraphElement>(manifestoProgress);
  const words = MANIFESTO.split(" ");
  return (
    <p ref={ref} className="manifesto" style={{ ["--n" as string]: words.length }} aria-label={MANIFESTO.replace(/[[\]]/g, "")}>
      {words.map((w, i) => {
        const pill = w.startsWith("[");
        const clean = w.replace(/[[\]]/g, "");
        return (
          <span key={i} aria-hidden="true" className={pill ? "mw mw-pill" : "mw"} style={{ ["--i" as string]: i }}>
            {pill ? <b>{clean.replace(/[.,]$/, "")}</b> : clean}
            {pill && /[.,]$/.test(clean) ? clean.slice(-1) : ""}{" "}
          </span>
        );
      })}
    </p>
  );
}

// ───────────────────────── glint-style live simulation ─────────────────────────

const CHAT: [string, string, number?][] = [
  ["you", "sell 50,000 PONS privately, paid in USDG, open for 1 hour"],
  ["prog", "posting listing", 1],
  ["sys", "private link saved locally · reply window 1h"],
  ["prog", "collecting sealed bids", 0.72],
  ["sys", "3 sealed bids · 2 signed by their wallet · best 2,450 USDG"],
  ["you", "accept the best one, ghost mode on"],
  ["prog", "settling on robinhood chain", 1],
  ["ok", "settled in 1 transaction"],
];

function Bar({ frac, label }: { frac: number; label: string }) {
  const W = 18;
  const on = Math.round(frac * W);
  return (
    <>
      <span className="tbar-label">{label}</span>
      <span className="tbar">
        <span className="tbar-on">{"█".repeat(on)}</span>
        <span className="tbar-off">{"█".repeat(W - on)}</span>
      </span>
      <span className="tbar-pct">{Math.round(frac * 100)}%</span>
    </>
  );
}

function AgentChat() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => (x >= CHAT.length + 2 ? 0 : x + 1)), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="chat term mono" aria-label="Example agent session">
      <div className="chat-bar">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="dim small">~/desk · agent + {BRAND.name.toLowerCase()} mcp</span>
      </div>
      {CHAT.slice(0, Math.min(n, CHAT.length)).map(([who, line, frac], k) => (
        <div key={k} className={`chat-line ${who}`}>
          {who === "prog" ? (
            <Bar frac={frac ?? 1} label={line} />
          ) : (
            <>
              <span className="who">{who === "you" ? ">" : who === "ok" ? "✓" : "·"}</span> {line}
            </>
          )}
        </div>
      ))}
      {n < CHAT.length && (
        <div className="chat-line you">
          <span className="who">&gt;</span>
          <span className="cursor">_</span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── section meta row ─────────────────────────

/** "NO. 1 · TRADE ────────── 01 / 05" */
function SectMeta({ label, idx, total = 6, tone = "green" }: { label: string; idx: number; total?: number; tone?: "green" | "copper" }) {
  return (
    <div className={`sect-meta mono ${tone}`}>
      <span>{label}</span>
      <i aria-hidden="true" />
      <span className="dim">
        {String(idx).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
    </div>
  );
}


// ───────────────────────── page ─────────────────────────

const FAQ = [
  ["Do I need an account?", "No. Posting gives you a private link that controls the block. Treat it like a password."],
  ["What can I trade?", "The listed Robinhood stock tokens, the ETFs and PONS, or any other ERC-20 on Robinhood Chain by address, paid in ETH or USDG. Fee-on-transfer tokens are rejected by the contract."],
  ["Can you take my funds?", "No. The contract has no owner, admin key, pause or upgrade. Funds only move to settle a deal or refund it after the deadline."],
  ["Is it audited?", "Not yet. There's an internal review and a full test suite, no professional audit. Start with sizes you're comfortable with."],
  ["What does it cost?", "Posting and answering are free. At settlement: 2.5% under $10k, 2% from $10k, 1.5% from $100k, capped at 2.5% in the contract. Holding the platform token takes 0.5% off."],
  ["Is it anonymous?", "No, it's private. Prices stay sealed while you negotiate. Once a side deposits into the contract, the deal terms are public on-chain like any transaction, and funding a one-time wallet from your main wallet is a visible transfer too."],
];

export function Landing() {
  // The "ENTER ↵" hint on the main button is real.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.closest("input, textarea, select, button, a, summary, [contenteditable]") || t.isContentEditable)) return;
      navigate("/otc");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const tilt = useTilt<HTMLDivElement>(7);
  const band = useScrollVar<HTMLElement>(bandProgress);
  useSpotlight();
  useScrollBoost(".tok-track");
  const mcp = `OBSYN_API=${window.location.origin}/api node backend/src/mcp/stdio.ts`;

  return (
    <div className="l3">
      {/* hero */}
      <section className="l3-hero">
        <PixelField />
        <span className="hero-aura" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="l3-hero-copy">
          <span className="chain-pill mono rise" style={{ ["--i" as string]: 0 }}>
            <i aria-hidden="true" /> On Robinhood Chain<span className="cid"> · chain 4663</span> · {MARKETS.length} markets
          </span>
          <SplitWords as="h1" text="Trade size. / [Stay private.]" accent="copper" />
          <p className="l3-lede rise" style={{ ["--i" as string]: 3 }}>
            Post a block you want to buy or sell. Get prices sealed so only you can read them. Settle both sides in one contract
            transaction, without touching the chart.
          </p>
          <div className="btn-wrap rise" style={{ ["--i" as string]: 4 }}>
            <div className="ticks" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="btn-group">
              <SlotButton to="/how">HOW IT WORKS</SlotButton>
              <KeyButton to="/otc">OPEN THE DESK</KeyButton>
            </div>
          </div>
        </div>
        <div className="l3-hero-art" ref={tilt}>
          <HeroTicket />
        </div>
      </section>

      {/* token strip (meridian) */}
      <section className="tok-strip" aria-label="Markets">
        <div className="tok-labels mono">
          <span>
            <CountUp value={MARKETS.length} /> MARKETS · OR ANY ERC-20 ON ROBINHOOD CHAIN
          </span>
          <span>PAY IN ETH OR USDG</span>
        </div>
        {[false, true].map((rev) => (
          <div key={String(rev)} className="tok-viewport">
            <div className={`tok-track ${rev ? "rev" : ""}`}>
              {[0, 1].map((k) => (
                <div key={k} className="tok-set" aria-hidden={k === 1}>
                  {(rev ? [...MARKETS].reverse() : MARKETS).map((t) => (
                    <Link key={t.symbol} to={`/markets?m=${t.symbol}`} className="tok">
                      <TokenAvatar address={t.address} symbol={t.symbol} size={30} />
                      <span>
                        <b>{t.symbol}</b>
                        <i>{t.name}</i>
                      </span>
                      <em className="mono">{t.kind === "etf" ? "ETF" : t.kind === "stock" ? "STOCK" : "TOKEN"}</em>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 01 markets */}
      <section className="l3-sect mk-sect">
        <div className="no">
          <SectMeta label="MARKETS" idx={1} />
          <div className="mk-sect-head">
            <SplitWords text="Pick a market. / [Keep your price.]" accent="tone" />
            <SlotButton to="/markets">ALL MARKETS</SlotButton>
          </div>
        </div>
        <Reveal>
          <div data-spot className="spot-wrap">
            <MarketBoard />
          </div>
        </Reveal>
      </section>

      {/* 02 privacy */}
      <section className="l3-sect priv2">
        <div className="no">
          <SectMeta label="PRIVACY" idx={2} tone="copper" />
          <SplitWords text="Your price is yours. / [Nobody else reads it.]" accent="tone" />
        </div>
        <Manifesto />
        <div className="priv2-grid">
          <Reveal className="priv2-facts">
            {[
              ["Sealed answers", "Every price is encrypted in the sender's browser to your key. Our server stores ciphertext it can't open."],
              ["No accounts", "No email, no KYC, no sign-up. A private link is the only key to your block."],
              ["Ghost mode", "Settle from a one-time wallet and let the relayer pay the gas, so the deal never names your main wallet."],
            ].map(([t, d], i) => (
              <div key={t} className="priv2-fact" style={{ ["--i" as string]: i }}>
                <span className="priv2-n mono">0{i + 1}</span>
                <div>
                  <b>{t}</b>
                  <p>{d}</p>
                </div>
              </div>
            ))}
            <p className="priv2-fine">
              Private, not anonymous: once a side deposits, the deal is public on-chain like any transaction.
            </p>
          </Reveal>
          <Reveal delay={80}>
            <WhoSees />
          </Reveal>
        </div>
      </section>

      {/* 03 how */}
      <section className="l3-sect">
        <div className="no">
          <SectMeta label="HOW A BLOCK TRADES" idx={3} />
          <SplitWords text="You decide. / [Code settles.]" accent="tone" />
          <p className="muted">One block, from the post to a settlement on chain. A live simulation.</p>
        </div>
        <Reveal>
          <PixelPipeline />
        </Reveal>
      </section>

      {/* 04 agents (glint "from your terminal") */}
      <section className="l3-sect ask">
        <div className="no">
          <SectMeta label="AGENTS & BUILDERS" idx={4} />
        </div>
        <div className="ask-head">
          <SplitWords text="Or just ask. / [From your terminal.]" accent="tone" />
          <p className="muted">Plug the desk into any MCP-capable AI agent. It posts, reads sealed answers and settles, with your keys on your machine.</p>
        </div>
        <div className="ask-grid">
          <Reveal className="ask-term">
            <div className="cmdline">
              <code className="mono">{mcp}</code>
              <Copy text={mcp} />
            </div>
            <AgentChat />
            <div className="ask-btns">
              <SlotButton to="/developers">11 MCP TOOLS</SlotButton>
              <SlotButton onClick={() => window.open("/api/sdk/obsyn.mjs", "_blank", "noreferrer")}>SDK</SlotButton>
              <SlotButton onClick={() => window.open("/api/openapi.json", "_blank", "noreferrer")}>OPENAPI</SlotButton>
            </div>
          </Reveal>
          <div className="ask-art" aria-hidden="true">
            <span className="ask-glow" />
            <AsciiMark />
          </div>
        </div>
      </section>

      {/* 05 token: the ember band */}
      <section className="tk-band" ref={band}>
        <EmberField />
        <div className="tk-band-in">
          <div className="no">
            <SectMeta label={`THE TOKEN · $${PLATFORM_TOKEN.symbol}`} idx={5} />
            <SplitWords text={`Every deal buys $${PLATFORM_TOKEN.symbol}. / [Then burns it.]`} accent="ember" />
            <p className="muted">
              Utility first: the desk runs today without a token. When ${PLATFORM_TOKEN.symbol} launches on Pons, two rules already
              written into the contracts switch on.
            </p>
          </div>
          <Reveal>
            <TokenUtility />
          </Reveal>
        </div>
      </section>

      {/* faq */}
      <section className="l3-sect two-col">
        <div className="no">
          <span className="no-label mono">FAQ</span>
          <SplitWords text="Questions." />
          <p className="muted">
            More in the <Link to="/docs">docs</Link> and on the <Link to="/security">security</Link> page.
          </p>
        </div>
        <div className="l3-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* closing: mobbin-style, real market logos drifting on both sides */}
      <section className="l3-close mb2">
        <div className="mb2-stage">
          <IconColumns />
          <div className="mb2-copy">
            <SplitWords text="Moving size? / [Keep it private.]" accent="mb2-strong" className="mb2-h" />
            <p className="mb2-sub">
              {MARKETS.length} markets, sealed answers only you can read, and one-transaction settlement on Robinhood Chain. No
              account, no order book.
            </p>
            <div className="btn-group">
              <SlotButton to="/otc?side=sell">SELL PRIVATELY</SlotButton>
              <KeyButton to="/otc">OPEN THE DESK</KeyButton>
            </div>
          </div>
        </div>
        <GiantMark />
      </section>
    </div>
  );
}

/** Rooq-style giant wordmark that rises letter by letter at the end of the page. */
function GiantMark() {
  const [ref, inView] = useInView<HTMLDivElement>("0px 0px -5% 0px");
  return (
    <div ref={ref} className={`giant ${inView ? "in" : ""}`} aria-hidden="true">
      {BRAND.name.split("").map((c, i) => (
        <span key={i} style={{ ["--i" as string]: i }}>
          {c}
        </span>
      ))}
    </div>
  );
}
