# Changelog

Notable changes to what users and integrators see. Dates are UTC.

## 2026-11-18

- **Autopilot** (obsyn-mcp 0.2.0): `obsyn-mcp autopilot rules.json` trades by rules, 24/7, with the owner's key on their machine. It answers matching bids and listings with sealed, signed prices against the token's DEX price, and deposits once accepted (as seller only after the buyer pays). Dry run unless `"live": true`; caps per deal and in total; optional price floor or ceiling; no answer without a reference price; balance checked first; rules that sell over 20% under or buy over 20% over market are refused. New MCP tool `otc_autopilot_preview` dry-runs rules. Tested end to end on a local escrow: answer, accept, both deposits, settlement, caps, dry run.

- **$OBSYN is a featured market** (15 markets now): in the desk's token picker, the token strip and /markets, with a "Trade $OBSYN OTC, no slippage" link in the token section.
- **Swap on Uniswap links** for small size: on every market (stocks pay in USDG, crypto in ETH), on each token's trade page and next to the $OBSYN contract address. Obsyn doesn't route these swaps; they open Uniswap on Robinhood Chain. Stock-token pages note that eligibility depends on your region.
- **Holder discount check** (any wallet: qualifies, or how much more and what it costs) and the **$OBSYN market** (price, market cap, liquidity, 24h) from its Uniswap v4 pool, on the homepage and /stats.

- **$OBSYN graduated** from the Pons bonding curve; it now trades on Uniswap v4 (OBSYN/ETH). Copy updated. The vault needs a Uniswap v4 route (adapter) to keep buying and burning; until it is queued and its 2-day wait passes, fees collect in the vault.
- **V4BurnAdapter** (`contracts/src/V4BurnAdapter.sol`): the vault's new buy route. ETH → OBSYN on the v4 pool; USDG → WETH (Uniswap v3) → ETH → OBSYN. No owner, holds nothing between calls, only the vault can call it. 9 tests, 8 on a fork of the live contracts; review notes in SECURITY-REVIEW.md. Deployed at `0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67` (Sourcify exact match) and queued in the vault; it can be switched on from 2026-11-19 20:18 UTC.

- **Stats page** (`/stats`, `GET /api/stats`): accepted, settled and refunded deals, settled volume (ETH, USDG and USD), fees, postings and sealed answers, plus the fee vault: $OBSYN burned by the vault, fees waiting to burn, and the total at the burn address. Deals are checked against the escrow on-chain; open postings' prices are never counted.
- **Referral program tested end to end** on a fork of the live escrow, through the real site in a browser: a partner's `?ref=` link → bid → sealed offer → accept → both deposits. The partner received exactly half the protocol fee (0.5625 of 1.125 USDG) in the settlement transaction, the vault the other half, the seller and buyer amounts were unchanged, and `/refer` and the API showed the earning. A buyer who opened their own link could still accept, with no referrer in the terms.
- **Referral program** (`/refer`, `GET /api/referrals/{address}`): your `?ref=` link, deals you referred and what you earned. The escrow already pays the referrer half the protocol fee at settlement; this makes it usable. A referral link that names one of the deal's own parties is now dropped instead of failing the accept.

- **MCP 0.1.1:** also ships as a one-click MCPB bundle (`obsyn-mcp-0.1.1.mcpb`) with a settings form, and is listed in the official MCP Registry as `trade.obsyn/mcp` (`packages/obsyn-mcp/server.json`; obsyn.trade proves the name at `/.well-known/mcp-registry-auth`). Blank settings now count as unset.
- **Public CI:** every push runs the contract tests, the backend suite (including end-to-end agent trades on a local chain) and the web build.

- **Exposure check:** a ghost-mode deal page shows which public on-chain hops link the one-time wallet back to you: the funding transfer (and from which wallet), whether the payment returns to that same wallet, and that the relayer paid the gas. Built in the browser from what it saw and the deal terms; nothing is sent anywhere.
- **`obsyn-mcp` package:** the MCP server is now one self-contained file (`packages/obsyn-mcp`, built with `npm run build:mcp`) that defaults to `https://obsyn.trade/api`, so agents won't need the repository. Install with `npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.1.0/obsyn-mcp-0.1.0.tgz` (published as a GitHub release, SHA-256 listed there).
- The SDK and MCP server read token facts from the Obsyn API first and fall back to the RPC, so they work on networks where the public RPC is blocked.

