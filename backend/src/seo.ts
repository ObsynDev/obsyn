/**
 * Static content for crawlers, link previews and AI search, which often don't run JavaScript.
 * The server puts it inside <div id="root"> of index.html; React replaces it as soon as the app mounts,
 * so people see the real page and bots still get real text, a per-page title and description.
 * Keep the wording in step with the pages in web/src/pages.
 */

type Page = { title: string; description: string; body: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FAQ: [string, string][] = [
  ["Do I need an account?", "No. Posting gives you a private link that controls the block. Treat it like a password."],
  [
    "What can I trade?",
    "The listed Robinhood stock tokens, the ETFs and PONS, or any other ERC-20 on Robinhood Chain by address, paid in ETH or USDG. Fee-on-transfer tokens are rejected by the contract.",
  ],
  ["Can you take my funds?", "No. The contract has no owner, admin key, pause or upgrade. Funds only move to settle a deal or refund it after the deadline."],
  ["Is it audited?", "Yes, by the Obsyn team: a published security audit (manual review, Slither, 41 contract tests, replays against the live contracts) with no critical or high issues. An independent third-party audit is planned."],
  [
    "What does it cost?",
    "Posting and answering are free. At settlement: 2.5% under $10k, 2% from $10k, 1.5% from $100k, capped at 2.5% in the contract. Holding the platform token takes 0.5% off.",
  ],
  [
    "Is it anonymous?",
    "No, it's private. Prices stay sealed while you negotiate. Once a side deposits into the contract, the deal terms are public on-chain like any transaction, and funding a one-time wallet from your main wallet is a visible transfer too.",
  ],
];

const faqHtml = `<h2>FAQ</h2>${FAQ.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}`;

const nav = `<nav><a href="/">Home</a> · <a href="/otc">OTC desk</a> · <a href="/markets">Markets</a> · <a href="/how">How it works</a> · <a href="/security">Security</a> · <a href="/docs">Docs</a> · <a href="/roadmap">Roadmap</a> · <a href="/stats">Stats</a> · <a href="/refer">Refer &amp; earn</a> · <a href="/developers">Developers</a></nav>`;

const ROADMAP: [string, string, [string, string][]][] = [
  [
    "00 · Live today",
    "The core desk is live, plus partial fills, the exposure check, the price-impact estimate, the installable MCP package and $OBSYN with buy-and-burn.",
    [
      ["Sealed bids and listings", "Post a bid to buy or list a block to sell. Answers are encrypted to you in the sender's browser."],
      ["OTC desk", "Size in USD or tokens, ETH or USDG, reply window."],
      ["Signed answers + funds check", "Every answer is signed by its wallet; fakes are flagged, empty wallets shown."],
      ["Payment locks first", "Sellers deposit only after the buyer has paid in."],
      ["Ghost mode relayer", "Deliver from a one-time wallet; gas paid by the relayer."],
      ["SDK, OpenAPI, local MCP server", "Agents and apps can do everything the site does."],
      ["Contract on mainnet", "Escrow and fee vault live on Robinhood Chain, verified on the explorer and Sourcify (exact match)."],
      ["Security audit by the Obsyn team", "Manual review, Slither, 41 contract tests, live-fork replays. Report published on GitHub."],
      ["Trade page per token", "Paste any contract: price, market cap, your balance, one-click sell, open blocks for that token."],
      ["Token list with logos", "Listed Robinhood Chain markets in the picker, with logos and checked contract addresses."],
      ["Reference price on offers", "Each offer is shown against the token's on-chain DEX price."],
      ["Deal receipts", "A public, shareable page per settled deal, rebuilt from the settlement transaction."],
      ["Export / import private links", "Back up the keys to your bids and offers and restore them on another device."],
      ["Platform token on Pons", "$OBSYN launched on Pons, graduated to Uniswap v4, and is plugged into the fee vault."],
      ["Buy-and-burn + holder discount", "Deal fees go to a vault that can only buy and burn $OBSYN (half goes to the referrer when there is one); holders pay 0.5% less."],
      ["Partial fills", "Several sellers fill one big bid (or several buyers share a listing), each part its own deal."],
      ["Exposure check", "On a ghost-mode deal, see which public hops link the one-time wallet back to you."],
      ["Autopilot", "An agent that trades by your rules 24/7: prices vs the DEX, hard caps, dry run by default."],
      ["Installable MCP package", "One command to give any agent the desk, no repository needed."],
      ["Stats and burn tracker", "Settled volume, deals, fees and the $OBSYN buy-and-burn, checked against the contracts."],
      ["Referral program", "Share a link, earn half the protocol fee on deals you bring, paid by the escrow at settlement."],
      ["Price-impact estimate", "An estimate of what the same size would cost as a DEX market order."],
    ],
  ],
  ["01 · Small: polish the desk", "Quick wins.", [["Uniswap v4 burn route (next)", "$OBSYN graduated, so the vault buys through its Uniswap v4 pool via an adapter, live 2 days after it is queued."], ["Notifications (next)", "Telegram and email alerts when an answer arrives or the other side deposits."]]],
  [
    "02 · Medium: more ways to trade",
    "Bigger and more varied deals.",
    [
      ["Independent third-party audit (next)", "An outside firm audits the contract and fee vault before large sizes."],
      ["Fee vault to a multisig (next)", "Move the vault from a single wallet to a multisig with a separate keeper."],
      ["Team access (planned)", "Big buyers send a direct, private request to a project's team."],
    ],
  ],
  [
    "03 · Large: locked tokens and the network",
    "Locked-token deals, and privacy past the desk.",
    [
      ["Locked-token OTC for teams (planned)", "Sell vesting or locked tokens with the unlock schedule enforced in the contract."],
      ["Private RPC relay (research)", "Hide which wallets you read and trade from."],
      ["Agent passports (research)", "Agents prove things about their owner without revealing who."],
    ],
  ],
  [
    "04 · XL: unlinkable settlement",
    "Built carefully and audited first.",
    [
      ["Shielded settlement pool (research)", "Pay and get paid through a zero-knowledge pool."],
      ["Independent relayer network (research)", "Anyone can run a relayer by bonding the token."],
    ],
  ],
];

const roadmapHtml = ROADMAP.map(
  ([title, blurb, items]) => `<h2>${esc(title)}</h2><p>${esc(blurb)}</p><ul>${items.map(([t, d]) => `<li><b>${esc(t)}</b>: ${esc(d)}</li>`).join("")}</ul>`,
).join("");

const PAGES: Record<string, Page> = {
  "/": {
    title: "Obsyn · Private OTC block trades on Robinhood Chain",
    description:
      "Trade size. Stay private. Post a block you want to buy or sell, get prices sealed so only you can read them, and settle both sides in one contract transaction on Robinhood Chain.",
    body: `<h1>Trade size. Stay private.</h1>
<p>Obsyn is a private OTC desk for block trades on Robinhood Chain. Post a block you want to buy or sell. Get prices sealed so only you can read them. Settle both sides in one contract transaction, without touching the chart.</p>
<h2>Markets</h2><p>15 markets: $OBSYN, Robinhood stock tokens such as TSLA, NVDA, AAPL, AMZN and MSFT, ETFs and PONS, or any ERC-20 on Robinhood Chain by address. Pay in ETH or USDG. Small trades can go straight to Uniswap; size goes to the desk, sealed and without slippage.</p>
<h2>Privacy</h2><p>Answers are encrypted in the sender's browser to a key that lives only in your private link. The server stores ciphertext it cannot read, so nobody can front-run your size.</p>
<h2>How it works</h2><ol><li>Post a sealed bid or listing and keep the private link.</li><li>Counterparties answer with sealed prices.</li><li>Pick one and both sides deposit into the contract.</li><li>The contract swaps both legs in one transaction, or refunds after the deadline.</li></ol>
<h2>Agents</h2><p>An MCP server and a JavaScript SDK let AI agents post, answer and settle blocks through the same API.</p>
<h2>$OBSYN</h2><p>Settlement fees fund buy-and-burn of $OBSYN, and holders get 0.5% off fees. $OBSYN graduated from its Pons curve to Uniswap v4; the fee vault's new Uniswap v4 burn route was queued behind the vault's public 2-day timelock and can be switched on from Thursday, November 19, 2026, 3:18 PM ET (20:18 UTC).</p>
${faqHtml}`,
  },
  "/otc": {
    title: "OTC desk · Obsyn",
    description: "Post a private bid or listing for a block of any Robinhood Chain token. Size in USD or tokens, pay in ETH or USDG, minimum $5.",
    body: `<h1>Private block trades. Sealed until settled.</h1><p>Choose buy or sell, pick a token or paste any ERC-20 address on Robinhood Chain, set the size in USD or tokens and the reply window. Posting is free and gives you a private link that controls the block.</p>`,
  },
  "/trade": {
    title: "Trade OTC · Obsyn",
    description:
      "Buy or sell any Robinhood Chain token in size, privately. Paste a contract address, set your size, and get sealed answers only you can read. Settles in one contract transaction.",
    body: `<h1>Buy or sell OTC, privately</h1><p>Paste any token's contract address on Robinhood Chain, see its price and market cap, set your size and post a sealed bid or listing. Sellers or buyers answer with prices only you can read. Pick one, both sides deposit into the contract, and it swaps in one transaction.</p><p>Connect your wallet to see your tokens and sell them privately in one click, or sell straight into a buyer's open bid.</p>`,
  },
  "/markets": {
    title: "Markets · Obsyn",
    description: "Reference prices and charts for the Robinhood Chain markets you can trade in blocks on Obsyn: stock tokens, ETFs and PONS.",
    body: `<h1>Markets</h1><p>Robinhood stock tokens, ETFs and PONS with reference prices and charts. Any other ERC-20 on Robinhood Chain can be traded by pasting its address on the desk.</p>`,
  },
  "/how": {
    title: "How it works · Obsyn",
    description:
      "Four steps from a private post to a settlement on Robinhood Chain. Every step is a public transaction you can check, except the prices: those stay sealed until a deposit.",
    body: `<h1>How it works</h1><p>Four steps from a private post to a settlement on Robinhood Chain. Every step is a public transaction you can check, except the prices: those stay sealed until a deposit.</p>
<ol><li><b>Post a block.</b> Say what you want to buy or sell and keep the private link.</li><li><b>Get sealed answers.</b> Prices are encrypted in the sender's browser; only your link can open them.</li><li><b>Accept and deposit.</b> Both sides deposit into the contract.</li><li><b>Settle in one transaction.</b> The contract swaps both legs at once, or refunds after the deadline.</li></ol>
<h2>Deliver from a one-time wallet.</h2><p>Sellers can deliver from a fresh wallet so the deal isn't tied to their main address.</p>
<h2>Free to post. Paid only when it settles.</h2><p>2.5% under $10k, 2% from $10k, 1.5% from $100k, capped at 2.5% in the contract. Holding $OBSYN takes 0.5% off.</p>`,
  },
  "/security": {
    title: "Security · Obsyn",
    description:
      "What the Obsyn contract guarantees: no owner, no admin key, no pause, no upgrade. Deposits only move to settle a deal or refund it. Prices stay sealed end to end.",
    body: `<h1>Security</h1><p>Deposits sit in a contract nobody controls. Prices are sealed so nobody can front-run them.</p>
<h2>What the contract guarantees</h2><p>No owner, admin key, pause or upgrade. Funds only move to settle a deal or refund it after the deadline. The deal id is the hash of its terms, so terms can't be changed after the fact.</p>
<h2>Sealed means sealed</h2><p>Answers are encrypted in the browser to a key that only exists in the private link's URL fragment, which browsers never send to the server.</p>
<h2>What we're upfront about</h2><p>A security audit by the Obsyn team is published on GitHub; an independent third-party audit is planned. Once a side deposits, the deal terms are public on-chain like any transaction.</p>`,
  },
  "/docs": {
    title: "Docs · Obsyn",
    description: "How Obsyn works end to end: sealed answers, the settlement contract, fees, the platform token, agents, the SDK and the MCP server.",
    body: `<h1>Docs</h1><p>How Obsyn works end to end: posting blocks, sealed answers, the settlement contract, fees and the $OBSYN token, plus the SDK and MCP server for agents.</p>`,
  },
  "/stats": {
    title: "Stats · Obsyn",
    description: "Obsyn desk stats: settled OTC volume, deals, fees and the $OBSYN buy-and-burn on Robinhood Chain, checked against the escrow contract.",
    body: `<h1>Stats</h1><p>Deals, settled volume, fees and the $OBSYN buy-and-burn. Every settled deal and every burn is a public transaction on Robinhood Chain. Prices of open postings stay sealed and are never counted. Live numbers: <a href="/api/stats">/api/stats</a>.</p>`,
  },
  "/refer": {
    title: "Refer & earn · Obsyn",
    description: "Share your Obsyn link and earn half the protocol fee on deals you refer, paid by the escrow contract straight to your wallet at settlement.",
    body: `<h1>Bring a trader. Earn half the fee.</h1><p>Share a link with ?ref=your-address. When someone you sent accepts a deal and it settles, the escrow pays you half of the protocol fee in ETH or USDG, in the same transaction. No sign-up, no claiming. A referrer can't be a party to the same deal.</p>`,
  },
  "/roadmap": {
    title: "Roadmap · Obsyn",
    description:
      "What's live on Obsyn and what's next: sealed OTC desk, partial fills, exposure check, price-impact estimate, installable MCP package and $OBSYN buy-and-burn are live.",
    body: `<h1>Roadmap</h1><p>From a private desk to unlinkable settlement. No dates: each step ships when it's built and tested.</p>${roadmapHtml}`,
  },
  "/developers": {
    title: "Developers · Obsyn",
    description: "Give an AI agent the desk: an MCP server, a one-import JavaScript SDK and a plain HTTP API with no accounts.",
    body: `<h1>Developers</h1><h2>Give an AI agent the desk</h2><p>An MCP server with 11 tools to post, answer and settle blocks. Install it with one command: <code>npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.2.0/obsyn-mcp-0.2.0.tgz</code> (GitHub release, SHA-256 listed there).</p><h2>One import, both sides</h2><p>A JavaScript SDK served at /api/sdk/obsyn.mjs.</p><h2>Plain HTTP, no accounts</h2><p>An OpenAPI-described REST API.</p><h2>Treat answers as hostile input</h2><p>Agents should validate every sealed answer before acting on it.</p>`,
  },
};

/** Facts every page states in plain HTML, for crawlers and research bots that don't run JavaScript. */
export interface SiteFacts {
  tokenAddress?: string | null;
}

const ESCROW = "0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865";
const REPO = "https://github.com/ObsynDev/obsyn";

function factsHtml(f: SiteFacts): string {
  const token = f.tokenAddress
    ? `<p><b>$OBSYN token contract (Robinhood Chain, chain id 4663):</b> <a href="https://robinhoodchain.blockscout.com/token/${esc(f.tokenAddress)}">${esc(f.tokenAddress)}</a></p>`
    : "";
  return `<footer>${token}<p><b>Settlement contract (OtcEscrow):</b> <a href="https://robinhoodchain.blockscout.com/address/${ESCROW}">${ESCROW}</a></p><p><b>Source code:</b> <a href="${REPO}">${REPO}</a> · <a href="${REPO}/blob/main/CHANGELOG.md">Changelog</a> · <a href="${REPO}/blob/main/SECURITY-REVIEW.md">Security audit by the Obsyn team</a> · <a href="${REPO}/blob/main/DEPLOYMENTS.md">Deployments</a></p><p><b>X:</b> <a href="https://x.com/Obsyntrade" rel="me">@Obsyntrade</a></p><p><a href="https://heyresearch.xyz/project/obsyn"><img src="https://heyresearch.xyz/api/badge/obsyn" alt="obsyn on HEY Research Lab" width="220" height="72"></a></p></footer>`;
}

/** index.html with the page's title, description, canonical URL and readable content for bots. */
export function renderIndex(html: string, path: string, origin: string, facts: SiteFacts = {}): string {
  const key = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const page = PAGES[key];
  if (!page) return html;
  const url = origin + (key === "/" ? "" : key);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(page.description)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${esc(page.title)}`)
    .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${esc(page.title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${esc(page.description)}`)
    .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${esc(page.description)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${esc(url)}`)
    .replace("</head>", `<link rel="canonical" href="${esc(url)}" />\n</head>`);
  out = out.replace('<div id="root"></div>', `<div id="root"><div class="ssr">${nav}${page.body}${factsHtml(facts)}</div></div>`);
  return out;
}
