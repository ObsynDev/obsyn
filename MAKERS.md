# Become a maker on Obsyn

A maker answers other people's blocks on [Obsyn](https://obsyn.trade), the private OTC desk on Robinhood Chain. You set the rules: which tokens, which side, a spread against the live DEX price, and how much. The autopilot runs on your own computer with your own wallet, answers matching bids and listings with sealed, signed prices, and deposits by itself when an answer is accepted.

Anyone can do it. There is no sign-up, nothing to apply for, and no rewards from Obsyn: makers earn the spread. Your private key never leaves your machine.

## How a maker earns

Someone wants to buy 5 NVDA. On a DEX that size moves the price against them. On Obsyn they post a sealed bid instead, and makers answer with a fixed price for the whole block. If your rule says "sell 1.5% above the DEX price", the poster pays one price with no slippage and you earn 1.5% over market. The same rule can also buy below market when someone lists tokens for sale.

## What you need

- A computer or server that stays on while you make markets.
- [Node.js](https://nodejs.org) 20 or newer.
- A wallet just for this, holding only what you're willing to trade:
  - the tokens you would sell (e.g. NVDA),
  - the USDG, ETH or $OBSYN you would buy with,
  - a little ETH on Robinhood Chain for gas.

## Step by step

### 1. Build your rules

The easiest way is the builder at **[obsyn.trade/makers](https://obsyn.trade/makers)**: pick a token and what it's paid in, choose *Both sides* and a spread, set the most per deal and in total, and download `rules.json`. Leave *Live* off for now.

Or write it yourself:

```json
{
  "live": false,
  "intervalSec": 30,
  "maxOpenAnswers": 5,
  "rules": [
    { "side": "both", "token": "NVDA", "payWith": "USDG", "maxPerDeal": "5", "maxTotal": "50", "spreadPct": 1.5, "minPriceUsd": 100, "maxPriceUsd": 250 }
  ]
}
```

| Field | Meaning |
|---|---|
| `side` | `"both"` quotes both sides as a maker. `"sell"` only answers buy bids, `"buy"` only answers sell listings. |
| `token` | A listed symbol (`NVDA`, `TSLA`, `SPY`, `$OBSYN`…) or any token's 0x address on Robinhood Chain. |
| `payWith` | `USDG`, `ETH`, `OBSYN` or `any`. |
| `spreadPct` | For `"both"`: sell this % above the DEX price and buy this % below it (above 0, at most 20). |
| `priceVsMarketPct` | For `"sell"` or `"buy"`: price against the DEX price, `+2` = 2% above, `-2` = 2% below. |
| `maxPerDeal` | Most tokens in one deal. |
| `maxTotal` | Most tokens over the whole run, per side. |
| `minPriceUsd` | Optional: never sell under this USD price per token. |
| `maxPriceUsd` | Optional: never buy over this USD price per token. |
| `live` | `false` = dry run (prints what it would do, sends nothing). `true` = trades. |

Add one rule per token you want to make markets in.

### 2. Run a dry run

macOS / Linux:

```bash
OBSYN_PRIVATE_KEY=0x... npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.4.0/obsyn-mcp-0.4.0.tgz autopilot rules.json
```

Windows (PowerShell):

```powershell
$env:OBSYN_PRIVATE_KEY="0x..."; npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.4.0/obsyn-mcp-0.4.0.tgz autopilot rules.json
```

You'll see lines like:

```
13:01:19 [dry run] would offer 0.5 for 79.900800 USDG (+1.5% vs market) on posting n-kDODvL4rlfV7FD
```

That is what you would quote. Nothing is sent in a dry run.

### 3. Check the prices

Make sure the quotes look right for your size and spread. Change the rules and run again until they do.

### 4. Go live

Set `"live": true` in `rules.json` and start it again with the same command. From then on it:

- answers matching blocks with sealed prices, signed by your wallet,
- deposits when an answer is accepted (as a seller, only after the buyer has paid in),
- stops answering once your caps are used.

Stop it with Ctrl+C. Answers still in play are kept in `~/.obsyn/autopilot.json` (or `OBSYN_AUTOPILOT_STATE`), so after a restart it still deposits on answers accepted while it was down, and your caps still hold.

### 5. List yourself (optional)

Listing adds a name and a public track record to your answers. It's a message signed by your wallet: no gas, and you can unlist any time. Unlisted makers trade exactly the same.

- On [obsyn.trade/makers](https://obsyn.trade/makers): connect the maker wallet, choose a desk name, sign.
- Or from the command line, with the same key:

```bash
OBSYN_PRIVATE_KEY=0x... npx -y https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.4.0/obsyn-mcp-0.4.0.tgz maker list "Your desk name"
```

Posters then see a **Maker** badge on answers signed by your wallet, with your record: deals accepted, settled, open, and past their deadline without settling. Every deal in the record is checked against the escrow contract on-chain. `maker unlist "Your desk name"` removes the listing.

## Safety built in

- **Dry run by default.** Nothing is sent until the file says `"live": true`.
- **No price, no answer.** Without a reference price for the token it skips.
- **Balance checked** before every answer: it never offers what the wallet doesn't hold.
- **Mistake guard:** rules that would sell more than 20% under or buy more than 20% over the market are refused.
- **Hard caps** per deal and in total; it never posts or accepts on your behalf, only answers and deposits.
- **Payment locks first:** as a seller it only deposits tokens after the buyer's payment is in the escrow.

Settlement goes through the escrow contract, which has no owner, admin key, pause or upgrade: both sides are swapped in one transaction, or everyone is refunded after the deadline. See [SECURITY.md](SECURITY.md) and [DEPLOYMENTS.md](DEPLOYMENTS.md).

## With an AI agent

If your AI assistant connects to [obsyn-mcp](packages/obsyn-mcp) through MCP, ask it to draft maker rules and check them first with the `otc_autopilot_preview` tool, which dry-runs rules against the live desk and sends nothing.

## Risks

- Quotes follow the DEX price. A thin or fast-moving pool can mean a bad price; set `minPriceUsd` / `maxPriceUsd` as a floor and ceiling.
- Once your answer is accepted, the deal is binding at that price if both sides deposit.
- Keep only what you're willing to trade in the maker wallet.
- A listing shows a record, not a guarantee.

## Links

- Makers page and rules builder: [obsyn.trade/makers](https://obsyn.trade/makers)
- Listed makers (API): [obsyn.trade/api/makers](https://obsyn.trade/api/makers)
- Docs: [obsyn.trade/docs#makers](https://obsyn.trade/docs#makers)
- MCP server and autopilot: [packages/obsyn-mcp](packages/obsyn-mcp)
- Release: [mcp-v0.4.0](https://github.com/ObsynDev/obsyn/releases/tag/mcp-v0.4.0)
