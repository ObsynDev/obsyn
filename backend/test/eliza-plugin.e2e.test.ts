/**
 * The elizaOS plugin, end to end on a real escrow (anvil): an Eliza agent posts a bid through the plugin's
 * actions, a seller answers with the SDK, the agent reads and accepts the offer, deposits, and the deal
 * settles. Also checks the OBSYN_MAX_USD cap and that bad input becomes a reply, not a crash.
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
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, parseAbi, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { createRelayer } from "../src/relayer.ts";
import { OtcAgent } from "../src/sdk/client.ts";
import { FileStore } from "../src/sdk/file-store.ts";
import { acceptOffer, dealStatus, deposit, getOffers, listBlocks, obsynPlugin, postBlock } from "../../packages/plugin-obsyn/src/index.ts";

const OUT = new URL("../../contracts/out/", import.meta.url);
const PORT = 8542;
const RPC = `http://127.0.0.1:${PORT}`;
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buyer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  seller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const satisfies Record<string, Hex>;
const canRun = existsSync(new URL("OtcEscrowV2.sol/OtcEscrowV2.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;

let anvil: ChildProcess | undefined;
let http_: ServerType | undefined;
let apiUrl = "";
let usdg: Address;
let stock: Address;
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const bal = (t: Address, who: Address) => pc.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/** The slice of IAgentRuntime the plugin uses: settings. */
function runtime(settings: Record<string, string>) {
  return { getSetting: (k: string) => settings[k] ?? null } as never;
}
async function act(a: { handler: (...args: never[]) => Promise<unknown> }, rt: unknown, parameters: Record<string, unknown>) {
  const said: string[] = [];
  const res = (await (a.handler as (...args: unknown[]) => Promise<{ success: boolean; text: string; data?: any }>)(rt, {}, undefined, { parameters }, async (c: { text: string }) => {
    said.push(c.text);
    return [];
  })) as { success: boolean; text: string; data?: any };
  assert.equal(said[0], res.text, "the callback gets the same text the action returns");
  return res;
}

