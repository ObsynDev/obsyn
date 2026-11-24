"""
Obsyn: private OTC blocks on Robinhood Chain, as an MCP server on Hugging Face.

Read-only tools over Obsyn's public API: open blocks, market and price-impact checks, the
slippage table, desk stats and who controls the contracts. Nothing here holds a key or moves
funds. To trade (post a sealed bid, answer, accept, deposit) run the obsyn-mcp server locally,
where the agent's key stays on its own machine: see how_to_trade().
"""

from __future__ import annotations

import concurrent.futures
import os
import time

import gradio as gr
import httpx

API = os.environ.get("OBSYN_API", "https://obsyn.trade/api").rstrip("/")
SITE = API[: -len("/api")] if API.endswith("/api") else API
MCP_RELEASE = "https://github.com/ObsynDev/obsyn/releases/download/mcp-v0.4.0/obsyn-mcp-0.4.0.tgz"

_client = httpx.Client(timeout=20.0, headers={"user-agent": "obsyn-hf-space/1.0"})
_cache: dict[str, tuple[float, object]] = {}


def _get(path: str, ttl: float = 30.0):
    """GET a path on the Obsyn API, cached briefly so a busy Space doesn't hammer it."""
    hit = _cache.get(path)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    r = _client.get(API + path)
    if r.status_code >= 400:
        try:
            msg = r.json().get("error", r.text)
        except Exception:
            msg = r.text
        raise gr.Error(f"Obsyn API {r.status_code}: {str(msg)[:200]}")
    data = r.json()
    _cache[path] = (time.time(), data)
    return data


def _markets() -> list[dict]:
    return _get("/markets", ttl=300.0)


def _resolve(token: str) -> tuple[str, str]:
    """A listed symbol (NVDA, $OBSYN) or a 0x address -> (address, symbol)."""
    t = (token or "").strip().lstrip("$")
    if t.lower().startswith("0x") and len(t) == 42:
        for m in _markets():
            if m["address"].lower() == t.lower():
                return m["address"], m["symbol"]
        return t, t
    for m in _markets():
        if m["symbol"].upper() == t.upper():
            return m["address"], m["symbol"]
    raise gr.Error(f'Unknown token "{token}". Listed: {", ".join(m["symbol"] for m in _markets())}. Any other token works by its 0x address.')


def _impact(size_usd: float, liquidity_usd: float | None) -> dict:
    """Constant-product estimate with half the pool's liquidity per side (as on obsyn.trade/slippage)."""
    if not liquidity_usd or size_usd <= 0:
        return {"buy_pct": None, "sell_pct": None, "pool_too_thin": None}
    y = liquidity_usd / 2
    if size_usd > y:
        return {"buy_pct": None, "sell_pct": None, "pool_too_thin": True}
    return {"buy_pct": round(size_usd / y * 100, 2), "sell_pct": round(size_usd / (y + size_usd) * 100, 2), "pool_too_thin": False}


# ─────────────────────────── tools (each one is an MCP tool) ───────────────────────────


