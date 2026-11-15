import { useEffect, useState } from "react";
import { api, type Rfq } from "../lib/api.ts";
import { BRAND } from "../lib/brand.tsx";
import { sideOf } from "../lib/sealed.ts";
import { Copy, Link, short } from "../lib/ui.tsx";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { compact, TokenAvatar } from "./Terminal.tsx";

// ───────────────────────── live bits ─────────────────────────

function useLive() {
  const [rows, setRows] = useState<Rfq[] | null>(null);
  const [escrow, setEscrow] = useState<string | null | undefined>(undefined);
  const [usdg, setUsdg] = useState<string | null>(null);
  useEffect(() => {
    api.listRfqs().then(setRows, () => setRows([]));
    api.config().then(
      (c) => {
        setEscrow(c.escrow);
        setUsdg(c.usdg);
      },
      () => setEscrow(undefined),
    );
  }, []);
  return { rows, escrow, usdg };
}

/** Hero visual: the real open blocks when there are some, labelled example cards otherwise. */
function HeroTerminal({ rows }: { rows: Rfq[] | null }) {
  const real = (rows ?? []).filter((r) => r.expiresAt > Date.now() / 1000).slice(0, 3);
  const [toks, setToks] = useState<Record<string, TokenInfo>>({});
  useEffect(() => {
    for (const r of real) {
      for (const a of [r.token, r.payToken]) {
        if (toks[a]) continue;
        tokenInfo(a).then((t) => setToks((s) => ({ ...s, [a]: t })), () => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const example = real.length === 0;
  const cards = example
    ? [
        { side: "buy" as const, sym: "TSLAx", name: "Tesla xStock", size: "250K", pay: "USDG", n: 3, left: "42m", addr: "0x7a3c5f10aa00000000000000000000000000c01d" },
        { side: "sell" as const, sym: "PONS", name: "Pons", size: "12.5M", pay: "ETH", n: 5, left: "3h 10m", addr: "0x39dbed3a2bd333467115de45665cc57f813c4571" },
        { side: "buy" as const, sym: "NVDAx", name: "Nvidia xStock", size: "40K", pay: "USDG", n: 1, left: "12m", addr: "0xc0ffee0000000000000000000000000000beef42" },
      ]
    : real.map((r) => {
        const t = toks[r.token];
        const p = toks[r.payToken];
        const mins = Math.max(0, Math.round((r.expiresAt - Date.now() / 1000) / 60));
        return {
          side: sideOf(r),
          sym: t?.symbol ?? short(r.token),
          name: t?.name && t.name !== t.symbol ? t.name : "",
          size: t && r.amount ? compact(r.amount, t.decimals) : "",
          pay: p?.symbol ?? "",
          n: r.quoteCount,
          left: mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`,
          addr: r.token,
        };
      });
  return (
    <div className="hero-term" aria-label={example ? "Example blocks" : "Open blocks"}>
      <div className="hero-term-head">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
        <span className="mono dim small">{BRAND.name.toLowerCase()} · terminal</span>
        {example && <span className="pill muted">example data</span>}
      </div>
      {cards.map((c, i) => (
        <div key={i} className={`hero-card ${c.side}`}>
          <TokenAvatar address={c.addr as `0x${string}`} symbol={c.sym} size={40} side={c.side} />
          <div className="hero-card-body">
            <div className="hero-card-top">
              <b>{c.sym}</b>
              {c.name && <span className="dim">{c.name}</span>}
              <span className={`tag ${c.side}`}>{c.side === "buy" ? "BUYING" : "SELLING"}</span>
              {c.size && <span className="mono hero-size">{c.size}</span>}
            </div>
            <div className="hero-card-mid">
              {c.pay && <span className="pill info">{c.pay}</span>}
              <span className="pill muted">PRICE ••••••</span>
              <span className="pill warn">
                {c.n} sealed {c.side === "buy" ? "offer" : "bid"}
                {c.n === 1 ? "" : "s"}
              </span>
              <span className="mono dim small">⏱ {c.left}</span>
            </div>
          </div>
        </div>
      ))}
      <div className="hero-term-foot mono small">
        <span>
          <span className="ok">●</span> deal #a91f
        </span>
        <span>buyer deposited ✓</span>
        <span>seller deposited ✓</span>
        <span className="ok">settled in 1 tx</span>
      </div>
    </div>
  );
}

function EscrowStatus({ escrow }: { escrow: string | null | undefined }) {
  if (escrow === undefined) return null;
  return (
    <span className="ca">
      Escrow{" "}
      {escrow ? (
        <>
          <b>{short(escrow)}</b>
          <Copy text={escrow} />
        </>
      ) : (
        <b>not deployed yet. Accept no imitations.</b>
      )}
    </span>
  );
}

// ───────────────────────── page ─────────────────────────

const USPS = [
  {
    t: "Sealed for real",
    d: "Prices are encrypted in your browser to the other side's key. Our server stores ciphertext it can't read, so nobody, us included, can front-run your size.",
  },
  {
    t: "Both directions",
    d: "Buyers post bids and sellers answer. Or sell privately: list a block and let buyers bid for it. Same escrow, same privacy.",
  },
  {
    t: "One transaction, or a refund",
    d: "Both sides deposit into an escrow contract. The second deposit swaps both at once. Miss the deadline and everyone gets back exactly what they put in.",
  },
  {
    t: "No fake answers",
    d: "Every answer is signed by the wallet it names, and you see whether that wallet actually holds the funds or tokens. Unverified answers are flagged.",
  },
  {
    t: "Ghost mode",
    d: "Sellers can deposit from a one-time wallet. A relayer pays the gas, the buyer only ever sees the one-time address, proceeds go where you choose.",
  },
  {
    t: "Agent-native, still private",
    d: "AI agents trade through a local MCP server and an open SDK. Encryption and keys stay on the agent's machine, not on our servers.",
  },
];

const PRIVACY_ROWS: [string, string, string, string, string][] = [
  // who            your price   your wallet           your size     the deal
  ["You", "yes", "yes", "yes", "yes"],
  ["The other side", "yes, after you answer", "only the address you choose", "yes", "yes"],
  ["Other traders", "no", "no", "yes, only that a block is open", "after settlement"],
  ["Our server", "no, ciphertext only", "no", "yes", "terms after acceptance"],
  ["The chain", "at settlement", "the deposit address", "at settlement", "yes, verifiable"],
];

const FAQ = [
  ["Do I need an account?", "No. Posting a bid or listing gives you a private link. That link is the key, so keep it like a password."],
  ["What can I trade?", "ERC-20 tokens on Robinhood Chain, paid in ETH or USDG. Tokens that take a fee on transfer are rejected by the escrow."],
  ["Can you take my funds?", "No. The escrow has no owner, no admin key, no pause and no upgrade. Funds only move to settle a deal or to refund it."],
  [
    "Is it audited?",
    "Not yet. The contracts have an internal security review and a full test suite, but no professional audit. Start with sizes you are comfortable with.",
  ],
  ["What does it cost?", "Posting and answering are free. At settlement: 2.5% under $10k, 2% from $10k, 1.5% from $100k, capped at 2.5% in the contract."],
  ["Is ghost mode a mixer?", "No. It hides your main wallet from the counterparty and casual watchers. Moving tokens into the one-time wallet is still a public transaction."],
];

export function Landing() {
  const { rows, escrow, usdg } = useLive();
  const open = (rows ?? []).filter((r) => r.expiresAt > Date.now() / 1000);
  const answers = open.reduce((n, r) => n + r.quoteCount, 0);
  const cmd = `mcp-client add ${BRAND.name.toLowerCase()} -e BLOCKOTC_API=${window.location.origin}/api -- node backend/src/mcp/stdio.ts`;

  return (
    <div className="landing">
      {/* hero */}
      <section className="hero">
        <div className="hero-copy">
          <span className="label">Private OTC · Robinhood Chain</span>
          <h1>
            Trade size <span className="serif">without</span> moving the price.
          </h1>
          <p className="lede">
            {BRAND.name} is a private block-trading desk for tokens on Robinhood Chain. Post what you want to buy or sell, get sealed
            prices only you can read, and settle both sides in one escrow transaction. No order book, no slippage, no chart.
          </p>
          <div className="hero-cta">
            <Link to="/app" className="cta buy">
              ⚡ Launch app
            </Link>
            <Link to="/app?new=sell" className="cta outline">
              Sell privately
            </Link>
          </div>
          <EscrowStatus escrow={escrow} />
        </div>
        <HeroTerminal rows={rows} />
      </section>

      <div className="ticker">
        {[
          ["Open blocks", String(open.length)],
          ["Sealed answers", String(answers)],
          ["Network", "Robinhood Chain · 4663"],
          ["Settlement", "1 transaction"],
          ["Pay with", usdg ? "ETH · USDG" : "ETH"],
          ["Escrow admin keys", "0"],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>

      {/* problem */}
      <section className="sect split">
        <div>
          <span className="label">The problem</span>
          <h2>
            Big orders get <span className="serif">punished</span> in public.
          </h2>
        </div>
        <div className="problem-grid">
          <div>
            <b>Slippage</b>
            <p>Selling a large position into a thin pool walks the price down with every unit.</p>
          </div>
          <div>
            <b>Front-running</b>
            <p>Bots see your transaction coming and trade ahead of it.</p>
          </div>
          <div>
            <b>Signalling</b>
            <p>The chart tells everyone a whale is moving, before you are done.</p>
          </div>
          <div>
            <b>Trust</b>
            <p>Classic OTC means sending funds first to a stranger or a middleman.</p>
          </div>
        </div>
      </section>

      {/* USPs */}
      <section className="sect">
        <span className="label">Why {BRAND.name}</span>
        <h2>
          Built for size. <span className="serif">Built for silence.</span>
        </h2>
        <div className="usp-grid">
          {USPS.map((u, i) => (
            <article key={u.t} className="usp">
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{u.t}</h3>
              <p>{u.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* pipeline */}
      <section className="sect">
        <span className="label">How a block trades</span>
        <h2>Six steps. One settlement.</h2>
        <ol className="pipeline">
          {[
            ["Post", "Bid to buy, or list to sell. Get a private link."],
            ["Seal", "Answers arrive encrypted to you."],
            ["Sign", "Each answer is signed by its wallet."],
            ["Accept", "Pick one. The terms are fixed."],
            ["Deposit", "Both sides fund the escrow."],
            ["Settle", "Second deposit swaps both, or refund."],
          ].map(([t, d], i) => (
            <li key={t}>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <b>{t}</b>
              <p>{d}</p>
            </li>
          ))}
        </ol>
        <Link to="/how" className="text-link">
          Read how it works →
        </Link>
      </section>

      {/* privacy table */}
      <section className="sect">
        <span className="label">Who sees what</span>
        <h2>
          What you see. <span className="serif">What they don't.</span>
        </h2>
        <div className="table-wrap">
          <table className="privacy">
            <thead>
              <tr>
                <th>Viewer</th>
                <th>Your price</th>
                <th>Your wallet</th>
                <th>Your size</th>
                <th>The deal</th>
              </tr>
            </thead>
            <tbody>
              {PRIVACY_ROWS.map((r) => (
                <tr key={r[0]}>
                  <th>{r[0]}</th>
                  {r.slice(1).map((c, i) => (
                    <td key={i} className={c === "no" || c.startsWith("no,") ? "no" : c === "yes" ? "yes" : ""}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">Ghost mode changes "your wallet" for the other side to a one-time address. It is not a mixer.</p>
      </section>

      {/* comparison */}
      <section className="sect">
        <span className="label">Compared</span>
        <h2>Three ways to move a block.</h2>
        <div className="compare">
          <div className="compare-col">
            <h3>DEX market order</h3>
            <ul>
              <li className="no">Price impact on every unit</li>
              <li className="no">Visible in the mempool</li>
              <li className="no">Moves the chart</li>
              <li className="yes">No counterparty risk</li>
            </ul>
          </div>
          <div className="compare-col">
            <h3>Chat OTC + middleman</h3>
            <ul>
              <li className="yes">Fixed price</li>
              <li className="no">Someone holds your funds</li>
              <li className="no">Prices shared in group chats</li>
              <li className="no">Slow, manual, trust-based</li>
            </ul>
          </div>
          <div className="compare-col best">
            <h3>{BRAND.name}</h3>
            <ul>
              <li className="yes">Fixed price, zero slippage</li>
              <li className="yes">Adminless escrow, refund on timeout</li>
              <li className="yes">Sealed, signed answers</li>
              <li className="yes">Settles in one transaction</li>
            </ul>
          </div>
        </div>
      </section>

      {/* agents */}
      <section className="sect split">
        <div>
          <span className="label">For agents & builders</span>
          <h2>
            Let your agent <span className="serif">work the desk.</span>
          </h2>
          <p className="muted">
            Ten MCP tools to list, bid, read sealed answers, accept, deposit and refund. The MCP server runs on the agent's own machine,
            so offers are encrypted there and its wallet key never leaves it. Prefer code? Use the JavaScript SDK or the OpenAPI spec.
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
        </div>
        <div className="cmd-card">
          <div className="cmd-bar">
            <code>{cmd}</code>
            <Copy text={cmd} />
          </div>
          <pre className="code">{`// any JS runtime
import { BlockOtc } from "${window.location.origin}/api/sdk/blockotc.mjs";

const otc = new BlockOtc({ apiUrl: "${window.location.origin}/api", privateKey });
const listing = await otc.createListing({
  token, amount: "50000", payWith: "USDG", replyMinutes: 60,
});
const bids = await otc.getOffers(listing.bidId); // decrypted locally
await otc.acceptOffer({ bidId: listing.bidId, offerId: bids[0].offerId,
  fundingMinutes: 60, ghost: true });`}</pre>
        </div>
      </section>

      {/* fees + security */}
      <section className="sect two">
        <div className="panel">
          <span className="label">Fees</span>
          <h3>Free to post. Pay only when it settles.</h3>
          <div className="fee-rows">
            <div>
              <span>Under $10k</span>
              <b>2.5%</b>
            </div>
            <div>
              <span>From $10k</span>
              <b>2.0%</b>
            </div>
            <div>
              <span>From $100k</span>
              <b>1.5%</b>
            </div>
          </div>
          <p className="fine">Capped at 2.5% in the contract. Partners earn half the fee on deals they refer. Platform-token holders will pay 0.5% less once the token launches.</p>
        </div>
        <div className="panel">
          <span className="label">Security</span>
          <h3>Nobody can touch the escrow. Including us.</h3>
          <ul className="checks-list">
            <li>No owner, no admin key, no pause, no upgrade</li>
            <li>Each side refunds independently on timeout</li>
            <li>Fee-on-transfer and short deposits rejected</li>
            <li>Answers signed and checked before you accept</li>
          </ul>
          <p className="warn-line">Not audited yet. Settlement turns on when the escrow is deployed.</p>
          <Link to="/security" className="text-link">
            Security details →
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="sect">
        <span className="label">FAQ</span>
        <h2>Questions</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* closing */}
      <section className="closing">
        <h2>
          Move the block. <span className="serif">Keep the chart quiet.</span>
        </h2>
        <div className="hero-cta">
          <Link to="/app" className="cta buy">
            ⚡ Launch app
          </Link>
          <Link to="/app?new=buy" className="cta outline">
            Post a bid
          </Link>
        </div>
      </section>
    </div>
  );
}
