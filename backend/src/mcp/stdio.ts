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
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { OtcAgent } from "../sdk/client.ts";
import { FileStore } from "../sdk/file-store.ts";
import { createMcpServer } from "./server.ts";

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

await createMcpServer(agent).connect(new StdioServerTransport());
console.error("obsyn MCP server ready (stdio)");
