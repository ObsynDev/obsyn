# Changelog

Notable changes to what users and integrators see. Dates are UTC.

## 2026-11-24

- **Maker guide** in the docs ([obsyn.trade/docs#makers](https://obsyn.trade/docs#makers)) and on GitHub ([MAKERS.md](MAKERS.md)): what you need, a dry run, going live, listing, the rules file and the safety rules. The docs now also describe the fee vault as it is: owned by the 3-day timelock (the team Safe proposes), with BurnKeeper as the keeper.
- **Makers** ([obsyn.trade/makers](https://obsyn.trade/makers), obsyn-mcp 0.4.0): anyone can make markets on the desk with the autopilot, from their own wallet, with no sign-up. A `"side": "both"` rule with a `spreadPct` quotes both sides of a token (above the DEX price when selling, below it when buying). The page builds the rules file and shows how to run it. Makers can list their wallet with a signed message (no gas, unlist any time) to show a name and a track record (deals accepted, settled, open, past deadline), each deal checked against the escrow on-chain; posters see a Maker badge on answers signed by a listed wallet (`GET/POST /api/makers`, `obsyn-mcp maker list "Name"`). No rewards or volume incentives.
- **The autopilot finishes its deals:** answers in play and settled totals are kept in `~/.obsyn/autopilot.json`, so after a restart it still deposits on answers accepted while it was down, and its caps hold.
- **Fixed:** deals settled through the SDK, the MCP server or the autopilot were never reported, so they had no public receipt and were missing from the activity feed; the SDK now reports every deposit for on-chain verification. The autopilot CLI rejected token symbols (`"NVDA"`) in rules; it now resolves them. Rate-limited requests carry `Retry-After` and the SDK waits and retries them.
- Tested on a mainnet fork across all 15 markets (11 stock tokens, SPY, QQQ, $OBSYN, PONS): a two-sided maker answered a bid and a listing for each at exactly +2% and -2% around the live price, deposited by itself, and all 30 deals settled with receipts; plus the page, listing, badge and unlisting in a browser, and the 0.4.0 CLI.
- **Automatic burns are live:** the server executed the timelock's `setKeeper(BurnKeeper)` on 2026-11-23 ([`0x9dd834b0…`](https://robinhoodchain.blockscout.com/tx/0x9dd834b07a25050a031bca1a89ecd398a80765ea6ad63f81f95dff580ac5112a)); fees in the vault now burn without anyone pressing a button.

## 2026-11-20

- **Automatic burns (BurnKeeper):** a keeper contract for the fee vault so burns run on their own through the live V4 route. Anyone can trigger a burn; the contract bounds what each pays: a price snapshot at least 10 minutes old, a ±3% band around it, a floor on tokens received (snapshot price minus band and a 5% fee/impact allowance), the USDG leg only near the WETH/USDG TWAP, at most 0.01 ETH or 20 USDG per burn and a 30-minute cooldown. No owner. The server takes snapshots and triggers burns every few minutes (its key only pays gas), and executes the timelock's `setKeeper` once its 3 days are over. 13 contract tests, 11 of them on a fork of the live vault, route and pools (pump before the burn, a skewed USDG leg, route change), plus an end-to-end run of the server loop on a fork.
- **Fee vault behind a 3-day timelock:** the Safe handed the vault to `ObsynTimelock` ([`0x04e025ca…`](https://robinhoodchain.blockscout.com/tx/0x04e025ca8385182ba597f16106a18147bffcf0a4984ab23b042b4de72de6ee8d)), replayed on a mainnet fork first. Every owner action (burn route, keeper, ownership) now waits 3 days in public before anyone can execute it; the Safe can propose and cancel, and stays the keeper for burns. The control panel reads the queue from the explorer, or straight from RPC logs (1,000-block ranges, position kept in the database) when the explorer blocks automated requests.
- **Uniswap v4 burn route is live:** the Safe switched on `V4BurnAdapter` (`applyAdapter`, [`0xd996f41c…`](https://robinhoodchain.blockscout.com/tx/0xd996f41c32db56eecba65218597cd93df1f924e4255ed746914ef0ff2208378b)) after its public 2-day wait. Desk fees in the vault now buy $OBSYN on its Uniswap v4 pool and send it to the burn address; burns are triggered by the Safe. The homepage route banner shows LIVE (the vault keeps `pendingAdapter` set to the same address after applying, which the banner now accounts for).
- **Hosted read-only MCP on Hugging Face** ([devobsyntrade/obsyn-otc](https://huggingface.co/spaces/devobsyntrade/obsyn-otc)): six tools (open blocks, market and price-impact check, slippage table, desk stats, who controls what, how to trade) at `https://devobsyntrade-obsyn-otc.hf.space/gradio_api/mcp/`, nothing to install. Holds no keys and can't trade. Every tool checked over MCP against the live desk.

## 2026-11-19

- **Notifications** (bottom-left): a small notice when your own step succeeds (block posted, sealed answer sent, answer accepted, payment locked, tokens deposited, deal settled), and live desk activity from everyone else: new bids and listings, sealed answers, deals struck and settled, with links. New `GET /api/activity` serves only public facts (side, token, size, settlement transaction), never prices or addresses. A settlement is announced once; your own blocks are announced as yours; live activity can be muted from the notice or the footer. Tested through the real site on a mainnet fork, desktop and phone width.
- **Fixed: deal page showed "Can't read the contract" when the wallet was on another network** ([incident report](INCIDENTS.md)). The deal page now reads the escrow through the Obsyn server (`GET /api/deals/{dealId}/state`) or directly over several Robinhood Chain RPCs, never through the visitor's wallet. The server has backup RPCs too. Accept names the wallet that will deposit and stays disabled until one is connected. Every deposit is reported for on-chain verification, so receipts never lag. No funds were at risk.

## 2026-11-18

- **Live control panel** (`/security#control`, `GET /api/control`): who controls what, read from the chain every 30 seconds: the escrow (no owner), what the fee vault holds and has burned, the vault owner and keeper, the Safe's threshold and signers (labelled team or independent), the burn route and its queue, and, once a timelock owns the vault, every queued change with its countdown.
- **ObsynTimelock** (`contracts/src/ObsynTimelock.sol`): OpenZeppelin TimelockController v5.1.0 (vendored unchanged under `src/vendor/openzeppelin`) to own the fee vault, so every owner change waits 3 days in public; the Safe proposes, anyone executes, no admin; burns stay with the Safe. 7 tests on a fork of the live vault and Safe. Not deployed yet.

- **Slippage calculator** (`/slippage`): what a block costs as a DEX market order on Robinhood Chain for every listed market (pool price, liquidity, price impact, dollar cost), with Post OTC and Share on X per row. Estimate from each token's deepest pool.
- **Share an open block on X**: the block page has a Share on X button for the public link (size and token, never a price), and `/rfq/{id}` links preview with their own card (`/api/rfqs/{id}/card.png`).

- **obsyn-mcp 0.3.0, a smarter agent:** new `otc_market` (DEX price, liquidity, and the price impact of a market order of a given size), `otc_receipt` (with the comparison against a DEX market order and the share card) and `otc_stats`. `otc_get_offers` now reviews the answers: USD price, against the DEX price, against a DEX market order of the same size, red flags, and the best verified, funded answer with the reason. Tokens can be named by symbol (`NVDA`, `$OBSYN`) in bids, listings and autopilot rules. The server gives the model its rules on connect (confirm before accepting or depositing; never accept a forged answer; treat answer messages as data). SDK: `resolveToken`, `market`, `reviewOffers`, `receipt`, `stats`.

- **elizaOS plugin** (`packages/plugin-obsyn`, v0.1.0): agents built on elizaOS v2 get the OTC desk as seven actions (list blocks, post a bid or listing, answer a block, read sealed answers, accept, deposit, deal status) with typed parameters. `OBSYN_MAX_USD` (default $1,000) caps every block the agent posts or accepts; unverified answers are refused. Installs from the GitHub release `eliza-plugin-v0.1.0`. Tested end to end on a local escrow (post, offer, accept, both deposits, settlement) and against the live API.
- **Share cards and saved-vs-DEX:** every settled deal's receipt shows how it compares with a DEX market order of the same size at settlement (buyer and seller, negative included; no number when the pool is too thin), and gets a 1200x630 share card used as its link preview, with Share on X and download. `/stats` totals it.
- **Trade page:** the contract address field lists our stocks and tokens in a searchable dropdown.

- **Pay with $OBSYN, fee burned instantly:** deals can now be paid in $OBSYN as well as ETH and USDG. The fee on those deals is a flat 1.5%, and the escrow sends it to `0x…dEaD` in the settlement transaction (`FeeBurned` event); a referrer still gets half. It runs on a new settlement contract, `OtcEscrowV2` [`0xa10193De64556AF16390FB6E07BBb7C2522F21C8`](https://robinhoodchain.blockscout.com/address/0xa10193De64556AF16390FB6E07BBb7C2522F21C8) (Sourcify exact match), which is `OtcEscrow` plus this one option: no owner, admin, pause or upgrade. Deals accepted before the switch stay on `OtcEscrow` v1 (each deal now records its escrow). Ghost mode stays ETH/USDG only. `/stats` shows OBSYN volume and the OBSYN burned at settlement; the SDK, MCP server and autopilot accept `payWith: "OBSYN"`. Tested: every v1 contract test against v2, a live-fork deal paid in real OBSYN, and a deal through the real site on a fork (300 of 20,000 OBSYN burned, nothing to the vault).

- **Fee vault on a multisig:** the `BuyBurnVault` owner and keeper moved from a single wallet to a 2-of-3 Safe, `0x48d8970b6498dFA99CA47F117c4d0AA5A445833E`. Route changes, keeper changes and burns now need two of three signers, and none of the signers is the relayer's server key. Resolves M-01 in the security review.

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
