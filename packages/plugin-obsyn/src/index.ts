/**
 * Obsyn plugin for elizaOS: a private OTC desk on Robinhood Chain for your agent.
 *
 * The agent can list open blocks, post a sealed bid or listing, answer someone else's block with a
 * sealed offer, read the offers on its own blocks, accept one, deposit its side and check the deal.
 * Everything goes through the Obsyn SDK: offers are encrypted and decrypted on this machine, the
 * server only ever sees ciphertext, and settlement is one transaction through an escrow with no admin.
 *
 * Settings (character `settings`/`secrets` or environment):
 *   OBSYN_PRIVATE_KEY  optional; a dedicated wallet. Without it, deposits return unsigned transactions.
 *   OBSYN_MAX_USD      hard cap per block the agent may post or accept, in USD (default 1000)
 *   OBSYN_API          default https://obsyn.trade/api
 *   OBSYN_RPC_URL      optional Robinhood Chain RPC override
 *   OBSYN_STATE        where the keys to the agent's blocks and offers are kept (default ~/.obsyn/eliza-state.json)
 *
 * Only type imports from @elizaos/core, so the plugin carries no runtime dependency on a core version.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { Action, ActionResult, HandlerCallback, HandlerOptions, IAgentRuntime, Memory, Plugin, State } from "@elizaos/core";
import { getAddress, isAddress, type Hex } from "viem";
import { OtcAgent } from "../../../backend/src/sdk/client.ts";
import { FileStore } from "../../../backend/src/sdk/file-store.ts";

const DEFAULT_API = "https://obsyn.trade/api";
const DEFAULT_MAX_USD = 1000;
const PAY = ["ETH", "USDG", "OBSYN"] as const;
type Pay = (typeof PAY)[number];

// ─────────────────────────── settings and the SDK client ───────────────────────────

function setting(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key) ?? process.env[key];
  return v === null || v === undefined || v === "" ? undefined : String(v);
}

const agents = new WeakMap<IAgentRuntime, OtcAgent>();

/** One SDK client per agent runtime. Exported for tests. */
export function obsynFor(runtime: IAgentRuntime): OtcAgent {
  let a = agents.get(runtime);
  if (!a) {
    const key = setting(runtime, "OBSYN_PRIVATE_KEY");
    if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("OBSYN_PRIVATE_KEY must be a 0x-prefixed 64-hex private key");
    a = new OtcAgent({
      apiUrl: setting(runtime, "OBSYN_API") ?? DEFAULT_API,
      privateKey: key as Hex | undefined,
      rpcUrl: setting(runtime, "OBSYN_RPC_URL"),
      store: new FileStore(setting(runtime, "OBSYN_STATE") ?? join(homedir(), ".obsyn", "eliza-state.json")),
    });
    agents.set(runtime, a);
  }
  return a;
}

function maxUsd(runtime: IAgentRuntime): number {
  const n = Number(setting(runtime, "OBSYN_MAX_USD") ?? DEFAULT_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_USD;
}

type MarketRow = { symbol: string; address: string; name?: string };

/** "NVDA", "nvda", "$OBSYN" or a 0x address → checksummed address. */
async function resolveToken(otc: OtcAgent, token: string): Promise<{ address: `0x${string}`; symbol: string }> {
  const t = token.trim().replace(/^\$/, "");
  if (isAddress(t)) return { address: getAddress(t), symbol: t };
  const markets = await otc.get<MarketRow[]>("/markets");
  const m = markets.find((x) => x.symbol.toUpperCase() === t.toUpperCase());
  if (!m) throw new Error(`Unknown token "${token}". Use one of ${markets.map((x) => x.symbol).join(", ")} or paste its 0x address.`);
  return { address: getAddress(m.address), symbol: m.symbol };
}

/** USD value of `amount` whole units of what a deal is paid in. null when there's no price. */
async function payToUsd(otc: OtcAgent, pay: string, amount: number): Promise<number | null> {
  if (pay === "USDG") return amount;
  const health = await otc.config();
  if (pay === "ETH") {
    const usdg = health.usdg;
    if (!usdg) return null;
    const m = await otc.get<{ ethUsd: number | null }>(`/token/${usdg}/market`).catch(() => null);
    return m?.ethUsd ? amount * m.ethUsd : null;
  }
  const obsyn = health.payTokens?.find((p) => p.symbol === pay)?.address;
  if (!obsyn) return null;
  const m = await otc.get<{ priceUsd: number | null }>(`/token/${obsyn}/market`).catch(() => null);
  return m?.priceUsd ? amount * m.priceUsd : null;
}

// ─────────────────────────── action plumbing ───────────────────────────

type Params = Record<string, unknown>;
const params = (options: unknown): Params => ((options as HandlerOptions | undefined)?.parameters ?? {}) as Params;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/[,$\s]/g, "")) : undefined);

