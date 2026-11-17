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

const nav = `<nav><a href="/">Home</a> · <a href="/otc">OTC desk</a> · <a href="/markets">Markets</a> · <a href="/how">How it works</a> · <a href="/security">Security</a> · <a href="/docs">Docs</a> · <a href="/developers">Developers</a></nav>`;

const PAGES: Record<string, Page> = {
  "/": {
    title: "Obsyn · Private OTC block trades on Robinhood Chain",
    description:
      "Trade size. Stay private. Post a block you want to buy or sell, get prices sealed so only you can read them, and settle both sides in one contract transaction on Robinhood Chain.",
    body: `<h1>Trade size. Stay private.</h1>
<p>Obsyn is a private OTC desk for block trades on Robinhood Chain. Post a block you want to buy or sell. Get prices sealed so only you can read them. Settle both sides in one contract transaction, without touching the chart.</p>
<h2>Markets</h2><p>14 markets: Robinhood stock tokens such as TSLA, NVDA, AAPL, AMZN and MSFT, ETFs and PONS, or any ERC-20 on Robinhood Chain by address. Pay in ETH or USDG.</p>
<h2>Privacy</h2><p>Answers are encrypted in the sender's browser to a key that lives only in your private link. The server stores ciphertext it cannot read, so nobody can front-run your size.</p>
<h2>How it works</h2><ol><li>Post a sealed bid or listing and keep the private link.</li><li>Counterparties answer with sealed prices.</li><li>Pick one and both sides deposit into the contract.</li><li>The contract swaps both legs in one transaction, or refunds after the deadline.</li></ol>
<h2>Agents</h2><p>An MCP server and a JavaScript SDK let AI agents post, answer and settle blocks through the same API.</p>
<h2>$OBSYN</h2><p>Settlement fees fund buy-and-burn of $OBSYN, and holders get 0.5% off fees.</p>
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
  "/developers": {
    title: "Developers · Obsyn",
    description: "Give an AI agent the desk: an MCP server, a one-import JavaScript SDK and a plain HTTP API with no accounts.",
    body: `<h1>Developers</h1><h2>Give an AI agent the desk</h2><p>An MCP server with tools to post, answer and settle blocks.</p><h2>One import, both sides</h2><p>A JavaScript SDK served at /api/sdk/obsyn.mjs.</p><h2>Plain HTTP, no accounts</h2><p>An OpenAPI-described REST API.</p><h2>Treat answers as hostile input</h2><p>Agents should validate every sealed answer before acting on it.</p>`,
  },
};

/** index.html with the page's title, description, canonical URL and readable content for bots. */
export function renderIndex(html: string, path: string, origin: string): string {
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
  out = out.replace('<div id="root"></div>', `<div id="root"><div class="ssr">${nav}${page.body}</div></div>`);
  return out;
}
