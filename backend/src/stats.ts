/**
 * Desk statistics and referral earnings, built from the deals this server saw accepted and the
 * escrow's own on-chain state. Only data that is already public once a deal settles is reported:
 * no prices of open postings, no sealed answers.
 */
import { erc20Abi, getAddress, parseAbi, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import type { DatabaseSync } from "node:sqlite";
import { OtcEscrowAbi } from "./abi/OtcEscrow.ts";
import { TermsSchema, type Terms } from "./terms.ts";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const vaultAbi = parseAbi([
  "function totalBurned() view returns (uint256)",
  "function balances() view returns (uint256 eth, uint256 usdgBal)",
  "function adapter() view returns (address)",
  "function pendingAdapter() view returns (address)",
  "function pendingAdapterEta() view returns (uint256)",
]);

/** What the stats need from the chain; injectable for tests. */
export interface StatsChain {
  /** 0 none, 1 open, 2 settled, 3 refunded */
  dealStatus(id: Hex): Promise<number>;
  /** protocol and referrer fee the escrow takes for these terms */
  fees(t: Terms): Promise<{ protocol: bigint; referrer: bigint }>;
  vault(): Promise<{
    address: Address;
    totalBurned: bigint;
    eth: bigint;
    usdg: bigint;
    tokenBurnedAtDead: bigint | null;
    /** the swap route the vault buys through, and one queued behind the 2-day timelock */
    route?: { active: Address; pending: Address; pendingEta: bigint };
  }>;
}

export function chainStats(client: PublicClient, escrow: Address, platformToken: Address | null): StatsChain {
  let vaultAddr: Promise<Address> | null = null;
  const vault = () => (vaultAddr ??= client.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "feeRecipient" }) as Promise<Address>);
  return {
    async dealStatus(id) {
      const [s] = (await client.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [id] })) as readonly [number, ...unknown[]];
      return Number(s);
    },
    async fees(t) {
      const [protocol, referrer] = (await client.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "quoteSettlement", args: [t] })) as readonly [bigint, bigint, bigint];
      return { protocol, referrer };
    },
    async vault() {
      const address = await vault();
      const [totalBurned, [eth, usdg], dead, active, pending, pendingEta] = await Promise.all([
        client.readContract({ address, abi: vaultAbi, functionName: "totalBurned" }),
        client.readContract({ address, abi: vaultAbi, functionName: "balances" }),
        platformToken ? client.readContract({ address: platformToken, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] }) : Promise.resolve(null),
        client.readContract({ address, abi: vaultAbi, functionName: "adapter" }),
        client.readContract({ address, abi: vaultAbi, functionName: "pendingAdapter" }),
        client.readContract({ address, abi: vaultAbi, functionName: "pendingAdapterEta" }),
      ]);
      return { address, totalBurned, eth, usdg, tokenBurnedAtDead: dead, route: { active, pending, pendingEta } };
    },
  };
}

type Deal = { id: Hex; terms: Terms; settleTx: string | null; acceptedAt: number };
type Amounts = { eth: string; usdg: string };

export interface StatsSummary {
  deals: { accepted: number; settled: number; refunded: number; open: number };
  /** settled volume, by what the buyers paid, in base units (ETH: wei, USDG: its decimals) */
  volume: Amounts;
  /** fees the escrow took on settled deals: to the vault, and to referrers */
  fees: { protocol: Amounts; referrer: Amounts };
  volumeUsd: number | null;
  ethUsd: number | null;
  postings: { total: number; open: number; answers: number };
  tokensTraded: number;
  vault: {
    address: string;
    ethWaiting: string;
    usdgWaiting: string;
    totalBurned: string;
    burnedAtDead: string | null;
    /** buy route: the adapter in use, and one queued behind the public 2-day timelock (eta in unix seconds, 0 = none) */
    route: { active: string; pending: string; pendingEta: number } | null;
  } | null;
  updatedAt: number;
}

export interface ReferralSummary {
  referrer: string;
  deals: { accepted: number; settled: number };
  earned: Amounts;
  recent: { dealId: string; payToken: string; fee: string; settleTx: string | null; acceptedAt: number }[];
}

