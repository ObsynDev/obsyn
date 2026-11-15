import { Link } from "../lib/ui.tsx";

type Status = "live" | "next" | "planned" | "research";
type Item = { t: string; d: string; s: Status; size: "S" | "M" | "L" | "XL"; doc?: string };

const STATUS_LABEL: Record<Status, string> = {
  live: "LIVE",
  next: "NEXT",
  planned: "PLANNED",
  research: "RESEARCH",
};

const PHASES: { n: string; title: string; blurb: string; items: Item[] }[] = [
  {
    n: "00",
    title: "Live today",
    blurb: "The core desk runs in preview: everything up to settlement works, and settlement switches on when the escrow is deployed.",
    items: [
      { t: "Sealed bids and listings", d: "Post a bid to buy or list a block to sell. Answers are encrypted to you in the sender's browser.", s: "live", size: "L" },
      { t: "OTC desk", d: "Swap-style widget: size in USD or tokens, ETH or USDG, reply window.", s: "live", size: "M" },
      { t: "Signed answers + funds check", d: "Every answer is signed by its wallet; fakes are flagged, empty wallets shown.", s: "live", size: "M" },
      { t: "Payment locks first", d: "Sellers deposit only after the buyer has paid in.", s: "live", size: "S" },
      { t: "Ghost mode relayer", d: "Deliver from a one-time wallet; gas paid by the relayer.", s: "live", size: "M" },
      { t: "SDK, OpenAPI, local MCP server", d: "Agents and apps can do everything the site does.", s: "live", size: "M" },
    ],
  },
  {
    n: "01",
    title: "Small: polish the desk",
    blurb: "Quick wins that make deals faster and easier to trust.",
    items: [
      { t: "Escrow on mainnet", d: "Deploy the escrow and fee vault on Robinhood Chain so deals settle for real.", s: "next", size: "S" },
      { t: "Reference price on offers", d: "Show each offer against the on-chain spot price: '4.2% under market'.", s: "next", size: "S" },
      { t: "Notifications", d: "Telegram and email alerts when an answer arrives or the other side deposits.", s: "next", size: "S" },
      { t: "Deal receipts", d: "A public, shareable page per settled deal, read live from the contract.", s: "planned", size: "S" },
      { t: "Token list with logos", d: "Curated Robinhood Chain tokens in the picker, with verified contract addresses.", s: "planned", size: "S" },
      { t: "Bahasa Indonesia", d: "Full site and app in Indonesian alongside English.", s: "planned", size: "S" },
      { t: "Export / import private links", d: "Back up the keys to your bids and offers across devices.", s: "planned", size: "S" },
    ],
  },
  {
    n: "02",
    title: "Medium: more ways to trade",
    blurb: "Features that open the desk to bigger and more varied deals.",
    items: [
      { t: "Professional audit", d: "External audit of the escrow and fee vault before large sizes.", s: "next", size: "M" },
      { t: "Partial fills", d: "Several sellers fill one big bid, each with their own sealed offer.", s: "planned", size: "M", doc: "partial-fills" },
      { t: "Team access", d: "Big buyers send a direct, private request to a project's team.", s: "planned", size: "M", doc: "team-access" },
      { t: "Exposure check", d: "After a ghost-mode deal, see how easily your main wallet can be linked.", s: "planned", size: "M", doc: "exposure-check" },
      { t: "Installable MCP package", d: "One command to give any agent the desk, no repository needed.", s: "planned", size: "M" },
      { t: "Price-impact calculator", d: "What the same size would cost as a DEX market order, side by side.", s: "planned", size: "S" },
    ],
  },
  {
    n: "03",
    title: "Large: the token and the network",
    blurb: "The platform token goes live and privacy reaches past the desk.",
    items: [
      { t: "Platform token on Pons", d: "Launch on a Pons bonding curve, then plug it into the fee vault.", s: "planned", size: "L", doc: "token" },
      { t: "Buy-and-burn + holder discount", d: "Fees buy the token and burn it; holders pay 0.5% less.", s: "planned", size: "L", doc: "token" },
      { t: "Locked-token OTC for teams", d: "Sell vesting or locked tokens with the unlock schedule enforced in escrow.", s: "planned", size: "L", doc: "locked-otc" },
      { t: "Private RPC relay", d: "Hide which wallets you read and trade from, with decoy traffic.", s: "research", size: "L", doc: "private-relay" },
      { t: "Agent passports", d: "Agents prove things about their owner (size, history) without revealing who.", s: "research", size: "L", doc: "agent-passports" },
    ],
  },
  {
    n: "04",
    title: "XL: unlinkable settlement",
    blurb: "The long game: deals that can't be traced back, built carefully and audited first.",
    items: [
      { t: "Shielded settlement pool", d: "Pay and get paid through a zero-knowledge pool so settlement can't be linked to your wallet.", s: "research", size: "XL", doc: "shielded-pool" },
      { t: "Independent relayer network", d: "Anyone can run a relayer by bonding the token; misbehaviour is slashed.", s: "research", size: "XL", doc: "relayer-network" },
    ],
  },
];

export function Roadmap() {
  return (
    <div className="doc rm">
      <span className="label">Roadmap</span>
      <h1>
        From a private desk <span className="copper">to unlinkable settlement.</span>
      </h1>
      <p className="lede">
        What's live, what's next, and the bigger pieces after that, from small to large. No dates: each step ships when it's built
        and checked. Big items link to the docs that explain what they are and what they change.
      </p>
      <div className="rm-legend mono">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <span key={s} className={`rm-status st-${s}`}>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="rm-phases">
        {PHASES.map((p) => (
          <section key={p.n} className="rm-phase">
            <div className="rm-phase-head">
              <span className="mono rm-n">{p.n}</span>
              <div>
                <h2>{p.title}</h2>
                <p className="muted">{p.blurb}</p>
              </div>
            </div>
            <div className="rm-items">
              {p.items.map((it) => (
                <div key={it.t} className={`rm-item st-${it.s}`}>
                  <div className="rm-item-top">
                    <span className={`rm-status st-${it.s}`}>{STATUS_LABEL[it.s]}</span>
                    <span className="mono dim small">SIZE {it.size}</span>
                  </div>
                  <b>{it.t}</b>
                  <p>{it.d}</p>
                  {it.doc && (
                    <Link to={`/docs#${it.doc}`} className="text-link">
                      Read the doc →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="fine">Plans change as we learn. Anything involving funds ships only after testing and review.</p>
    </div>
  );
}
