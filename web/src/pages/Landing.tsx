import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { BRAND, PLATFORM_TOKEN } from "../lib/brand.tsx";
import { Reveal } from "../lib/motion.tsx";
import { Copy, Link, navigate, short } from "../lib/ui.tsx";
import { AsciiSlabs } from "./AsciiSlabs.tsx";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { PixelPipeline } from "./PixelPipeline.tsx";
import { ZeroSlippage } from "./PixelStat.tsx";
import { HeroTicket } from "./HeroTicket.tsx";
import { TokenUtility } from "./TokenUtility.tsx";
import { MarketBoard } from "./Markets.tsx";
import { TokenAvatar } from "./Terminal.tsx";
import { MARKETS, market } from "../lib/tokens.ts";

function useServer() {
  const [escrow, setEscrow] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    api.config().then((c) => setEscrow(c.escrow), () => setEscrow(undefined));
    api.listRfqs().then((r) => setOpen(r.filter((x) => x.expiresAt > Date.now() / 1000).length), () => setOpen(null));
  }, []);
  return { escrow, open };
}

// ───────────────────────── app preview (demo data) ─────────────────────────

const DEMO_BLOCKS = [
  { side: "sell", sym: "PONS", size: "12.5M", pay: "ETH", n: 5, left: "3h 10m", on: true },
  { side: "buy", sym: "TSLA", size: "2,500", pay: "USDG", n: 3, left: "42m" },
  { side: "buy", sym: "NVDA", size: "4,000", pay: "USDG", n: 1, left: "12m" },
  { side: "sell", sym: "AAPL", size: "800", pay: "USDG", n: 0, left: "4h" },
];
const DEMO_BIDS = [
  { price: "6.10 ETH", unit: "0.000000488", who: "0x4f2a…91c0", ok: true, funds: true },
  { price: "5.95 ETH", unit: "0.000000476", who: "0x8b77…0e1d", ok: true, funds: true },
  { price: "9.00 ETH", unit: "0.000000720", who: "0xd3ad…beef", ok: false, funds: false },
];