export function createStats(opts: {
  db: DatabaseSync;
  chain: StatsChain | null;
  usdg: Address | null;
  ethUsd: () => Promise<number | null>;
  now: () => number;
  ttlSec?: number;
}) {
  const { db, chain, usdg } = opts;
  const ttl = opts.ttlSec ?? 60;
  // settled and refunded are final, and the fee is fixed once settled: remember them for good
  const final = new Map<string, { status: number; fees?: { protocol: bigint; referrer: bigint } }>();

  const allDeals = db.prepare(`
    SELECT deal_id, terms_json, settle_tx, created_at FROM quotes WHERE deal_id IS NOT NULL AND terms_json IS NOT NULL
    UNION ALL
    SELECT r.deal_id, r.terms_json, r.settle_tx, r.created_at FROM rfqs r
      WHERE r.deal_id IS NOT NULL AND r.terms_json IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM quotes q WHERE lower(q.deal_id) = lower(r.deal_id))`);

  function deals(): Deal[] {
    const seen = new Set<string>();
    const out: Deal[] = [];
    for (const row of allDeals.all() as { deal_id: string; terms_json: string; settle_tx: string | null; created_at: number }[]) {
      const id = row.deal_id.toLowerCase();
      if (seen.has(id)) continue;
      const parsed = TermsSchema.safeParse(JSON.parse(row.terms_json));
      if (!parsed.success) continue;
      seen.add(id);
      out.push({ id: id as Hex, terms: parsed.data as Terms, settleTx: row.settle_tx, acceptedAt: row.created_at });
    }
    return out;
  }

  async function state(d: Deal) {
    const hit = final.get(d.id);
    if (hit) return hit;
    if (!chain) return { status: d.settleTx ? 2 : 1 };
    const status = await chain.dealStatus(d.id);
    if (status === 2) {
      const entry = { status, fees: await chain.fees(d.terms) };
      final.set(d.id, entry);
      return entry;
    }
    if (status === 3) final.set(d.id, { status });
    return { status };
  }

  const isUsdg = (a: Address) => !!usdg && a.toLowerCase() === usdg.toLowerCase();
  const add = (m: { eth: bigint; usdg: bigint }, payToken: Address, v: bigint) => {
    if (payToken === zeroAddress) m.eth += v;
    else if (isUsdg(payToken)) m.usdg += v;
  };
  const str = (m: { eth: bigint; usdg: bigint }): Amounts => ({ eth: m.eth.toString(), usdg: m.usdg.toString() });

  let cached: { at: number; value: StatsSummary } | null = null;
  let inflight: Promise<StatsSummary> | null = null;

  async function build(): Promise<StatsSummary> {
    const list = deals();
    const states = await Promise.all(list.map((d) => state(d).catch(() => ({ status: -1 }) as { status: number; fees?: undefined })));
    const volume = { eth: 0n, usdg: 0n };
    const protocol = { eth: 0n, usdg: 0n };
    const referrer = { eth: 0n, usdg: 0n };
    const counts = { accepted: list.length, settled: 0, refunded: 0, open: 0 };
    const tokens = new Set<string>();
    list.forEach((d, i) => {
      const s = states[i];
      if (s.status === 2) {
        counts.settled++;
        tokens.add(d.terms.token.toLowerCase());
        add(volume, d.terms.payToken, d.terms.price);
        if (s.fees) {
          add(protocol, d.terms.payToken, s.fees.protocol);
          add(referrer, d.terms.payToken, s.fees.referrer);
        }
      } else if (s.status === 3) counts.refunded++;
      else counts.open++;
    });
    const t = opts.now();
    const posts = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' AND expires_at > ? THEN 1 ELSE 0 END) AS open FROM rfqs").get(t) as { total: number; open: number | null };
    const answers = db.prepare("SELECT COUNT(*) AS n FROM quotes").get() as { n: number };
    const ethUsd = await opts.ethUsd().catch(() => null);
    const usdgDecimals = 6;
    const volumeUsd = ethUsd === null && volume.eth > 0n ? null : Number(volume.usdg) / 10 ** usdgDecimals + (Number(volume.eth) / 1e18) * (ethUsd ?? 0);
    let vault: StatsSummary["vault"] = null;
    if (chain) {
      try {
        const v = await chain.vault();
        vault = {
          address: getAddress(v.address),
          ethWaiting: v.eth.toString(),
          usdgWaiting: v.usdg.toString(),
          totalBurned: v.totalBurned.toString(),
          burnedAtDead: v.tokenBurnedAtDead === null ? null : v.tokenBurnedAtDead.toString(),
          route: v.route ? { active: getAddress(v.route.active), pending: getAddress(v.route.pending), pendingEta: Number(v.route.pendingEta) } : null,
        };
      } catch {
        vault = null;
      }
    }
    return {
      deals: counts,
      volume: str(volume),
      fees: { protocol: str(protocol), referrer: str(referrer) },
      volumeUsd: volumeUsd === null ? null : Math.round(volumeUsd * 100) / 100,
      ethUsd,
      postings: { total: posts.total, open: posts.open ?? 0, answers: answers.n },
      tokensTraded: tokens.size,
      vault,
      updatedAt: t,
    };
  }

  async function summary(): Promise<StatsSummary> {
    const t = opts.now();
    if (cached && t - cached.at < ttl) return cached.value;
    inflight ??= build().finally(() => (inflight = null));
    const value = await inflight;
    cached = { at: t, value };
    return value;
  }

  async function referrals(who: Address): Promise<ReferralSummary> {
    const mine = deals().filter((d) => d.terms.referrer.toLowerCase() === who.toLowerCase());
    const earned = { eth: 0n, usdg: 0n };
    let settled = 0;
    const recent: ReferralSummary["recent"] = [];
    for (const d of mine) {
      const s = await state(d).catch(() => ({ status: -1 }) as { status: number; fees?: undefined });
      if (s.status !== 2) continue;
      settled++;
      const fee = s.fees?.referrer ?? 0n;
      add(earned, d.terms.payToken, fee);
      recent.push({ dealId: d.id, payToken: d.terms.payToken, fee: fee.toString(), settleTx: d.settleTx, acceptedAt: d.acceptedAt });
    }
    recent.sort((a, b) => b.acceptedAt - a.acceptedAt);
    return { referrer: getAddress(who), deals: { accepted: mine.length, settled }, earned: str(earned), recent: recent.slice(0, 20) };
  }

  return { summary, referrals };
}
