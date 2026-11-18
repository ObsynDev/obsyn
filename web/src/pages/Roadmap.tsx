import { PLATFORM_TOKEN } from "../lib/brand.tsx";
import { Link } from "../lib/ui.tsx";

type Status = "live" | "next" | "planned" | "research";
type Item = { t: string; d: string; s: Status; size: "S" | "M" | "L" | "XL"; doc?: string; /** sub-group, for long phases */ g?: string };

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
    blurb: "Running on obsyn.trade today: the sealed OTC desk with one-transaction settlement, privacy tools, agent access, public stats, referrals and $OBSYN with buy-and-burn.",
    items: [
      { t: "Sealed bids and listings", d: "Post a bid to buy or list a block to sell. Answers are encrypted to you in the sender's browser.", s: "live", size: "L", g: "Trading desk" },
      { t: "OTC desk", d: "Swap-style widget: size in USD or tokens, ETH or USDG, reply window.", s: "live", size: "M", g: "Trading desk" },
      { t: "Trade page per token", d: "Paste any contract: price, market cap, your balance, one-click sell, open blocks for that token.", s: "live", size: "M", g: "Trading desk" },
      { t: "Token list with logos", d: "Listed Robinhood Chain markets in the picker, with logos and checked contract addresses.", s: "live", size: "S", g: "Trading desk" },
      { t: "Partial fills", d: "Several sellers fill one big bid (or several buyers share a listing), each part its own deal.", s: "live", size: "M", doc: "partial-fills", g: "Trading desk" },
      { t: "Payment locks first", d: "Sellers deposit only after the buyer has paid in.", s: "live", size: "S", g: "Trading desk" },
      { t: "Reference price on offers", d: "Each offer is shown against the token's on-chain DEX price: '4.2% under market'.", s: "live", size: "S", g: "Trading desk" },
      { t: "Price-impact estimate", d: "An estimate of what the same size would cost as a DEX market order, shown on the desk and the trade page.", s: "live", size: "S", doc: "price-impact", g: "Trading desk" },
      { t: "Deal receipts", d: "A public, shareable page per settled deal, rebuilt from the settlement transaction.", s: "live", size: "S", g: "Trading desk" },
      { t: "Export / import private links", d: "Back up the keys to your bids and offers to a file and restore them on another device.", s: "live", size: "S", g: "Trading desk" },
      { t: "Signed answers + funds check", d: "Every answer is signed by its wallet; fakes are flagged, empty wallets shown.", s: "live", size: "M", g: "Privacy" },
      { t: "Ghost mode relayer", d: "Deliver from a one-time wallet; gas paid by the relayer.", s: "live", size: "M", g: "Privacy" },
      { t: "Exposure check", d: "On a ghost-mode deal, see which public hops link the one-time wallet back to you.", s: "live", size: "M", doc: "exposure-check", g: "Privacy" },
      { t: "SDK, OpenAPI, local MCP server", d: "Agents and apps can do everything the site does.", s: "live", size: "M", g: "Agents and developers" },
      { t: "Autopilot", d: "An agent that trades by your rules 24/7: prices vs the DEX, hard caps, dry run by default.", s: "live", size: "M", doc: "autopilot", g: "Agents and developers" },
      { t: "Installable MCP package", d: "One command to give any agent the desk, no repository needed (npx, from the GitHub release).", s: "live", size: "M", doc: "mcp-package", g: "Agents and developers" },
      { t: "Contract on mainnet", d: "Escrow and fee vault live on Robinhood Chain, verified on the explorer and Sourcify (exact match).", s: "live", size: "S", g: "Trust and transparency" },
      { t: "Security audit by the Obsyn team", d: "Manual review, Slither, 41 contract tests, live-fork replays. Report published on GitHub.", s: "live", size: "M", g: "Trust and transparency" },
      { t: "Stats and burn tracker", d: "Settled volume, deals, fees and the $OBSYN buy-and-burn, checked against the contracts.", s: "live", size: "S", doc: "stats", g: "Trust and transparency" },
      { t: "Fee vault on a multisig", d: "The vault's owner and keeper are a 2-of-3 Safe: every change and every burn needs two signers.", s: "live", size: "S", doc: "multisig", g: "Trust and transparency" },
      { t: "Platform token on Pons", d: "$OBSYN launched on Pons, graduated to Uniswap v4, and is plugged into the fee vault.", s: "live", size: "L", doc: "token", g: "$OBSYN and growth" },
      { t: "Buy-and-burn + holder discount", d: "Deal fees go to a vault that can only buy and burn $OBSYN (half goes to the referrer when there is one); holders pay 0.5% less.", s: "live", size: "L", doc: "token", g: "$OBSYN and growth" },
      { t: "Referral program", d: "Share a link, earn half the protocol fee on deals you bring, paid by the escrow at settlement.", s: "live", size: "S", doc: "referrals", g: "$OBSYN and growth" },
    ],
  },
  {
    n: "01",
    title: "Small: polish the desk",
    blurb: "Quick wins that make deals faster and easier to trust.",
    items: [
      { t: "Uniswap v4 burn route", d: "$OBSYN graduated, so the vault buys through its Uniswap v4 pool: an adapter, live 2 days after it is queued.", s: "next", size: "S", doc: "token" },
      { t: "Notifications", d: "Telegram and email alerts when an answer arrives or the other side deposits.", s: "next", size: "S" },
    ],
  },
  {
    n: "02",
    title: "Medium: more ways to trade",
    blurb: "Features that open the desk to bigger and more varied deals.",
    items: [
      { t: "Independent third-party audit", d: "An outside firm audits the contract and fee vault before large sizes.", s: "next", size: "M" },
      { t: "Team access", d: "Big buyers send a direct, private request to a project's team.", s: "planned", size: "M", doc: "team-access" },
    ],
  },
  {
    n: "03",
    title: "Large: locked tokens and the network",
    blurb: "Locked-token deals, and privacy that reaches past the desk.",
    items: [
      { t: "Locked-token OTC for teams", d: "Sell vesting or locked tokens with the unlock schedule enforced in the contract.", s: "planned", size: "L", doc: "locked-otc" },
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

/** Items that go live with $OBSYN: flipped at render, once the server provides the token address. */
const TOKEN_ITEMS = new Set(["Platform token on Pons"]);
const withLaunch = (it: Item): Item => {
  const a = PLATFORM_TOKEN.address;
  if (TOKEN_ITEMS.has(it.t) && a)
    return { ...it, s: "live", d: `$OBSYN is live (${a.slice(0, 6)}…${a.slice(-4)}), graduated from the Pons curve to Uniswap v4, and plugged into the fee vault.` };
  // the vault was pointed at $OBSYN on-chain; the threshold shown comes from the server
  if (it.t === "Buy-and-burn + holder discount" && a && PLATFORM_TOKEN.discountMin)
    return { ...it, s: "live", d: `Holders of ${PLATFORM_TOKEN.discountMin}+ $OBSYN pay 0.5% less. Deal fees go to a vault that can only buy and burn $OBSYN; when a deal has a referrer, half the fee goes to them instead.` };
  return it;
};

/** Items in their sub-groups, in first-seen order; one unnamed group when a phase has none. */
function groupsOf(items: Item[]): [string | undefined, Item[]][] {
  const out = new Map<string | undefined, Item[]>();
  for (const it of items) out.set(it.g, [...(out.get(it.g) ?? []), it]);
  return [...out];
}

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
            <div className="rm-groups">
            {groupsOf(p.items).map(([g, items]) => (
              <div key={g ?? "all"} className="rm-group">
                {g && (
                  <h3 className="rm-group-h mono">
                    {g} <span className="dim">· {items.length}</span>
                  </h3>
                )}
                <div className="rm-items">
                  {items.map(withLaunch).map((it) => (
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