async function reply(callback: HandlerCallback | undefined, text: string, action: string, data?: Record<string, unknown>): Promise<ActionResult> {
  await callback?.({ text, actions: [action] });
  return { success: true, text, data: data as ActionResult["data"] };
}
async function fail(callback: HandlerCallback | undefined, text: string, action: string): Promise<ActionResult> {
  await callback?.({ text, actions: [action] });
  return { success: false, text, error: text };
}

/** Wraps a handler: settings errors and SDK errors become a plain reply instead of a crash. */
function run(name: string, fn: (otc: OtcAgent, p: Params, runtime: IAgentRuntime) => Promise<{ text: string; data?: Record<string, unknown> }>): Action["handler"] {
  return async (runtime: IAgentRuntime, _message: Memory, _state?: State, options?: unknown, callback?: HandlerCallback) => {
    try {
      const out = await fn(obsynFor(runtime), params(options), runtime);
      return reply(callback, out.text, name, out.data);
    } catch (e) {
      return fail(callback, `Obsyn: ${(e as Error).message}`, name);
    }
  };
}

const always = async () => true;
const left = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(0, Math.floor(s / 60))}m`);

// ─────────────────────────── actions ───────────────────────────

export const listBlocks: Action = {
  name: "OBSYN_LIST_BLOCKS",
  similes: ["OBSYN_OPEN_BLOCKS", "LIST_OTC_BLOCKS", "OTC_ORDER_BOOK"],
  description: "List open OTC blocks on Obsyn (Robinhood Chain): buy bids and sell listings for stock tokens and other tokens. Prices are sealed, so it shows size, side, pay token and time left.",
  routingHint: "user asks what is open / for sale / wanted on Obsyn or the OTC desk -> OBSYN_LIST_BLOCKS",
  parameters: [{ name: "token", description: "Optional symbol (NVDA, TSLA, OBSYN) or 0x address to filter by", required: false, schema: { type: "string" } }],
  validate: always,
  handler: run("OBSYN_LIST_BLOCKS", async (otc, p) => {
    const want = str(p.token)?.replace(/^\$/, "").toUpperCase();
    const rows = (await otc.listBids()).filter((b) => b.secondsLeft > 0 && (!want || b.symbol?.toUpperCase() === want || b.token.toUpperCase() === want));
    if (!rows.length) return { text: want ? `No open blocks for ${want} right now.` : "No open blocks on Obsyn right now.", data: { blocks: [] } };
    const lines = rows.slice(0, 15).map(
      (b) => `• ${b.side === "sell" ? "SELL" : "BUY"} ${b.amount ? `${b.amount} ` : "a USD-sized block of "}${b.symbol ?? b.token} for ${b.payWith} · ${b.offers} sealed answer(s) · ${left(b.secondsLeft)} left · id ${b.bidId}`,
    );
    return { text: `Open blocks on Obsyn (prices are sealed):\n${lines.join("\n")}`, data: { blocks: rows } };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "What OTC blocks are open on Obsyn?" } },
      { name: "{{agent}}", content: { text: "Open blocks on Obsyn (prices are sealed): …", actions: ["OBSYN_LIST_BLOCKS"] } },
    ],
  ],
};

export const postBlock: Action = {
  name: "OBSYN_POST_BLOCK",
  similes: ["OBSYN_POST_BID", "OBSYN_LIST_FOR_SALE", "POST_OTC_BID", "SELL_PRIVATELY"],
  description:
    "Post a sealed OTC block on Obsyn. side=buy posts a bid (size in USD or tokens) and sellers answer with sealed prices; side=sell lists tokens and buyers answer. Free to post. Capped by OBSYN_MAX_USD.",
  routingHint: "user wants to buy or sell a block privately / OTC on Obsyn -> OBSYN_POST_BLOCK; don't use for DEX swaps",
  parameters: [
    { name: "side", description: "buy (post a bid) or sell (list tokens)", required: true, schema: { type: "string", enum: ["buy", "sell"] } },
    { name: "token", description: "Token symbol (NVDA, TSLA, OBSYN…) or 0x address", required: true, schema: { type: "string" } },
    { name: "sizeUsd", description: "Buy only: size in USD (use this or amount)", required: false, schema: { type: "number" } },
    { name: "amount", description: "Size in whole tokens (required to sell)", required: false, schema: { type: "string" } },
    { name: "payWith", description: "What the buyer pays in", required: false, schema: { type: "string", enum: [...PAY], default: "USDG" } },
    { name: "replyMinutes", description: "How long answers are accepted, 15 to 1440 minutes", required: false, schema: { type: "number", default: 60 } },
  ],
  validate: always,
  handler: run("OBSYN_POST_BLOCK", async (otc, p, runtime) => {
    const side = str(p.side) === "sell" ? "sell" : "buy";
    const tok = await resolveToken(otc, str(p.token) ?? "");
    const payWith = (str(p.payWith)?.toUpperCase() ?? "USDG") as Pay;
    if (!PAY.includes(payWith)) throw new Error("payWith must be ETH, USDG or OBSYN");
    const replyMinutes = Math.min(1440, Math.max(15, Math.round(num(p.replyMinutes) ?? 60)));
    const amount = str(p.amount)?.replace(/,/g, "");
    const sizeUsd = num(p.sizeUsd);
    const cap = maxUsd(runtime);
    // the cap: a USD size directly, a token amount at its market price
    let usd = side === "buy" && !amount ? sizeUsd : undefined;
    if (amount) {
      const m = await otc.get<{ priceUsd: number | null }>(`/token/${tok.address}/market`).catch(() => null);
      usd = m?.priceUsd ? Number(amount) * m.priceUsd : undefined;
    }
    if (usd === undefined || !Number.isFinite(usd) || usd <= 0) {
      if (!amount && !sizeUsd) throw new Error(side === "buy" ? "Say the size: a USD amount or a number of tokens." : "Say how many tokens to sell.");
      throw new Error(`No market price for ${tok.symbol}, so the OBSYN_MAX_USD cap can't be checked. Not posting.`);
    }
    if (usd > cap) throw new Error(`That block is about $${Math.round(usd).toLocaleString("en-US")}, over this agent's cap of $${cap.toLocaleString("en-US")} (OBSYN_MAX_USD).`);
    const res =
      side === "buy"
        ? await otc.createBid({ token: tok.address, amount, sizeUsd: amount ? undefined : sizeUsd, payWith, replyMinutes })
        : await otc.createListing({ token: tok.address, amount: amount!, payWith, replyMinutes });
    const what = side === "buy" ? `Bid to buy ${amount ? `${amount} ${res.token}` : `~$${sizeUsd} of ${res.token}`}` : `Listing of ${amount} ${res.token}`;
    return {
      text: `${what} posted on Obsyn, paid in ${payWith}, open for ${replyMinutes} min. Answers arrive sealed to this agent. Block id ${res.bidId}. Share: ${res.shareUrl}`,
      data: { ...res },
    };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "Post a bid on Obsyn for $500 of NVDA, pay in USDG, open for an hour" } },
      { name: "{{agent}}", content: { text: "Bid to buy ~$500 of NVDA posted on Obsyn…", actions: ["OBSYN_POST_BLOCK"] } },
    ],
    [
      { name: "{{user}}", content: { text: "List 2 TSLA for sale privately on Obsyn, paid in OBSYN" } },
      { name: "{{agent}}", content: { text: "Listing of 2 TSLA posted on Obsyn, paid in OBSYN…", actions: ["OBSYN_POST_BLOCK"] } },
    ],
  ],
};

