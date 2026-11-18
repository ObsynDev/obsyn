/**
 * Who controls what, read live from the chain: the escrow (no owner), the fee vault's owner and keeper,
 * the team Safe's signers and threshold, the timelock in front of the vault (when there is one) and every
 * change it has queued, the burn route, and what the vault holds. Nothing here comes from our database.
 */
import { decodeEventLog, getAddress, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

const SCHEDULED_ABI = parseAbi(["event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)"]);

const VAULT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function adapter() view returns (address)",
  "function pendingAdapter() view returns (address)",
  "function pendingAdapterEta() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function balances() view returns (uint256 eth, uint256 usdgBal)",
]);
const SAFE_ABI = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])", "function VERSION() view returns (string)"]);
const TL_ABI = parseAbi(["function getMinDelay() view returns (uint256)", "function isOperationPending(bytes32) view returns (bool)", "function getTimestamp(bytes32) view returns (uint256)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const DEAD = "0x000000000000000000000000000000000000dEaD";

/** What each queued call does, for the known vault and timelock functions. */
const LABELS: Record<string, string> = {
  "0x748747e6": "change the keeper",
  "0xf2fde38b": "hand the vault to a new owner",
  "0x79ba5097": "accept vault ownership",
  "0x178cc54d": "queue a new burn route",
  "0x463e0edc": "switch on the queued burn route",
  "0x64d62353": "change the timelock delay",
  "0x2f2ff15d": "grant a timelock role",
  "0xd547741f": "revoke a timelock role",
};

export interface QueuedChange {
  id: Hex;
  target: Address;
  selector: string;
  label: string;
  /** unix seconds; executable from then, by anyone */
  readyAt: number;
}

export interface ControlReport {
  escrow: { address: Address | null; legacy: Address | null; owner: null; note: string };
  vault: {
    address: Address;
    owner: Address;
    ownerKind: "safe" | "timelock" | "account" | "contract";
    keeper: Address;
    keeperKind: "safe" | "timelock" | "account" | "contract";
    pendingOwner: Address | null;
    route: { active: Address | null; pending: Address | null; pendingEta: number };
    holds: { eth: string; usdg: string };
    totalBurned: string;
  };
  safe: { address: Address; threshold: number; signers: { address: Address; team: boolean }[]; version: string | null } | null;
  timelock: { address: Address; minDelay: number; queued: QueuedChange[]; queuedKnown: boolean } | null;
  burnedAtDead: string | null;
  updatedAt: number;
}

export interface ControlDeps {
  client: PublicClient;
  vault: Address;
  escrow: Address | null;
  escrowLegacy: Address | null;
  token: Address | null;
  /** signers the team holds, labelled honestly as team on the page */
  teamSigners: Address[];
  /** CallScheduled ids of a timelock (e.g. from the explorer's logs); queued changes are checked on-chain */
  scheduledIds?: (timelock: Address) => Promise<{ id: Hex; target: Address; data: Hex }[]>;
  now: () => number;
}

async function kindOf(client: PublicClient, a: Address): Promise<"safe" | "timelock" | "account" | "contract"> {
  const code = await client.getCode({ address: a }).catch(() => undefined);
  if (!code || code === "0x") return "account";
  const isSafe = await client.readContract({ address: a, abi: SAFE_ABI, functionName: "getThreshold" }).then(() => true, () => false);
  if (isSafe) return "safe";
  const isTl = await client.readContract({ address: a, abi: TL_ABI, functionName: "getMinDelay" }).then(() => true, () => false);
  return isTl ? "timelock" : "contract";
}

async function readSafe(client: PublicClient, a: Address, team: Address[]) {
  const [threshold, owners, version] = await Promise.all([
    client.readContract({ address: a, abi: SAFE_ABI, functionName: "getThreshold" }),
    client.readContract({ address: a, abi: SAFE_ABI, functionName: "getOwners" }),
    client.readContract({ address: a, abi: SAFE_ABI, functionName: "VERSION" }).catch(() => null),
  ]);
  const teamSet = new Set(team.map((t) => t.toLowerCase()));
  return { address: a, threshold: Number(threshold), signers: owners.map((o) => ({ address: getAddress(o), team: teamSet.has(o.toLowerCase()) })), version };
}

export async function readControl(d: ControlDeps): Promise<ControlReport> {
  const c = d.client;
  const v = d.vault;
  const [owner, keeper, pendingOwner, active, pending, eta, burned, [eth, usdg], dead] = await Promise.all([
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "owner" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "keeper" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "pendingOwner" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "adapter" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "pendingAdapter" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "pendingAdapterEta" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "totalBurned" }),
    c.readContract({ address: v, abi: VAULT_ABI, functionName: "balances" }),
    d.token ? c.readContract({ address: d.token, abi: ERC20, functionName: "balanceOf", args: [DEAD] }) : Promise.resolve(null),
  ]);
  const [ownerKind, keeperKind] = await Promise.all([kindOf(c, owner), kindOf(c, keeper)]);

  // the Safe behind the vault: the owner itself, or the keeper when a timelock owns the vault
  const safeAddr = ownerKind === "safe" ? owner : keeperKind === "safe" ? keeper : null;
  const safe = safeAddr ? await readSafe(c, safeAddr, d.teamSigners) : null;

  let timelock: ControlReport["timelock"] = null;
  if (ownerKind === "timelock") {
    const minDelay = Number(await c.readContract({ address: owner, abi: TL_ABI, functionName: "getMinDelay" }));
    let queued: QueuedChange[] = [];
    let queuedKnown = false;
    if (d.scheduledIds) {
      try {
        const scheduled = await d.scheduledIds(owner);
        const seen = new Set<string>();
        for (const s of scheduled) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          const [isPending, ts] = await Promise.all([
            c.readContract({ address: owner, abi: TL_ABI, functionName: "isOperationPending", args: [s.id] }),
            c.readContract({ address: owner, abi: TL_ABI, functionName: "getTimestamp", args: [s.id] }),
          ]);
          if (!isPending) continue;
          const selector = s.data.slice(0, 10).toLowerCase();
          queued.push({ id: s.id, target: getAddress(s.target), selector, label: LABELS[selector] ?? "other call", readyAt: Number(ts) });
        }
        queued = queued.sort((a, b) => a.readyAt - b.readyAt);
        queuedKnown = true;
      } catch {
        queuedKnown = false;
      }
    }
    timelock = { address: owner, minDelay, queued, queuedKnown };
  }

  return {
    escrow: { address: d.escrow, legacy: d.escrowLegacy, owner: null, note: "No owner, admin, pause or upgrade: there is no function to call." },
    vault: {
      address: v,
      owner,
      ownerKind,
      keeper,
      keeperKind,
      pendingOwner: pendingOwner === zeroAddress ? null : pendingOwner,
      route: { active: active === zeroAddress ? null : active, pending: pending === zeroAddress ? null : pending, pendingEta: Number(eta) },
      holds: { eth: eth.toString(), usdg: usdg.toString() },
      totalBurned: burned.toString(),
    },
    safe,
    timelock,
    burnedAtDead: dead === null ? null : dead.toString(),
    updatedAt: d.now(),
  };
}

