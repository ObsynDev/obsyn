import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, parseAbi, type Hex } from "viem";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { blockscoutScheduled, firstScheduled, memoryScanStore, rpcScheduled, type ControlReport } from "../src/control.ts";
import { openDb } from "../src/db.ts";
import type { Relayer } from "../src/relayer.ts";

const EV = parseAbi(["event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)"]);
const VAULT = "0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221";
const TL = "0xe7213b68DC25bf30bC7f1DE9BAead075c66979F9";

function scheduledLog(id: Hex, data: Hex) {
  const topics = encodeEventTopics({ abi: EV, eventName: "CallScheduled", args: { id, index: 0n } });
  return {
    topics,
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes32" }, { type: "uint256" }],
      [VAULT, 0n, data, `0x${"00".repeat(32)}`, 259200n],
    ),
  };
}

describe("timelock queue from the explorer", () => {
  it("decodes CallScheduled from the raw log, follows pages, skips other events", async () => {
    const setKeeper = encodeFunctionData({ abi: parseAbi(["function setKeeper(address)"]), args: ["0x000000000000000000000000000000000000bEEF"] });
    const pages: Record<string, unknown> = {
      [`https://x/api/v2/addresses/${TL}/logs`]: {
        items: [scheduledLog(`0x${"aa".repeat(32)}`, setKeeper), { topics: [`0x${"11".repeat(32)}`], data: "0x" }],
        next_page_params: { block_number: "5", index: "1" },
      },
      [`https://x/api/v2/addresses/${TL}/logs?block_number=5&index=1`]: { items: [scheduledLog(`0x${"bb".repeat(32)}`, "0x463e0edc")], next_page_params: null },
    };
    const read = blockscoutScheduled("https://x", async (u) => {
      if (!(u in pages)) throw new Error(`unexpected ${u}`);
      return pages[u];
    });
    const got = await read(TL);
    assert.deepEqual(
      got.map((g) => [g.id.slice(0, 6), g.target, g.data.slice(0, 10)]),
      [
        ["0xaaaa", VAULT, "0x748747e6"],
        ["0xbbbb", VAULT, "0x463e0edc"],
      ],
    );
  });
});

describe("timelock queue from RPC logs", () => {
  const log = (id: string, start: bigint) => ({ args: { id: `0x${id.repeat(32)}`, target: VAULT, data: "0x463e0edc" }, blockNumber: start });
  it("scans in chunks from the deploy block, then only new blocks", async () => {
    let head = 2_500_000n;
    const calls: [bigint, bigint][] = [];
    const node = {
      getBlockNumber: async () => head,
      getLogs: async ({ fromBlock, toBlock }: any) => (calls.push([fromBlock, toBlock]), fromBlock <= 1_200_000n && 1_200_000n <= toBlock ? [log("aa", 1_200_000n)] : fromBlock > 2_500_000n ? [log("bb", 2_600_000n)] : []),
    };
    const read = rpcScheduled([node as any], 1_000_000n, { span: 1_000_000n });
    assert.deepEqual((await read(TL as any)).map((x) => x.id.slice(0, 4)), ["0xaa"]);
    assert.deepEqual(calls, [[1_000_000n, 1_999_999n], [2_000_000n, 2_500_000n]]);
    head = 2_600_000n;
    assert.deepEqual((await read(TL as any)).map((x) => x.id.slice(0, 4)), ["0xaa", "0xbb"]);
    assert.deepEqual(calls.at(-1), [2_500_001n, 2_600_000n], "only the new blocks");
  });
  it("reads at most maxChunks ranges per call, reports 'still indexing', and resumes from the store", async () => {
    const node = { getBlockNumber: async () => 5_000n, getLogs: async ({ fromBlock, toBlock }: any) => (fromBlock <= 3_000n && 3_000n <= toBlock ? [log("dd", 3_000n)] : []) };
    const store = memoryScanStore();
    const read = rpcScheduled([node as any], 1n, { span: 1_000n, maxChunks: 2, store });
    await assert.rejects(read(TL as any), /still indexing/);
    assert.equal(store.get(TL.toLowerCase())?.scanned, "2000");
    await assert.rejects(read(TL as any), /still indexing/);
    const again = rpcScheduled([node as any], 1n, { span: 1_000n, maxChunks: 2, store }); // e.g. after a restart
    assert.deepEqual((await again(TL as any)).map((x) => x.id.slice(0, 4)), ["0xdd"]);
    assert.equal(store.get(TL.toLowerCase())?.scanned, "5000");
  });

  it("falls back to the next node, and from the explorer to RPC", async () => {
    const bad = { getBlockNumber: async () => Promise.reject(new Error("down")), getLogs: async () => [] };
    const good = { getBlockNumber: async () => 10n, getLogs: async () => [log("cc", 5n)] };
    const rpc = rpcScheduled([bad as any, good as any], 1n);
    const explorer = blockscoutScheduled("https://x", async () => {
      throw new SyntaxError("Unexpected token '<'"); // a bot-check page instead of JSON
    });
    const got = await firstScheduled(explorer, rpc)(TL as any);
    assert.equal(got[0].id.slice(0, 4), "0xcc");
  });
});

