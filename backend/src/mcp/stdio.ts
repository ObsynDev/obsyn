/**
 * Local MCP server (stdio). Register it in any MCP client as a stdio server:
 *   command: node   args: [/path/to/backend/src/mcp/stdio.ts]   env: OBSYN_API=https://your-backend/api
 *
 * Env:
 *   OBSYN_API            backend API URL (default https://obsyn.trade/api)
 *   OBSYN_PRIVATE_KEY    optional agent wallet key; without it deposits come back unsigned
 *   OBSYN_RPC_URL        optional RPC override
 *   OBSYN_STATE          where bid/offer secrets are kept (default ~/.obsyn/state.json)
 * The older BLOCKOTC_* names are still read as a fallback.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { OtcAgent } from "../sdk/client.ts";
import { FileStore } from "../sdk/file-store.ts";
import { createMcpServer } from "./server.ts";
import { createAutopilot, validateConfig, type AutopilotConfig } from "../sdk/autopilot.ts";

/** A setting from the environment; blank counts as unset (MCP clients often pass "" for empty fields). */
const env = (name: string) => (process.env[`OBSYN_${name}`] || process.env[`BLOCKOTC_${name}`] || "").trim() || undefined;

const key = env("PRIVATE_KEY");
if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("OBSYN_PRIVATE_KEY must be 0x + 64 hex chars");
  process.exit(1);
}

const agent = new OtcAgent({
  apiUrl: env("API") ?? "https://obsyn.trade/api",
  privateKey: key as Hex | undefined,
  rpcUrl: env("RPC_URL"),
  store: new FileStore(env("STATE") ?? join(homedir(), ".obsyn", "state.json")),
});

if (process.argv[2] === "autopilot") {
  // obsyn-mcp autopilot rules.json : trade by rules until stopped (Ctrl+C). Dry run unless "live": true.
  const file = process.argv[3];
  if (!file) {
    console.error("usage: obsyn-mcp autopilot <rules.json>");
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(file, "utf8")) as AutopilotConfig;
  const problems = validateConfig(cfg);
  if (problems.length) {
    console.error(["rules.json:", ...problems].join("\n  "));
    process.exit(1);
  }
  if (cfg.live === true && !key) {
    console.error("A live autopilot needs OBSYN_PRIVATE_KEY (use a dedicated wallet).");
    process.exit(1);
  }
  const stamp = () => new Date().toISOString().slice(11, 19);
  const pilot = await createAutopilot(agent, cfg, (line) => console.log(`${stamp()} ${line}`));
  const signal = { stopped: false };
  process.on("SIGINT", () => {
    signal.stopped = true;
    console.log("stopping after this tick…");
  });
  await pilot.run(signal);
  process.exit(0);
}

await createMcpServer(agent).connect(new StdioServerTransport());
console.error("obsyn MCP server ready (stdio)");
