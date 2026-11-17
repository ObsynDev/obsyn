import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BRAND, PLATFORM_TOKEN } from "../lib/brand.tsx";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { answerMessage } from "../lib/sealed.ts";
import { MARKETS } from "../lib/tokens.ts";
import { Copy, Link, short } from "../lib/ui.tsx";

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
      { who: "Traders", text: "Settlement stops being the weak point. Today the contract transfers are public; with the pool, they can't be tied to your main wallet." },
      { who: "Projects", text: "Treasuries and funds can buy their own token without broadcasting it." },
      { who: BRAND.name, text: "Turns 'private, not anonymous' into private end to end. The biggest step on the privacy half." },
    ],
    risks: "Zero-knowledge systems are hard to get right and carry legal questions. It ships only after a dedicated audit and legal review, and may launch with deposit limits.",
  },
  {
    id: "token",
    title: "Platform token, buy-and-burn, holder discount",
    status: "Planned",
    half: "trade",
    what: "A fixed-supply token launched on a Pons bonding curve. Every fee, paid in ETH or USDG, is used to buy the token and send it to the burn address. Holding it lowers your fees.",
    how: [
      "Launch on Pons; after the curve sells out, liquidity moves to a locked Uniswap v4 pool.",
      "The fee vault (already deployed with the contract) is pointed at the token once; that switch can never be changed.",
      "A keeper spends accumulated fees on the token and burns it, with a minimum-out check on every buy.",
      "Wallets holding the threshold amount get 0.5% off the fee, read on-chain at settlement.",
    ],
    impact: [
      { who: "Traders", text: "Lower fees for holders, and a token whose supply shrinks as the desk is used." },
      { who: "Holders", text: "Buy pressure tied to real usage, not emissions." },
      { who: BRAND.name, text: "Aligns the community with volume on the desk." },
    ],
    risks: "Launches on Pons V2 are whitelist-only and V2 is not audited yet. Burns depend on desk volume. Nothing here is a promise of value.",
  },
  {
    id: "locked-otc",
    title: "Locked-token OTC for teams",
    status: "Planned",
    half: "trade",
    what: "Sell tokens that are still vesting or locked, to a buyer who agrees to the same unlock schedule. The contract releases them to the buyer only as they unlock.",
    how: [
      "The seller lists a locked position with its unlock schedule.",
      "Buyers bid privately, usually at a discount to spot.",
      "On acceptance, the contract holds the tokens and streams them to the buyer on the schedule; the buyer's payment settles up front or in tranches.",
    ],
    impact: [
      { who: "Teams and early holders", text: "Get liquidity without dumping on the chart when tokens unlock." },
      { who: "Buyers", text: "Access discounted, long-term positions that never reach a DEX." },
      { who: BRAND.name, text: "Owns a market that public exchanges can't serve: size that must stay quiet and locked." },
    ],
    risks: "Needs a new, audited contract with time-based release. Only works for tokens that can be held by a contract.",
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
      "Each slice settles as its own contract deal, so one failed slice never blocks the others.",
    ],
    impact: [
      { who: "Buyers", text: "Fill sizes that no single holder can, at a blended price." },
      { who: "Sellers", text: "Smaller holders can join big deals." },
      { who: BRAND.name, text: "Bigger blocks, deeper liquidity." },
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
      "If both agree, it settles through the same contract.",
    ],
    impact: [
      { who: "Projects", text: "Raise from serious buyers without a public sale moving the price." },
      { who: "Buyers", text: "A direct line to the people who can sell size." },
      { who: BRAND.name, text: "Becomes the place projects and big holders meet." },
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
      { who: BRAND.name, text: "Makes the privacy half honest and checkable." },
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
      { who: BRAND.name, text: "Extends privacy beyond the desk into everyday use." },
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
      { who: BRAND.name, text: "Trust between agents, without KYC." },
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
      "Sellers pick a relayer; the contract already binds each deposit signature to one relayer.",
      "Provable misbehaviour (e.g. front-running a deposit) is slashed.",
    ],
    impact: [
      { who: "Traders", text: "No single relayer to trust or to censor you." },
      { who: "Holders", text: "Real utility for the token beyond fees." },
      { who: BRAND.name, text: "Removes us as a point of failure." },
    ],
    risks: "Slashing rules must be precise; needs the token and an audited staking contract first.",
  },
];

