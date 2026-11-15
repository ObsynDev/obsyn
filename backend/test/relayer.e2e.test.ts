/**
 * End-to-end: real OtcEscrow on a local anvil chain, real relayer code, ghost wallet with 0 ETH.
 * Skips when anvil or the forge build output is missing.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, before, it } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { OtcEscrowAbi } from "../src/abi/OtcEscrow.ts";
import { loadConfig } from "../src/config.ts";
import { createRelayer, depositTypedData } from "../src/relayer.ts";
import { readTokenInfo } from "../src/price.ts";
import { dealId, type Terms } from "../src/terms.ts";

const OUT = new URL("../../contracts/out/", import.meta.url);
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
// anvil's well-known dev keys
const DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const RELAYER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};

const canRun = existsSync(new URL("OtcEscrow.sol/OtcEscrow.json", OUT)) && spawnSync("anvil", ["--version"]).status === 0;
let anvil: ChildProcess | undefined;

before(async () => {
  if (!canRun) return;
  anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
  for (let i = 0; i < 50; i++) {
    try {
      await pc.getChainId();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("anvil did not start");
});

after(() => anvil?.kill());

it("relays a gasless ghost deposit that settles the deal", { skip: !canRun && "anvil or forge build output missing" }, async () => {
  const pc = createPublicClient({ chain: foundry, transport: http(RPC) });
  const deployer = createWalletClient({ chain: foundry, account: privateKeyToAccount(DEPLOYER), transport: http(RPC) });
  const buyer = createWalletClient({ chain: foundry, account: privateKeyToAccount(BUYER), transport: http(RPC) });

  const deploy = async (file: string, name: string, args: unknown[]) => {
    const { abi, bytecode } = artifact(file, name);
    const hash = await deployer.deployContract({ abi, bytecode, args });
    return (await pc.waitForTransactionReceipt({ hash })).contractAddress as Address;
  };
  const send = async (hash: Hex) => assert.equal((await pc.waitForTransactionReceipt({ hash })).status, "success");

  const mockAbi = parseAbi([
    "function mint(address,uint256)",
    "function set(int256,uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
  ]);
  const usdg = await deploy("Mocks.sol", "MockToken", ["Global Dollar", "USDG", 6]);
  const stock = await deploy("Mocks.sol", "MockToken", ["Stock", "TSLAx", 18]);
  const feed = await deploy("Mocks.sol", "MockFeed", []);
  const treasury = privateKeyToAccount(generatePrivateKey()).address;
  const escrow = await deploy("OtcEscrow.sol", "OtcEscrow", [usdg, feed, treasury]);

  // token check used to vet addresses (e.g. USDG) before they go into immutable config
  const info = await readTokenInfo(pc as any, usdg);
  assert.equal(info.isContract, true);
  assert.equal(info.symbol, "USDG");
  assert.equal(info.decimals, 6);
  assert.equal(info.permit, true);
  const eoa = await readTokenInfo(pc as any, treasury);
  assert.equal(eoa.isContract, false);
  assert.equal(eoa.symbol, null);

  // ghost wallet: holds the stock tokens, has zero ETH, never sends a transaction
  const ghost = privateKeyToAccount(generatePrivateKey());
  const payout = privateKeyToAccount(generatePrivateKey()).address;
  await send(await deployer.writeContract({ address: stock, abi: mockAbi, functionName: "mint", args: [ghost.address, 100n * 10n ** 18n] }));
  await send(await deployer.writeContract({ address: usdg, abi: mockAbi, functionName: "mint", args: [buyer.account.address, 50_000n * 10n ** 6n] }));

  const block = await pc.getBlock();
  const terms: Terms = {
    buyer: buyer.account.address,
    seller: ghost.address,
    token: stock,
    amount: 100n * 10n ** 18n,
    payToken: usdg,
    price: 20_000n * 10n ** 6n, // $20k → 2% fee
    sellerPayout: payout,
    referrer: "0x0000000000000000000000000000000000000000",
    relayerFee: 2n * 10n ** 6n,
    deadline: block.timestamp + 3600n,
    salt: `0x${"07".repeat(32)}`,
  };

  // buyer funds first
  await send(await buyer.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [escrow, terms.price] }));
  await send(await buyer.writeContract({ address: escrow, abi: OtcEscrowAbi, functionName: "depositPayment", args: [terms] }));

  const cfg = loadConfig({
    CHAIN_ID: String(foundry.id),
    RPC_URL: RPC,
    ESCROW_ADDRESS: escrow,
    USDG_ADDRESS: usdg,
    RELAYER_PRIVATE_KEY: RELAYER,
    RELAYER_MIN_FEE_USDG: "1000000",
  });
  const relayer = createRelayer(cfg);
  const relayerAddr = relayer.info().address!;

  // ghost signs: an EIP-2612 permit + the deposit authorization for this relayer
  const permitDeadline = block.timestamp + 3600n;
  const permitSig = await ghost.signTypedData({
    domain: { name: "Stock", version: "1", chainId: foundry.id, verifyingContract: stock },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: ghost.address, spender: escrow, value: terms.amount, nonce: 0n, deadline: permitDeadline },
  });
  const sellerSig = await ghost.signTypedData(depositTypedData(cfg, escrow, dealId(terms), relayerAddr));

  // a signature for some other relayer is refused before any gas is spent
  const otherSig = await ghost.signTypedData(depositTypedData(cfg, escrow, dealId(terms), treasury));
  await assert.rejects(relayer.relayDeposit(terms, { deadline: 0n, v: 27, r: `0x${"0".repeat(64)}`, s: `0x${"0".repeat(64)}` }, otherSig), /does not authorize/);

  const permit = {
    deadline: permitDeadline,
    r: `0x${permitSig.slice(2, 66)}` as Hex,
    s: `0x${permitSig.slice(66, 130)}` as Hex,
    v: parseInt(permitSig.slice(130, 132), 16),
  };
  const { txHash, dealId: id } = await relayer.relayDeposit(terms, permit, sellerSig);
  await send(txHash);

  const bal = (t: Address, who: Address) => pc.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  assert.equal(await bal(stock, buyer.account.address), terms.amount);
  assert.equal(await bal(usdg, relayerAddr), 2_000_000n); // relayer got paid
  assert.equal(await bal(usdg, treasury), 400_000_000n); // 2%
  assert.equal(await bal(usdg, payout), 20_000_000_000n - 400_000_000n - 2_000_000n);
  assert.equal(await pc.getBalance({ address: ghost.address }), 0n, "ghost wallet never needed ETH");

  const [status] = await pc.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [id] });
  assert.equal(status, 2); // Settled
});
