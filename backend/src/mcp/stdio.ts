/**
 * Local MCP server (stdio). Register it in any MCP client as a stdio server, e.g.:
 *   mcp-client add blockotc -e BLOCKOTC_API=https://your-backend/api -- node /path/to/backend/src/mcp/stdio.ts
 *
 * Env:
 *   BLOCKOTC_API          backend API URL (default http://localhost:8787/api)
 *   BLOCKOTC_PRIVATE_KEY  optional agent wallet key; without it deposits come back unsigned
 *   BLOCKOTC_RPC_URL      optional RPC override
 *   BLOCKOTC_STATE        where bid/offer secrets are kept (default ~/.blockotc/state.json)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { OtcAgent } from "../sdk/client.ts";
import { FileStore } from "../sdk/file-store.ts";
import { createMcpServer } from "./server.ts";

const key = process.env.BLOCKOTC_PRIVATE_KEY?.trim();
if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("BLOCKOTC_PRIVATE_KEY must be 0x + 64 hex chars");
  process.exit(1);
}

const agent = new OtcAgent({
  apiUrl: process.env.BLOCKOTC_API ?? "http://localhost:8787/api",
  privateKey: key as Hex | undefined,
  rpcUrl: process.env.BLOCKOTC_RPC_URL,
  store: new FileStore(process.env.BLOCKOTC_STATE ?? join(homedir(), ".blockotc", "state.json")),
});

await createMcpServer(agent).connect(new StdioServerTransport());
console.error("blockotc MCP server ready (stdio)");
