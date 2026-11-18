/**
 * Paying in $OBSYN, end to end on a real OtcEscrowV2 (anvil): the API takes an OBSYN-paid bid,
 * the SDK autopilot prices its offer in OBSYN, both sides deposit through the SDK, and the escrow
 * burns its 1.5% fee to the dead address while the seller gets the rest. Ghost mode is refused.
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { createRelayer } from "../src/relayer.ts";
import { Autopilot } from "../src/sdk/autopilot.ts";
import { OtcAgent } from "../src/sdk/client.ts";
import { FileStore } from "../src/sdk/file-store.ts";

const OUT = new URL("../../contracts/out/", import.meta.url);
const PORT = 8543; // relayer 8546, mcp 8547, autopilot 8544
const RPC = `http://127.0.0.1:${PORT}`;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buyer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  seller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  relayer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const satisfies Record<string, Hex>;
const canRun = existsSync(new URL("OtcEscrowV2.sol/OtcEscrowV2.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;

let anvil: ChildProcess | undefined;
let http_: ServerType | undefined;
let apiUrl = "";
let usdg: Address;
let stock: Address;
let obsyn: Address;
let vault: Address;
const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};
const bal = (t: Address, who: Address) => pc.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const agent = (key: Hex) => new OtcAgent({ apiUrl, privateKey: key, store: new FileStore(join(mkdtempSync(join(tmpdir(), "obp-")), "state.json")) });
const addr = (k: Hex) => privateKeyToAccount(k).address;

describe("paying in $OBSYN on a real OtcEscrowV2", { skip: !canRun && "anvil or forge build output missing" }, () => {
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
    const mock = parseAbi(["function mint(address,uint256)", "function set(int256,uint256)"]);
    usdg = await deploy("Mocks.sol", "MockToken", ["Global Dollar", "USDG", 6]);
    stock = await deploy("Mocks.sol", "MockToken", ["Tesla xStock", "TSLAx", 18]);
    obsyn = await deploy("Mocks.sol", "MockToken", ["Obsyn", "OBSYN", 18]);
    vault = privateKeyToAccount(generatePrivateKey()).address;
    // no ETH/USD feed, like production (holder discount and USD tiers off)
    const escrow = await deploy("OtcEscrowV2.sol", "OtcEscrowV2", [usdg, "0x0000000000000000000000000000000000000000", vault, obsyn]);
    for (const [t, to, amt] of [
      [obsyn, addr(KEYS.buyer), 100_000_000n * 10n ** 18n],
      [stock, addr(KEYS.seller), 10_000n * 10n ** 18n],
    ] as const) {
      await pc.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: t, abi: mock, functionName: "mint", args: [to, amt] }) });
    }
    const cfg = loadConfig({
      CHAIN_ID: String(foundry.id),
      RPC_URL: RPC,
      ESCROW_ADDRESS: escrow,
      USDG_ADDRESS: usdg,
      ESCROW_BURN_TOKEN: obsyn,
      RELAYER_PRIVATE_KEY: KEYS.relayer,
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

  it("settles an OBSYN-paid deal and burns the 1.5% fee", async () => {
    const buyer = agent(KEYS.buyer);
    const seller = agent(KEYS.seller);
    const health = await buyer.config();
    assert.deepEqual(
      health.payTokens?.map((p) => p.symbol),
      ["ETH", "USDG", "OBSYN"],
    );

    // TSLAx at $200, OBSYN at $0.002: 100 TSLAx = $20,000 = 10,000,000 OBSYN
    const quote = async (t: Address) => (getAddress(t) === obsyn ? { usd: 0.002, ethUsd: 3000 } : { usd: 200, ethUsd: 3000 });
    const ap = new Autopilot(
      seller,
      { live: true, rules: [{ side: "sell", token: stock, payWith: "OBSYN", maxTotal: "100", maxPerDeal: "100", priceVsMarketPct: 0 }] },
      {
        api: (p) => seller.get(p),
        quote,
        balanceOf: (a, w) => seller.balanceOf(a, w),
        decimals: (t) => seller.decimalsOf(t),
        usdg,
        burnToken: health.payTokens!.find((p) => p.symbol === "OBSYN")!.address,
      },
    );

    const bid = await buyer.createBid({ token: stock, amount: "100", payWith: "OBSYN", replyMinutes: 60 });
    const t1 = await ap.tick();
    assert.equal(t1.actions.length, 1, JSON.stringify(t1));
    assert.match(t1.actions[0], /^sent offer 100 for 10000000\.000000 OBSYN/);

    const offers = (await buyer.getOffers(bid.bidId)) as any[];
    assert.equal(offers[0].payWith, "OBSYN");
    assert.equal(offers[0].totalPrice, "10000000");
    await buyer.acceptOffer({ bidId: bid.bidId, offerId: offers[0].offerId, fundingMinutes: 60 });
    await buyer.deposit({ bidId: bid.bidId }); // approves OBSYN, then deposits

    const dead0 = await bal(obsyn, DEAD);
    const seller0 = await bal(obsyn, addr(KEYS.seller));
    const t2 = await ap.tick();
    assert.ok(t2.actions.some((a) => /^deposited as seller/.test(a)), JSON.stringify(t2));

    const price = 10_000_000n * 10n ** 18n;
    const fee = (price * 150n) / 10_000n; // 150,000 OBSYN
    assert.equal(await bal(stock, addr(KEYS.buyer)), 100n * 10n ** 18n, "buyer got the stock");
    assert.equal((await bal(obsyn, DEAD)) - dead0, fee, "the fee was burned at the dead address");
    assert.equal((await bal(obsyn, addr(KEYS.seller))) - seller0, price - fee, "the seller got the rest");
    assert.equal(await bal(obsyn, vault), 0n, "nothing went to the fee vault");
  });

  it("refuses ghost mode on OBSYN-paid deals", async () => {
    const buyer = agent(KEYS.buyer);
    const seller = agent(KEYS.seller);
    const bid = await buyer.createBid({ token: stock, amount: "10", payWith: "OBSYN", replyMinutes: 60 });
    await assert.rejects(seller.sendOffer({ bidId: bid.bidId, totalPrice: "1000000", ghost: true }), /only available for deals paid in ETH or USDG/);
  });
});