const HALF_LABEL = { trade: "TRADE", privacy: "PRIVACY", both: "TRADE + PRIVACY" } as const;

const SECTIONS = [
  ["start", "Getting started"],
  ["post", "Posting a block"],
  ["sealed", "Sealed answers"],
  ["settle", "Settlement and the contract"],
  ["markets", "Markets and prices"],
  ["fees", `Fees and $${PLATFORM_TOKEN.symbol}`],
  ["agents", "For agents: MCP, SDK, API"],
  ["privacy", "Privacy model"],
  ["contracts", "Contracts and how to verify"],
  ["permissions", "Who can do what"],
  ["safety", "Safety and worst cases"],
  ["data", "Data we keep and third parties"],
  ["troubleshooting", "Troubleshooting"],
  ["coming", "In development"],
  ["terms", "Terms"],
  ["faq", "FAQ"],
] as const;

const LAST_UPDATED = "17 Nov 2026";
const GITHUB = BRAND.github;
const EXPLORER = "https://robinhoodchain.blockscout.com";

const ADDRESSES: [string, string, string][] = [
  ["OtcEscrow (settlement)", "0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865", "Holds both sides of a deal and swaps them in one transaction. No owner, admin key, pause or upgrade."],
  ["BuyBurnVault (fees)", "0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221", `Receives the protocol fee. It can't send funds anywhere except a buy that burns $${PLATFORM_TOKEN.symbol}.`],
  ["Vault owner and keeper", "0x533452c0e3C3455D33d551964F14D352597b21e1", "A single wallet for now, not a multisig. Its powers are listed under Who can do what."],
  ["Relayer", "0x81D583e77A74571a6fD7b6EE16ECeba9CfE3a2DD", "Pays gas for ghost-mode deposits. Can only submit a deposit the seller signed for that deal and that relayer."],
  ["USDG (payment token)", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "Global Dollar on Robinhood Chain. Not ours; fixed in the escrow at deploy."],
];

// [action, who can]
const PERMISSIONS: [string, string][] = [
  ["Post a bid or listing, send a sealed answer", "Anyone"],
  ["Read the prices in sealed answers", "Only the poster (encrypted to keys in their browser)"],
  ["Accept an answer", "Whoever holds the block's private link"],
  ["Deposit the payment", "Only the buyer named in the deal"],
  ["Deposit the tokens", "Only the seller named in the deal, or the relayer with the seller's signature for that exact deal"],
  ["Change price, amount, payout or deadline after accepting", "Nobody: any change is a different deal id"],
  ["Refund after the deadline", "Anyone can trigger it; funds only go back to the side that paid them"],
  ["Pause, upgrade or change the escrow", "Nobody: no owner, no admin key"],
  ["Raise the fee above 2.5%", "Nobody: capped in the contract"],
  ["Withdraw fees from the vault", `Nobody. The keeper can only spend them on a buy that burns $${PLATFORM_TOKEN.symbol}`],
  [`Set the $${PLATFORM_TOKEN.symbol} token in the vault`, "The vault owner, once, then never again"],
  ["Change the swap route used for buy-and-burn", "The vault owner, after a public 2-day delay"],
  ["Change the keeper, hand over the vault", "The vault owner (ownership moves in two steps)"],
];

