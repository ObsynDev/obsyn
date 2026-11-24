/**
 * Local MCP server (stdio). Register it in any MCP client as a stdio server:
 *   command: node   args: [/path/to/backend/src/mcp/stdio.ts]   env: OBSYN_API=https://your-backend/api
 *
 * Env:
 *   OBSYN_API            backend API URL (default https://obsyn.trade/api)
 *   OBSYN_PRIVATE_KEY    optional agent wallet key; without it deposits come back unsigned
 *   OBSYN_RPC_URL        optional RPC override
 *   OBSYN_STATE          where bid/offer secrets are kept (default ~/.obsyn/state.json)
 *   OBSYN_AUTOPILOT_STATE  the autopilot's ledger of answers in play (default autopilot.json next to OBSYN_STATE)
 * The older BLOCKOTC_* names are still read as a fallback.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Hex } from "viem";
import { OtcAgent } from "../sdk/client.ts";
import { FileLedger, FileStore } from "../sdk/file-store.ts";
import { createMcpServer } from "./server.ts";
import { createAutopilot, validateConfig, type AutopilotConfig } from "../sdk/autopilot.ts";

/** A setting from the environment; blank counts as unset (MCP clients often pass "" for empty fields). */
const env = (name: string) => (process.env[`OBSYN_${name}`] || process.env[`BLOCKOTC_${name}`] || "").trim() || undefined;

const key = env("PRIVATE_KEY");
if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("OBSYN_PRIVATE_KEY must be 0x + 64 hex chars");
  process.exit(1);
}

const STATE_PATH = env("STATE") ?? join(homedir(), ".obsyn", "state.json");

const agent = new OtcAgent({
  apiUrl: env("API") ?? "https://obsyn.trade/api",
  privateKey: key as Hex | undefined,
  rpcUrl: env("RPC_URL"),
  store: new FileStore(STATE_PATH),
});

if (process.argv[2] === "maker") {
  // obsyn-mcp maker list "Name" | obsyn-mcp maker unlist "Name": show this wallet as a maker (a signed message, no gas)
  const [action, ...words] = process.argv.slice(3);
  const name = words.join(" ").trim();
  if ((action !== "list" && action !== "unlist") || !name) {
    console.error('usage: obsyn-mcp maker list "Your desk name"   (or: maker unlist "Your desk name")');
    process.exit(1);
  }
  try {
    const r = await agent.maker(action, name);
    console.log(r.listed ? `Listed ${r.address} as "${r.name}". See it on https://obsyn.trade/makers` : `Unlisted ${r.address}.`);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (process.argv[2] === "autopilot") {
  // obsyn-mcp autopilot rules.json : trade by rules until stopped (Ctrl+C). Dry run unless "live": true.
  const file = process.argv[3];
  if (!file) {
    console.error("usage: obsyn-mcp autopilot <rules.json>");
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(file, "utf8")) as AutopilotConfig;
  // tokens may be named by symbol ("NVDA", "$OBSYN"): check everything else now, each token once it's resolved
  const problems = Array.isArray(cfg?.rules)
    ? validateConfig({ ...cfg, rules: cfg.rules.map((r) => ({ ...r, token: "0x0000000000000000000000000000000000000001" })) })
    : validateConfig(cfg);
  if (problems.length) {
    console.error(["rules.json:", ...problems].join("\n  "));
    process.exit(1);
  }
  if (cfg.live === true && !key) {
    console.error("A live autopilot needs OBSYN_PRIVATE_KEY (use a dedicated wallet).");
    process.exit(1);
  }
  const stamp = () => new Date().toISOString().slice(11, 19);
  // answers in play survive a restart: the autopilot still deposits on ones accepted while it was down
  const ledgerPath = env("AUTOPILOT_STATE") ?? join(dirname(STATE_PATH), "autopilot.json");
  const pilot = await createAutopilot(agent, cfg, (line) => console.log(`${stamp()} ${line}`), cfg.live === true ? new FileLedger(ledgerPath) : undefined).catch(
    (e: Error) => {
      console.error(`rules.json: ${e.message}`); // e.g. a token symbol that isn't listed
      process.exit(1);
    },
  );
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
