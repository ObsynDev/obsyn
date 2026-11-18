/** OpenAPI 3.1 description of the HTTP API. Served at GET /openapi.json. */

const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } as const;
const uintString = { type: "string", pattern: "^[0-9]+$", description: "Base-10 integer in base units" } as const;
const bearer = [{ capability: [] }];

const Terms = {
  type: "object",
  description: "Mirrors OtcEscrow.Terms. dealId = keccak256(abi.encode(terms)).",
  required: ["buyer", "seller", "token", "amount", "payToken", "price", "sellerPayout", "deadline", "salt"],
  properties: {
    buyer: address,
    seller: address,
    token: address,
    amount: uintString,
    payToken: { ...address, description: "0x000…0 for ETH, the USDG address, or the OBSYN address when the escrow accepts it (see /health payTokens)" },
    price: uintString,
    sellerPayout: address,
    referrer: { ...address, description: "Earns half the fee; zero address for none" },
    relayerFee: uintString,
    deadline: { ...uintString, description: "Unix seconds; deposits must land before it" },
    salt: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
  },
} as const;

const Rfq = {
  type: "object",
  properties: {
    id: { type: "string" },
    side: { enum: ["buy", "sell"], description: "buy: a buyer posted it and sellers answer. sell: a seller posted it and buyers answer." },
    token: address,
    payToken: address,
    amount: { ...uintString, nullable: true },
    sizeUsd: { type: ["number", "null"] },
    note: { type: ["string", "null"] },
    encPubKey: { type: "string", description: "Poster's base64 NaCl box public key; encrypt answers to this" },
    buyerEncPubKey: { type: "string", deprecated: true, description: "Same as encPubKey" },
    createdAt: { type: "integer", description: "Unix seconds" },
    expiresAt: { type: "integer", description: "Unix seconds; offers close after this" },
    status: { enum: ["open", "accepted", "cancelled"] },
    quoteCount: { type: "integer" },
  },
} as const;

const SealedQuote = {
  type: "object",
  required: ["sellerEncPubKey", "nonce", "ciphertext"],
  properties: {
    sellerEncPubKey: { type: "string", description: "Base64, 32 bytes (one-off key per offer)" },
    nonce: { type: "string", description: "Base64, 24 bytes" },
    ciphertext: {
      type: "string",
      maxLength: 4096,
      description:
        "nacl.box(JSON answer, nonce, encPubKey, ephemeralSecret). On a buy bid the answer is a seller offer {amount, price, seller, sellerPayout, relayerFee, ghost, message?}; on a sell listing it is a buyer bid {amount, price, buyer, message?}.",
    },
  },
} as const;

