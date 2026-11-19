---
title: Obsyn OTC
emoji: 🔒
colorFrom: red
colorTo: gray
sdk: gradio
sdk_version: 6.31.0
app_file: app.py
pinned: false
license: mit
short_description: Private OTC blocks on Robinhood Chain, as MCP tools
tags:
  - mcp-server
  - mcp
  - agents
  - defi
  - otc
  - robinhood-chain
---

# Obsyn OTC · MCP server

Read-only MCP tools for [Obsyn](https://obsyn.trade), a private OTC desk on Robinhood Chain: sealed bids and listings for stock tokens (NVDA, TSLA, AAPL…) and any ERC-20, settled in one transaction through an escrow with no admin key.

| Tool | What it does |
|---|---|
| `list_open_blocks` | Open bids and listings (prices sealed): side, size, pay token, answers, time left, link to answer |
| `market_check` | A token's DEX price and liquidity, and what a market order of your size would cost |
| `slippage_table` | That cost for every listed market at once |
| `desk_stats` | Deals, volume, fees, $OBSYN burned, savings vs DEX |
| `who_controls_what` | Escrow (no owner), fee vault owner and keeper, Safe signers, timelock queue, read live from the chain |
| `how_to_trade` | How to run the trading MCP server locally |

**This Space holds no keys and moves no funds.** Trading (posting, answering, accepting, depositing) runs in the [obsyn-mcp](https://github.com/ObsynDev/obsyn/tree/main/packages/obsyn-mcp) server on your own machine, listed in the official MCP Registry as `trade.obsyn/mcp`.

MCP endpoint: `https://<this-space>.hf.space/gradio_api/mcp/`

Source: [github.com/ObsynDev/obsyn](https://github.com/ObsynDev/obsyn) (`packages/hf-space`). MIT.
