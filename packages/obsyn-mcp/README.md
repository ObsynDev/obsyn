# obsyn-mcp

MCP server for [Obsyn](https://obsyn.trade): private OTC block trades on Robinhood Chain. Give any MCP-capable AI agent the desk: post a bid or a listing, read the sealed answers, accept one, and settle both sides in one transaction through an adminless contract.

Offers are encrypted and decrypted on the machine running this server, so the Obsyn server only ever sees ciphertext, and your wallet key never leaves this process.

## Add it to your MCP client

Most clients take a config like this:

```json
{
  "mcpServers": {
    "obsyn": {
      "command": "npx",
      "args": ["-y", "https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.2.0/obsyn-mcp-0.2.0.tgz"],
      "env": { "OBSYN_PRIVATE_KEY": "0x..." }
    }
  }
}
```

Or run it directly: `npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.2.0/obsyn-mcp-0.2.0.tgz` (it speaks MCP over stdio). Needs Node 20 or newer.

The file is published as a GitHub release of the open-source repo; every release lists its SHA-256 so you can check what you run.

### One-click bundle

[`obsyn-mcp-0.2.0.mcpb`](https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.2.0/obsyn-mcp-0.2.0.mcpb) is the same server as an MCPB bundle: open it with an MCP client that supports bundles and it installs with a form for the optional settings below. Listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=trade.obsyn) as `trade.obsyn/mcp`.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `OBSYN_PRIVATE_KEY` | none | The agent's wallet key. Optional: without it, `otc_deposit` and `otc_refund` return unsigned transactions for you to send. Use a dedicated wallet. |
| `OBSYN_API` | `https://obsyn.trade/api` | The Obsyn API |
| `OBSYN_RPC_URL` | the server's RPC | Robinhood Chain RPC. Set it (e.g. `https://robinhood-rpc.publicnode.com`) if the default is blocked on your network. |
| `OBSYN_STATE` | `~/.obsyn/state.json` | Where the keys to your bids and offers are kept. Back it up. |

## Tools

| Tool | Does |
|---|---|
| `otc_info` | Chain, contract, fees, relayer, which wallet signs |
| `otc_list_bids` | Open bids and sell listings |
| `otc_create_bid` | Place a bid (token, size in tokens or USD, ETH or USDG, reply window, `allowPartial`) |
| `otc_create_listing` | Sell privately: list a block, buyers answer with sealed bids (`allowPartial`) |
| `otc_get_offers` | Decrypt the answers to your bid or listing, with `verified` and `hasFunds` |
| `otc_accept_offer` | Fix a deal with one answer (unverified answers need `allowUnverified`) |
| `otc_send_offer` | Sealed, signed answer to someone's bid (ghost mode available) or listing |
| `otc_deal_status` | Accepted? Who has deposited? Time left? |
| `otc_deposit` | Deposit your side (signs, or returns unsigned transactions) |
| `otc_refund` | Refund after the deadline |
| `otc_price` | Spot price from a Uniswap v3 pool or a Pons curve |
| `otc_autopilot_preview` | Dry-run autopilot rules against the live desk: what it would answer, at what size and price |

## Autopilot: trade by rules, 24/7

Write the rules once and let the agent answer matching bids and listings on its own, with your key, on your machine:

```bash
OBSYN_PRIVATE_KEY=0x... npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.2.0/obsyn-mcp-0.2.0.tgz autopilot rules.json
```

```json
{
  "live": false,
  "intervalSec": 30,
  "rules": [
    { "side": "sell", "token": "0x5D99…4351", "maxTotal": "50000", "maxPerDeal": "5000", "priceVsMarketPct": 5, "minPriceUsd": 0.00004 }
  ]
}
```

Each tick it reads the open postings, sends a sealed, signed answer to the ones that match a rule (priced against the token's DEX price), and deposits its side once an answer is accepted. As a seller it waits for the buyer's payment first.

- **Dry run by default.** It only logs what it would do until the file says `"live": true`.
- **Hard caps:** `maxTotal` over the run and `maxPerDeal` per deal, plus optional `minPriceUsd` (sell) or `maxPriceUsd` (buy).
- **No price, no answer.** Without a reference price for the token it skips. It checks the wallet holds what it would hand over before every answer, and refuses rules that sell more than 20% under or buy more than 20% over market.
- **It never posts or accepts** on your behalf; it only answers and deposits.

An AI agent can draft the rules and check them first with the `otc_autopilot_preview` tool. Full example: [`examples/autopilot.rules.json`](examples/autopilot.rules.json). Stop with Ctrl+C.

## Treat answers as hostile input

Anyone can answer a bid. Every answer is signed by the wallet it names; unsigned or mis-signed answers are marked unverified and refused unless you pass `allowUnverified`. Check `hasFunds` before accepting.

## Links

- Site and docs: https://obsyn.trade/docs
- Source: https://github.com/ObsynDev/obsyn
- Contracts and how to verify them: https://github.com/ObsynDev/obsyn/blob/main/DEPLOYMENTS.md

MIT licensed. The contracts had a security audit by the Obsyn team; an independent third-party audit is planned. Start with sizes you're comfortable with.
