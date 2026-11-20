import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { clients } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { readPrice, readTokenInfo } from "./price.ts";
import { readReceipt } from "./receipt.ts";
import { createRelayer } from "./relayer.ts";
import { createSite } from "./site.ts";
import { chainStats } from "./stats.ts";
import { OtcEscrowAbi } from "./abi/OtcEscrow.ts";
import { blockscoutScheduled, firstScheduled, readControl, rpcScheduled, type ScanStore } from "./control.ts";
import { createPublicClient, getAddress, http } from "viem";
import { robinhoodChain } from "./chain.ts";

try {
  process.loadEnvFile();
} catch {
  // no .env file: fall back to the real environment
}

const cfg = loadConfig();
const { publicClient } = clients(cfg);

const db = openDb(cfg.dbPath);

/**
 * Timelock queue: the explorer's log API, else CallScheduled logs read from RPC nodes in 1,000-block ranges,
 * with the scan position kept in the database. The scan starts at the vault handover (block 118670637):
 * only the Safe can schedule, and none of its earlier transactions (nonces 0-4) touched the timelock.
 */
const TIMELOCK = getAddress(process.env.TIMELOCK_ADDRESS ?? "0x49c6f104b0BdD7353e68d70951f6E22fc1e3Cd16");
const TIMELOCK_SCAN_FROM = BigInt(process.env.TIMELOCK_SCAN_FROM ?? "118670000");
db.exec("CREATE TABLE IF NOT EXISTS scan_state (key TEXT PRIMARY KEY, json TEXT NOT NULL)");
const scanGet = db.prepare("SELECT json FROM scan_state WHERE key = ?");
const scanPut = db.prepare("INSERT INTO scan_state (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json");
const scanStore: ScanStore = {
  get: (k) => {
    const row = scanGet.get(`timelock:${k}`) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  },
  set: (k, v) => void scanPut.run(`timelock:${k}`, JSON.stringify(v)),
};
const logNodes = [...new Set(["https://4663.rpc.thirdweb.com", cfg.rpcUrl])].map((u) => createPublicClient({ chain: robinhoodChain(cfg), transport: http(u, { timeout: 20_000 }) }));
const rpcQueue = rpcScheduled(cfg.chainId === 4663 ? logNodes : [publicClient], TIMELOCK_SCAN_FROM, { store: scanStore });
const scheduledReader = firstScheduled(blockscoutScheduled(process.env.EXPLORER_API ?? "https://robinhoodchain.blockscout.com"), rpcQueue);
// keep the scan caught up with the chain even when nobody is looking (about one RPC call per tick)
if (cfg.chainId === 4663) {
  const tick = () => rpcQueue(TIMELOCK).catch(() => {});
  tick();
  setInterval(tick, 30_000).unref();
}

const api = createApp({
  cfg,
  db,
  relayer: createRelayer(cfg),
  readPrice: (token, src) => readPrice(publicClient, token, src),
  readToken: (token) => readTokenInfo(publicClient, token),
  readReceipt: cfg.escrow ? (tx) => readReceipt(publicClient, [cfg.escrow!, ...(cfg.escrowLegacy ? [cfg.escrowLegacy] : [])], tx) : undefined,
  readDeal: async (escrow, id) => {
    const [status, buyerFunded, sellerFunded] = await publicClient.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [id] });
    return { status: Number(status), buyerFunded, sellerFunded };
  },
  controlReader: () =>
    readControl({
      client: publicClient,
      vault: getAddress(process.env.FEE_VAULT_ADDRESS ?? "0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221"),
      escrow: cfg.escrow,
      escrowLegacy: cfg.escrowLegacy ?? null,
      token: cfg.platformToken?.address ?? null,
      // the vault Safe's signers held by the team; shown as such on the Security page
      teamSigners: (process.env.TEAM_SIGNERS ?? "0x533452c0e3C3455D33d551964F14D352597b21e1,0xD3b32872b311c29A0DBBbbbc76fE5871Cb0b994A,0x9743307CebE092eea55756A2526EeB24Ddd4bA86")
        .split(",")
        .map((a) => getAddress(a.trim())),
      scheduledIds: scheduledReader,
      now: () => Math.floor(Date.now() / 1000),
    }),
  statsChain: cfg.escrow ? chainStats(publicClient, cfg.escrow, cfg.platformToken?.address ?? null, cfg.escrowLegacy ?? null) : undefined,
});
const site = createSite(api, process.env.WEB_DIST ?? fileURLToPath(new URL("../../web/dist", import.meta.url)), cfg.publicUrl, {
  tokenAddress: cfg.platformToken?.address ?? null,
});

if (cfg.relayerKeyProblem) console.warn(cfg.relayerKeyProblem);
if (!cfg.escrow) console.warn("ESCROW_ADDRESS not set: accepted deals will have no escrow address, relayer disabled");

const server = serve({ fetch: site.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Obsyn on port ${info.port} (chain ${cfg.chainId}); API at /api`);
});

// Railway sends SIGTERM on redeploy: finish in-flight requests, then exit.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
