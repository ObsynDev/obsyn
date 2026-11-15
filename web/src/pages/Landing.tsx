import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { BRAND } from "../lib/brand.tsx";
import { Reveal } from "../lib/motion.tsx";
import { Copy, Link, navigate, short } from "../lib/ui.tsx";
import { AsciiSlabs } from "./AsciiSlabs.tsx";
import { DotWave } from "./DotWave.tsx";
import { TokenAvatar } from "./Terminal.tsx";

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
  { side: "buy", sym: "TSLAx", size: "250K", pay: "USDG", n: 3, left: "42m" },
  { side: "buy", sym: "NVDAx", size: "40K", pay: "USDG", n: 1, left: "12m" },
  { side: "sell", sym: "AAPLx", size: "8K", pay: "USDG", n: 0, left: "4h" },
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

const STAGES = [
  ["POSTING", "Buyer posts 250,000 TSLAx · pay in USDG · reply window 1h", "Bid to buy or list to sell. A private link, no account."],
  ["SEALED_BOX", "3 offers arrive as ciphertext · server can't read them", "Answers are encrypted to the poster's key in the sender's browser."],
  ["SIGNATURE_CHECK", "2 signed by their wallet · 1 unverified, ranked last", "Every answer is signed by the wallet it names. Fakes are flagged."],
  ["ACCEPT", "Best offer accepted · terms fixed · deal id 0xa91f…", "The poster picks one. The terms can't change after this."],
  ["ESCROW", "Payment locked first · seller deposits gasless", "No owner, no admin key. Funds only move to settle or refund."],
  ["ROBINHOOD_CHAIN", "Swapped in one transaction · receipt on chain", "Tokens to the buyer, payment to the seller. Or everyone is refunded."],
] as const;

function Pipeline() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((x) => (x + 1) % STAGES.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pipe">
      <div className="pipe-nodes">
        {STAGES.map(([k, , d], n) => (
          <div key={k} className={`pipe-node ${n === i ? "on" : n < i ? "done" : ""}`}>
            <span className="mono">{k}</span>
            <p>{d}</p>
          </div>
        ))}
      </div>
      <div className="pipe-log mono">
        <span className="dim">&gt;</span> {STAGES[i][1]}
        <span className="cursor" aria-hidden="true">
          _
        </span>
      </div>
    </div>
  );
}

const CHAT: [string, string][] = [
  ["you", "sell 50,000 PONS privately, paid in USDG, open for 1 hour"],
  ["sys", "listing posted · private link saved locally"],
  ["sys", "3 sealed bids · 2 signed by their wallet · best 2,450 USDG"],
  ["you", "accept the best one, ghost mode on"],
  ["sys", "one-time wallet funded · buyer paid in · deposited gasless"],
  ["ok", "settled in 1 transaction ✓"],
];

function AgentChat() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => (x >= CHAT.length + 2 ? 0 : x + 1)), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="chat mono" aria-label="Example agent session">
      <div className="chat-bar">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="dim small">agent · slab mcp</span>
      </div>
      {CHAT.slice(0, Math.min(n, CHAT.length)).map(([who, line], k) => (
        <div key={k} className={`chat-line ${who}`}>
          <span className="who">{who === "you" ? ">" : who === "ok" ? "✓" : "·"}</span> {line}
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
function SectMeta({ label, idx, total = 5, tone = "green" }: { label: string; idx: number; total?: number; tone?: "green" | "copper" }) {
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

const EXAMPLE_TOKENS: [string, string, string][] = [
  ["TSLAx", "Tesla xStock", "0x7a3c5f10aa00000000000000000000000000c01d"],
  ["NVDAx", "Nvidia xStock", "0xc0ffee0000000000000000000000000000beef42"],
  ["PONS", "Pons", "0x39dbed3a2bd333467115de45665cc57f813c4571"],
  ["AAPLx", "Apple xStock", "0x8a791620dd6260079bf849dc5567adc3f2fdc318"],
  ["AMZNx", "Amazon xStock", "0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6"],
  ["METAx", "Meta xStock", "0xb7f8bc63bbcad18155201308c8f3540b07f84f5e"],
  ["USDG", "Global Dollar", "0x5fc5360d0400a0fd4f2af552add042d716f1d168"],
];

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
          <h1>
            Trade size.
            <br />
            <span className="copper">Stay private.</span>
          </h1>
          <p className="kicker mono">
            PRIVATE OTC DESK. BUILT ON ROBINHOOD CHAIN.<span className="cursor" aria-hidden="true">_</span>
          </p>
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
              <Link to="/how" className="sq ghost">
                HOW IT WORKS <span aria-hidden="true">→</span>
              </Link>
              <Link to="/otc" className="sq go">
                OPEN THE DESK <span className="key">ENTER ↵</span>
              </Link>
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
          <AsciiSlabs />
        </div>
        <DotWave />
      </section>

      {/* token strip (meridian) */}
      <section className="tok-strip" aria-label="Example tokens">
        <span className="tok-label mono">ANY ERC-20 ON ROBINHOOD CHAIN · FOR EXAMPLE</span>
        <div className="tok-viewport">
          <div className="tok-track">
            {[0, 1].map((k) => (
              <div key={k} className="tok-set" aria-hidden={k === 1}>
                {EXAMPLE_TOKENS.map(([sym, name, addr]) => (
                  <div key={sym} className="tok">
                    <TokenAvatar address={addr as `0x${string}`} symbol={sym} size={30} />
                    <span>
                      <b>{sym}</b>
                      <i>{name}</i>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* product preview */}
      <section className="l3-preview">
        <Reveal>
          <AppPreview />
        </Reveal>
      </section>

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
          <Pipeline />
        </Reveal>
      </section>

      {/* NO. 5 agents */}
      <section className="l3-sect">
        <Reveal className="no">
          <SectMeta label="NO. 5 · AGENTS & BUILDERS" idx={5} />
          <h2>
            Your agent can <span className="green">work the desk.</span>
          </h2>
        </Reveal>
        <Reveal className="cmdline">
          <code className="mono">{mcp}</code>
          <Copy text={mcp} />
        </Reveal>
        <Reveal>
          <AgentChat />
        </Reveal>
        <div className="link-row">
          <a className="sq ghost sm" href="/api/openapi.json" target="_blank" rel="noreferrer">
            OPENAPI
          </a>
          <a className="sq ghost sm" href="/api/sdk/blockotc.mjs" target="_blank" rel="noreferrer">
            SDK
          </a>
          <Link to="/developers" className="sq ghost sm">
            10 MCP TOOLS →
          </Link>
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
          <Link to="/app?new=sell" className="sq ghost">
            SELL PRIVATELY
          </Link>
          <Link to="/otc" className="sq go">
            OPEN THE DESK <span className="key">ENTER ↵</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