## 2026-11-17

- **Price-impact estimate:** the desk and the trade page show what the same size would cost as a market order on the token's deepest DEX pool ("≈ 11% worse, ≈ $11,048" for a $100k NVDA buy), from that pool's liquidity. Labelled as an estimate.
- **Partial fills:** a bid or listing can be filled by several answers, each its own deal that settles on its own. On by default on the desk and the trade page (a checkbox turns it off); answerers can offer part of a fixed size; the private page shows a fill bar and one deal panel per fill. The SDK and MCP take `allowPartial`. No contract change: the escrow already settles any amount per deal.
- **Reference price on offers:** each decrypted offer or bid shows how it compares with the token's on-chain DEX price ("15% over market"), and price fields show the same while you type. Reference only.
- **Deal receipts:** `/receipt/<tx>` is a public page per settled deal, rebuilt from the settlement transaction (terms from its input, fees from its `Settled` event). Whichever side completes the deal reports the transaction; the server checks it on-chain before recording it, and both sides get a "View receipt" link.
- **Backup of private links:** My blocks can download your private links to a file and import them on another browser or device. Imports accept only well-formed Obsyn links.
- **$OBSYN launched and plugged into the fee vault** (`setPlatformToken`, one time, permanent): holders of 1,000,000+ OBSYN pay 0.5% less fee; vault fees buy $OBSYN on its Pons curve and burn it. Tested first on a fork against the live curve.
- Site-wide $OBSYN contract-address bar with copy and a Pons link.
- **Security audit by the Obsyn team published** ([SECURITY-REVIEW.md](SECURITY-REVIEW.md)): manual review, Slither triage, 41 contract tests, live-fork replays. No critical or high contract issues.
- **Contracts verified on Sourcify** with an exact match (runtime and creation bytecode).
- The backend refuses deal terms whose referrer is the buyer, the seller or the payout address (self-referral would halve the protocol fee).
- Fixed: a pasted token address was never selected on the desk while the token read was slow, so the bid was never created.
- Docs explain the escrow's single dependency (the fee vault) and what it can and can't do.
- **Trade page** (`/trade?ca=0x…`): one page per token with its DEX price, market cap and logo, buying power and 25/50/75/MAX presets, "describe it" sentence fill (parsed in the browser), your wallet with one-click "Sell privately", and the open bids and listings for that token.
- **Ghost mode only for tokens with EIP-2612 permits.** Tokens without a permit can't do the gasless deposit, so ghost mode is now disabled for them up front instead of failing after tokens were moved into the one-time wallet.
- Connection errors are no longer reported as "token doesn't support permits".
- Phone layout: hamburger menu, side-by-side buttons.
- Unknown `/api/*` paths return a 404 in JSON.
- MCP setup is documented as a generic stdio server for any MCP client.
- New `GET /api/token/{address}/market` (DEX snapshot, reference only).
- Deployment record, `contracts/scripts/verify-deployment.mjs`, LICENSE and this changelog.

## 2026-11-16

- **Contracts deployed to Robinhood Chain** (see [DEPLOYMENTS.md](DEPLOYMENTS.md)). Settlement is live.
- **Fixed: the buyer's Deposit button never appeared on a new deal.** A fresh deal is `None` on-chain until its first deposit; the button waited for `Open`. Found by a black-box run of the full flow against the live contract on a fork.
- Security hardening: rate limits keyed on the proxy-appended client IP, 64 KB request limit, cached token reads, HSTS, CSP and Permissions-Policy headers, malformed paths answer 400.
- WalletConnect QR crash fixed (pinned `qr` 0.5.5).
- Pages ship readable text for crawlers and link previews.
- Fork smoke test (`contracts/test/LiveFork.t.sol`) that replays deals against the live deployment.

## 2026-11-15

- First version: sealed bids and listings, the adminless `OtcEscrow`, `BuyBurnVault`, ghost-mode relayer, SDK, MCP server and the web app.
