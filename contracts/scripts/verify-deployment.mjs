#!/usr/bin/env node
// Check that the contracts live on Robinhood Chain are exactly this repo's source, and print their settings.
//
//   cd contracts && forge build && node scripts/verify-deployment.mjs
//   RPC_URL=https://your-rpc node scripts/verify-deployment.mjs     # if the default RPC is blocked where you are
//
// How: fetch the runtime bytecode at each address, blank out the immutable slots (values set at deploy time,
// such as the USDG address), and compare it byte for byte with the bytecode `forge build` produced here.
// Needs only Node 18+ (built-in fetch) and the build output in ./out. No dependencies.
import { readFileSync } from "node:fs";

const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const DEPLOYMENTS = JSON.parse(readFileSync(new URL("../../deployments/robinhood-4663.json", import.meta.url), "utf8"));

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const call = (to, selector) => rpc("eth_call", [{ to, data: selector }, "latest"]);
const word = (hex) => hex.slice(2).padStart(64, "0").slice(0, 64);
const asAddr = (hex) => "0x" + word(hex).slice(24);
const asUint = (hex) => BigInt("0x" + word(hex)).toString();

function artifact(name) {
  const path = new URL(`../out/${name}.sol/${name}.json`, import.meta.url);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Missing ${path.pathname}. Run \`forge build\` in contracts/ first.`);
  }
}

function sameCode(onchain, art) {
  const local = art.deployedBytecode.object.toLowerCase();
  const live = onchain.toLowerCase();
  if (local.length !== live.length) return false;
  const a = local.split("");
  const b = live.split("");
  for (const refs of Object.values(art.deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of refs) {
      for (let k = 0; k < length * 2; k++) a[2 + start * 2 + k] = b[2 + start * 2 + k] = "0";
    }
  }
  return a.join("") === b.join("");
}

const SETTINGS = {
  OtcEscrow: [
    ["usdg()", "0xf5b91b7b", asAddr],
    ["feeRecipient()", "0x46904840", asAddr],
    ["ethUsdFeed()", "0x8009b7bd", asAddr],
    ["MAX_FEE_BPS()", "0xd55be8c6", asUint],
    ["FEE_BPS_SMALL() under $10k", "0x381707cf", asUint],
    ["FEE_BPS_MID() from $10k", "0x9a8f74a8", asUint],
    ["FEE_BPS_LARGE() from $100k", "0x5141c04c", asUint],
  ],
  OtcEscrowV2: [
    ["usdg()", "0xf5b91b7b", asAddr],
    ["feeRecipient()", "0x46904840", asAddr],
    ["ethUsdFeed()", "0x8009b7bd", asAddr],
    ["burnToken() paid in, fee burned", "0xfaa0a264", asAddr],
    ["BURN_TOKEN_FEE_BPS()", "0xdb9ca7f5", asUint],
    ["MAX_FEE_BPS()", "0xd55be8c6", asUint],
  ],
  BurnKeeper: [
    ["vault()", "0xfbfa77cf", asAddr],
    ["route() V4 burn route", "0xd96661ef", asAddr],
    ["bandBps()", "0xe163ef68", asUint],
    ["feeAllowanceBps()", "0x26ecb947", asUint],
    ["maxEthPerBurn() wei", "0xfcf30f13", asUint],
    ["maxUsdgPerBurn() base units", "0x55a396e0", asUint],
    ["cooldown() seconds", "0x787a08a6", asUint],
  ],
  ObsynTimelock: [
    ["getMinDelay() seconds", "0xf27a0c92", asUint],
  ],
  BuyBurnVault: [
    ["owner()", "0x8da5cb5b", asAddr],
    ["keeper()", "0xaced1661", asAddr],
    ["usdg()", "0xf5b91b7b", asAddr],
    ["token() platform token", "0xfc0c546a", asAddr],
    ["adapter() swap route", "0x03eadcfc", asAddr],
    ["pendingAdapter()", "0x5a8f520d", asAddr],
    ["ADAPTER_DELAY() seconds", "0x50807bd7", asUint],
    ["totalBurned()", "0xd89135cd", asUint],
  ],
};

const chainId = parseInt(await rpc("eth_chainId", []), 16);
console.log(`RPC ${RPC} · chain id ${chainId}`);
if (chainId !== DEPLOYMENTS.chainId) throw new Error(`expected chain ${DEPLOYMENTS.chainId}`);

let ok = true;
for (const c of DEPLOYMENTS.contracts) {
  const code = await rpc("eth_getCode", [c.address, "latest"]);
  const match = code !== "0x" && sameCode(code, artifact(c.name));
  ok &&= match;
  console.log(`\n${c.name} ${c.address}`);
  console.log(`  bytecode ${match ? "MATCHES this repo's source" : "DOES NOT MATCH"}`);
  for (const [label, sel, fmt] of SETTINGS[c.name] ?? []) console.log(`  ${label.padEnd(30)} ${fmt(await call(c.address, sel))}`);
}
console.log(ok ? "\nAll deployed contracts match the source in this repository." : "\nMismatch found. Do not trust these addresses.");
process.exit(ok ? 0 : 1);