export const getOffers: Action = {
  name: "OBSYN_GET_OFFERS",
  similes: ["OBSYN_READ_OFFERS", "OBSYN_SEALED_ANSWERS"],
  description: "Decrypt and show the sealed answers on one of this agent's Obsyn blocks: price, amount, whether the sender's wallet signature checks out and whether it holds the funds.",
  routingHint: "user asks what offers / answers / bids came in on their Obsyn block -> OBSYN_GET_OFFERS",
  parameters: [{ name: "bidId", description: "The block id returned when it was posted", required: true, schema: { type: "string" } }],
  validate: always,
  handler: run("OBSYN_GET_OFFERS", async (otc, p) => {
    const bidId = str(p.bidId);
    if (!bidId) throw new Error("Which block? Give its id.");
    const offers = (await otc.getOffers(bidId)) as { offerId: string; totalPrice: string; payWith: string; amount: string; unitPrice: number; verified: boolean; hasFunds: boolean | null; status: string }[];
    if (!offers.length) return { text: `No answers on block ${bidId} yet.`, data: { offers: [] } };
    const lines = offers.map(
      (o) =>
        `• ${o.amount} for ${o.totalPrice} ${o.payWith} (${o.unitPrice.toPrecision(6)} each) · ${o.verified ? "signed by its wallet" : "UNVERIFIED signature"} · ${o.hasFunds === false ? "wallet can't cover it" : o.hasFunds ? "funds checked" : "funds unknown"} · ${o.status} · offer ${o.offerId}`,
    );
    return { text: `Sealed answers on ${bidId}:\n${lines.join("\n")}`, data: { offers: offers.map(({ ...o }) => ({ ...o, _offer: undefined })) } };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "Any offers on my Obsyn bid abc123?" } },
      { name: "{{agent}}", content: { text: "Sealed answers on abc123: …", actions: ["OBSYN_GET_OFFERS"] } },
    ],
  ],
};

