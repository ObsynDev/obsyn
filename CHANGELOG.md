# Changelog

Notable changes to what users and integrators see. Dates are UTC.

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
