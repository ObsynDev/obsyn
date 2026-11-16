import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { clients } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { readPrice, readTokenInfo } from "./price.ts";
import { createRelayer } from "./relayer.ts";
import { createSite } from "./site.ts";

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
});
const site = createSite(api, process.env.WEB_DIST ?? fileURLToPath(new URL("../../web/dist", import.meta.url)), cfg.publicUrl);

if (cfg.relayerKeyProblem) console.warn(cfg.relayerKeyProblem);
if (!cfg.escrow) console.warn("ESCROW_ADDRESS not set: accepted deals will have no escrow address, relayer disabled");

const server = serve({ fetch: site.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Obsyn on port ${info.port} (chain ${cfg.chainId}); API at /api`);
});

// Railway sends SIGTERM on redeploy: finish in-flight requests, then exit.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
