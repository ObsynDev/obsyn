# Obsyn

[![obsyn on HEY Research Lab](https://heyresearch.xyz/api/badge/obsyndev-obsyn)](https://heyresearch.xyz/project/obsyndev-obsyn)

**Trade size. Stay private.** Private OTC block trades on Robinhood Chain: sealed bids and offers that only the poster can read, one-transaction settlement through an adminless contract, and a gasless "ghost mode" for sellers.

[obsyn.trade](https://obsyn.trade) · [X @Obsyntrade](https://x.com/Obsyntrade) · [How it works](https://obsyn.trade/how) · [Security](https://obsyn.trade/security) · [Docs](https://obsyn.trade/docs)

### Live on Robinhood Chain (chain id 4663)

| Contract | Address |
|---|---|
| `OtcEscrow` (settlement, no owner / admin / pause / upgrade) | [`0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865`](https://robinhoodchain.blockscout.com/address/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865) |
| `BuyBurnVault` (collects fees for $OBSYN buy-and-burn; can't withdraw them) | [`0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221`](https://robinhoodchain.blockscout.com/address/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221) |

**Security audit by the Obsyn team:** [SECURITY-REVIEW.md](SECURITY-REVIEW.md), no critical or high issues. An independent third-party audit is planned.

### Transparency

| | |
|---|---|
| [DEPLOYMENTS.md](DEPLOYMENTS.md) | Every address, its deploy transaction, block, constructor settings and compiler settings |
| [`contracts/scripts/verify-deployment.mjs`](contracts/scripts/verify-deployment.mjs) | Checks the live bytecode against this source and prints the on-chain settings. `forge build && node scripts/verify-deployment.mjs` |
| [SECURITY-REVIEW.md](SECURITY-REVIEW.md) | Security audit by the Obsyn team: method, Slither triage, findings by severity, what was fixed |
| [SECURITY.md](SECURITY.md) | Who can do what (permissions table), worst cases stated plainly, known risks, how to report a vulnerability |
| [CHANGELOG.md](CHANGELOG.md) | What changed and when, including bugs we found and fixed |
| [LICENSE](LICENSE) | MIT |

- **No admin keys on the escrow.** No owner, no pause, no upgrade. The fee is capped at 2.5% in code.
- **The fee vault's owner is a single wallet for now,** and can only steer how fees already in the vault buy and burn $OBSYN (route changes wait 2 days, publicly). It can't touch user deposits. Details in [SECURITY.md](SECURITY.md#who-can-do-what).
- **What our server stores:** postings (token, size, side, pay token, optional note, expiry), sealed answers as ciphertext it can't decrypt, SHA-256 hashes of the private-link tokens, and the terms of accepted deals. No accounts, no emails. We set no cookies and run no analytics. Nothing is deleted automatically yet.
- **Third parties:** Google Fonts (fonts, loaded by your browser), DexScreener and Yahoo Finance (market data, fetched by our server; token logos load from DexScreener's CDN), your wallet's RPC, WalletConnect/Reown if you connect that way, Railway (hosting) and Cloudflare (DNS).

| Folder | What it is |
|---|---|
| [contracts/](contracts/) | Foundry: `OtcEscrow` (adminless escrow) and `BuyBurnVault` (turns fees into token burns) |
| [backend/](backend/) | Node 26 + Hono: RFQ API, sealed-offer store, ghost-mode relayer, on-chain price reads |
| [web/](web/) | Vite + React app: bid, sealed offers, deal panel |

Deploying: see [DEPLOY.md](DEPLOY.md) (Railway, one service for API + web).

## Try it locally

You need Foundry and Node.js 22+. Clone with submodules (`git clone --recursive`, or `git submodule update --init` after cloning) so `contracts/lib/forge-std` is there. Use four terminals.

```bash
# 1. local chain
anvil

# 2. deploy demo contracts (mock USDG + mock TSLAx stock token + escrow)
cd contracts
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
#    it prints USDG_ADDRESS, STOCK_TOKEN and ESCROW_ADDRESS

# 3. backend (fill in the printed addresses)
cd backend
CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8545 \
ESCROW_ADDRESS=0x... USDG_ADDRESS=0x... \
RELAYER_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
npm start

# 4. web app → http://localhost:5173
cd web
npm run dev
```

On a fresh anvil the addresses are always:
`USDG_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3`, `STOCK_TOKEN=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, `BUYBURN_VAULT=0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`, `ESCROW_ADDRESS=0x5FC8d32690cc91D4c39d9d3abcBD16989F875707`.

In MetaMask, add the network `http://127.0.0.1:8545` (chain id 31337) and import two of anvil's **public test keys** (never use them on a real network):

- Buyer, anvil #0 (holds 1,000,000 USDG): `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- Seller, anvil #1 (holds 10,000 TSLAx): `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

Walkthrough: as the buyer, place a bid for the `STOCK_TOKEN` paid in USDG. Open the `/rfq/…` share link in another browser profile, switch to the seller account and send a sealed offer (try ghost mode). Back on the buyer's private link, accept the offer and deposit. Then go to the seller's link and deposit. The swap settles when the second deposit lands.

## SDK and API

- **OpenAPI spec:** `GET /api/openapi.json`. A test checks that it lists exactly the routes the server has.
- **JavaScript SDK:** `npm run build:sdk` in `backend/`, then the backend serves it at `GET /api/sdk/obsyn.mjs`. It works in browsers and Node, and CORS is open so any site can use it.

```js
import { Obsyn } from "https://obsyn.trade/api/sdk/obsyn.mjs";

const otc = new Obsyn({ apiUrl: "https://obsyn.trade/api", privateKey: "0x…" }); // key optional
const bid = await otc.createBid({ token: "0x…", amount: "25000", payWith: "USDG", replyMinutes: 60 });
const offers = await otc.getOffers(bid.bidId);            // decrypted locally, cheapest first
await otc.acceptOffer({ bidId: bid.bidId, offerId: offers[0].offerId, fundingMinutes: 60 });
await otc.deposit({ bidId: bid.bidId });                  // signs, or returns unsigned txs without a key
```

Sellers use `listBids()`, `sendOffer({ bidId, totalPrice, ghost })`, `dealStatus({ offerId })` and `deposit({ offerId })`. Secrets are kept in memory by default; in Node pass `store: new FileStore(path)` from `src/sdk/file-store.ts`.

## AI agents (MCP)

A local MCP server lets any MCP-capable AI agent bid, send sealed offers and settle. It runs on the agent's machine on purpose: offers are encrypted and decrypted there, so the backend still only sees ciphertext, and the wallet key never leaves that process.

Add it to your MCP client as a stdio server. Most clients take a config like this:

```json
{
  "mcpServers": {
    "obsyn": {
      "command": "node",
      "args": ["/path/to/backend/src/mcp/stdio.ts"],
      "env": { "OBSYN_API": "https://obsyn.trade/api", "OBSYN_PRIVATE_KEY": "0x..." }
    }
  }
}
```

`OBSYN_PRIVATE_KEY` is optional. Without it, `otc_deposit` and `otc_refund` return unsigned transactions for you to send. Bid and offer secrets are kept in `~/.blockotc/state.json` (override with `OBSYN_STATE`); `OBSYN_RPC_URL` overrides the RPC.

| Tool | Does |
|---|---|
| `otc_info` | Chain, escrow, fees, relayer, which wallet signs |
| `otc_list_bids` | Open bids and sell listings (`side`) |
| `otc_create_listing` | Sell privately: list a block, buyers answer with sealed bids |
| `otc_create_bid` | Place a bid (token, amount, ETH/USDG, reply window) |
| `otc_get_offers` | Decrypt answers on your bid or listing, with `verified` (signed by the wallet it names) and `hasFunds` |
| `otc_accept_offer` | Fix the deal with one answer (refuses unverified answers unless `allowUnverified`) |
| `otc_send_offer` | Sealed, signed answer: an offer on a bid (`ghost: true` available) or a bid on a listing |
| `otc_deal_status` | Accepted? Who has deposited? Time left? |
| `otc_deposit` | Deposit your side (signs, or returns unsigned txs) |
| `otc_refund` | Refund after the deadline |
| `otc_price` | Spot price from a Uniswap v3 pool or Pons curve |

## Tests

```bash
cd contracts && forge test     # escrow + vault, incl. fuzzing
cd backend && npm test         # API flow, dealId parity with Solidity, relayer end-to-end on anvil
cd web && npm run build        # typecheck + production build
```

## Going to Robinhood Chain mainnet

The OTC can go live **before** the platform token exists.

1. `script/Deploy.s.sol` deploys `BuyBurnVault` and `OtcEscrow` pointing at it (already done, see the addresses above). Fees in ETH and USDG pile up in the vault; nobody can withdraw them.
2. Fill `backend/.env` (see `.env.example`) and fund the relayer key with a little ETH.
3. Later, when the token launches on Pons: run `script/SetPlatformToken.s.sol` with the token address, its Pons curve and the holder threshold. It works once and can't be changed. From then on holders get the 0.5% discount and the keeper can burn the accumulated fees.

The escrow itself is never redeployed or changed.

`contracts/test/LiveFork.t.sol` replays deals against the live deployment on a fork: `LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract LiveFork`.