const WORST: [string, string][] = [
  ["A bug in the escrow", "The Obsyn team's audit found no critical or high issues, but no audit can rule out every bug. Funds deposited in open deals could be at risk. A deal settles in one transaction, so funds sit in the contract only between the two deposits."],
  ["Our server goes down", "You can't post or read answers, but deposits are never stuck: after the deadline anyone can call refund(terms) on the escrow from the explorer. The deal panel has a \"Copy for a manual refund\" button with the terms in the format the explorer expects."],
  ["Our server or website is compromised", "It could show a wrong page. It still can't read sealed prices or move funds, and before you deposit the offer page checks the final terms against the answer saved in your own browser."],
  ["The relayer key leaks", "It can only submit deposits sellers already signed for that relayer. Its ETH balance is kept small."],
  ["The vault owner acts badly", `It could buy $${PLATFORM_TOKEN.symbol} at a poor price with fees already in the vault (a route change waits 2 days and is public). User deposits are not affected.`],
  ["You lose your private link", "Nobody can recover it. Your deposits are still safe: they refund after the deadline."],
];

const STORED: [string, string][] = [
  ["Postings", "token, side, size, pay token, optional public note, reply window"],
  ["Sealed answers", "ciphertext we can't decrypt, plus the sender's one-off encryption key"],
  ["Private-link tokens", "only their SHA-256 hashes"],
  ["Accepted deals", "the deal terms (they become public on-chain at the first deposit anyway)"],
  ["Not stored", "accounts, emails, names, cookies, analytics. Request logs from our host keep IPs for a short time"],
];

const THIRD: [string, string][] = [
  ["Google Fonts", "fonts, loaded by your browser"],
  ["DexScreener", "token prices and logos (our server fetches prices; logos load from their CDN)"],
  ["Yahoo Finance", "reference prices of the listed stocks, fetched and cached by our server"],
  ["Your wallet's RPC", "on-chain reads and transactions go through your wallet's network settings"],
  ["WalletConnect / Reown", "only if you connect with a phone wallet through WalletConnect"],
  ["Railway, Cloudflare", "hosting, and DNS for obsyn.trade"],
];

const TROUBLE: [string, string][] = [
  ["\"Couldn't reach Robinhood Chain\"", "Some networks block the official RPC. In your wallet, edit Robinhood Chain's RPC to https://robinhood-rpc.publicnode.com and retry."],
  ["\"Select the token first\" / \"Minimum $5\"", "Pick a token or paste its address; bids start at $5."],
  ["\"This private link is incomplete\"", "Open the full link you saved, including everything after #. That part never reaches our server."],
  ["\"Connect the buyer (or seller) wallet\"", "Switch your wallet to the address named in the deal."],
  ["The seller can't deposit yet", "Payment locks first: the seller's button appears once the buyer has paid in."],
  ["Ghost mode is greyed out", `The token has no gasless approvals (EIP-2612). Deliver from your wallet instead.`],
  ["\"Transaction reverted\"", "Usually the deadline passed or the balance is short. After the deadline, use Refund."],
];

const DOC_FAQ: [string, string][] = [
  ["Do I need an account?", "No. Posting gives you a private link that controls the block. Keep it like a password: whoever holds it can read the answers and accept one."],
  ["Who can read the prices?", "Only the side that posted the block. Answers are encrypted in the sender's browser to the poster's key before they leave it, and our server only ever stores ciphertext."],
  ["Can you take my funds?", "No. The contract has no owner, no admin key, no pause and no upgrade. Funds only move to settle a deal or to refund a side after the deadline."],
  ["Is it audited?", "Yes, by the Obsyn team: a published security audit (manual review, Slither, 41 contract tests, replays against the live contracts) with no critical or high issues. An independent third-party audit is planned."],
  ["Is it anonymous?", "No, it's private. Prices stay sealed while you negotiate. Once a side deposits, the deal is public on-chain like any transaction."],
  ["What happens if the other side never deposits?", "Nothing moves until both sides are in. After the deadline, whoever deposited takes their own funds back with a refund call."],
  ["Do I need the token?", `No. The desk works without $${PLATFORM_TOKEN.symbol}. Holding it only takes 0.5% off your fee once it launches.`],
];

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function Sect({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="dx-sect">
      <span className="dx-n mono">{String(n).padStart(2, "0")}</span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="dx-code">
      <pre className="mono">{children}</pre>
      <Copy text={children} />
    </div>
  );
}