describe("GET /control", () => {
  const relayer: Relayer = { info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }), relayDeposit: async () => Promise.reject(new Error("unused")) };
  const report = { vault: { owner: TL, ownerKind: "timelock" }, timelock: { minDelay: 259200, queued: [] } } as unknown as ControlReport;
  let clock = 1_800_000_000;
  const mk = (reader?: () => Promise<ControlReport>) =>
    createApp({ cfg: loadConfig({}), db: openDb(":memory:"), relayer, readPrice: async () => Promise.reject(new Error("n/a")), controlReader: reader, now: () => clock });

  it("serves the live report and reads the chain at most every 30 seconds", async () => {
    let reads = 0;
    const app = mk(async () => (reads++, report));
    const r = await (await app.request("/control")).json();
    assert.equal(r.vault.ownerKind, "timelock");
    await app.request("/control");
    assert.equal(reads, 1, "cached");
    clock += 31;
    await app.request("/control");
    assert.equal(reads, 2, "refreshed after 30s");
  });

  it("says when it can't read the chain, and when it isn't configured", async () => {
    assert.equal((await mk(async () => Promise.reject(new Error("rpc down"))).request("/control")).status, 502);
    assert.equal((await mk().request("/control")).status, 503);
  });
});

describe("GET /deals/{id}/state", () => {
  const relayer: Relayer = { info: () => ({ enabled: false, address: null, problem: null, minFee: { eth: "1", usdg: "1" } }), relayDeposit: async () => Promise.reject(new Error("unused")) };
  const V2 = getAddress("0x00000000000000000000000000000000000000E2");
  const V1 = getAddress("0x00000000000000000000000000000000000000E1");
  const ID = `0x${"ab".repeat(32)}`;
  const reads: string[] = [];
  const app = createApp({
    cfg: loadConfig({ ESCROW_ADDRESS: V2, ESCROW_LEGACY_ADDRESS: V1 }),
    db: openDb(":memory:"),
    relayer,
    readPrice: async () => Promise.reject(new Error("n/a")),
    readDeal: async (escrow, id) => (reads.push(`${escrow}:${id}`), { status: 1, buyerFunded: true, sellerFunded: false }),
    now: () => 1_800_000_000,
  });

  it("reads a deal on the current escrow, or on the legacy one when asked", async () => {
    const a = (await (await app.request(`/deals/${ID}/state`)).json()) as any;
    assert.deepEqual({ s: a.status, b: a.buyerFunded, e: a.escrow }, { s: 1, b: true, e: V2 });
    const b = (await (await app.request(`/deals/${ID}/state?escrow=${V1.toLowerCase()}`)).json()) as any;
    assert.equal(b.escrow, V1);
    assert.deepEqual(reads, [`${V2}:${ID}`, `${V1}:${ID}`]);
  });

  it("refuses other contracts and bad ids", async () => {
    assert.equal((await app.request(`/deals/${ID}/state?escrow=0x0000000000000000000000000000000000000bad`)).status, 400);
    assert.equal((await app.request(`/deals/nope/state`)).status, 400);
  });
});