const Error = { type: "object", properties: { error: { type: "string" }, problems: { type: "array", items: { type: "string" } } } };
const err = (d: string) => ({ description: d, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const ok = (d: string, schema: unknown) => ({ description: d, content: { "application/json": { schema } } });
const body = (schema: unknown) => ({ required: true, content: { "application/json": { schema } } });
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Obsyn API",
    version: "0.1.0",
    description:
      "Private OTC block trades on Robinhood Chain. No accounts: creating a bid or offer returns a capability token; send it as `Authorization: Bearer <token>` to manage that bid or offer. Offers are sealed client-side; the server stores ciphertext only. Settlement happens on-chain in the OtcEscrow contract.",
  },
  components: {
    securitySchemes: { capability: { type: "http", scheme: "bearer", description: "manageToken (bids) or quoteToken (offers)" } },
    schemas: { Terms, Rfq, SealedQuote, Error },
  },
  paths: {
    "/health": {
      get: {
        summary: "Server config: chain, RPC, escrow, USDG, relayer",
        responses: { 200: ok("Config", { type: "object" }) },
      },
    },
    "/rfqs": {
      get: {
        summary: "Open bids and sell listings, newest first",
        parameters: [
          { name: "token", in: "query", schema: address },
          { name: "side", in: "query", schema: { enum: ["buy", "sell"] } },
        ],
        responses: { 200: ok("Open bids", { type: "array", items: { $ref: "#/components/schemas/Rfq" } }) },
      },
      post: {
        summary: "Post a bid (side=buy) or a sell listing (side=sell)",
        requestBody: body({
          type: "object",
          required: ["token", "payToken", "replySeconds", "encPubKey"],
          properties: {
            side: { enum: ["buy", "sell"], default: "buy" },
            token: address,
            payToken: { description: "ETH, USDG or OBSYN (OBSYN only when /health lists it in payTokens), or the token address", type: "string" },
            amount: uintString,
            sizeUsd: { type: "number" },
            replySeconds: { type: "integer", minimum: 900, maximum: 86400 },
            encPubKey: { type: "string" },
            note: { type: "string", maxLength: 280 },
          },
        }),
        responses: {
          201: ok("Created. manageToken is shown once.", {
            type: "object",
            properties: { id: { type: "string" }, manageToken: { type: "string" }, shareUrl: { type: "string" }, expiresAt: { type: "integer" } },
          }),
          400: err("Invalid input"),
        },
      },
    },
    "/rfqs/{id}": {
      get: { summary: "One bid (public view)", parameters: [idParam], responses: { 200: ok("Bid", { $ref: "#/components/schemas/Rfq" }), 404: err("Not found") } },
    },
    "/rfqs/{id}/cancel": {
      post: { summary: "Cancel your bid", security: bearer, parameters: [idParam], responses: { 200: ok("Cancelled", { type: "object" }), 401: err("Wrong token"), 409: err("Not open") } },
    },
    "/rfqs/{id}/quotes": {
      get: {
        summary: "Sealed offers on your bid (still encrypted)",
        security: bearer,
        parameters: [idParam],
        responses: { 200: ok("Offers", { type: "array", items: { $ref: "#/components/schemas/SealedQuote" } }), 401: err("Wrong token") },
      },
      post: {
        summary: "Send a sealed offer",
        parameters: [idParam],
        requestBody: body({ $ref: "#/components/schemas/SealedQuote" }),
        responses: {
          201: ok("Created. quoteToken is shown once.", { type: "object", properties: { quoteId: { type: "string" }, quoteToken: { type: "string" } } }),
          409: err("Bid closed or full"),
        },
      },
    },
    "/rfqs/{id}/accept": {
      post: {
        summary: "Accept one offer and fix the deal terms",
        security: bearer,
        parameters: [idParam],
        requestBody: body({ type: "object", required: ["quoteId", "terms"], properties: { quoteId: { type: "string" }, terms: { $ref: "#/components/schemas/Terms" } } }),
        responses: {
          200: ok("Deal", { type: "object", properties: { dealId: { type: "string" }, terms: { $ref: "#/components/schemas/Terms" }, escrow: address, chainId: { type: "integer" } } }),
          400: err("Terms don't match the bid"),
          401: err("Wrong token"),
          409: err("Bid no longer open"),
        },
      },
    },
    "/rfqs/{id}/deal": {
      get: { summary: "The accepted deal (buyer)", security: bearer, parameters: [idParam], responses: { 200: ok("Deal", { type: "object" }), 404: err("No deal yet") } },
    },
    "/quotes/{id}": {
      get: {
        summary: "Your offer's status; includes terms once accepted (seller)",
        security: bearer,
        parameters: [idParam],
        responses: { 200: ok("Offer status", { type: "object" }), 401: err("Wrong token") },
      },
    },
    "/relay": {
      get: { summary: "Relayer address and minimum fees", responses: { 200: ok("Relayer", { type: "object" }) } },
    },
    "/relay/deposit": {
      post: {
        summary: "Ghost mode: relay a seller deposit signed by a one-time wallet",
        description:
          "The seller signs EIP-712 Deposit(bytes32 dealId, address relayer) for domain {name: 'Obsyn', version: '1', chainId, verifyingContract: escrow}, plus an optional EIP-2612 permit. Only relayed once the buyer has funded the deal.",
        requestBody: body({
          type: "object",
          required: ["terms", "sellerSig"],
          properties: {
            terms: { $ref: "#/components/schemas/Terms" },
            sellerSig: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
            permit: { type: "object", properties: { deadline: uintString, v: { type: "integer" }, r: { type: "string" }, s: { type: "string" } } },
            escrow: { ...address, description: "The escrow the deal is on (the deal's `escrow` field). Defaults to the current one." },
          },
        }),
        responses: { 202: ok("Submitted", { type: "object", properties: { txHash: { type: "string" }, dealId: { type: "string" } } }), 400: err("Rejected"), 409: err("Deal not ready") },
      },
    },
    "/token/{address}": {
      get: {
        summary: "ERC-20 facts read on-chain: code present, name, symbol, decimals, supply, EIP-2612 permit",
        parameters: [{ name: "address", in: "path", required: true, schema: address }],
        responses: { 200: ok("Token info", { type: "object" }), 400: err("Bad address"), 502: err("Read failed") },
      },
    },
    "/rfqs/{id}/deals": {
      get: {
        summary: "Every deal on a posting, one per accepted answer (partial fills). Needs the manage token",
        security: [{ bearer: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Deals", { type: "object" }), 401: err("Wrong or missing manage token"), 404: err("Not found") },
      },
    },
    "/receipts/{tx}": {
      get: {
        summary: "Public receipt of a settled deal, rebuilt from its settlement transaction: terms, fee split, block and time, plus vsDex (the block against a DEX market order of the same size at settlement, when known)",
        parameters: [{ name: "tx", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }],
        responses: { 200: ok("Receipt", { type: "object" }), 400: err("Bad hash"), 404: err("Not an Obsyn settlement") },
      },
    },
    "/rfqs/{id}/card.png": {
      get: {
        summary: "Share card for an open block (1200x630 PNG): side, size, token, pay token, number of sealed answers, time left. Never a price",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "PNG image", content: { "image/png": { schema: { type: "string", format: "binary" } } } }, 404: err("No such block") },
      },
    },
    "/receipts/{tx}/card.png": {
      get: {
        summary: "Share card for a settled deal (1200x630 PNG): size, price, the comparison with a DEX market order, and the fee. Public data only",
        parameters: [{ name: "tx", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }],
        responses: { 200: { description: "PNG image", content: { "image/png": { schema: { type: "string", format: "binary" } } } }, 400: err("Bad hash"), 404: err("Not an Obsyn settlement") },
      },
    },
    "/control": {
      get: {
        summary: "Who controls what, read live from the chain: the escrow (no owner), the fee vault's owner and keeper (Safe or timelock), the Safe's signers and threshold, the timelock's delay and every queued change, the burn route and what the vault holds",
        responses: { 200: ok("Control report", { type: "object" }), 502: err("Chain read failed"), 503: err("Not configured") },
      },
    },
    "/stats": {
      get: {
        summary: "Desk totals: accepted, settled and refunded deals, settled volume and fees (ETH and USDG base units, plus USD), postings, and the fee vault's buy-and-burn",
        responses: { 200: ok("Stats", { type: "object" }), 502: err("Chain read failed") },
      },
    },
    "/referrals/{address}": {
      get: {
        summary: "Deals this wallet referred and what it earned: half the protocol fee, paid by the escrow at settlement",
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }],
        responses: { 200: ok("Referral summary", { type: "object" }), 400: err("Bad address"), 502: err("Chain read failed") },
      },
    },
    "/deals/{dealId}/receipt": {
      get: {
        summary: "Settlement transaction of a deal, once a party has reported it",
        parameters: [{ name: "dealId", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }],
        responses: { 200: ok("Transaction hash", { type: "object" }), 400: err("Bad id"), 404: err("No receipt yet") },
      },
    },
    "/rfqs/{id}/settled": {
      post: {
        summary: "Report the transaction that settled this posting's deal. Verified on-chain before it's recorded; no token needed",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["txHash"], properties: { txHash: { type: "string" } } } } } },
        responses: { 200: ok("Recorded", { type: "object" }), 400: err("Not this deal's settlement"), 404: err("Not found"), 409: err("No accepted deal") },
      },
    },
    "/token/{address}/market": {
      get: {
        summary:
          "DEX market snapshot (reference only, deals settle at the sealed price): USD price, market cap, liquidity, 24h change and logo from the deepest Robinhood Chain pool, plus ETH/USD",
        parameters: [{ name: "address", in: "path", required: true, schema: address }],
        responses: { 200: ok("Market snapshot", { type: "object" }), 400: err("Bad address"), 502: err("Market data unavailable") },
      },
    },
    "/price/{token}": {
      get: {
        summary: "On-chain spot price",
        parameters: [
          { name: "token", in: "path", required: true, schema: address },
          { name: "source", in: "query", required: true, schema: { type: "string", pattern: "^(v3|pons):0x[0-9a-fA-F]{40}$" } },
        ],
        responses: { 200: ok("Price", { type: "object" }), 400: err("Bad source"), 502: err("Read failed") },
      },
    },
    "/markets": {
      get: {
        summary:
          "Featured markets: verified token address, delayed reference price of the underlying listing with a 5-day sparkline (null when unavailable), and blocks open on this desk",
        responses: { 200: ok("Markets", { type: "array", items: { type: "object" } }) },
      },
    },
    "/markets/{symbol}/chart": {
      get: {
        summary: "OHLC candles of a market's reference listing (delayed)",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string", example: "TSLA" } },
          { name: "range", in: "query", required: false, schema: { type: "string", enum: ["1d", "5d", "1mo", "6mo", "1y"], default: "1d" } },
        ],
        responses: { 200: ok("Candles", { type: "object" }), 400: err("Bad range"), 404: err("Unknown market or no reference listing"), 502: err("Reference source failed") },
      },
    },
    "/openapi.json": { get: { summary: "This document", responses: { 200: ok("OpenAPI", { type: "object" }) } } },
    "/sdk/obsyn.mjs": { get: { summary: "Bundled JavaScript SDK (ES module)", responses: { 200: { description: "JavaScript" }, 404: err("Not built") } } },
    "/sdk/blockotc.mjs": { get: { summary: "Deprecated alias of /sdk/obsyn.mjs", deprecated: true, responses: { 200: { description: "JavaScript" }, 404: err("Not built") } } },
  },
} as const;