const go = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", `/docs#${id}`);
};

export function Docs() {
  const ids = useMemo(() => SECTIONS.map(([id]) => id), []);
  const active = useActiveSection(ids);
  // jump to #anchor when arriving from the roadmap or a link
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, []);

  const origin = window.location.origin;
  const name = BRAND.name;
  const exampleMsg = answerMessage("3f9c…a1", "buy", "0x7a3C5f10aa00000000000000000000000000c01D", "2500000000000000000000", "978050000000");

  return (
    <div className="dx">
      <header className="dx-head">
        <div>
          <span className="eyebrow mono">DOCS</span>
          <h1>
            How {name} <span className="copper">works.</span>
          </h1>
          <p className="dx-lede">
            Posting a block, reading sealed answers, settling in one transaction, the privacy model, fees, the token and the API.
            Every contract address, who can do what, what we store, and what can go wrong.
          </p>
          <p className="dx-updated mono">
            Last updated {LAST_UPDATED} ·{" "}
            <a href={GITHUB} target="_blank" rel="noreferrer">
              source on GitHub ↗
            </a>{" "}
            ·{" "}
            <a href={`${GITHUB}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
              changelog ↗
            </a>
          </p>
        </div>
        <div className="dx-stats">
          <div>
            <span className="mono">MARKETS</span>
            <b className="copper">{MARKETS.length}</b>
            <i>stock tokens, ETFs and PONS. Any ERC-20 by address</i>
          </div>
          <div>
            <span className="mono">MAX FEE</span>
            <b>2.5%</b>
            <i>hard cap, written into the contract</i>
          </div>
          <div>
            <span className="mono">ADMIN KEYS</span>
            <b className="mono">0</b>
            <i>on the contract. No pause, no upgrade</i>
          </div>
          <div>
            <span className="mono">SETTLEMENT</span>
            <b className="mono">1 tx</b>
            <i>both sides swap at once, or neither does</i>
          </div>
        </div>
      </header>

      <div className="dx-grid">
        <aside className="dx-toc">
          <span className="mono">ON THIS PAGE</span>
          <nav>
            {SECTIONS.map(([id, t], i) => (
              <a key={id} href={`#${id}`} className={active === id ? "on" : ""} onClick={go(id)}>
                <i className="mono">{String(i + 1).padStart(2, "0")}</i>
                {t}
              </a>
            ))}
          </nav>
          <div className="dx-toc-card">
            <span>Prefer pages?</span>
            <Link to="/how">How it works</Link>
            <Link to="/security">Security</Link>
            <Link to="/roadmap">Roadmap</Link>
          </div>
        </aside>

        <div className="dx-body">
          <Sect id="start" n={1} title="Getting started">
            <p className="dx-p">
              {name} is a private OTC desk on Robinhood Chain. You post a block you want to buy or sell, the other side answers with
              sealed prices only you can read, and the deal settles in one contract transaction. No order book, so size never moves the
              chart.
            </p>
            <div className="dx-cards">
              {[
                ["Bid to buy", "Set a size in USD and a token. Sellers answer with sealed prices.", "/otc", "Place a bid →"],
                ["Sell privately", "List a token amount. Buyers answer with sealed prices.", "/otc?side=sell", "List a block →"],
                ["Browse markets", `${MARKETS.length} markets with reference prices and what's open on the desk.`, "/markets", "Markets →"],
                ["Plug in an agent", "An MCP server and SDK let any AI agent work the desk with its own keys.", "/developers", "Developers →"],
              ].map(([t, d, to, cta], i) => (
                <div key={t} className="dx-card">
                  <span className="mono">{String(i + 1).padStart(2, "0")}</span>
                  <b>{t}</b>
                  <p>{d}</p>
                  <Link to={to}>{cta}</Link>
                </div>
              ))}
            </div>
          </Sect>

          <Sect id="post" n={2} title="Posting a block">
            <p className="dx-p">A block is one side's intent, posted privately. There are two kinds:</p>
            <div className="dx-two">
              <div>
                <b>Bid (you buy)</b>
                <p>You set the size in USD (minimum $5) and the token. Sellers answer with how many tokens they'd give and at what price.</p>
              </div>
              <div>
                <b>Listing (you sell)</b>
                <p>You set the token amount. Buyers answer with the price they'd pay for the whole block.</p>
              </div>
            </div>
            <dl className="dx-facts">
              <div>
                <dt>Pay in</dt>
                <dd>ETH or USDG</dd>
              </div>
              <div>
                <dt>Reply window</dt>
                <dd>15 minutes to 24 hours</dd>
              </div>
              <div>
                <dt>Accept by</dt>
                <dd>up to 24 h after the window closes</dd>
              </div>
              <div>
                <dt>Cost to post</dt>
                <dd>free</dd>
              </div>
            </dl>
            <p className="dx-note">
              Posting returns a private link. It is the only key to your block: whoever holds it can read the answers and accept one.
              It's saved in this browser; export it if you switch devices.
            </p>
          </Sect>

          <Sect id="sealed" n={3} title="Sealed answers">
            <p className="dx-p">
              Every answer is encrypted in the sender's browser to the poster's public key (NaCl box) before it leaves the device. The
              server stores and relays ciphertext it cannot open. Only the poster's browser holds the key that decrypts it.
            </p>
            <p className="dx-p">Each answer is also signed by the wallet that sent it. The signed text is plain and readable:</p>
            <Code>{exampleMsg}</Code>
            <div className="dx-two">
              <div>
                <b>signed</b>
                <p>The signature matches the wallet in the answer. Answers that fail are marked <em>unverified</em>, ranked last, and accepting one needs your explicit OK.</p>
              </div>
              <div>
                <b>has funds</b>
                <p>The answering wallet holds enough of what it would deposit, read on-chain when you open the answers.</p>
              </div>
            </div>
          </Sect>

          <Sect id="settle" n={4} title="Settlement and the contract">
            <ol className="dx-steps">
              <li>
                <b>Accept.</b> You pick an answer. The terms (both wallets, token, amount, price, deadline) are fixed and hashed into a
                deal id.
              </li>
              <li>
                <b>Payment locks first.</b> The buyer deposits ETH or USDG into the contract. The seller only deposits once the payment is
                in, so nobody can be griefed into locking tokens for nothing.
              </li>
              <li>
                <b>The second deposit settles.</b> When the seller's tokens arrive, the contract swaps both sides in the same
                transaction: tokens to the buyer, payment minus the fee to the seller.
              </li>
              <li>
                <b>Or everyone is refunded.</b> If the deadline passes first (the desk lets you pick 1 to 24 hours and never allows more
                than 7 days), each side takes back exactly what it put in. Anyone can trigger the refund, and no one can block it.
              </li>
            </ol>
            <div className="dx-two">
              <div>
                <b>Gasless seller deposits</b>
                <p>For tokens with EIP-2612 permit, including every listed stock token, the seller signs and a relayer pays the gas.</p>
              </div>
              <div>
                <b>Ghost mode</b>
                <p>
                  Deliver from a one-time wallet so the deal never names your main wallet. Funding that wallet is still a public
                  transfer, so on-chain analysis can link them.
                </p>
              </div>
            </div>
            <p className="dx-note">
              The settlement contract and how to check it are in <a href="#contracts" onClick={go("contracts")}>Contracts and how to verify</a>.
            </p>
          </Sect>

          <Sect id="markets" n={5} title="Markets and prices">
            <p className="dx-p">
              The market board lists {MARKETS.length} tokens, each checked on Robinhood Chain: Robinhood stock tokens, two index ETFs
              and PONS. Any other ERC-20 can still be traded by pasting its address. Fee-on-transfer tokens are rejected by the
              escrow.
            </p>
            <p className="dx-p">
              Prices shown are reference prices of the listed stock, delayed, fetched and cached by our server so your browser never
              calls a third party. The on-chain token can trade away from them, and your block settles at the price you accept. PONS
              has no listed underlying, so it has no reference price.
            </p>
            <Link to="/markets" className="dx-link">
              Open the market board →
            </Link>
          </Sect>

          <Sect id="fees" n={6} title={`Fees and $${PLATFORM_TOKEN.symbol}`}>
            <p className="dx-p">Posting and answering are free. A fee is taken only when a deal settles, from the payment:</p>
            <table className="dx-table mono">
              <thead>
                <tr>
                  <th>Deal size</th>
                  <th>Fee</th>
                  <th>Holding ${PLATFORM_TOKEN.symbol}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Under $10k</td>
                  <td>2.5%</td>
                  <td>2.0%</td>
                </tr>
                <tr>
                  <td>From $10k</td>
                  <td>2.0%</td>
                  <td>1.5%</td>
                </tr>
                <tr>
                  <td>From $100k</td>
                  <td>1.5%</td>
                  <td>1.0%</td>
                </tr>
              </tbody>
            </table>
            <ul className="dx-list">
              <li>The fee is capped at 2.5% in the contract and can't be raised.</li>
              <li>A partner who refers the deal earns half of the fee.</li>
              <li>
                The protocol's share goes to a vault that buys ${PLATFORM_TOKEN.symbol} and sends it to 0x…dEaD. The running total is
                public on-chain.
              </li>
              <li>If the buyer or the seller holds the minimum ${PLATFORM_TOKEN.symbol}, the fee drops by 0.5%.</li>
            </ul>
            <p className="dx-note">
              ${PLATFORM_TOKEN.symbol} {PLATFORM_TOKEN.address ? `contract: ${short(PLATFORM_TOKEN.address)}` : "hasn't launched yet"}.
              It's a utility token for this desk, not an investment, and nothing here promises a price or a return.
            </p>
          </Sect>

          <Sect id="agents" n={7} title="For agents: MCP, SDK, API">
            <p className="dx-p">
              Agents use the same desk as people. Keys and decryption stay on the agent's machine; the server only sees what a browser
              would send.
            </p>
            <h3 className="dx-h3">MCP server (11 tools)</h3>
            <Code>{`OBSYN_API=${origin}/api node backend/src/mcp/stdio.ts   # register as a stdio server in your MCP client`}</Code>
            <h3 className="dx-h3">JavaScript SDK</h3>
            <Code>{`import { Obsyn } from "${origin}/api/sdk/obsyn.mjs";
const otc = new Obsyn({ apiUrl: "${origin}/api", privateKey }); // key optional`}</Code>
            <h3 className="dx-h3">REST API</h3>
            <Code>{`GET  ${origin}/api/markets
GET  ${origin}/api/markets/{symbol}/chart?range=1d|5d|1mo|6mo|1y
GET  ${origin}/api/rfqs                 open blocks
POST ${origin}/api/rfqs                 post a bid or listing
POST ${origin}/api/rfqs/{id}/quotes     send a sealed answer
POST ${origin}/api/rfqs/{id}/accept     accept one (needs the private link)
GET  ${origin}/api/token/{address}      ERC-20 facts read on-chain
GET  ${origin}/api/openapi.json         the full spec`}</Code>
            <Link to="/developers" className="dx-link">
              Full developer guide →
            </Link>
          </Sect>

          <Sect id="privacy" n={8} title="Privacy model">
            <p className="dx-p">Private, not anonymous. Here is exactly who sees what:</p>
            <table className="dx-table">
              <thead>
                <tr>
                  <th />
                  <th>While negotiating</th>
                  <th>After a deposit</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Token and size</td>
                  <td>visible to everyone</td>
                  <td>public on-chain</td>
                </tr>
                <tr>
                  <td>Prices in answers</td>
                  <td className="sealed">sealed: only the poster</td>
                  <td>the accepted one is public on-chain</td>
                </tr>
                <tr>
                  <td>Wallets</td>
                  <td className="sealed">hidden from other traders</td>
                  <td>public on-chain (or a one-time wallet)</td>
                </tr>
                <tr>
                  <td>Our server</td>
                  <td>ciphertext, plus timing and IP like any website</td>
                  <td>the accepted terms</td>
                </tr>
              </tbody>
            </table>
            <p className="dx-note">
              Making settlement itself private needs zero-knowledge tech. That's the shielded pool in <a href="#coming" onClick={go("coming")}>In development</a>.
            </p>
          </Sect>

          <Sect id="contracts" n={9} title="Contracts and how to verify">
            <p className="dx-p">
              Everything that holds or moves money, on Robinhood Chain (chain id 4663). Deployed 16 Nov 2026. Each link opens the
              explorer.
            </p>
            <table className="dx-table stack">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Address</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {ADDRESSES.map(([what, addr, role]) => (
                  <tr key={addr}>
                    <td>{what}</td>
                    <td className="mono">
                      <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                        {short(addr)} ↗
                      </a>{" "}
                      <Copy text={addr} />
                    </td>
                    <td>{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dx-p">
              None of these is the ${PLATFORM_TOKEN.symbol} token. ${PLATFORM_TOKEN.symbol}{" "}
              {PLATFORM_TOKEN.address ? `is ${PLATFORM_TOKEN.address}` : "hasn't launched yet; anything claiming to be it is not us"}.
            </p>
            <h3 className="dx-h3">Check it yourself</h3>
            <p className="dx-p">
              The source is public. This script compares the live bytecode with the source byte for byte and prints every setting
              it reads from the contracts:
            </p>
            <Code>{`git clone --recursive ${GITHUB}
cd obsyn/contracts && forge build
node scripts/verify-deployment.mjs`}</Code>
            <p className="dx-note">
              Deploy transactions, blocks and constructor settings are in{" "}
              <a href={`${GITHUB}/blob/main/DEPLOYMENTS.md`} target="_blank" rel="noreferrer">
                DEPLOYMENTS.md
              </a>
              . Both contracts are verified on the Robinhood Chain explorer and on{" "}
              <a href="https://repo.sourcify.dev/4663/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865" target="_blank" rel="noreferrer">
                Sourcify
              </a>{" "}
              with an exact match, and the security audit by the Obsyn team is in{" "}
              <a href={`${GITHUB}/blob/main/SECURITY-REVIEW.md`} target="_blank" rel="noreferrer">
                SECURITY-REVIEW.md
              </a>
              .
            </p>
          </Sect>

          <Sect id="permissions" n={10} title="Who can do what">
            <p className="dx-p">Enforced by the contracts, except reading and accepting answers, which the app handles with encryption and private links.</p>
            <table className="dx-table stack">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Who can</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map(([a, w]) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td>
                      <b>{w}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dx-note">
              "Nobody" includes us. The vault owner is a single wallet for now, and its powers only touch fees already in the vault, never
              your deposits.
            </p>
            <h3 className="dx-h3">The escrow's one dependency</h3>
            <p className="dx-p">
              The escrow has no admin key, but it does talk to one other contract: the fee vault, owned by the deployer wallet. It asks the
              vault whether the 0.5% holder discount applies (a read capped at 30,000 gas; if it fails, the normal fee applies) and sends
              it the fee (if an ETH transfer failed, the fee is credited instead and settlement continues). That's all. The vault can't
              block a deposit, a settlement or a refund, and can't touch user funds. Details in{" "}
              <a href={`${GITHUB}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
                SECURITY.md
              </a>
              .
            </p>
          </Sect>

          <Sect id="safety" n={11} title="Safety and worst cases">
            <div className="dx-cards">
              {[
                ["No admin keys", "The escrow has no owner, pause or upgrade. Only the deal's own rules move funds."],
                ["Refunds can't be blocked", "Each side can always take its deposit back after the deadline."],
                ["Security audit by the Obsyn team", "Published report: no critical or high contract issues. An independent third-party audit is planned."],
                ["Never your seed phrase", "Signing an answer is a plain message, not a transaction. We never ask for keys."],
              ].map(([t, d]) => (
                <div key={t} className="dx-card plain">
                  <b>{t}</b>
                  <p>{d}</p>
                </div>
              ))}
            </div>
            <h3 className="dx-h3">If something goes wrong</h3>
            <table className="dx-table stack">
              <tbody>
                {WORST.map(([w, d]) => (
                  <tr key={w}>
                    <td>
                      <b>{w}</b>
                    </td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dx-note">
              Found a vulnerability? Report it privately through "Report a vulnerability" on the{" "}
              <a href={`${GITHUB}/security`} target="_blank" rel="noreferrer">
                GitHub Security tab
              </a>{" "}
              or DM {BRAND.xHandle}.
            </p>
            <Link to="/security" className="dx-link">
              Security details →
            </Link>
          </Sect>

          <Sect id="data" n={12} title="Data we keep and third parties">
            <h3 className="dx-h3">On our server</h3>
            <table className="dx-table stack">
              <tbody>
                {STORED.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <b>{k}</b>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dx-p">Nothing is deleted automatically yet. Private links stay in your browser; clearing site data removes them.</p>
            <h3 className="dx-h3">Services involved</h3>
            <table className="dx-table stack">
              <tbody>
                {THIRD.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <b>{k}</b>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sect>

          <Sect id="troubleshooting" n={13} title="Troubleshooting">
            <table className="dx-table stack">
              <thead>
                <tr>
                  <th>You see</th>
                  <th>What to do</th>
                </tr>
              </thead>
              <tbody>
                {TROUBLE.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <b>{k}</b>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Sect>

          <Sect id="coming" n={14} title="In development">
            <p className="dx-p">The big pieces that aren't live yet. Details can change, and nothing ships before it's tested and reviewed.</p>
            {DOCS.map((d) => (
              <details key={d.id} id={d.id} className="dx-dev">
                <summary>
                  <span className={`half ${d.half} mono`}>{HALF_LABEL[d.half]}</span>
                  <b>{d.title}</b>
                  <span className="mono dim">{d.status.toUpperCase()}</span>
                </summary>
                <p>{d.what}</p>
                <ol>
                  {d.how.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ol>
                <div className="dx-impact">
                  {d.impact.map((i) => (
                    <div key={i.who}>
                      <b>{i.who}</b>
                      <p>{i.text}</p>
                    </div>
                  ))}
                </div>
                <p className="dx-note">
                  <span className="mono">RISKS & CONDITIONS</span> {d.risks}
                </p>
              </details>
            ))}
            <Link to="/roadmap" className="dx-link">
              See the roadmap →
            </Link>
          </Sect>

          <Sect id="terms" n={15} title="Terms">
            <ul className="dx-list">
              <li>Not financial, legal or tax advice. Nothing here promises a price or a return.</li>
              <li>The software is provided as is (MIT license). Trades settle on-chain and are final.</li>
              <li>Not a regulated venue. You're responsible for following the rules where you live, including any restrictions on stock tokens.</li>
              <li>Deposits are controlled by the contract and the two parties to a deal, not by us.</li>
            </ul>
          </Sect>

          <Sect id="faq" n={16} title="FAQ">
            <div className="l3-faq dx-faq">
              {DOC_FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </Sect>

          <section className="dx-end">
            <h2>Ready when you are.</h2>
            <div className="btn-group">
              <SlotButton to="/developers">FOR DEVELOPERS</SlotButton>
              <KeyButton to="/otc">OPEN THE DESK</KeyButton>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
