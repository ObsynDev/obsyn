import { useEffect, useState } from "react";
import { api, type Rfq } from "../lib/api.ts";
import { BRAND, LogoMark } from "../lib/brand.tsx";
import { CountUp, Reveal, reducedMotion, Scramble, useTilt } from "../lib/motion.tsx";
import { Copy, Link, short } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

// ───────────────────────── data ─────────────────────────

function useLive() {
  const [rows, setRows] = useState<Rfq[] | null>(null);
  const [escrow, setEscrow] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api.listRfqs().then(setRows, () => setRows([]));
    api.config().then((c) => setEscrow(c.escrow), () => setEscrow(undefined));
  }, []);
  const open = (rows ?? []).filter((r) => r.expiresAt > Date.now() / 1000);
  return { open, escrow, answers: open.reduce((n, r) => n + r.quoteCount, 0) };
}

const EXAMPLE = [
  { side: "buy" as const, sym: "TSLAx", name: "Tesla xStock", size: "250K", pay: "USDG", n: 3, left: "42m", addr: "0x7a3c5f10aa00000000000000000000000000c01d", pct: 70 },
  { side: "sell" as const, sym: "PONS", name: "Pons", size: "12.5M", pay: "ETH", n: 5, left: "3h 10m", addr: "0x39dbed3a2bd333467115de45665cc57f813c4571", pct: 45 },
  { side: "buy" as const, sym: "NVDAx", name: "Nvidia xStock", size: "40K", pay: "USDG", n: 1, left: "12m", addr: "0xc0ffee0000000000000000000000000000beef42", pct: 18 },
];

// ───────────────────────── hero stage ─────────────────────────

function HeroStage() {
  const tilt = useTilt<HTMLDivElement>(7);
  return (
    <div className="stage" ref={tilt}>
      <div className="stage-glow" aria-hidden="true" />
      <div className="stage-card">
        <div className="stage-head">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span className="mono dim small">{BRAND.name.toLowerCase()}://terminal</span>
          <span className="pill muted">example</span>
        </div>
        {EXAMPLE.map((c, i) => (
          <div key={c.sym} className={`stage-row ${c.side}`} style={{ animationDelay: `${300 + i * 140}ms` }}>
            <TokenAvatar address={c.addr as `0x${string}`} symbol={c.sym} size={38} side={c.side} />
            <div className="stage-row-body">
              <div className="stage-row-top">
                <b>{c.sym}</b>
                <span className="dim">{c.name}</span>
                <span className={`tag ${c.side}`}>{c.side === "buy" ? "BUYING" : "SELLING"}</span>
                <span className="mono stage-size">{c.size}</span>
              </div>
              <div className="stage-row-mid">
                <span className="pill info">{c.pay}</span>
                <span className="pill muted shimmer">PRICE ••••••</span>
                <span className="pill warn">
                  {c.n} sealed {c.side === "buy" ? "offer" : "bid"}
                  {c.n === 1 ? "" : "s"}
                </span>
              </div>
              <div className="stage-bar">
                <span style={{ width: `${c.pct}%` }} />
                <em className="mono">⏱ {c.left}</em>
              </div>
            </div>
          </div>
        ))}
      </div>
      <span className="float f1">
        <i className="ok">●</i> sealed in browser
      </span>
      <span className="float f2">
        <i className="ok">✓</i> signed by 0x7a…c01d
      </span>
      <span className="float f3">
        <i className="ok">⚡</i> settled in 1 tx
      </span>
    </div>
  );
}

// ───────────────────────── seal demo ─────────────────────────

const CIPHER = "x9Fq2+Lm0vRZ7c/aH1tQe8Ws4KpBn5yU3gTj6Dk0";