/**
 * CallScheduled events of a timelock from Blockscout's API (no log-range limits). Topic0 is
 * keccak256("CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)").
 */
export function blockscoutScheduled(explorerApi: string, fetchJson: (url: string) => Promise<unknown> = (u) => fetch(u).then((r) => r.json())) {
  const TOPIC = "0x4cf4410cc57040e44862ef0f45f3dd5a5e02db8eb8add648d4b0e236f1d07dca";
  return async (tl: Address) => {
    const out: { id: Hex; target: Address; data: Hex }[] = [];
    let url: string | null = `${explorerApi}/api/v2/addresses/${tl}/logs`;
    for (let page = 0; url && page < 10; page++) {
      const j = (await fetchJson(url)) as { items?: { topics?: (string | null)[]; data?: string }[]; next_page_params?: Record<string, string> | null };
      for (const it of j.items ?? []) {
        if ((it.topics?.[0] ?? "").toLowerCase() !== TOPIC) continue;
        // the raw log is the source of truth; the explorer's decoding is not always there
        try {
          const ev = decodeEventLog({ abi: SCHEDULED_ABI, data: it.data as Hex, topics: it.topics!.filter((t): t is string => !!t) as [Hex, ...Hex[]] });
          out.push({ id: ev.args.id, target: getAddress(ev.args.target), data: ev.args.data });
        } catch {
          /* not a well-formed CallScheduled: skip it */
        }
      }
      url = j.next_page_params ? `${explorerApi}/api/v2/addresses/${tl}/logs?${new URLSearchParams(j.next_page_params)}` : null;
    }
    return out;
  };
}
