/**
 * The autopilot trades by rules against the real backend and a real escrow on anvil:
 * it answers a matching bid, deposits after the buyer pays, respects its caps, and does nothing
 * in a dry run. Config validation runs without anvil. Skips the chain part when anvil or the
 * forge build output is missing.
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
import { Autopilot, validateConfig, type AutopilotConfig, type MarketQuote } from "../src/sdk/autopilot.ts";
import { OtcAgent } from "../src/sdk/client.ts";
import { FileStore } from "../src/sdk/file-store.ts";
import { createRelayer } from "../src/relayer.ts";

describe("autopilot config", () => {
  const ok: AutopilotConfig = { rules: [{ side: "sell", token: "0x1111111111111111111111111111111111111111", maxTotal: "100", maxPerDeal: "50", priceVsMarketPct: 5 }] };
  it("accepts a sane config", () => assert.deepEqual(validateConfig(ok), []));
  it("refuses configs that would hurt the owner", () => {
    const bad = (r: Record<string, unknown>) => validateConfig({ rules: [{ ...ok.rules[0], ...r }] });
    assert.match(bad({ priceVsMarketPct: -30 }).join(" "), /under market looks like a mistake/);
    assert.match(validateConfig({ rules: [{ ...ok.rules[0], side: "buy", priceVsMarketPct: 30 }] }).join(" "), /over market looks like a mistake/);
    assert.match(bad({ maxPerDeal: "500" }).join(" "), /maxPerDeal can't exceed maxTotal/);
    assert.match(bad({ token: "TSLA" }).join(" "), /contract address/);
    assert.match(bad({ maxTotal: "-1" }).join(" "), /positive number/);
    assert.match(bad({ slippage: 3 }).join(" "), /unknown field/);
    assert.match(validateConfig({ ...ok, live: "yes" }).join(" "), /live must be true or false/);
    assert.match(validateConfig({ ...ok, intervalSec: 1 }).join(" "), /at least 10/);
    assert.deepEqual(validateConfig({ rules: [] }), ["rules must be a non-empty list"]);
  });
});

const OUT = new URL("../../contracts/out/", import.meta.url);
const PORT = 8544; // each e2e file runs in parallel with its own anvil: relayer 8546, mcp 8547
const RPC = `http://127.0.0.1:${PORT}`;
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buyer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  seller: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const satisfies Record<string, Hex>;
const canRun = existsSync(new URL("OtcEscrow.sol/OtcEscrow.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;

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
const agent = (key: Hex) => new OtcAgent({ apiUrl, privateKey: key, store: new FileStore(join(mkdtempSync(join(tmpdir(), "ap-")), "state.json")) });

function pilot(a: OtcAgent, cfg: AutopilotConfig, quote: () => Promise<MarketQuote>) {
  return new Autopilot(a, cfg, {
    api: (path) => a.get(path),
    quote,
    balanceOf: (asset, who) => a.balanceOf(asset, who),
    decimals: (t) => a.decimalsOf(t),
    usdg,
  });
}

describe("autopilot on a real escrow", { skip: !canRun && "anvil or forge build output missing" }, () => {
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
    const feed = await deploy("Mocks.sol", "MockFeed", []);
    const block = await pc.getBlock();
    await pc.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: feed, abi: mock, functionName: "set", args: [3_000n * 10n ** 8n, block.timestamp] }) });
    const escrow = await deploy("OtcEscrow.sol", "OtcEscrow", [usdg, feed, privateKeyToAccount(generatePrivateKey()).address]);
    for (const [t, to, amt] of [
      [usdg, privateKeyToAccount(KEYS.buyer).address, 1_000_000n * 10n ** 6n],
      [stock, privateKeyToAccount(KEYS.seller).address, 10_000n * 10n ** 18n],
    ] as const) {
      await pc.waitForTransactionReceipt({ hash: await deployer.writeContract({ address: t, abi: mock, functionName: "mint", args: [to, amt] }) });
    }
    const cfg = loadConfig({ CHAIN_ID: String(foundry.id), RPC_URL: RPC, ESCROW_ADDRESS: escrow, USDG_ADDRESS: usdg });
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

  it("answers a matching bid at its price, deposits after the buyer pays, and stops at its cap", async () => {
    const buyer = agent(KEYS.buyer);
    const seller = agent(KEYS.seller);
    const quote = async () => ({ usd: 200, ethUsd: 3000 });
    const rules: AutopilotConfig = { live: true, rules: [{ side: "sell", token: stock, payWith: "USDG", maxTotal: "150", maxPerDeal: "100", priceVsMarketPct: 5 }] };
    const ap = pilot(seller, rules, quote);

    const bid = await buyer.createBid({ token: stock, amount: "100", payWith: "USDG", replyMinutes: 60 });
    const t1 = await ap.tick();
    assert.equal(t1.actions.length, 1, JSON.stringify(t1));
    assert.match(t1.actions[0], /^sent offer 100 for 21000\.000000 USDG \(\+5% vs market\)/);

    // the buyer sees a verified answer at 210 USDG a token, accepts and pays
    const offers = (await buyer.getOffers(bid.bidId)) as any[];
    assert.equal(offers.length, 1);
    assert.equal(offers[0].verified, true);
    assert.equal(offers[0].totalPrice, "21000");
    assert.equal(offers[0].unitPrice, 210);
    await buyer.acceptOffer({ bidId: bid.bidId, offerId: offers[0].offerId, fundingMinutes: 60 });
    const sellerUsdg0 = await bal(usdg, privateKeyToAccount(KEYS.seller).address);
    await buyer.deposit({ bidId: bid.bidId });

    // next tick: the autopilot sees the payment locked and deposits its tokens, which settles the deal
    const t2 = await ap.tick();
    assert.ok(t2.actions.some((a) => /^deposited as seller/.test(a)), JSON.stringify(t2));
    assert.equal(await bal(stock, privateKeyToAccount(KEYS.buyer).address), 100n * 10n ** 18n);
    const got = (await bal(usdg, privateKeyToAccount(KEYS.seller).address)) - sellerUsdg0;
    assert.ok(got > 20_000n * 10n ** 6n && got < 21_000n * 10n ** 6n, `seller received ${got} (21000 USDG minus the fee)`);

    const t3 = await ap.tick();
    assert.ok(t3.actions.some((a) => /settled/.test(a)), JSON.stringify(t3));
    assert.deepEqual(t3.totals[0], { rule: 1, side: "sell", token: stock, done: "100", pending: "0", left: "50" });

    // a second 100-token block is over what's left (50) and isn't partial: skipped, nothing sent
    const bid2 = await buyer.createBid({ token: stock, amount: "100", payWith: "USDG", replyMinutes: 60 });
    const t4 = await ap.tick();
    assert.ok(t4.skipped.some((s) => s.includes(bid2.bidId) && /over this rule's limit/.test(s)), JSON.stringify(t4));
    assert.equal(((await buyer.getOffers(bid2.bidId)) as any[]).length, 0);
  });

  it("does nothing in a dry run, without a reference price, or under its floor", async () => {
    const buyer = agent(KEYS.buyer);
    const seller = agent(KEYS.seller);
    const bid = await buyer.createBid({ token: stock, amount: "10", payWith: "USDG", replyMinutes: 60 });
    const rule = { side: "sell" as const, token: stock, maxTotal: "1000", maxPerDeal: "10", priceVsMarketPct: 0 };

    const dry = await pilot(seller, { rules: [rule] }, async () => ({ usd: 200, ethUsd: 3000 })).tick();
    assert.ok(dry.actions.some((a) => a.startsWith("[dry run] would offer 10 for 2000.000000 USDG")), JSON.stringify(dry));
    assert.equal(((await buyer.getOffers(bid.bidId)) as any[]).length, 0, "a dry run sends nothing");

    const noPrice = await pilot(seller, { live: true, rules: [rule] }, async () => ({ usd: null, ethUsd: null })).tick();
    assert.ok(noPrice.skipped.some((s) => /no reference price/.test(s)));
    const floor = await pilot(seller, { live: true, rules: [{ ...rule, minPriceUsd: 250 }] }, async () => ({ usd: 200, ethUsd: 3000 })).tick();
    assert.ok(floor.skipped.some((s) => /under the floor/.test(s)));
    assert.equal(((await buyer.getOffers(bid.bidId)) as any[]).length, 0, "nothing sent without a price or under the floor");
  });
});