/** Loops: a plain offer → scrambles into ciphertext → locks. Shows the core idea without words. */
function SealDemo() {
  const [phase, setPhase] = useState(0); // 0 plain, 1 sealing, 2 sealed
  useEffect(() => {
    if (reducedMotion()) return setPhase(2);
    const seq = [2200, 1400, 2600];
    let i = 0;
    let t: number;
    const step = () => {
      i = (i + 1) % 3;
      setPhase(i);
      t = window.setTimeout(step, seq[i]);
    };
    t = window.setTimeout(step, seq[0]);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`seal-demo p${phase}`}>
      <div className="seal-line">
        <span className="dim mono">offer</span>
        <span className="seal-value mono">
          {phase === 0 ? "41,250.00 USDG · 0x7a3c…c01d" : phase === 1 ? <Scramble text={CIPHER} duration={1100} /> : CIPHER}
        </span>
      </div>
      <div className="seal-foot">
        <span className={`lock ${phase === 2 ? "on" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" />
            <path d={phase === 2 ? "M8 10.5V8a4 4 0 0 1 8 0v2.5" : "M8 10.5V8a4 4 0 0 1 7.5-1.9"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="mono small">{phase === 0 ? "plain text, in your browser" : phase === 1 ? "encrypting to the poster's key…" : "sealed. only the poster can open it"}</span>
      </div>
    </div>
  );
}

// ───────────────────────── escrow flow ─────────────────────────

function EscrowFlow() {
  return (
    <svg className="flow" viewBox="0 0 640 220" role="img" aria-label="Buyer sends payment and seller sends tokens into the escrow, which swaps both in one transaction">
      <defs>
        <linearGradient id="g-buy" x1="0" x2="1">
          <stop offset="0" stopColor="#8cff61" stopOpacity="0" />
          <stop offset="1" stopColor="#8cff61" />
        </linearGradient>
        <linearGradient id="g-sell" x1="1" x2="0">
          <stop offset="0" stopColor="#ff4a5a" stopOpacity="0" />
          <stop offset="1" stopColor="#ff4a5a" />
        </linearGradient>
      </defs>
      <path id="p-in-l" d="M110 80 C 200 80, 240 110, 290 110" className="flow-path" />
      <path id="p-in-r" d="M530 80 C 440 80, 400 110, 350 110" className="flow-path" />
      <path id="p-out-l" d="M290 130 C 240 130, 200 160, 110 160" className="flow-path" />
      <path id="p-out-r" d="M350 130 C 400 130, 440 160, 530 160" className="flow-path" />
      {!reducedMotion() && (
        <>
          <circle r="5" fill="#8cff61">
            <animateMotion dur="3s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.4;1">
              <mpath href="#p-in-l" />
            </animateMotion>
          </circle>
          <circle r="5" fill="#ff4a5a">
            <animateMotion dur="3s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.4;1">
              <mpath href="#p-in-r" />
            </animateMotion>
          </circle>
          <circle r="5" fill="#ff4a5a">
            <animateMotion dur="3s" repeatCount="indefinite" keyPoints="0;0;1" keyTimes="0;0.55;1">
              <mpath href="#p-out-l" />
            </animateMotion>
          </circle>
          <circle r="5" fill="#8cff61">
            <animateMotion dur="3s" repeatCount="indefinite" keyPoints="0;0;1" keyTimes="0;0.55;1">
              <mpath href="#p-out-r" />
            </animateMotion>
          </circle>
        </>
      )}
      <g className="flow-node">
        <rect x="20" y="62" width="90" height="116" rx="14" />
        <text x="65" y="98" textAnchor="middle" className="t-h">
          BUYER
        </text>
        <text x="65" y="122" textAnchor="middle" className="t-s">
          pays USDG
        </text>
        <text x="65" y="158" textAnchor="middle" className="t-s ok-fill">
          gets tokens
        </text>
      </g>
      <g className="flow-node">
        <rect x="530" y="62" width="90" height="116" rx="14" />
        <text x="575" y="98" textAnchor="middle" className="t-h">
          SELLER
        </text>
        <text x="575" y="122" textAnchor="middle" className="t-s">
          sends tokens
        </text>
        <text x="575" y="158" textAnchor="middle" className="t-s ok-fill">
          gets USDG
        </text>
      </g>
      <g className="flow-escrow">
        <rect x="270" y="70" width="100" height="100" rx="20" />
        <text x="320" y="112" textAnchor="middle" className="t-h">
          ESCROW
        </text>
        <text x="320" y="132" textAnchor="middle" className="t-s">
          no admin key
        </text>
        <text x="320" y="150" textAnchor="middle" className="t-s ok-fill">
          1 tx swap
        </text>
      </g>
    </svg>
  );
}

// ───────────────────────── who sees what ─────────────────────────

const VIEWERS = ["You", "The other side", "Other traders", "Our server"] as const;
type Viewer = (typeof VIEWERS)[number];
const FIELDS = ["Price", "Wallet", "Size", "Deal terms"] as const;
const SEES: Record<Viewer, Record<(typeof FIELDS)[number], string | null>> = {
  You: { Price: "41,250.00 USDG", Wallet: "0x7a3c…c01d", Size: "250,000 TSLAx", "Deal terms": "fixed, signed" },
  "The other side": { Price: "41,250.00 USDG", Wallet: "one-time 0x9b1e…07fa", Size: "250,000 TSLAx", "Deal terms": "fixed, signed" },
  "Other traders": { Price: null, Wallet: null, Size: "250,000 TSLAx", "Deal terms": null },
  "Our server": { Price: null, Wallet: null, Size: "250,000 TSLAx", "Deal terms": "after acceptance" },
};

function WhoSees() {
  const [v, setV] = useState<Viewer>("Other traders");
  return (
    <div className="whosees">
      <div className="viewer-tabs" role="tablist" aria-label="View as">
        <span className="mono dim small">view as</span>
        {VIEWERS.map((x) => (
          <button key={x} role="tab" aria-selected={v === x} className={v === x ? "on" : ""} onClick={() => setV(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="sees-grid">
        {FIELDS.map((f) => {
          const val = SEES[v][f];
          return (
            <div key={f} className={`sees ${val ? "open" : "hidden"}`}>
              <span className="label-plain">{f}</span>
              <b className="mono">{val ?? "••••••••"}</b>
              <i>{val ? "visible" : "sealed"}</i>
            </div>
          );
        })}
      </div>
      <p className="fine">Example deal. At settlement the transfers are public on-chain, like any token transfer. Ghost mode swaps your wallet for a one-time address; it is not a mixer.</p>
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
  ["Is ghost mode a mixer?", "No. It hides your main wallet from the counterparty and casual watchers. Funding the one-time wallet is still a public transfer."],
];

export function Landing() {
  const { open, escrow, answers } = useLive();
  const cmd = `mcp-client add ${BRAND.name.toLowerCase()} -e BLOCKOTC_API=${window.location.origin}/api -- node backend/src/mcp/stdio.ts`;

  return (
    <div className="landing2">
      <div className="bg-grid" aria-hidden="true" />
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      {/* ── hero ── */}
      <section className="hero2">
        <div className="hero2-copy">
          <span className="badge-line">
            <span className="pulse" /> {escrow ? "Live on Robinhood Chain" : "Preview · Robinhood Chain"}
          </span>
          <h1>
            <span className="h1-line">Trade size</span>
            <span className="h1-line">
              <em className="serif">without</em> moving
            </span>
            <span className="h1-line">the price.</span>
          </h1>
          <p className="lede">
            A private block desk for Robinhood Chain. Post what you want to buy or sell, receive{" "}
            <b className="hl">sealed prices only you can read</b>, and settle both sides in <b className="hl">one escrow transaction</b>.
          </p>
          <div className="hero-cta">
            <Link to="/app" className="cta buy lg">
              ⚡ Launch app
            </Link>
            <Link to="/app?new=sell" className="cta outline lg">
              Sell privately →
            </Link>
          </div>
          <div className="hero-meta mono">
            <span>
              <b>
                <CountUp value={open.length} />
              </b>{" "}
              open blocks
            </span>
            <span>
              <b>
                <CountUp value={answers} />
              </b>{" "}
              sealed answers
            </span>
            <span>
              <b>0</b> admin keys
            </span>
            <span className="ca-inline">
              escrow{" "}
              {escrow ? (
                <>
                  <b>{short(escrow)}</b> <Copy text={escrow} />
                </>
              ) : (
                <b className="warn-text">not deployed yet</b>
              )}
            </span>
          </div>
        </div>
        <HeroStage />
      </section>

      {/* ── big marquee ── */}
      <div className="bigmarq" aria-hidden="true">
        <div className="bigmarq-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k}>
              SIZE <i>✦</i> <em>SEALED</em> <i>✦</i> SIGNED <i>✦</i> <em>SETTLED</em> <i>✦</i> NO SLIPPAGE <i>✦</i> <em>NO CHART</em> <i>✦</i>
            </span>
          ))}
        </div>
      </div>

      {/* ── problem → answer ── */}
      <section className="sect2 problem2">
        <Reveal className="sect-head">
          <span className="label">The problem</span>
          <h2>
            Big orders get <em className="serif">punished</em> in public.
          </h2>
        </Reveal>
        <div className="problem2-grid">
          {[
            ["↘", "Slippage", "A large sell walks a thin pool down with every unit."],
            ["⚡", "Front-running", "Bots see your transaction coming and trade ahead of it."],
            ["◉", "Signalling", "The chart tells everyone a whale is moving."],
            ["⇄", "Trust", "Chat OTC means sending first to a stranger or a middleman."],
          ].map(([n, t, d], i) => (
            <Reveal key={t} delay={i * 80} className="pcard">
              <span className="pnum">{n}</span>
              <b>{t}</b>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── bento USPs ── */}
      <section className="sect2">
        <Reveal className="sect-head">
          <span className="label">Why {BRAND.name}</span>
          <h2>
            Built for size. <em className="serif">Built for silence.</em>
          </h2>
        </Reveal>
        <div className="bento">
          <Reveal className="tile t-seal">
            <span className="num">01</span>
            <h3>Sealed for real</h3>
            <p>Prices are encrypted in your browser to the other side's key. Our server stores ciphertext it can't read.</p>
            <SealDemo />
          </Reveal>
          <Reveal className="tile t-two" delay={80}>
            <span className="num">02</span>
            <h3>Both directions</h3>
            <p>Bid for a block, or sell privately and let buyers bid for yours.</p>
            <div className="two-way mono">
              <span className="tag buy">BUY</span>
              <span className="arrows">⇄</span>
              <span className="tag sell">SELL</span>
            </div>
          </Reveal>
          <Reveal className="tile t-sig" delay={160}>
            <span className="num">03</span>
            <h3>No fake answers</h3>
            <p>Every answer is signed by its wallet, and you see if that wallet holds the funds.</p>
            <div className="sig-list mono small">
              <span>
                <i className="ok">✓</i> signed by this wallet <em className="ok">has the funds</em>
              </span>
              <span>
                <i className="warn-text">!</i> unverified <em className="warn-text">ranked last</em>
              </span>
            </div>
          </Reveal>
          <Reveal className="tile t-escrow" delay={60}>
            <span className="num">04</span>
            <h3>One transaction, or a refund</h3>
            <p>The second deposit swaps both sides. Miss the deadline and everyone gets back exactly what they put in.</p>
            <EscrowFlow />
          </Reveal>
          <Reveal className="tile t-ghost" delay={120}>
            <span className="num">05</span>
            <h3>Ghost mode</h3>
            <p>Deliver from a one-time wallet. The relayer pays the gas; the buyer never sees your main address.</p>
            <div className="ghost-viz mono small">
              <span className="dim">0x7a3c…c01d</span>
              <span className="ghost-arrow">→</span>
              <span className="ok">0x9b1e…07fa</span>
              <span className="pill muted">gas: relayer</span>
            </div>
          </Reveal>
          <Reveal className="tile t-agent" delay={180}>
            <span className="num">06</span>
            <h3>Agent-native, still private</h3>
            <p>AI agents trade through a local MCP server. Keys and decryption stay on the agent's machine.</p>
            <div className="mini-term mono small">
              <span>
                <i className="dim">›</i> otc_create_listing <i className="dim">50000 PONS</i>
              </span>
              <span>
                <i className="dim">›</i> otc_get_offers <i className="ok">3 verified</i>
              </span>
              <span>
                <i className="dim">›</i> otc_deposit <i className="ok">settled</i>
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── who sees what ── */}
      <section className="sect2 split2">
        <Reveal className="sect-head">
          <span className="label">Who sees what</span>
          <h2>
            What you see. <em className="serif">What they don't.</em>
          </h2>
          <p className="muted">Switch the viewer. Everything sealed stays sealed until the deal settles.</p>
        </Reveal>
        <Reveal delay={100}>
          <WhoSees />
        </Reveal>
      </section>

      {/* ── steps ── */}
      <section className="sect2">
        <Reveal className="sect-head">
          <span className="label">How a block trades</span>
          <h2>Six steps. One settlement.</h2>
        </Reveal>
        <ol className="rail">
          {[
            ["Post", "Bid to buy, or list to sell."],
            ["Seal", "Answers arrive encrypted to you."],
            ["Sign", "Each answer is signed by its wallet."],
            ["Accept", "Pick one. Terms are fixed."],
            ["Deposit", "Both sides fund the escrow."],
            ["Settle", "One tx swaps both. Or refund."],
          ].map(([t, d], i) => (
            <Reveal as="li" key={t} delay={i * 70}>
              <span className="rail-dot" />
              <span className="num mono">{String(i + 1).padStart(2, "0")}</span>
              <b>{t}</b>
              <p>{d}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ── compare ── */}
      <section className="sect2">
        <Reveal className="sect-head">
          <span className="label">Compared</span>
          <h2>Three ways to move a block.</h2>
        </Reveal>
        <div className="vs">
          <Reveal className="vs-col">
            <h3>DEX market order</h3>
            <ul>
              <li className="no">Price impact on every unit</li>
              <li className="no">Visible in the mempool</li>
              <li className="no">Moves the chart</li>
              <li className="yes">No counterparty risk</li>
            </ul>
          </Reveal>
          <Reveal className="vs-col" delay={80}>
            <h3>Chat OTC + middleman</h3>
            <ul>
              <li className="yes">Fixed price</li>
              <li className="no">Someone holds your funds</li>
              <li className="no">Prices leak in group chats</li>
              <li className="no">Slow and trust-based</li>
            </ul>
          </Reveal>
          <Reveal className="vs-col best" delay={160}>
            <span className="best-tag mono">{BRAND.name}</span>
            <h3>
              <LogoMark size={22} /> {BRAND.name}
            </h3>
            <ul>
              <li className="yes">Fixed price, zero slippage</li>
              <li className="yes">Adminless escrow, refund on timeout</li>
              <li className="yes">Sealed, signed answers</li>
              <li className="yes">One-transaction settlement</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ── agents ── */}
      <section className="sect2 split2 agents2">
        <Reveal className="sect-head">
          <span className="label">For agents & builders</span>
          <h2>
            Let your agent <em className="serif">work the desk.</em>
          </h2>
          <p className="muted">
            Ten MCP tools to list, bid, read sealed answers, accept, deposit and refund. Or use the JavaScript SDK and the OpenAPI spec.
          </p>
          <div className="pill-row">
            <a className="pill info" href="/api/openapi.json" target="_blank" rel="noreferrer">
              openapi.json
            </a>
            <a className="pill info" href="/api/sdk/blockotc.mjs" target="_blank" rel="noreferrer">
              sdk.mjs
            </a>
            <Link to="/developers" className="pill info">
              developer docs →
            </Link>
          </div>
        </Reveal>
        <Reveal delay={100} className="code-window">
          <div className="stage-head">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            <span className="mono dim small">agent.ts</span>
          </div>
          <div className="cmd-bar">
            <code>{cmd}</code>
            <Copy text={cmd} />
          </div>
          <pre className="code">
            <span className="c">// sell 50,000 PONS without touching the chart</span>
            {"\n"}
            <span className="k">const</span> listing = <span className="k">await</span> otc.<span className="f">createListing</span>({"{"} token, amount: <span className="s">"50000"</span>, payWith: <span className="s">"USDG"</span> {"}"});{"\n"}
            <span className="k">const</span> bids = <span className="k">await</span> otc.<span className="f">getOffers</span>(listing.bidId); <span className="c">// decrypted locally</span>
            {"\n"}
            <span className="k">await</span> otc.<span className="f">acceptOffer</span>({"{"} ...bids[<span className="n">0</span>], ghost: <span className="k">true</span> {"}"});{"\n"}
            <span className="k">await</span> otc.<span className="f">deposit</span>({"{"} bidId: listing.bidId {"}"}); <span className="c">// settles in one tx</span>
          </pre>
        </Reveal>
      </section>

      {/* ── fees + security ── */}
      <section className="sect2 duo">
        <Reveal className="glass">
          <span className="label">Fees</span>
          <h3>Free to post. Pay only when it settles.</h3>
          <div className="fee-bars">
            {[
              ["Under $10k", 2.5],
              ["From $10k", 2.0],
              ["From $100k", 1.5],
            ].map(([k, v]) => (
              <div key={k as string}>
                <span>{k}</span>
                <span className="fee-track">
                  <span style={{ width: `${((v as number) / 2.5) * 100}%` }} />
                </span>
                <b className="mono">{(v as number).toFixed(1)}%</b>
              </div>
            ))}
          </div>
          <p className="fine">Capped at 2.5% in the contract. Partners earn half the fee on deals they refer. Platform-token holders will pay 0.5% less once it launches.</p>
        </Reveal>
        <Reveal className="glass" delay={100}>
          <span className="label">Security</span>
          <h3>Nobody can touch the escrow. Including us.</h3>
          <ul className="checks-list">
            <li>No owner, no admin key, no pause, no upgrade</li>
            <li>Each side refunds independently on timeout</li>
            <li>Short and fee-on-transfer deposits rejected</li>
            <li>Answers signed and checked before you accept</li>
          </ul>
          <p className="warn-line">Not audited yet. Settlement turns on when the escrow is deployed.</p>
          <Link to="/security" className="text-link">
            Security details →
          </Link>
        </Reveal>
      </section>

      {/* ── faq ── */}
      <section className="sect2 split2">
        <Reveal className="sect-head">
          <span className="label">FAQ</span>
          <h2>Questions, answered.</h2>
        </Reveal>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 50}>
              <details>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── closing ── */}
      <section className="closing2">
        <span className="giant" aria-hidden="true">
          {BRAND.name}
        </span>
        <Reveal className="closing2-inner">
          <h2>
            Move the block.
            <br />
            <em className="serif">Keep the chart quiet.</em>
          </h2>
          <div className="hero-cta">
            <Link to="/app" className="cta buy lg">
              ⚡ Launch app
            </Link>
            <Link to="/app?new=buy" className="cta outline lg">
              Post a bid
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
