import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OtcAgent } from "../sdk/client.ts";

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
  bidId: z.string().optional().describe("Your bid id (when you are the buyer)"),
  offerId: z.string().optional().describe("Your offer id (when you are the seller)"),
};

export function createMcpServer(agent: OtcAgent) {
  const server = new McpServer({ name: "blockotc", version: "0.1.0" });

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
      title: "Open bids",
      description: "Open buy requests (where demand is forming). Sellers answer these with otc_send_offer.",
      annotations: { readOnlyHint: true },
    },
    () => run(() => agent.listBids()),
  );

  server.registerTool(
    "otc_create_bid",
    {
      title: "Place a bid",
      description:
        "Ask to buy a block of a token. Sellers reply with sealed offers only you can decrypt. Returns a bidId and a share link for sellers.",
      inputSchema: {
        token: z.string().describe("Token address on Robinhood Chain"),
        amount: z.string().describe("How many tokens, in whole units, e.g. '25000'"),
        payWith: z.enum(["ETH", "USDG"]),
        replyMinutes: z.number().min(15).max(1440).default(60).describe("How long sellers can reply (15–1440)"),
        note: z.string().max(280).optional().describe("Public note to sellers"),
      },
    },
    (a) => run(() => agent.createBid(a)),
  );

  server.registerTool(
    "otc_get_offers",
    {
      title: "Read sealed offers",
      description: "Decrypts the offers on your bid locally. Sorted cheapest first.",
      inputSchema: { bidId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ bidId }) => run(async () => (await agent.getOffers(bidId)).map(({ _offer, ...rest }) => rest)),
  );

  server.registerTool(
    "otc_accept_offer",
    {
      title: "Accept an offer",
      description: "Fix the deal terms with one seller. Both sides then deposit before the funding deadline.",
      inputSchema: {
        bidId: z.string(),
        offerId: z.string(),
        fundingMinutes: z.number().min(5).max(10080).default(60).describe("Time both sides have to deposit"),
        buyer: z.string().optional().describe("Buyer address, if this agent has no wallet key"),
        referrer: z.string().optional().describe("Partner address that earns half the fee"),
      },
    },
    (a) => run(() => agent.acceptOffer(a)),
  );

  server.registerTool(
    "otc_send_offer",
    {
      title: "Send a sealed offer",
      description:
        "Answer a bid with a total price, encrypted to the buyer. ghost=true uses a one-time wallet and a gasless relayed deposit; the relayer fee comes out of proceeds.",
      inputSchema: {
        bidId: z.string(),
        totalPrice: z.string().describe("Total price for the whole size, in ETH or USDG units, e.g. '41250.5'"),
        payoutAddress: z.string().optional().describe("Where the payment goes (a fresh address keeps it private)"),
        ghost: z.boolean().default(false),
        message: z.string().max(200).optional().describe("Sealed note to the buyer"),
        seller: z.string().optional().describe("Seller address, if this agent has no wallet key"),
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

  return server;
}
