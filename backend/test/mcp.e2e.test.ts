/**
 * Two AI agents trade through the MCP tools against the real backend and a real escrow on anvil.
 * Skips when anvil or the forge build output is missing.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import nacl from "tweetnacl";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { OtcAgent } from "../src/sdk/client.ts";
import { FileStore } from "../src/sdk/file-store.ts";
import { createMcpServer } from "../src/mcp/server.ts";
import { createRelayer } from "../src/relayer.ts";

const OUT = new URL("../../contracts/out/", import.meta.url);
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buyer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  seller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  relayer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;

const canRun = existsSync(new URL("OtcEscrow.sol/OtcEscrow.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;

let anvil: ChildProcess | undefined;
let http_: ServerType | undefined;
let apiUrl = "";
let usdg: Address;
let stock: Address;
let escrow: Address;
let treasury: Address;
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });

const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};

async function agentClient(key?: Hex) {
  const agent = new OtcAgent({ apiUrl, privateKey: key, store: new FileStore(join(mkdtempSync(join(tmpdir(), "otc-")), "state.json")) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(agent).connect(a);
  const client = new Client({ name: "test-agent", version: "1" });
  await client.connect(b);
  return {
    async call(name: string, args: Record<string, unknown> = {}) {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      const out = JSON.parse(r.content[0].text);
      if (r.isError) throw new Error(`${name}: ${out.error}`);
      return out;
    },
    client,
  };
}

const bal = (t: Address, who: Address) => pc.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [who] });

before(async () => {
  if (!canRun) return;
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; ; i++) {
    try {
      await pc.getChainId();
      break;
    } catch {
      if (i > 50) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const deployer = createWalletClient({ chain: foundry, account: privateKeyToAccount(KEYS.deployer), transport: http(RPC) });
  const deploy = async (file: string, name: string, args: unknown[]) => {
    const { abi, bytecode } = artifact(file, name);
    const hash = await deployer.deployContract({ abi, bytecode, args });
    return getAddress((await pc.waitForTransactionReceipt({ hash })).contractAddress!);
  };
  const mock = parseAbi(["function mint(address,uint256)", "function set(int256,uint256)"]);
  usdg = await deploy("Mocks.sol", "MockToken", ["Global Dollar", "USDG", 6]);
  stock = await deploy("Mocks.sol", "MockToken", ["Tesla xStock", "TSLAx", 18]);
  const feed = await deploy("Mocks.sol", "MockFeed", []);
  const block = await pc.getBlock();
  await pc.waitForTransactionReceipt({
    hash: await deployer.writeContract({ address: feed, abi: mock, functionName: "set", args: [3_000n * 10n ** 8n, block.timestamp] }),
  });
  treasury = privateKeyToAccount(generatePrivateKey()).address;
  escrow = await deploy("OtcEscrow.sol", "OtcEscrow", [usdg, feed, treasury]);
  const buyer = privateKeyToAccount(KEYS.buyer).address;
  const seller = privateKeyToAccount(KEYS.seller).address;
  for (const [t, to, amt] of [
    [usdg, buyer, 1_000_000n * 10n ** 6n],
    [stock, seller, 10_000n * 10n ** 18n],
  ] as const) {
    await pc.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: t, abi: mock, functionName: "mint", args: [to, amt] }) });
  }

  const cfg = loadConfig({
    CHAIN_ID: String(foundry.id),
    RPC_URL: RPC,
    ESCROW_ADDRESS: escrow,
    USDG_ADDRESS: usdg,
    RELAYER_PRIVATE_KEY: KEYS.relayer,
    RELAYER_MIN_FEE_ETH: "100000000000000",
    RELAYER_MIN_FEE_USDG: "1000000",
  });
  const app = createApp({ cfg, db: openDb(":memory:"), relayer: createRelayer(cfg), readPrice: async () => Promise.reject(new Error("n/a")) });
  await new Promise<void>((resolve) => {
    http_ = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
      apiUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

after(() => {
  http_?.close();
  anvil?.kill();
});

describe("MCP agents", { skip: !canRun && "anvil or forge build output missing" }, () => {
  it("exposes the tool set", async () => {
    const a = await agentClient(KEYS.buyer);
    const { tools } = await a.client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["otc_accept_offer", "otc_create_bid", "otc_create_listing", "otc_deal_status", "otc_deposit", "otc_get_offers", "otc_info", "otc_list_bids", "otc_price", "otc_refund", "otc_send_offer"],
    );
    const info = await a.call("otc_info");
    assert.equal(info.escrow, escrow);
    assert.equal(info.agentWallet, privateKeyToAccount(KEYS.buyer).address);
  });

  it("buyer agent and seller agent trade TSLAx for USDG end to end", async () => {
    const buyer = await agentClient(KEYS.buyer);
    const seller = await agentClient(KEYS.seller);
    const buyerAddr = privateKeyToAccount(KEYS.buyer).address;
    const payout = privateKeyToAccount(generatePrivateKey()).address;

    const bid = await buyer.call("otc_create_bid", { token: stock, amount: "100", payWith: "USDG", replyMinutes: 30 });
    const feed = await seller.call("otc_list_bids");
    const seen = feed.find((b: any) => b.bidId === bid.bidId);
    assert.equal(seen.symbol, "TSLAx");
    assert.equal(seen.amount, "100");
    assert.equal(seen.payWith, "USDG");

    const off1 = await seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "26000", payoutAddress: payout });
    const off2 = await seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "25000", payoutAddress: payout });

    const offers = await buyer.call("otc_get_offers", { bidId: bid.bidId });
    assert.equal(offers.length, 2);
    assert.equal(offers[0].offerId, off2.offerId, "cheapest first");
    assert.equal(offers[0].totalPrice, "25000");
    assert.equal(offers[0].unitPrice, 250);

    assert.equal((await seller.call("otc_deal_status", { offerId: off2.offerId })).offer, "pending");
    await buyer.call("otc_accept_offer", { bidId: bid.bidId, offerId: off2.offerId, fundingMinutes: 60 });
    assert.equal((await seller.call("otc_deal_status", { offerId: off1.offerId })).offer, "rejected");

    const dep1 = await buyer.call("otc_deposit", { bidId: bid.bidId });
    assert.equal(dep1.signed, true);
    assert.equal(dep1.transactions.length, 2, "approve + deposit");
    let st = await seller.call("otc_deal_status", { offerId: off2.offerId });
    assert.equal(st.buyerFunded, true);
    assert.equal(st.status, "open");

    await seller.call("otc_deposit", { offerId: off2.offerId });
    st = await buyer.call("otc_deal_status", { bidId: bid.bidId });
    assert.equal(st.status, "settled");

    assert.equal(await bal(stock, buyerAddr), 100n * 10n ** 18n);
    assert.equal(await bal(usdg, treasury), 500n * 10n ** 6n); // 2% of $25k
    assert.equal(await bal(usdg, payout), 24_500n * 10n ** 6n);
  });

  it("seller agent uses ghost mode with an ETH-paid bid", async () => {
    const buyer = await agentClient(KEYS.buyer);
    const seller = await agentClient(KEYS.seller);
    const buyerAddr = privateKeyToAccount(KEYS.buyer).address;
    const payout = privateKeyToAccount(generatePrivateKey()).address;
    const before = await bal(stock, buyerAddr);

    const bid = await buyer.call("otc_create_bid", { token: stock, amount: "10", payWith: "ETH", replyMinutes: 15 });
    const off = await seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "1", payoutAddress: payout, ghost: true });
    assert.ok(off.ghostWallet);

    const [o] = await buyer.call("otc_get_offers", { bidId: bid.bidId });
    assert.equal(o.seller, off.ghostWallet, "buyer only sees the one-time wallet");
    assert.equal(o.ghost, true);
    await buyer.call("otc_accept_offer", { bidId: bid.bidId, offerId: off.offerId, fundingMinutes: 60 });

    // seller first: funds the one-time wallet, then waits for the buyer
    const early = await seller.call("otc_deposit", { offerId: off.offerId });
    assert.equal(early.done, false);
    assert.equal(await bal(stock, off.ghostWallet), 10n * 10n ** 18n);

    await buyer.call("otc_deposit", { bidId: bid.bidId });
    const relayed = await seller.call("otc_deposit", { offerId: off.offerId });
    assert.equal(relayed.done, true);

    assert.equal((await buyer.call("otc_deal_status", { bidId: bid.bidId })).status, "settled");
    assert.equal((await bal(stock, buyerAddr)) - before, 10n * 10n ** 18n);
    assert.equal(await pc.getBalance({ address: off.ghostWallet }), 0n, "one-time wallet never held ETH");
    // 1 ETH - 2.5% fee (stale-proof top tier under $10k) - 0.0001 ETH relayer fee
    assert.equal(await pc.getBalance({ address: payout }), 10n ** 18n - 25n * 10n ** 15n - 10n ** 14n);
  });

  it("sell privately: seller agent lists, buyer agents bid sealed, seller takes the highest", async () => {
    const seller = await agentClient(KEYS.seller);
    const buyerA = await agentClient(KEYS.buyer);
    const buyerB = await agentClient(KEYS.deployer);
    const buyerAddr = privateKeyToAccount(KEYS.buyer).address;
    const payout = privateKeyToAccount(generatePrivateKey()).address;
    const before = await bal(stock, buyerAddr);

    const listing = await seller.call("otc_create_listing", { token: stock, amount: "40", payWith: "USDG", replyMinutes: 30 });
    assert.equal(listing.side, "sell");
    const seen = (await buyerA.call("otc_list_bids")).find((b: any) => b.bidId === listing.bidId);
    assert.equal(seen.side, "sell");
    assert.equal(seen.amount, "40");

    const low = await buyerB.call("otc_send_offer", { bidId: listing.bidId, totalPrice: "9800" });
    const high = await buyerA.call("otc_send_offer", { bidId: listing.bidId, totalPrice: "10000" });
    assert.equal(high.as, "buyer");
    await assert.rejects(buyerA.call("otc_send_offer", { bidId: listing.bidId, totalPrice: "1", ghost: true }), /Ghost mode is for sellers/);

    const bids = await seller.call("otc_get_offers", { bidId: listing.bidId });
    assert.equal(bids.length, 2);
    assert.equal(bids[0].offerId, high.offerId, "highest bid first");
    assert.equal(bids[0].buyer, buyerAddr);

    await seller.call("otc_accept_offer", { bidId: listing.bidId, offerId: high.offerId, fundingMinutes: 60, payoutAddress: payout });
    assert.equal((await buyerB.call("otc_deal_status", { offerId: low.offerId })).offer, "rejected");

    // buyer (the answerer) pays, seller (the poster) delivers
    const st = await buyerA.call("otc_deal_status", { offerId: high.offerId });
    assert.equal(st.role, "buyer");
    await buyerA.call("otc_deposit", { offerId: high.offerId });
    await seller.call("otc_deposit", { bidId: listing.bidId });

    assert.equal((await seller.call("otc_deal_status", { bidId: listing.bidId })).status, "settled");
    assert.equal((await bal(stock, buyerAddr)) - before, 40n * 10n ** 18n);
    assert.equal(await bal(usdg, payout), 9_800n * 10n ** 6n); // exactly $10k is in the 2% tier
  });

  it("sell privately in ghost mode: the seller picks ghost when accepting", async () => {
    const seller = await agentClient(KEYS.seller);
    const buyer = await agentClient(KEYS.buyer);
    const payout = privateKeyToAccount(generatePrivateKey()).address;

    const listing = await seller.call("otc_create_listing", { token: stock, amount: "5", payWith: "ETH", replyMinutes: 15 });
    const bid = await buyer.call("otc_send_offer", { bidId: listing.bidId, totalPrice: "0.8" });
    const acc = await seller.call("otc_accept_offer", { bidId: listing.bidId, offerId: bid.offerId, fundingMinutes: 60, payoutAddress: payout, ghost: true });
    assert.ok(acc.ghostWallet);
    assert.equal(acc.terms.seller, acc.ghostWallet, "buyer only ever sees the one-time wallet");

    const early = await seller.call("otc_deposit", { bidId: listing.bidId }); // funds the one-time wallet, waits for buyer
    assert.equal(early.done, false);
    await buyer.call("otc_deposit", { offerId: bid.offerId });
    const relayed = await seller.call("otc_deposit", { bidId: listing.bidId });
    assert.equal(relayed.done, true);

    assert.equal((await buyer.call("otc_deal_status", { offerId: bid.offerId })).status, "settled");
    assert.equal(await pc.getBalance({ address: acc.ghostWallet }), 0n);
    assert.equal(await pc.getBalance({ address: payout }), 8n * 10n ** 17n - 2n * 10n ** 16n - 10n ** 14n); // 0.8 - 2.5% - relayer fee
  });

  it("USD-sized bid: sellers name the token amount, the deal settles", async () => {
    const buyer = await agentClient(KEYS.buyer);
    const seller = await agentClient(KEYS.seller);
    const buyerAddr = privateKeyToAccount(KEYS.buyer).address;
    const payout = privateKeyToAccount(generatePrivateKey()).address;
    const before = await bal(stock, buyerAddr);

    const bid = await buyer.call("otc_create_bid", { token: stock, sizeUsd: 1000, payWith: "USDG", replyMinutes: 15 });
    assert.equal(bid.sizeUsd, 1000);
    assert.equal(bid.amount, null);
    // refused before reaching the backend: the MCP input schema enforces the $5 minimum
    await assert.rejects(buyer.call("otc_create_bid", { token: stock, sizeUsd: 2, payWith: "USDG", replyMinutes: 15 }));

    await assert.rejects(seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "1000" }), /sized in USD/);
    const off = await seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "1000", amount: "4", payoutAddress: payout });

    const [o] = await buyer.call("otc_get_offers", { bidId: bid.bidId });
    assert.equal(o.amount, "4");
    assert.equal(o.unitPrice, 250);
    assert.equal(o.verified, true, "signature covers the seller's own amount");

    await buyer.call("otc_accept_offer", { bidId: bid.bidId, offerId: off.offerId, fundingMinutes: 30 });

    // payment locks first: the seller can't put tokens in before the buyer has paid
    const sellerBal = await bal(stock, privateKeyToAccount(KEYS.seller).address);
    const early = await seller.call("otc_deposit", { offerId: off.offerId });
    assert.equal(early.done, false);
    assert.match(early.message, /Payment locks first/);
    assert.equal(await bal(stock, privateKeyToAccount(KEYS.seller).address), sellerBal, "no tokens moved");

    await buyer.call("otc_deposit", { bidId: bid.bidId });
    await seller.call("otc_deposit", { offerId: off.offerId });
    assert.equal((await buyer.call("otc_deal_status", { bidId: bid.bidId })).status, "settled");
    assert.equal((await bal(stock, buyerAddr)) - before, 4n * 10n ** 18n);
  });

  it("hostile answers: malformed ones are skipped, forged ones are flagged and refused", async () => {
    const seller = await agentClient(KEYS.seller);
    const buyer = await agentClient(KEYS.buyer);
    const whale = privateKeyToAccount(KEYS.deployer).address; // someone the attacker pretends to be

    const listing = await seller.call("otc_create_listing", { token: stock, amount: "7", payWith: "USDG", replyMinutes: 15 });
    const pub = (await (await fetch(`${apiUrl}/rfqs/${listing.bidId}`)).json()) as { encPubKey: string; amount: string };
    const sealRaw = async (payload: unknown) => {
      const eph = nacl.box.keyPair();
      const nonce = nacl.randomBytes(24);
      const box = nacl.box(new TextEncoder().encode(JSON.stringify(payload)), nonce, new Uint8Array(Buffer.from(pub.encPubKey, "base64")), eph.secretKey);
      const res = await fetch(`${apiUrl}/rfqs/${listing.bidId}/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sellerEncPubKey: Buffer.from(eph.publicKey).toString("base64"), nonce: Buffer.from(nonce).toString("base64"), ciphertext: Buffer.from(box).toString("base64") }),
      });
      return ((await res.json()) as { quoteId: string }).quoteId;
    };

    // 1. junk that used to crash reading: bad numbers, bad address, not even JSON-shaped
    await sealRaw({ amount: pub.amount, price: "not-a-number", buyer: whale });
    await sealRaw({ amount: pub.amount, price: "1", buyer: "0xnope" });
    await sealRaw(["array", "instead", "of", "object"]);
    // 2. forged: a huge bid "from" the whale, but signed by nobody
    const forged = await sealRaw({ amount: pub.amount, price: "999999000000", buyer: whale, sig: "0x1234" });
    // 3. honest bid, signed by its own wallet
    const honest = await buyer.call("otc_send_offer", { bidId: listing.bidId, totalPrice: "1700" });

    const answers = await seller.call("otc_get_offers", { bidId: listing.bidId });
    assert.equal(answers.length, 2, "junk answers are dropped instead of breaking the list");
    assert.equal(answers[0].offerId, honest.offerId, "verified answers come first, even below a bigger forged one");
    assert.equal(answers[0].verified, true);
    assert.equal(answers[0].hasFunds, true);
    assert.equal(answers[1].offerId, forged);
    assert.equal(answers[1].verified, false);
    assert.equal(answers[1].hasFunds, false, "the whale holds no USDG here");

    await assert.rejects(
      seller.call("otc_accept_offer", { bidId: listing.bidId, offerId: forged, fundingMinutes: 30 }),
      /isn't signed by the wallet it names/,
    );
    // the honest one goes through
    await seller.call("otc_accept_offer", { bidId: listing.bidId, offerId: honest.offerId, fundingMinutes: 30 });
  });

  it("without a wallet key, deposit returns unsigned transactions", async () => {
    const buyer = await agentClient(); // no key
    const seller = await agentClient(KEYS.seller);
    const buyerAddr = privateKeyToAccount(KEYS.buyer).address;

    const bid = await buyer.call("otc_create_bid", { token: stock, amount: "1", payWith: "USDG", replyMinutes: 15 });
    const off = await seller.call("otc_send_offer", { bidId: bid.bidId, totalPrice: "250" });
    await buyer.call("otc_accept_offer", { bidId: bid.bidId, offerId: off.offerId, fundingMinutes: 30, buyer: buyerAddr });
    const dep = await buyer.call("otc_deposit", { bidId: bid.bidId });
    assert.equal(dep.signed, false);
    assert.equal(dep.from, buyerAddr);
    assert.equal(dep.transactions.length, 2);
    assert.equal(dep.transactions[0].to, usdg);
    assert.equal(dep.transactions[1].to, escrow);
    assert.match(dep.transactions[1].data, /^0x/);
  });

  it("the bundled SDK file served by the backend works on its own", async (t) => {
    const res = await fetch(`${apiUrl}/sdk/obsyn.mjs`);
    if (res.status === 404) return t.skip("SDK not built (npm run build:sdk)");
    const url = `data:text/javascript;base64,${Buffer.from(await res.text()).toString("base64")}`;
    const { Obsyn } = await import(url);
    const buyer = new Obsyn({ apiUrl, privateKey: KEYS.buyer });
    const bid = await buyer.createBid({ token: stock, amount: "3", payWith: "ETH", replyMinutes: 15 });
    const seller = new Obsyn({ apiUrl, privateKey: KEYS.seller });
    const off = await seller.sendOffer({ bidId: bid.bidId, totalPrice: "0.5" });
    const offers = await buyer.getOffers(bid.bidId);
    assert.equal(offers[0].offerId, off.offerId);
    assert.equal(offers[0].totalPrice, "0.5");
  });

  it("refuses unknown bids and reports errors as tool errors", async () => {
    const a = await agentClient(KEYS.buyer);
    await assert.rejects(a.call("otc_get_offers", { bidId: "nope" }), /wasn't created by this agent/);
  });
});
