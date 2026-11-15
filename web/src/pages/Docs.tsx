import { useEffect } from "react";
import { Link } from "../lib/ui.tsx";

type Doc = {
  id: string;
  title: string;
  status: "Planned" | "Designing" | "Research";
  half: "trade" | "privacy" | "both";
  what: string;
  how: string[];
  impact: { who: string; text: string }[];
  risks: string;
};

const DOCS: Doc[] = [
  {
    id: "shielded-pool",
    title: "Shielded settlement pool",
    status: "Research",
    half: "privacy",
    what: "A pool where USDG goes in from one wallet and comes out to another, with a zero-knowledge proof instead of a visible link between the two. Deals settle through it, so the payment can't be traced back to the wallet that funded it.",
    how: [
      "You deposit USDG into the pool and keep a secret note.",
      "When a deal settles, the payment is withdrawn from the pool with a proof that you own a valid note, without revealing which deposit was yours.",
      "Stablecoins only at first. Stock tokens have a freeze authority, which makes pooling them unsafe.",
    ],
    impact: [
      { who: "Traders", text: "Settlement stops being the weak point. Today the escrow transfers are public; with the pool, they can't be tied to your main wallet." },
      { who: "Projects", text: "Treasuries and funds can buy their own token without broadcasting it." },
      { who: "SLAB", text: "Turns 'private, not anonymous' into private end to end. The biggest step on the privacy half." },
    ],
    risks: "Zero-knowledge systems are hard to get right and carry legal questions. It ships only after a dedicated audit and legal review, and may launch with deposit limits.",
  },
  {
    id: "token",
    title: "Platform token, buy-and-burn, holder discount",
    status: "Planned",
    half: "trade",
    what: "A fixed-supply token launched on a Pons bonding curve. Every escrow fee, paid in ETH or USDG, is used to buy the token and send it to the burn address. Holding it lowers your fees.",
    how: [
      "Launch on Pons; after the curve sells out, liquidity moves to a locked Uniswap v4 pool.",
      "The fee vault (already deployed with the escrow) is pointed at the token once; that switch can never be changed.",
      "A keeper spends accumulated fees on the token and burns it, with a minimum-out check on every buy.",
      "Wallets holding the threshold amount get 0.5% off the fee, read on-chain at settlement.",
    ],
    impact: [
      { who: "Traders", text: "Lower fees for holders, and a token whose supply shrinks as the desk is used." },
      { who: "Holders", text: "Buy pressure tied to real usage, not emissions." },
      { who: "SLAB", text: "Aligns the community with volume on the desk." },
    ],
    risks: "Launches on Pons V2 are whitelist-only and V2 is not audited yet. Burns depend on desk volume. Nothing here is a promise of value.",
  },
  {
    id: "locked-otc",
    title: "Locked-token OTC for teams",
    status: "Planned",
    half: "trade",
    what: "Sell tokens that are still vesting or locked, to a buyer who agrees to the same unlock schedule. The escrow releases them to the buyer only as they unlock.",
    how: [
      "The seller lists a locked position with its unlock schedule.",
      "Buyers bid privately, usually at a discount to spot.",
      "On acceptance, the escrow holds the tokens and streams them to the buyer on the schedule; the buyer's payment settles up front or in tranches.",
    ],
    impact: [
      { who: "Teams and early holders", text: "Get liquidity without dumping on the chart when tokens unlock." },
      { who: "Buyers", text: "Access discounted, long-term positions that never reach a DEX." },
      { who: "SLAB", text: "Owns a market that public exchanges can't serve: size that must stay quiet and locked." },
    ],
    risks: "Needs a new, audited escrow with time-based release. Only works for tokens that can be held by a contract.",
  },
  {
    id: "partial-fills",
    title: "Partial fills",
    status: "Planned",
    half: "trade",
    what: "One large bid gets filled by several sellers, each with their own sealed offer, instead of needing one seller big enough for the whole size.",
    how: [
      "A buyer posts a bid for, say, $1M of a token.",
      "Sellers offer any slice. The buyer picks a set of offers that adds up to the size, best prices first.",
      "Each slice settles as its own escrow deal, so one failed slice never blocks the others.",
    ],
    impact: [
      { who: "Buyers", text: "Fill sizes that no single holder can, at a blended price." },
      { who: "Sellers", text: "Smaller holders can join big deals." },
      { who: "SLAB", text: "Bigger blocks, deeper liquidity." },
    ],
    risks: "More moving parts per deal. The interface has to make the blended price and the status of each slice very clear.",
  },
  {
    id: "team-access",
    title: "Team access",
    status: "Planned",
    half: "trade",
    what: "Large buyers send a private, direct request to a project's team, to buy from the treasury or arrange a strategic position, without a public announcement.",
    how: [
      "Teams verify a wallet as the project's official contact.",
      "A buyer sends a sealed request with size and terms; only the team can read it.",
      "If both agree, it settles through the same escrow.",
    ],
    impact: [
      { who: "Projects", text: "Raise from serious buyers without a public sale moving the price." },
      { who: "Buyers", text: "A direct line to the people who can sell size." },
      { who: "SLAB", text: "Becomes the place projects and big holders meet." },
    ],
    risks: "Verification of teams has to be strict to avoid impersonation.",
  },
  {
    id: "exposure-check",
    title: "Exposure check",
    status: "Planned",
    half: "privacy",
    what: "A score that shows how easily someone could connect your main wallet to a wallet you used for a deal, and what gave it away.",
    how: [
      "Reads public chain data around both wallets: direct transfers, shared funders, timing, amounts.",
      "Shows each link it found and how strong it is.",
      "Suggests what to change next time (e.g. fund the one-time wallet differently).",
    ],
    impact: [
      { who: "Traders", text: "Privacy you can measure, not just a claim." },
      { who: "SLAB", text: "Makes the privacy half honest and checkable." },
    ],
    risks: "A good score is not a guarantee; it only covers the patterns we check.",
  },
  {
    id: "private-relay",
    title: "Private RPC relay",
    status: "Research",
    half: "privacy",
    what: "Your wallet talks to the chain through our relay instead of a public RPC, mixed with decoy requests, so the RPC provider can't map which wallets you read and trade from.",
    how: [
      "Point your wallet or agent at the relay URL.",
      "Each real request is joined by decoy reads of other tokens and pools.",
      "No logs that tie requests to an IP are kept.",
    ],
    impact: [
      { who: "Traders", text: "Hides intent before a trade, not just during it." },
      { who: "Agents", text: "Bots that poll often stop leaking their watchlist." },
      { who: "SLAB", text: "Extends privacy beyond the desk into everyday use." },
    ],
    risks: "The relay itself must be trusted not to log, until relays become independent (see relayer network).",
  },
  {
    id: "agent-passports",
    title: "Agent passports",
    status: "Research",
    half: "both",
    what: "A signed credential that lets an AI agent prove something about its owner, such as 'controls more than $100k' or 'has settled 20 deals', without revealing which wallet or person it is.",
    how: [
      "The owner proves the claim once to the issuer.",
      "The agent carries a signed passport and shows it when it bids or offers.",
      "Counterparties check the signature, not the identity.",
    ],
    impact: [
      { who: "Agents", text: "Get taken seriously by big counterparties while staying private." },
      { who: "Traders", text: "Filter out empty or fake counterparties before a deal." },
      { who: "SLAB", text: "Trust between agents, without KYC." },
    ],
    risks: "Starts with a trusted issuer; later versions can move to zero-knowledge proofs.",
  },
  {
    id: "relayer-network",
    title: "Independent relayer network",
    status: "Research",
    half: "privacy",
    what: "Anyone can run a ghost-mode relayer by bonding the platform token. Relayers earn the relayer fee; one that misbehaves loses part of its bond.",
    how: [
      "Relayers stake the token to join.",
      "Sellers pick a relayer; the escrow already binds each deposit signature to one relayer.",
      "Provable misbehaviour (e.g. front-running a deposit) is slashed.",
    ],
    impact: [
      { who: "Traders", text: "No single relayer to trust or to censor you." },
      { who: "Holders", text: "Real utility for the token beyond fees." },
      { who: "SLAB", text: "Removes us as a point of failure." },
    ],
    risks: "Slashing rules must be precise; needs the token and an audited staking contract first.",
  },
];

