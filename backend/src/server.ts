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
import { blockscoutScheduled, readControl } from "./control.ts";
import { getAddress } from "viem";

try {
  process.loadEnvFile();
} catch {
  // no .env file: fall back to the real environment
}

const cfg = loadConfig();
const { publicClient } = clients(cfg);
const api = createApp({
  cfg,
  db: openDb(cfg.dbPath),
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
      scheduledIds: blockscoutScheduled(process.env.EXPLORER_API ?? "https://robinhoodchain.blockscout.com"),
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
