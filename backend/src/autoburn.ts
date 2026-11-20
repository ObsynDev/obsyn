/**
 * Automatic burns: the vault's keeper is the BurnKeeper contract, where anyone may take a price
 * snapshot and trigger a burn, and the contract bounds what every burn pays. This loop is simply
 * that "anyone": it reads the keeper, takes a snapshot when one is needed, waits for it to age,
 * then triggers the burn. Its key (the relayer's) only pays gas; it can't change what a burn pays.
 */
import { encodeFunctionData, parseAbi, zeroHash, type Address, type PublicClient, type WalletClient } from "viem";

export const KEEPER_ABI = parseAbi([
  "function route() view returns (address)",
  "function pending() view returns (uint256 eth, uint256 usdgAmt)",
  "function canSnapshot() view returns (bool)",
  "function snapshotAt() view returns (uint256)",
  "function lastBurnAt() view returns (uint256)",
  "function cooldown() view returns (uint256)",
  "function minSnapshotAge() view returns (uint256)",
  "function maxSnapshotAge() view returns (uint256)",
  "function poolSqrtPrice() view returns (uint160)",
  "function inBand(uint160) view returns (bool)",
  "function snapshot()",
  "function burnEth()",
  "function burnUsdg()",
]);
const VAULT_ABI = parseAbi(["function keeper() view returns (address)", "function adapter() view returns (address)", "function setKeeper(address)"]);
const TL_ABI = parseAbi([
  "function hashOperation(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function isOperationReady(bytes32 id) view returns (bool)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt) payable",
]);

/** The timelock operation that installs the keeper, exactly as the Safe schedules it (no predecessor, salt 0). */
export function installOperation(vault: Address, keeper: Address) {
  return { target: vault, value: 0n, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "setKeeper", args: [keeper] }), predecessor: zeroHash, salt: zeroHash } as const;
}

export interface KeeperState {
  installed: boolean; // the vault's keeper is this contract and its route is the vault's route
  pendingEth: bigint;
  pendingUsdg: bigint;
  canSnapshot: boolean;
  snapshotAt: number;
  lastBurnAt: number;
  cooldown: number;
  minSnapshotAge: number;
  maxSnapshotAge: number;
  inBand: boolean;
}

export type BurnAction = { kind: "wait"; why: string } | { kind: "snapshot" } | { kind: "burnEth" } | { kind: "burnUsdg" };

/** What to do now. Pure, so it can be tested without a chain. */
export function decide(s: KeeperState, now: number): BurnAction {
  if (!s.installed) return { kind: "wait", why: "not the vault's keeper yet" };
  if (s.pendingEth === 0n && s.pendingUsdg === 0n) return { kind: "wait", why: "nothing to burn" };
  if (s.lastBurnAt !== 0 && now < s.lastBurnAt + s.cooldown) return { kind: "wait", why: "cooldown" };
  const fresh = s.snapshotAt !== 0 && now <= s.snapshotAt + s.maxSnapshotAge && s.inBand;
  if (!fresh) return s.canSnapshot ? { kind: "snapshot" } : { kind: "wait", why: "snapshot can't be retaken yet" };
  if (now < s.snapshotAt + s.minSnapshotAge) return { kind: "wait", why: "snapshot aging" };
  return s.pendingEth > 0n ? { kind: "burnEth" } : { kind: "burnUsdg" };
}

export async function readKeeper(c: PublicClient, keeper: Address, vault: Address): Promise<KeeperState> {
  const r = <T>(functionName: string, args: unknown[] = []) => c.readContract({ address: keeper, abi: KEEPER_ABI, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [vk, va, route, pending, canSnapshot, snapshotAt, lastBurnAt, cooldown, minAge, maxAge, spot] = await Promise.all([
    c.readContract({ address: vault, abi: VAULT_ABI, functionName: "keeper" }),
    c.readContract({ address: vault, abi: VAULT_ABI, functionName: "adapter" }),
    r<Address>("route"),
    r<readonly [bigint, bigint]>("pending"),
    r<boolean>("canSnapshot"),
    r<bigint>("snapshotAt"),
    r<bigint>("lastBurnAt"),
    r<bigint>("cooldown"),
    r<bigint>("minSnapshotAge"),
    r<bigint>("maxSnapshotAge"),
    r<bigint>("poolSqrtPrice"),
  ]);
  const inBand = await r<boolean>("inBand", [spot]);
  return {
    installed: vk.toLowerCase() === keeper.toLowerCase() && va.toLowerCase() === route.toLowerCase(),
    pendingEth: pending[0],
    pendingUsdg: pending[1],
    canSnapshot,
    snapshotAt: Number(snapshotAt),
    lastBurnAt: Number(lastBurnAt),
    cooldown: Number(cooldown),
    minSnapshotAge: Number(minAge),
    maxSnapshotAge: Number(maxAge),
    inBand,
  };
}

/**
 * One step of the loop: read, decide, and (after simulating it) send at most one transaction.
 * Returns what it did, for the log.
 */
export async function autoBurnStep(c: PublicClient, w: WalletClient, keeper: Address, vault: Address, timelock: Address | null, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const account = w.account!;
  const s = await readKeeper(c, keeper, vault);
  if (!s.installed && timelock) {
    // the Safe scheduled setKeeper(keeper) on the timelock; once its 3 days are over, anyone may execute it
    const op = installOperation(vault, keeper);
    const id = await c.readContract({ address: timelock, abi: TL_ABI, functionName: "hashOperation", args: [op.target, op.value, op.data, op.predecessor, op.salt] });
    if (await c.readContract({ address: timelock, abi: TL_ABI, functionName: "isOperationReady", args: [id] })) {
      const { request } = await c.simulateContract({ address: timelock, abi: TL_ABI, functionName: "execute", args: [op.target, op.value, op.data, op.predecessor, op.salt], account });
      const hash = await w.writeContract(request);
      const rc = await c.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return `install keeper (timelock execute): ${rc.status} ${hash}`;
    }
  }
  const a = decide(s, now);
  if (a.kind === "wait") return `wait: ${a.why}`;
  // simulate first: if anything changed since the read, nothing is sent and no gas is spent
  const { request } = await c.simulateContract({ address: keeper, abi: KEEPER_ABI, functionName: a.kind, account });
  const hash = await w.writeContract(request);
  const rc = await c.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return `${a.kind}: ${rc.status} ${hash}`;
}