const HALF_LABEL = { trade: "TRADE", privacy: "PRIVACY", both: "TRADE + PRIVACY" } as const;

export function Docs() {
  // jump to #anchor when arriving from the roadmap
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);

  return (
    <div className="docs">
      <aside className="docs-toc">
        <span className="label">Docs</span>
        <nav>
          <span className="toc-h mono">LIVE TODAY</span>
          <Link to="/how">How it works</Link>
          <Link to="/developers">Developers & agents</Link>
          <Link to="/security">Security</Link>
          <span className="toc-h mono">IN DEVELOPMENT</span>
          {DOCS.map((d) => (
            <a key={d.id} href={`#${d.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(d.id)?.scrollIntoView({ behavior: "smooth" }), history.replaceState(null, "", `/docs#${d.id}`))}>
              {d.title}
            </a>
          ))}
          <Link to="/roadmap" className="toc-road">
            Roadmap →
          </Link>
        </nav>
      </aside>

      <div className="docs-body">
        <header className="docs-intro">
          <h1>
            What's coming, <span className="copper">and why it matters.</span>
          </h1>
          <p className="lede">
            The big utilities that aren't live yet: what each one is, how it works, and what it changes. For what runs today, see{" "}
            <Link to="/how">How it works</Link>, <Link to="/developers">Developers</Link> and <Link to="/security">Security</Link>.
          </p>
          <p className="fine">Everything below is in development. Details can change, and nothing ships before it's tested and reviewed.</p>
        </header>

        {DOCS.map((d) => (
          <article key={d.id} id={d.id} className="doc-card">
            <div className="doc-card-top mono">
              <span className={`half ${d.half}`}>{HALF_LABEL[d.half]}</span>
              <span className="doc-status">{d.status.toUpperCase()}</span>
            </div>
            <h2>{d.title}</h2>
            <p className="doc-what">{d.what}</p>

            <h3 className="mono">HOW IT WORKS</h3>
            <ol className="doc-how">
              {d.how.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>

            <h3 className="mono">IMPACT</h3>
            <div className="doc-impact">
              {d.impact.map((i) => (
                <div key={i.who}>
                  <b>{i.who}</b>
                  <p>{i.text}</p>
                </div>
              ))}
            </div>

            <div className="doc-risk">
              <span className="mono">RISKS & CONDITIONS</span>
              <p>{d.risks}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