export const acceptOffer: Action = {
  name: "OBSYN_ACCEPT_OFFER",
  similes: ["OBSYN_TAKE_OFFER"],
  description: "Accept one sealed answer on this agent's Obsyn block. This fixes the deal terms; both sides then deposit. Refuses unverified answers and anything over OBSYN_MAX_USD.",
  routingHint: "user explicitly accepts a specific offer id on their Obsyn block -> OBSYN_ACCEPT_OFFER; never accept without the user naming the offer",
  tags: ["capability:execute"],
  parameters: [
    { name: "bidId", description: "The block id", required: true, schema: { type: "string" } },
    { name: "offerId", description: "The answer to accept", required: true, schema: { type: "string" } },
    { name: "fundingMinutes", description: "How long both sides have to deposit, 10 to 1440 minutes", required: false, schema: { type: "number", default: 60 } },
  ],
  validate: always,
  handler: run("OBSYN_ACCEPT_OFFER", async (otc, p, runtime) => {
    const bidId = str(p.bidId);
    const offerId = str(p.offerId);
    if (!bidId || !offerId) throw new Error("Give the block id and the offer id to accept.");
    const offers = (await otc.getOffers(bidId)) as { offerId: string; totalPrice: string; payWith: string; verified: boolean }[];
    const o = offers.find((x) => x.offerId === offerId);
    if (!o) throw new Error(`No answer ${offerId} on block ${bidId}.`);
    if (!o.verified) throw new Error("That answer's wallet signature doesn't check out. Not accepting it.");
    const usd = await payToUsd(otc, o.payWith, Number(o.totalPrice));
    const cap = maxUsd(runtime);
    if (usd === null) throw new Error(`No ${o.payWith} price to check the OBSYN_MAX_USD cap. Not accepting.`);
    if (usd > cap) throw new Error(`That deal is about $${Math.round(usd).toLocaleString("en-US")}, over this agent's cap of $${cap.toLocaleString("en-US")} (OBSYN_MAX_USD).`);
    const fundingMinutes = Math.min(1440, Math.max(10, Math.round(num(p.fundingMinutes) ?? 60)));
    const res = (await otc.acceptOffer({ bidId, offerId, fundingMinutes })) as Record<string, unknown>;
    return { text: `Accepted ${o.totalPrice} ${o.payWith} on block ${bidId}. Both sides now have ${fundingMinutes} min to deposit (OBSYN_DEPOSIT).`, data: res };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "Accept offer q1 on my bid abc123" } },
      { name: "{{agent}}", content: { text: "Accepted … Both sides now have 60 min to deposit.", actions: ["OBSYN_ACCEPT_OFFER"] } },
    ],
  ],
};

export const sendOffer: Action = {
  name: "OBSYN_SEND_OFFER",
  similes: ["OBSYN_ANSWER_BLOCK", "OBSYN_QUOTE"],
  description: "Answer someone else's open Obsyn block with a sealed, signed price: an offer to sell into a bid, or a bid on a listing. Only the poster can read it.",
  routingHint: "user wants to answer / quote / make an offer on an existing Obsyn block id -> OBSYN_SEND_OFFER",
  parameters: [
    { name: "bidId", description: "The block to answer", required: true, schema: { type: "string" } },
    { name: "totalPrice", description: "Total price for the whole amount, in the block's pay token", required: true, schema: { type: "string" } },
    { name: "amount", description: "Whole tokens, when the block is sized in USD or allows partial fills", required: false, schema: { type: "string" } },
  ],
  validate: always,
  handler: run("OBSYN_SEND_OFFER", async (otc, p) => {
    const bidId = str(p.bidId);
    const totalPrice = str(p.totalPrice)?.replace(/,/g, "");
    if (!bidId || !totalPrice) throw new Error("Give the block id and your total price.");
    const res = (await otc.sendOffer({ bidId, totalPrice, amount: str(p.amount)?.replace(/,/g, "") })) as { offerId: string };
    return { text: `Sealed answer sent on block ${bidId} (answer ${res.offerId}). Only the poster can read the price.`, data: res };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "Offer 4,400 USDG on Obsyn bid abc123" } },
      { name: "{{agent}}", content: { text: "Sealed answer sent on block abc123…", actions: ["OBSYN_SEND_OFFER"] } },
    ],
  ],
};

