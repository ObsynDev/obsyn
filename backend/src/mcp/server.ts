import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OtcAgent } from "../sdk/client.ts";
import { createAutopilot, validateConfig, type AutopilotConfig } from "../sdk/autopilot.ts";

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }],
});

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    return { ...json({ error: (e as Error).message }), isError: true };
  }
}

const ref = {
  bidId: z.string().optional().describe("Id of something you posted (bid or sell listing)"),
  offerId: z.string().optional().describe("Id of an answer you sent (offer or bid)"),
};

export function createMcpServer(agent: OtcAgent) {
  const server = new McpServer({ name: "obsyn", version: "0.2.0" });

  server.registerTool(
    "otc_info",
    {
      title: "Market info",
      description: "Chain, escrow address, fee schedule, relayer status, and which wallet this agent signs with.",
      annotations: { readOnlyHint: true },
    },
    () => run(() => agent.info()),
  );

  server.registerTool(
    "otc_list_bids",
    {
      title: "Open bids and sell listings",
      description:
        "Open postings. side=buy: a buyer wants tokens, answer as a seller. side=sell: a seller is offloading tokens, answer as a buyer. Answer either with otc_send_offer.",
      annotations: { readOnlyHint: true },
    },
    () => run(() => agent.listBids()),
  );

  server.registerTool(
    "otc_create_listing",
    {
      title: "Sell privately",
      description:
        "List a block of a token for sale. Buyers reply with sealed bids only you can decrypt; you pick one with otc_accept_offer (optionally in ghost mode). Returns a bidId (your listing) and a share link for buyers.",
      inputSchema: {
        token: z.string().describe("Token address on Robinhood Chain"),
        amount: z.string().describe("How many tokens you are selling, in whole units, e.g. '50000'"),
        payWith: z.enum(["ETH", "USDG"]).describe("What buyers pay in"),
        replyMinutes: z.number().min(15).max(1440).default(60).describe("How long buyers can bid (15–1440)"),
        note: z.string().max(280).optional().describe("Public note to buyers"),
        allowPartial: z.boolean().optional().describe("Let several buyers each take part of the block (each becomes its own deal)"),
      },
    },
    (a) => run(() => agent.createListing(a)),
  );

  server.registerTool(
    "otc_create_bid",
    {
      title: "Place a bid",
      description:
        "Ask to buy a block of a token. Sellers reply with sealed offers only you can decrypt. Returns a bidId and a share link for sellers.",
      inputSchema: {
        token: z.string().describe("Token address on Robinhood Chain"),
        amount: z.string().optional().describe("How many tokens, in whole units, e.g. '25000'"),
        sizeUsd: z.number().min(5).optional().describe("Or size the bid in USD; sellers then say how many tokens they offer"),
        payWith: z.enum(["ETH", "USDG"]),
        replyMinutes: z.number().min(15).max(1440).default(60).describe("How long sellers can reply (15–1440)"),
        note: z.string().max(280).optional().describe("Public note to sellers"),
        allowPartial: z.boolean().optional().describe("Let several sellers each fill part of the bid (each becomes its own deal)"),
      },
    },
    (a) => run(() => agent.createBid(a)),
  );

  server.registerTool(
    "otc_get_offers",
    {
      title: "Read sealed answers",
      description:
        "Decrypts, locally, the answers on something you posted. On your bid: seller offers; on your sell listing: buyer bids. verified=true means the answer is signed by the wallet it names; hasFunds says whether that wallet holds enough right now (null = unknown, e.g. a ghost wallet). Verified answers first, then best price.",
      inputSchema: { bidId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ bidId }) => run(async () => (await agent.getOffers(bidId)).map(({ _offer, ...rest }) => rest)),
  );

  server.registerTool(
    "otc_accept_offer",
    {
      title: "Accept an answer",
      description:
        "Fix the deal terms with one answer on your posting. Both sides then deposit before the funding deadline. On a sell listing you are the seller: set payoutAddress and optionally ghost=true.",
      inputSchema: {
        bidId: z.string(),
        offerId: z.string(),
        fundingMinutes: z.number().min(5).max(10080).default(60).describe("Time both sides have to deposit"),
        buyer: z.string().optional().describe("Your bid: buyer address, if this agent has no wallet key"),
        seller: z.string().optional().describe("Your listing: seller address, if this agent has no wallet key"),
        payoutAddress: z.string().optional().describe("Your listing: where the payment goes"),
        ghost: z.boolean().default(false).describe("Your listing: deposit from a one-time wallet via the relayer"),
        referrer: z.string().optional().describe("Partner address that earns half the fee"),
        allowUnverified: z.boolean().default(false).describe("Accept an answer that is not signed by the wallet it names (may be fake; not recommended)"),
      },
    },
    (a) => run(() => agent.acceptOffer(a)),
  );

  server.registerTool(
    "otc_send_offer",
    {
      title: "Send a sealed answer",
      description:
        "Answer a posting with a total price, encrypted to the poster. On a bid you answer as the seller (ghost=true uses a one-time wallet and a gasless relayed deposit; the relayer fee comes out of proceeds). On a sell listing you answer as the buyer.",
      inputSchema: {
        bidId: z.string(),
        totalPrice: z.string().describe("Total price for the whole size, in ETH or USDG units, e.g. '41250.5'"),
        amount: z.string().optional().describe("Whole tokens you offer; required when the bid is sized in USD"),
        payoutAddress: z.string().optional().describe("Where the payment goes (a fresh address keeps it private)"),
        ghost: z.boolean().default(false),
        message: z.string().max(200).optional().describe("Sealed note to the poster"),
        seller: z.string().optional().describe("On a bid: seller address, if this agent has no wallet key"),
        buyer: z.string().optional().describe("On a sell listing: buyer address, if this agent has no wallet key"),
      },
    },
    (a) => run(() => agent.sendOffer(a)),
  );

  server.registerTool(
    "otc_deal_status",
    {
      title: "Deal status",
      description: "Where a deal stands: whether the offer was accepted, who has deposited, time left, settled or refunded.",
      inputSchema: ref,
      annotations: { readOnlyHint: true },
    },
    (a) => run(() => agent.dealStatus(a)),
  );

  server.registerTool(
    "otc_deposit",
    {
      title: "Deposit into escrow",
      description:
        "Deposit your side (buyer: payment, seller: tokens). With a wallet key it signs and sends; without one it returns unsigned transactions. The second deposit settles the swap.",
      inputSchema: ref,
      annotations: { destructiveHint: true },
    },
    (a) => run(() => agent.deposit(a)),
  );

  server.registerTool(
    "otc_refund",
    {
      title: "Refund after deadline",
      description: "If the funding deadline passed before both sides deposited, return everyone's deposits.",
      inputSchema: ref,
    },
    (a) => run(() => agent.refund(a)),
  );

  server.registerTool(
    "otc_price",
    {
      title: "On-chain reference price",
      description: "Spot price read from a Uniswap v3 pool ('v3:0xPool') or a Pons bonding curve ('pons:0xCurve').",
      inputSchema: { token: z.string(), source: z.string().describe("v3:0xPool or pons:0xCurve") },
      annotations: { readOnlyHint: true },
    },
    ({ token, source }) => run(() => agent.price(token, source)),
  );

  const rule = z.object({
    side: z.enum(["sell", "buy"]).describe("sell: answer buy bids with offers. buy: answer sell listings with bids"),
    token: z.string().describe("Token address on Robinhood Chain"),
    payWith: z.enum(["ETH", "USDG", "any"]).optional(),
    maxTotal: z.string().describe("Most tokens over the whole run, whole units"),
    maxPerDeal: z.string().describe("Most tokens per deal, whole units"),
    priceVsMarketPct: z.number().describe("Price against the token's DEX price: +5 = 5% above, -3 = 3% below"),
    minPriceUsd: z.number().optional().describe("Sell rules: never below this USD price per token"),
    maxPriceUsd: z.number().optional().describe("Buy rules: never above this USD price per token"),
    payoutAddress: z.string().optional().describe("Sell rules: where payments go (default: the agent's wallet)"),
  });

  server.registerTool(
    "otc_autopilot_preview",
    {
      title: "Autopilot: preview rules",
      description:
        "Dry-run trading rules against the live desk: which open postings the autopilot would answer, at what size and price, and why it would skip the others. Sends nothing. To run them for real, save the same JSON with \"live\": true and start `obsyn-mcp autopilot rules.json`.",
      inputSchema: { rules: z.array(rule).min(1).max(10) },
      annotations: { readOnlyHint: true },
    },
    ({ rules }) =>
      run(async () => {
        const cfg: AutopilotConfig = { rules, live: false };
        const problems = validateConfig(cfg);
        if (problems.length) throw new Error(problems.join("; "));
        const pilot = await createAutopilot(agent, cfg);
        const report = await pilot.tick();
        return { ...report, configToRun: { ...cfg, live: true, intervalSec: 30 } };
      }),
  );

  return server;
}