describe("elizaOS plugin on a real escrow", { skip: !canRun && "anvil or forge build output missing" }, () => {
  before(async () => {
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
    const mock = parseAbi(["function mint(address,uint256)"]);
    usdg = await deploy("Mocks.sol", "MockToken", ["Global Dollar", "USDG", 6]);
    stock = await deploy("Mocks.sol", "MockToken", ["NVIDIA", "NVDA", 18]);
    const obsyn = await deploy("Mocks.sol", "MockToken", ["Obsyn", "OBSYN", 18]);
    const vault = privateKeyToAccount(KEYS.deployer).address;
    const escrow = await deploy("OtcEscrowV2.sol", "OtcEscrowV2", [usdg, "0x0000000000000000000000000000000000000000", vault, obsyn]);
    for (const [t, to, amt] of [
      [usdg, privateKeyToAccount(KEYS.buyer).address, 1_000_000n * 10n ** 6n],
      [stock, privateKeyToAccount(KEYS.seller).address, 10_000n * 10n ** 18n],
    ] as const) {
      await pc.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: t, abi: mock, functionName: "mint", args: [to, amt] }) });
    }
    const cfg = loadConfig({ CHAIN_ID: String(foundry.id), RPC_URL: RPC, ESCROW_ADDRESS: escrow, USDG_ADDRESS: usdg, ESCROW_BURN_TOKEN: obsyn });
    const app = createApp({
      cfg,
      db: openDb(":memory:"),
      relayer: createRelayer(cfg),
      readPrice: async () => Promise.reject(new Error("n/a")),
      // NVDA at $180 for the agent's cap check
      tokenMarket: async (a) => ({ address: a, symbol: null, name: null, priceUsd: a === stock ? 180 : null, marketCap: null, liquidityUsd: null, change24h: null, volume24h: null, imageUrl: null, pairUrl: null, pools: 0 }),
      refQuote: async () => Promise.reject(new Error("no reference prices in this test")),
    });
    await new Promise<void>((resolve) => {
      http_ = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
        apiUrl = `http://127.0.0.1:${info.port}/`.replace(/\/$/, "");
        resolve();
      });
    });
  });

  after(() => {
    http_?.close();
    anvil?.kill();
  });

  it("posts, reads offers, accepts, deposits and settles through the plugin's actions", async () => {
    const eliza = runtime({ OBSYN_API: apiUrl, OBSYN_PRIVATE_KEY: KEYS.buyer, OBSYN_STATE: join(mkdtempSync(join(tmpdir(), "eliza-")), "state.json"), OBSYN_MAX_USD: "5000" });
    const seller = new OtcAgent({ apiUrl, privateKey: KEYS.seller, store: new FileStore(join(mkdtempSync(join(tmpdir(), "sel-")), "s.json")) });

    assert.equal(obsynPlugin.actions?.length, 7);

    const posted = await act(postBlock, eliza, { side: "buy", token: stock, amount: "10", payWith: "USDG", replyMinutes: 60 });
    assert.equal(posted.success, true, posted.text);
    const bidId = posted.data.bidId as string;
    assert.match(posted.text, /Bid to buy 10 NVDA posted on Obsyn, paid in USDG/);

    const listed = await act(listBlocks, eliza, {});
    assert.match(listed.text, new RegExp(`BUY 10 NVDA for USDG .* id ${bidId}`));

    const sent = (await seller.sendOffer({ bidId, totalPrice: "1750" })) as { offerId: string };
    const offers = await act(getOffers, eliza, { bidId });
    assert.match(offers.text, /10 for 1750 USDG .* signed by its wallet .* funds checked/);
    const offerId = offers.data.offers[0].offerId as string;

    const accepted = await act(acceptOffer, eliza, { bidId, offerId, fundingMinutes: 60 });
    assert.equal(accepted.success, true, accepted.text);

    const buyerNvda0 = await bal(stock, privateKeyToAccount(KEYS.buyer).address);
    const paid = await act(deposit, eliza, { bidId });
    assert.equal(paid.success, true, paid.text);
    const delivered = (await seller.deposit({ offerId: sent.offerId })) as { done?: boolean };
    assert.ok(delivered.done !== false, JSON.stringify(delivered));

    const status = await act(dealStatus, eliza, { bidId });
    assert.match(status.text, /settled/);
    assert.equal((await bal(stock, privateKeyToAccount(KEYS.buyer).address)) - buyerNvda0, 10n * 10n ** 18n, "the agent received 10 NVDA");
  });

  it("refuses a block over OBSYN_MAX_USD, and turns bad input into a reply", async () => {
    const eliza = runtime({ OBSYN_API: apiUrl, OBSYN_STATE: join(mkdtempSync(join(tmpdir(), "eliza-")), "state.json"), OBSYN_MAX_USD: "1000" });
    const big = await act(postBlock, eliza, { side: "buy", token: stock, amount: "10", payWith: "USDG" }); // 10 × $180 = $1,800
    assert.equal(big.success, false);
    assert.match(big.text, /over this agent's cap of \$1,000 \(OBSYN_MAX_USD\)/);
    const usdOver = await act(postBlock, eliza, { side: "buy", token: stock, sizeUsd: 2500 });
    assert.match(usdOver.text, /over this agent's cap/);
    const unknown = await act(postBlock, eliza, { side: "buy", token: "NOPE", sizeUsd: 50 });
    assert.equal(unknown.success, false);
    assert.match(unknown.text, /Unknown token "NOPE"/);
    const badKey = await act(listBlocks, runtime({ OBSYN_API: apiUrl, OBSYN_PRIVATE_KEY: "0x1234" }), {});
    assert.match(badKey.text, /OBSYN_PRIVATE_KEY must be/);
  });
});
