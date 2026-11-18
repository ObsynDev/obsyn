import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nacl from "tweetnacl";
import { zeroAddress } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { createRelayer, NO_PERMIT, RelayError, type Relayer } from "../src/relayer.ts";

const USDG = "0x00000000000000000000000000000000000000A1";
const ESCROW = "0x00000000000000000000000000000000000000E5";
const OBSYN = "0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351";
const TOKEN = "0x1111111111111111111111111111111111111111";

const fakeRelayer: Relayer = {
  info: () => ({ enabled: true, address: "0x5555555555555555555555555555555555555555", problem: null, minFee: { eth: "1", usdg: "1" } }),
  relayDeposit: async () => {
    throw new RelayError(503, "unused");
  },
};

function setup(burnToken?: string) {
  const cfg = loadConfig({
    ESCROW_ADDRESS: ESCROW,
    USDG_ADDRESS: USDG,
    PUBLIC_URL: "https://otc.example",
    ...(burnToken ? { ESCROW_BURN_TOKEN: burnToken } : {}),
  });
  return createApp({
    cfg,
    db: openDb(":memory:"),
    relayer: fakeRelayer,
    readPrice: async (token) => ({ token, quote: "ETH", price: 0.001, source: "test", blockNumber: "1" }),
    readReceipt: async () => {
      throw new Error("unused");
    },
    now: () => 1_800_000_000,
  });
}

async function call(app: ReturnType<typeof setup>, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const rfq = (app: ReturnType<typeof setup>, extra: Record<string, unknown>) =>
  call(app, "POST", "/rfqs", {
    token: TOKEN,
    payToken: "USDG",
    amount: "1000000000000000000000",
    replySeconds: 3600,
    buyerEncPubKey: Buffer.from(nacl.box.keyPair().publicKey).toString("base64"),
    ...extra,
  });

describe("paying in $OBSYN (OtcEscrowV2)", () => {
  it("is off while the escrow has no burn token", async () => {
    const app = setup();
    const r = await rfq(app, { payToken: "OBSYN" });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /OBSYN isn't available/);
    assert.equal((await rfq(app, { payToken: OBSYN })).status, 400);
    const health = (await call(app, "GET", "/health")).json;
    assert.deepEqual(
      health.payTokens.map((p: any) => p.symbol),
      ["ETH", "USDG"],
    );
  });

  it("accepts OBSYN by symbol or address once the escrow burns it", async () => {
    const app = setup(OBSYN.toLowerCase()); // env value may come in any case
    const bySymbol = await rfq(app, { payToken: "OBSYN" });
    assert.equal(bySymbol.status, 201);
    assert.equal((await rfq(app, { payToken: "obsyn" })).status, 201);
    assert.equal((await rfq(app, { payToken: OBSYN.toLowerCase() })).status, 201);
    const listed = (await call(app, "GET", "/rfqs")).json;
    assert.ok(listed.every((r: any) => r.payToken === OBSYN));
    assert.equal((await rfq(app, { payToken: TOKEN })).status, 400); // still no arbitrary tokens
  });

  it("refuses trading OBSYN for OBSYN", async () => {
    const app = setup(OBSYN);
    const r = await rfq(app, { token: OBSYN, payToken: "OBSYN" });
    assert.equal(r.status, 400);
    // OBSYN itself can still be traded for ETH or USDG
    assert.equal((await rfq(app, { token: OBSYN, payToken: "ETH" })).status, 201);
  });

  it("announces OBSYN with its burned 1.5% fee in /health", async () => {
    const health = (await call(setup(OBSYN), "GET", "/health")).json;
    const obsyn = health.payTokens.find((p: any) => p.symbol === "OBSYN");
    assert.deepEqual(obsyn, { symbol: "OBSYN", address: OBSYN, decimals: 18, feeBps: 150, feeBurned: true });
  });
});

describe("ghost relayer and OBSYN-paid deals", () => {
  it("refuses to relay a deal paid in OBSYN", async () => {
    const relayer = createRelayer(
      loadConfig({
        ESCROW_ADDRESS: ESCROW,
        USDG_ADDRESS: USDG,
        ESCROW_BURN_TOKEN: OBSYN,
        RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        RPC_URL: "http://127.0.0.1:1",
      }),
    );
    assert.equal(relayer.info().enabled, true);
    await assert.rejects(
      relayer.relayDeposit(
        {
          buyer: TOKEN,
          seller: TOKEN,
          token: TOKEN,
          amount: 1n,
          payToken: OBSYN,
          price: 1n,
          sellerPayout: TOKEN,
          relayerFee: 10n ** 18n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
          salt: `0x${"01".repeat(32)}`,
          referrer: zeroAddress,
        } as any,
        NO_PERMIT,
        "0x",
      ),
      (e: any) => e instanceof RelayError && e.status === 400 && /only available for deals paid in ETH or USDG/.test(e.message),
    );
  });
});