export const deposit: Action = {
  name: "OBSYN_DEPOSIT",
  similes: ["OBSYN_FUND_DEAL", "OBSYN_SETTLE"],
  description:
    "Deposit this agent's side of an accepted Obsyn deal into the escrow (the buyer's payment, or the seller's tokens once the payment is locked). Signs with OBSYN_PRIVATE_KEY; without it, returns the unsigned transactions.",
  routingHint: "user wants to deposit / fund / settle an accepted Obsyn deal -> OBSYN_DEPOSIT",
  tags: ["capability:execute"],
  parameters: [
    { name: "bidId", description: "A block this agent posted", required: false, schema: { type: "string" } },
    { name: "offerId", description: "An answer this agent sent", required: false, schema: { type: "string" } },
  ],
  validate: always,
  handler: run("OBSYN_DEPOSIT", async (otc, p) => {
    const bidId = str(p.bidId);
    const offerId = str(p.offerId);
    if (!bidId && !offerId) throw new Error("Give the block id (if this agent posted it) or the offer id (if it answered).");
    const r = (await otc.deposit({ bidId, offerId })) as { done?: boolean; message?: string; signed?: boolean; transactions?: { description: string; to: string }[]; steps?: string[] };
    if (r.signed === false && r.transactions) {
      return { text: `Ready to deposit. No OBSYN_PRIVATE_KEY is set, so sign and send these yourself:\n${r.transactions.map((t, i) => `${i + 1}. ${t.description} → ${t.to}`).join("\n")}`, data: r };
    }
    return { text: r.message ?? (r.steps?.length ? r.steps.join("\n") : "Deposited."), data: r };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "Deposit for my Obsyn bid abc123" } },
      { name: "{{agent}}", content: { text: "Payment deposited…", actions: ["OBSYN_DEPOSIT"] } },
    ],
  ],
};

export const dealStatus: Action = {
  name: "OBSYN_DEAL_STATUS",
  similes: ["OBSYN_CHECK_DEAL"],
  description: "Check an Obsyn deal on-chain: funded sides, settled or refunded, time left, what each side gets.",
  routingHint: "user asks about the state of their Obsyn deal -> OBSYN_DEAL_STATUS",
  parameters: [
    { name: "bidId", description: "A block this agent posted", required: false, schema: { type: "string" } },
    { name: "offerId", description: "An answer this agent sent", required: false, schema: { type: "string" } },
  ],
  validate: always,
  handler: run("OBSYN_DEAL_STATUS", async (otc, p) => {
    const bidId = str(p.bidId);
    const offerId = str(p.offerId);
    if (!bidId && !offerId) throw new Error("Give the block id or the offer id.");
    const s = (await otc.dealStatus({ bidId, offerId })) as Record<string, unknown> & { deal?: null; offer?: string };
    if (s.deal === null) return { text: `No deal yet: the answer is ${s.offer}.`, data: s };
    return {
      text: `Deal ${String(s.dealId).slice(0, 10)}…: ${s.status}. Buyer funded: ${s.buyerFunded ? "yes" : "no"}, seller funded: ${s.sellerFunded ? "yes" : "no"}. Buyer gets ${s.buyerGets}; seller gets ${s.sellerGets}.${s.expired ? " Deadline passed: either side can refund." : ""}`,
      data: s,
    };
  }),
  examples: [
    [
      { name: "{{user}}", content: { text: "What's the status of my Obsyn deal abc123?" } },
      { name: "{{agent}}", content: { text: "Deal 0x5f0d…: settled…", actions: ["OBSYN_DEAL_STATUS"] } },
    ],
  ],
};

export const obsynPlugin: Plugin = {
  name: "obsyn",
  description: "Private OTC block trades on Robinhood Chain: sealed bids and listings for stock tokens and any ERC-20, settled through an escrow with no admin key.",
  actions: [listBlocks, postBlock, sendOffer, getOffers, acceptOffer, deposit, dealStatus],
  config: {
    OBSYN_API: process.env.OBSYN_API ?? null,
    OBSYN_RPC_URL: process.env.OBSYN_RPC_URL ?? null,
    OBSYN_MAX_USD: process.env.OBSYN_MAX_USD ?? null,
    OBSYN_STATE: process.env.OBSYN_STATE ?? null,
  },
};

export default obsynPlugin;