function AppPreview() {
  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="mono">{BRAND.name.toLowerCase()} / desk</span>
        <span className="preview-note">Demo, example data</span>
      </div>
      <div className="preview-body">
        <div className="pv-col">
          <div className="pv-head">Open blocks</div>
          {DEMO_BLOCKS.map((b) => (
            <div key={b.sym} className={`pv-block ${b.on ? "on" : ""}`}>
              <span className={`side-chip ${b.side}`}>{b.side === "buy" ? "BUY" : "SELL"}</span>
              <TokenAvatar address={market(b.sym).address} symbol={b.sym} size={22} />
              <b>{b.sym}</b>
              <span className="mono">{b.size}</span>
              <span className="mono dim">{b.left}</span>
            </div>
          ))}
        </div>

        <div className="pv-col">
          <div className="pv-head">
            Sealed bids · PONS listing <span className="priv-chip">decrypted in your browser</span>
          </div>
          {DEMO_BIDS.map((b) => (
            <div key={b.who} className={`pv-bid ${b.ok ? "" : "bad"}`}>
              <div>
                <b className="mono">{b.price}</b>
                <span className="mono dim small"> {b.unit} / PONS</span>
              </div>
              <div className="pv-bid-meta mono small">
                <span>{b.who}</span>
                <span className={b.ok ? "good" : "warnc"}>{b.ok ? "signed" : "unverified"}</span>
                <span className={b.funds ? "good" : "warnc"}>{b.funds ? "has funds" : "no funds"}</span>
              </div>
            </div>
          ))}
          <div className="pv-hint mono small">Other traders see the size. Never the bids.</div>
        </div>

        <div className="pv-col ticket">
          <div className="pv-head">Deal ticket</div>
          <dl className="pv-terms mono small">
            <dt>Buyer gets</dt>
            <dd>12,500,000 PONS</dd>
            <dt>Seller gets</dt>
            <dd>6.10 ETH</dd>
            <dt>Fee</dt>
            <dd>2.5%</dd>
            <dt>Seller wallet</dt>
            <dd className="copper">one-time 0x9b1e…07fa</dd>
          </dl>
          <ol className="pv-steps mono small">
            <li className="done">Buyer deposited</li>
            <li className="done">Seller deposited (gasless)</li>
            <li className="now">Settled in 1 transaction</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── who sees what ─────────────────────────

const VIEWERS = ["You", "Counterparty", "Other traders", "Our server"] as const;
type Viewer = (typeof VIEWERS)[number];
const ROWS = ["Price", "Your wallet", "Size", "Deal terms"] as const;
const SEES: Record<Viewer, Record<(typeof ROWS)[number], string | null>> = {
  You: { Price: "6.10 ETH", "Your wallet": "0x7a3c…c01d", Size: "12.5M PONS", "Deal terms": "fixed, signed" },
  Counterparty: { Price: "6.10 ETH", "Your wallet": "one-time 0x9b1e…07fa", Size: "12.5M PONS", "Deal terms": "fixed, signed" },
  "Other traders": { Price: null, "Your wallet": null, Size: "12.5M PONS", "Deal terms": null },
  "Our server": { Price: null, "Your wallet": null, Size: "12.5M PONS", "Deal terms": "after acceptance" },
};

function WhoSees() {
  const [v, setV] = useState<Viewer>("Other traders");
  return (
    <div className="ws">
      <div className="ws-tabs" role="tablist" aria-label="View as">
        {VIEWERS.map((x) => (
          <button key={x} role="tab" aria-selected={v === x} className={v === x ? "on" : ""} onClick={() => setV(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="ws-rows">
        {ROWS.map((r) => {
          const val = SEES[v][r];
          return (
            <div key={r} className="ws-row">
              <span className="mono dim">{r}</span>
              {val ? <b className="mono">{val}</b> : <span className="redact" aria-label="hidden" />}
              <span className={`mono small ${val ? "good" : "copper"}`}>{val ? "VISIBLE" : "SEALED"}</span>
            </div>
          );
        })}
      </div>
    </div>
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
        <span className="dim small">~/desk · agent + slab mcp</span>
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
  ["What can I trade?", "ERC-20 tokens on Robinhood Chain, paid in ETH or USDG. Fee-on-transfer tokens are rejected by the escrow."],
  ["Can you take my funds?", "No. The escrow has no owner, admin key, pause or upgrade. Funds only move to settle or refund a deal."],
  ["Is it audited?", "Not yet. There's an internal review and a full test suite, no professional audit. Start with sizes you're comfortable with."],
  ["What does it cost?", "Posting and answering are free. At settlement: 2.5% under $10k, 2% from $10k, 1.5% from $100k. Capped at 2.5% in the contract."],
  ["Is it anonymous?", "No, it's private. Prices, intent and your main wallet stay hidden from other traders and from us. Settlement transfers are public on-chain like any token transfer."],
];

export function Landing() {
  const { escrow, open } = useServer();
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
  const mcp = `mcp-client add ${BRAND.name.toLowerCase()} -e BLOCKOTC_API=${window.location.origin}/api -- node backend/src/mcp/stdio.ts`;

  return (
    <div className="l3">
      {/* hero */}
      <section className="l3-hero">
        <div className="l3-hero-copy">
          <span className="chain-pill mono">
            <i aria-hidden="true" /> On Robinhood Chain<span className="cid"> · chain 4663</span> · {MARKETS.length} markets
          </span>
          <h1>
            Trade size.
            <br />
            <span className="copper">Stay private.</span>
          </h1>
          <p className="l3-lede">
            Post a block you want to buy or sell. Get prices sealed so only you can read them. Settle both sides in one escrow
            transaction, without touching the chart.
          </p>
          <div className="btn-wrap">
            <div className="ticks" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="btn-group">
              <SlotButton to="/how">HOW IT WORKS</SlotButton>
              <KeyButton to="/otc">OPEN THE DESK</KeyButton>
            </div>
          </div>
          <div className="ca-row mono">
            <span className="ca-k">ESCROW</span>
            {escrow ? (
              <>
                <span>{short(escrow)}</span>
                <Copy text={escrow} />
              </>
            ) : (
              <span className="dim">{escrow === null ? "not deployed yet" : "…"}</span>
            )}
            <span className="ca-sep" />
            <span className="ca-k">OPEN</span>
            <span>{open ?? "…"}</span>
          </div>
        </div>
        <div className="l3-hero-art">
          <HeroTicket />
        </div>
      </section>

      {/* token strip (meridian) */}
      <section className="tok-strip" aria-label="Example tokens">
        <div className="tok-labels mono">
          <span>{MARKETS.length} MARKETS · OR ANY ERC-20 ON ROBINHOOD CHAIN</span>
          <span>PAY IN ETH OR USDG</span>
        </div>
        {[false, true].map((rev) => (
          <div key={String(rev)} className="tok-viewport">
            <div className={`tok-track ${rev ? "rev" : ""}`}>
              {[0, 1].map((k) => (
                <div key={k} className="tok-set" aria-hidden={k === 1}>
                  {(rev ? [...MARKETS].reverse() : MARKETS).map((t) => (
                    <div key={t.symbol} className="tok">
                      <TokenAvatar address={t.address} symbol={t.symbol} size={30} />
                      <span>
                        <b>{t.symbol}</b>
                        <i>{t.name}</i>
                      </span>
                      <em className="mono">{t.kind === "etf" ? "ETF" : t.kind === "stock" ? "STOCK" : "TOKEN"}</em>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* market board */}
      <section className="l3-sect mk-sect">
        <Reveal className="no">
          <SectMeta label="MARKETS" idx={0} />
          <div className="mk-sect-head">
            <h2>
              Pick a market. <span className="tone">Keep your price.</span>
            </h2>
            <SlotButton to="/markets">ALL MARKETS</SlotButton>
          </div>
        </Reveal>
        <Reveal>
          <MarketBoard />
        </Reveal>
      </section>

      {/* product preview */}
      <section className="l3-preview">
        <Reveal>
          <AppPreview />
        </Reveal>
      </section>

      {/* glint-style pixel stat + fanned cards */}
      <Reveal>
        <ZeroSlippage />
      </Reveal>

      {/* NO. 1 trade */}
      <section className="l3-sect">
        <Reveal className="no">
          <SectMeta label="NO. 1 · TRADE" idx={1} />
          <h2>
            Move size <span className="green">without moving the price.</span>
          </h2>
        </Reveal>
        <div className="l3-points">
          {[
            ["Fixed price", "You agree a price with one counterparty. No order book, no slippage."],
            ["Both directions", "Bid to buy a block, or list one and let buyers bid for it."],
            ["One-transaction escrow", "The second deposit swaps both sides. Miss the deadline and both are refunded."],
            ["ETH or USDG", "Settle in either. Posting and answering are free."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 60} className="pt">
              <span className="pt-n mono">0{i + 1}</span>
              <b>{t}</b>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* NO. 2 privacy */}
      <section className="l3-sect">
        <Reveal className="no">
          <SectMeta label="NO. 2 · PRIVACY" idx={2} tone="copper" />
          <h2>
            Your price, your wallet, your intent. <span className="copper sweep">Out of sight.</span>
          </h2>
        </Reveal>
        <div className="l3-points priv">
          {[
            ["Sealed prices", "Answers are encrypted in the sender's browser to your key. Our server only stores ciphertext."],
            ["No accounts", "No email, no KYC, no sign-up. A private link is the only key."],
            ["Ghost mode", "Deliver from a one-time wallet; the relayer pays the gas. Your main wallet stays out of the deal."],
            ["Private agents", "AI agents trade through a local MCP server. Decryption and keys never leave their machine."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 60} className="pt">
              <span className="pt-n mono">0{i + 1}</span>
              <b>{t}</b>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* NO. 3 who sees what */}
      <section className="l3-sect two-col">
        <Reveal className="no">
          <SectMeta label="NO. 3 · WHO SEES WHAT" idx={3} tone="copper" />
          <h2>Switch the viewer.</h2>
          <p className="muted">
            Everything sealed stays sealed until the deal settles. Private, not anonymous: settlement transfers are public on-chain like
            any token transfer.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <WhoSees />
        </Reveal>
      </section>

      {/* NO. 4 how */}
      <section className="l3-sect">
        <Reveal className="no">
          <SectMeta label="NO. 4 · HOW A BLOCK TRADES" idx={4} />
          <h2>
            You decide. <span className="green">Code settles.</span>
          </h2>
          <p className="muted">One block, from the post to a settlement on chain. A live simulation.</p>
        </Reveal>
        <Reveal>
          <PixelPipeline />
        </Reveal>
      </section>

      {/* NO. 5 agents (glint "from your terminal") */}
      <section className="l3-sect ask">
        <Reveal className="no">
          <SectMeta label="NO. 5 · AGENTS & BUILDERS" idx={5} />
        </Reveal>
        <Reveal className="ask-head">
          <h2>
            Or just ask. <span className="tone">From your terminal.</span>
          </h2>
          <p className="muted">Plug the desk into any MCP-capable AI agent. It posts, reads sealed answers and settles, with your keys on your machine.</p>
        </Reveal>
        <div className="ask-grid">
          <Reveal className="ask-term">
            <div className="cmdline">
              <code className="mono">{mcp}</code>
              <Copy text={mcp} />
            </div>
            <AgentChat />
            <div className="ask-btns">
              <SlotButton to="/developers">10 MCP TOOLS</SlotButton>
              <SlotButton onClick={() => window.open("/api/sdk/blockotc.mjs", "_blank", "noreferrer")}>SDK</SlotButton>
              <SlotButton onClick={() => window.open("/api/openapi.json", "_blank", "noreferrer")}>OPENAPI</SlotButton>
            </div>
          </Reveal>
          <div className="ask-art" aria-hidden="true">
            <span className="ask-glow" />
            <AsciiSlabs />
          </div>
        </div>
      </section>

      {/* fees + security */}
      <section className="l3-sect facts">
        <Reveal className="fact">
          <span className="no-label mono">FEES</span>
          <h3>Free to post. Paid only when it settles.</h3>
          <table className="fee-table mono">
            <tbody>
              <tr>
                <td>Under $10k</td>
                <td>2.5%</td>
              </tr>
              <tr>
                <td>From $10k</td>
                <td>2.0%</td>
              </tr>
              <tr>
                <td>From $100k</td>
                <td>1.5%</td>
              </tr>
            </tbody>
          </table>
          <p className="fine">Capped at 2.5% in the contract. Partners earn half the fee on deals they refer.</p>
        </Reveal>
        <Reveal className="fact" delay={80}>
          <span className="no-label mono">SECURITY</span>
          <h3>Nobody can touch the escrow. Including us.</h3>
          <ul className="dash-list">
            <li>No owner, no admin key, no pause, no upgrade</li>
            <li>Each side refunds independently on timeout</li>
            <li>Answers signed and checked before you accept</li>
          </ul>
          <p className="fine copper">Not audited yet. Settlement turns on when the escrow is deployed.</p>
          <Link to="/security" className="text-link">
            Security details →
          </Link>
        </Reveal>
      </section>

      {/* NO. 6 token utility */}
      <section className="l3-sect">
        <Reveal className="no">
          <SectMeta label={`NO. 6 · THE TOKEN`} idx={6} />
          <h2>
            Every deal buys ${PLATFORM_TOKEN.symbol}. <span className="tone">Then burns it.</span>
          </h2>
          <p className="muted">
            Utility first: the desk runs today without a token. When ${PLATFORM_TOKEN.symbol} launches on Pons, two rules already
            written into the contracts switch on.
          </p>
        </Reveal>
        <Reveal>
          <TokenUtility />
        </Reveal>
      </section>

      {/* faq */}
      <section className="l3-sect two-col">
        <Reveal className="no">
          <span className="no-label mono">FAQ</span>
          <h2>Questions.</h2>
        </Reveal>
        <div className="l3-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* closing */}
      <section className="l3-close">
        <h2>
          Move the block.
          <br />
          <span className="copper">Keep it private.</span>
        </h2>
        <div className="btn-group">
          <SlotButton to="/otc?side=sell">SELL PRIVATELY</SlotButton>
          <KeyButton to="/otc">OPEN THE DESK</KeyButton>
        </div>
      </section>
    </div>
  );
}