def list_open_blocks(token: str = "all") -> list[dict]:
    """List open OTC blocks on Obsyn (Robinhood Chain): buy bids and sell listings for stock tokens and other ERC-20s.

    Prices are sealed (encrypted to the poster), so each block shows its side, size, pay token,
    number of sealed answers and time left, plus the public link to answer it.

    Args:
        token: Optional filter: a listed symbol such as NVDA, TSLA or OBSYN, or a 0x token address. "all" (the default) or empty for every block.

    Returns:
        One entry per open block: side ("buy" = someone wants to buy, "sell" = someone is selling), token,
        size, pay token, sealed answers so far, minutes left and the link to answer it.
    """
    rows = _get("/rfqs", ttl=15.0)
    syms = {m["address"].lower(): m["symbol"] for m in _markets()}
    want = (token or "").strip().lstrip("$").lower()
    if want in ("all", "*", "any"):
        want = ""
    now = time.time()
    out = []
    for r in rows:
        sym = syms.get(r["token"].lower(), r["token"])
        if want and want not in (sym.lower(), r["token"].lower()):
            continue
        left = int((r["expiresAt"] - now) // 60)
        if left <= 0 or r.get("status") != "open":
            continue
        pay = "ETH" if int(r["payToken"], 16) == 0 else syms.get(r["payToken"].lower(), "USDG" if r["payToken"].lower() == "0x5fc5360d0400a0fd4f2af552add042d716f1d168" else r["payToken"])
        out.append({
            "side": r.get("side") or "buy",
            "token": sym,
            "size": f'~${r["sizeUsd"]:,.0f}' if r.get("sizeUsd") else "fixed token amount",
            "pay_with": pay,
            "sealed_answers": r.get("quoteCount", 0),
            "minutes_left": left,
            "answer_link": f'{SITE}/rfq/{r["id"]}',
        })
    return out


def market_check(token: str, size_usd: float = 10000.0) -> dict:
    """Check a token's DEX market on Robinhood Chain before trading a block: price, liquidity and price impact.

    Estimates what a market order of `size_usd` would cost on the token's deepest DEX pool, so an
    agent can compare it with a single OTC price on Obsyn. Reference only, not a quote.

    Args:
        token: A listed symbol (NVDA, TSLA, AAPL, OBSYN...) or a 0x token address on Robinhood Chain.
        size_usd: Block size in USD for the price-impact estimate.

    Returns:
        Price, pool liquidity, 24h change and volume, estimated buy and sell price impact (percent)
        and the estimated dollar cost of each, plus links to post the block on Obsyn.
    """
    address, symbol = _resolve(token)
    m = _get(f"/token/{address}/market", ttl=60.0)
    imp = _impact(float(size_usd), m.get("liquidityUsd"))
    cost = lambda p: None if p is None else round(float(size_usd) * p / 100, 2)  # noqa: E731
    return {
        "token": symbol,
        "address": address,
        "price_usd": m.get("priceUsd"),
        "liquidity_usd": m.get("liquidityUsd"),
        "change_24h_pct": m.get("change24h"),
        "volume_24h_usd": m.get("volume24h"),
        "size_usd": float(size_usd),
        "dex_buy_impact_pct": imp["buy_pct"],
        "dex_buy_cost_usd": cost(imp["buy_pct"]),
        "dex_sell_impact_pct": imp["sell_pct"],
        "dex_sell_cost_usd": cost(imp["sell_pct"]),
        "pool_too_thin": imp["pool_too_thin"],
        "post_a_bid": f"{SITE}/otc?token={address}&usd={int(size_usd)}",
        "note": "DEX reference from the deepest pool (constant-product estimate). On Obsyn a block settles at one sealed price both sides agree.",
    }


def slippage_table(size_usd: float = 50000.0, side: str = "buy") -> list[dict]:
    """What a block of `size_usd` costs as a DEX market order for every market Obsyn lists, most expensive first.

    Args:
        size_usd: Block size in USD.
        side: "buy" or "sell".

    Returns:
        One row per listed market: token, DEX price, pool liquidity, estimated impact percent and dollar cost.
    """
    side = "sell" if str(side).lower().startswith("s") else "buy"
    ms = _markets()

    def one(m):
        try:
            mk = _get(f'/token/{m["address"]}/market', ttl=60.0)
        except Exception:
            mk = {}
        imp = _impact(float(size_usd), mk.get("liquidityUsd"))
        pct = imp["buy_pct"] if side == "buy" else imp["sell_pct"]
        return {
            "token": m["symbol"],
            "price_usd": mk.get("priceUsd"),
            "liquidity_usd": mk.get("liquidityUsd"),
            f"{side}_impact_pct": pct,
            "cost_usd": None if pct is None else round(float(size_usd) * pct / 100, 2),
            "pool_too_thin": imp["pool_too_thin"],
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        rows = list(ex.map(one, ms))
    return sorted(rows, key=lambda r: -(r[f"{side}_impact_pct"] or -1))


def desk_stats() -> dict:
    """Obsyn desk totals read from the chain: deals accepted and settled, settled volume, fees, $OBSYN burned and savings versus DEX market orders.

    Returns:
        The desk summary as published at obsyn.trade/stats.
    """
    return _get("/stats", ttl=60.0)


def who_controls_what() -> dict:
    """Who controls Obsyn's contracts right now, read live from Robinhood Chain.

    The settlement escrow has no owner or admin. The fee vault's owner and keeper (a Safe multisig,
    behind a timelock once handed over), the Safe's signers and threshold, the burn route, what the
    vault holds and every queued change.

    Returns:
        The live control report published at obsyn.trade/security.
    """
    return _get("/control", ttl=30.0)


def how_to_trade() -> str:
    """How an AI agent trades on Obsyn: run the obsyn-mcp server locally so the wallet key never leaves the agent's machine.

    Returns:
        Setup instructions for the trading MCP server (post sealed bids, answer blocks, review offers, accept, deposit).
    """
    return (
        "This Space is read-only and holds no keys. To trade, add the obsyn-mcp server to your MCP client "
        "(stdio, Node 20+):\n\n"
        f'  {{"mcpServers": {{"obsyn": {{"command": "npx", "args": ["-y", "{MCP_RELEASE}"], '
        '"env": {"OBSYN_PRIVATE_KEY": "0x... (optional, a dedicated wallet)"}}}}\n\n'
        "Tools: otc_market, otc_create_bid, otc_create_listing, otc_list_bids, otc_send_offer, otc_get_offers "
        "(reviews every sealed offer against the DEX and picks the best), otc_accept_offer, otc_deposit, "
        "otc_deal_status, otc_receipt, otc_stats, otc_autopilot_preview. Listed in the official MCP Registry "
        "as trade.obsyn/mcp. Docs: https://obsyn.trade/developers"
    )


# ─────────────────────────── the page ───────────────────────────

INTRO = """
# Obsyn · private OTC blocks on Robinhood Chain

Sealed bids and listings for stock tokens (NVDA, TSLA, AAPL…) and any ERC-20. Prices are encrypted to the poster,
and a deal settles both sides in one transaction through an escrow with no admin key.

This Space is an **MCP server**: click **Use via API → MCP** (or "Add to MCP tools" on the Space card) to give your agent
these read-only tools. Nothing here holds a key or moves funds. To trade, see *How to trade*.
"""

with gr.Blocks(title="Obsyn OTC · MCP") as demo:
    gr.Markdown(INTRO)
    with gr.Tab("Open blocks"):
        t1 = gr.Textbox(label="Token (optional)", value="all", placeholder="all, NVDA, TSLA, OBSYN or 0x…")
        b1 = gr.Button("List open blocks")
        o1 = gr.JSON()
        b1.click(list_open_blocks, t1, o1)
    with gr.Tab("Market check"):
        t2 = gr.Textbox(label="Token", value="NVDA")
        s2 = gr.Number(label="Size (USD)", value=10000)
        b2 = gr.Button("Check")
        o2 = gr.JSON()
        b2.click(market_check, [t2, s2], o2)
    with gr.Tab("Slippage table"):
        s3 = gr.Number(label="Size (USD)", value=50000)
        d3 = gr.Radio(["buy", "sell"], value="buy", label="Side")
        b3 = gr.Button("Compare all markets")
        o3 = gr.JSON()
        b3.click(slippage_table, [s3, d3], o3)
    with gr.Tab("Desk stats"):
        b4 = gr.Button("Read stats")
        o4 = gr.JSON()
        b4.click(desk_stats, None, o4)
    with gr.Tab("Who controls what"):
        b5 = gr.Button("Read from the chain")
        o5 = gr.JSON()
        b5.click(who_controls_what, None, o5)
    with gr.Tab("How to trade"):
        b6 = gr.Button("Show")
        o6 = gr.Textbox(lines=10, label="Trading MCP server")
        b6.click(how_to_trade, None, o6)

if __name__ == "__main__":
    demo.launch(mcp_server=True)
