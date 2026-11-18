/**
 * Autopilot: an agent that trades on the desk by rules, 24/7, with the owner's own key.
 *
 * Each tick it reads the open postings, answers the ones that match a rule with a sealed, signed
 * price (a seller offer on someone's buy bid, or a buyer bid on someone's sell listing), and
 * deposits its side once its answer is accepted. It never posts, never accepts on anyone's
 * behalf, and never deposits before the deal says so (as seller it waits for the payment first).
 *
 * Safety first: dry-run unless the rules say `"live": true`; hard caps per deal and in total;
 * optional price floor and ceiling per token; no reference price → no answer; balance checked
 * before every answer. Nothing here can raise a limit by itself.
 */
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import type { OtcAgent } from "./client.ts";

export interface AutopilotRule {
  /** sell: answer buy bids with offers. buy: answer sell listings with bids. */
  side: "sell" | "buy";
  /** Token contract on Robinhood Chain. */
  token: string;
  /** Which payment to accept (sell) or pay with (buy). Default: any. OBSYN only where the server accepts it. */
  payWith?: "ETH" | "USDG" | "OBSYN" | "any";
  /** Most tokens to sell (or buy) over the whole run, whole tokens. */
  maxTotal: string;
  /** Most tokens per deal, whole tokens. */
  maxPerDeal: string;
  /** Price against the token's DEX price: +5 = 5% above, -3 = 3% below. */
  priceVsMarketPct: number;
  /** Never sell below / never buy above this USD price per token. */
  minPriceUsd?: number;
  maxPriceUsd?: number;
  /** Seller only: where the payment goes. Default: the agent's own wallet. */
  payoutAddress?: string;
}

export interface AutopilotConfig {
  rules: AutopilotRule[];
  /** Must be exactly true to send answers and deposit. Anything else is a dry run. */
  live?: boolean;
  /** Seconds between ticks. Default 30, minimum 10. */
  intervalSec?: number;
  /** Most answers waiting for a reply at once. Default 5. */
  maxOpenAnswers?: number;
}

export interface MarketQuote {
  /** USD price of one whole token. */
  usd: number | null;
  /** USD price of one ETH, to price ETH-paid answers. */
  ethUsd: number | null;
}

type Posting = {
  id: string;
  side?: "buy" | "sell";
  token: Address;
  payToken: Address;
  amount: string | null;
  sizeUsd: number | null;
  status: string;
  expiresAt: number;
  partial?: boolean;
  filledAmount?: string | null;
};

type Answer = { rule: number; rfqId: string; amount: bigint; state: "waiting" | "accepted" | "settled" | "dropped" };

export interface TickReport {
  live: boolean;
  actions: string[];
  skipped: string[];
  totals: { rule: number; side: "sell" | "buy"; token: string; done: string; pending: string; left: string }[];
}

const RULE_KEYS = new Set(["side", "token", "payWith", "maxTotal", "maxPerDeal", "priceVsMarketPct", "minPriceUsd", "maxPriceUsd", "payoutAddress"]);

/** Check a config before anything runs. Returns the problems, empty when it's fine. */
export function validateConfig(c: unknown): string[] {
  const out: string[] = [];
  if (!c || typeof c !== "object") return ["config must be an object with rules"];
  const cfg = c as AutopilotConfig;
  if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) out.push("rules must be a non-empty list");
  if (cfg.live !== undefined && typeof cfg.live !== "boolean") out.push("live must be true or false");
  if (cfg.intervalSec !== undefined && !(Number(cfg.intervalSec) >= 10)) out.push("intervalSec must be at least 10");
  (cfg.rules ?? []).forEach((r, i) => {
    const at = `rule ${i + 1}`;
    for (const k of Object.keys(r ?? {})) if (!RULE_KEYS.has(k)) out.push(`${at}: unknown field "${k}"`);
    if (r?.side !== "sell" && r?.side !== "buy") out.push(`${at}: side must be "sell" or "buy"`);
    if (!isAddress(String(r?.token))) out.push(`${at}: token must be a contract address`);
    if (r?.payWith && !["ETH", "USDG", "OBSYN", "any"].includes(r.payWith)) out.push(`${at}: payWith must be ETH, USDG, OBSYN or any`);
    for (const k of ["maxTotal", "maxPerDeal"] as const) if (!/^\d+(\.\d+)?$/.test(String(r?.[k])) || Number(r?.[k]) <= 0) out.push(`${at}: ${k} must be a positive number of tokens`);
    if (Number(r?.maxPerDeal) > Number(r?.maxTotal)) out.push(`${at}: maxPerDeal can't exceed maxTotal`);
    if (typeof r?.priceVsMarketPct !== "number" || !Number.isFinite(r.priceVsMarketPct) || Math.abs(r.priceVsMarketPct) > 50) out.push(`${at}: priceVsMarketPct must be a number between -50 and 50`);
    if (r?.side === "sell" && r.priceVsMarketPct < -20) out.push(`${at}: selling more than 20% under market looks like a mistake`);
    if (r?.side === "buy" && r.priceVsMarketPct > 20) out.push(`${at}: buying more than 20% over market looks like a mistake`);
    if (r?.payoutAddress && !isAddress(r.payoutAddress)) out.push(`${at}: payoutAddress must be an address`);
    if (r?.payoutAddress && r.side === "buy") out.push(`${at}: payoutAddress is for sell rules`);
  });
  return out;
}

export interface AutopilotDeps {
  api: <T>(path: string) => Promise<T>;
  quote: (token: Address) => Promise<MarketQuote>;
  balanceOf: (asset: Address, who: Address) => Promise<bigint>;
  decimals: (token: Address) => Promise<number>;
  usdg: Address | null;
  /** $OBSYN, when the server's escrow accepts it as payment */
  burnToken?: Address | null;
  now?: () => number;
  log?: (line: string) => void;
}

export class Autopilot {
  private answers = new Map<string, Answer>();
  private decCache = new Map<string, number>();
  private done = new Map<number, bigint>();
  private agent: OtcAgent;
  private cfg: AutopilotConfig;
  private deps: AutopilotDeps;

  constructor(agent: OtcAgent, cfg: AutopilotConfig, deps: AutopilotDeps) {
    const problems = validateConfig(cfg);
    if (problems.length) throw new Error("Autopilot config: " + problems.join("; "));
    this.agent = agent;
    this.cfg = cfg;
    this.deps = deps;
  }

  get live() {
    return this.cfg.live === true;
  }

  private log(line: string) {
    this.deps.log?.(line);
  }

  private async units(token: Address, whole: string) {
    const d = await this.deps.decimals(token);
    this.decCache.set(token.toLowerCase(), d);
    return parseUnits(whole, d);
  }

  /** Tokens committed under a rule: settled plus answers still in play. */
  private committed(rule: number) {
    let pending = 0n;
    for (const a of this.answers.values()) if (a.rule === rule && (a.state === "waiting" || a.state === "accepted")) pending += a.amount;
    return { done: this.done.get(rule) ?? 0n, pending };
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = { live: this.live, actions: [], skipped: [], totals: [] };
    const me = this.agent.address;
    if (this.live && !me) throw new Error("Live autopilot needs the agent's wallet key (OBSYN_PRIVATE_KEY).");

    // 1. follow up on answers already sent: deposit when accepted, count what settled
    for (const [offerId, a] of this.answers) {
      if (a.state === "settled" || a.state === "dropped") continue;
      try {
        const s = await this.agent.dealStatus({ offerId });
        if (!s.deal && "offer" in s && s.offer && s.offer !== "pending") {
          a.state = "dropped";
          report.actions.push(`answer ${offerId} was ${s.offer}; released`);
          continue;
        }
        if (!("dealId" in s) || !s.dealId) continue;
        if (s.status === "settled") {
          a.state = "settled";
          this.done.set(a.rule, (this.done.get(a.rule) ?? 0n) + a.amount);
          report.actions.push(`deal ${s.dealId.slice(0, 10)}… settled`);
          continue;
        }
        if (s.status === "refunded" || s.expired) {
          a.state = "dropped";
          report.actions.push(`deal ${s.dealId.slice(0, 10)}… ${s.status === "refunded" ? "refunded" : "expired"}; released`);
          continue;
        }
        a.state = "accepted";
        const mine = s.role === "seller" ? s.sellerFunded : s.buyerFunded;
        if (mine) continue;
        if (s.role === "seller" && !s.buyerFunded) continue; // payment locks first
        const r = await this.agent.deposit({ offerId });
        report.actions.push(`deposited as ${s.role} on deal ${s.dealId.slice(0, 10)}…: ${JSON.stringify(r).slice(0, 120)}`);
      } catch (e) {
        report.skipped.push(`answer ${offerId}: ${(e as Error).message}`);
      }
    }

    // 2. answer new postings that match a rule
    const open = [...this.answers.values()].filter((a) => a.state === "waiting").length;
    let room = Math.max(0, (this.cfg.maxOpenAnswers ?? 5) - open);
    const postings = await this.deps.api<Posting[]>("/rfqs");
    const now = this.deps.now?.() ?? Math.floor(Date.now() / 1000);
    const answered = new Set([...this.answers.values()].map((a) => a.rfqId));

    for (let i = 0; i < this.cfg.rules.length; i++) {
      const r = this.cfg.rules[i];
      const token = getAddress(r.token);
      const want = r.side === "sell" ? "buy" : "sell"; // we answer the opposite side
      const { done, pending } = this.committed(i);
      const maxTotal = await this.units(token, r.maxTotal);
      const maxPer = await this.units(token, r.maxPerDeal);
      let left = maxTotal - done - pending;

      for (const p of postings) {
        if (room <= 0 || left <= 0n) break;
        if ((p.side ?? "buy") !== want || getAddress(p.token) !== token || p.status !== "open" || p.expiresAt <= now) continue;
        if (answered.has(p.id)) continue;
        const burnToken = this.deps.burnToken ?? null;
        const pay =
          p.payToken === zeroAddress
            ? "ETH"
            : this.deps.usdg && getAddress(p.payToken) === getAddress(this.deps.usdg)
              ? "USDG"
              : burnToken && getAddress(p.payToken) === getAddress(burnToken)
                ? "OBSYN"
                : null;
        if (!pay || (r.payWith && r.payWith !== "any" && r.payWith !== pay)) continue;

        const q = await this.deps.quote(token).catch(() => ({ usd: null, ethUsd: null }));
        if (!q.usd || q.usd <= 0) {
          report.skipped.push(`posting ${p.id}: no reference price for the token, not answering`);
          continue;
        }
        const perToken = q.usd * (1 + r.priceVsMarketPct / 100);
        if (r.side === "sell" && r.minPriceUsd !== undefined && perToken < r.minPriceUsd) {
          report.skipped.push(`posting ${p.id}: ${perToken.toPrecision(4)} USD is under the floor ${r.minPriceUsd}`);
          continue;
        }
        if (r.side === "buy" && r.maxPriceUsd !== undefined && perToken > r.maxPriceUsd) {
          report.skipped.push(`posting ${p.id}: ${perToken.toPrecision(4)} USD is over the ceiling ${r.maxPriceUsd}`);
          continue;
        }

        // size: a fixed block must be taken whole unless it allows partial fills
        const decimals = await this.deps.decimals(token);
        let amount: bigint;
        if (p.amount) {
          const full = BigInt(p.amount) - BigInt(p.filledAmount ?? "0");
          amount = p.partial ? [full, maxPer, left].reduce((a, b) => (a < b ? a : b)) : full;
          if (!p.partial && (full > maxPer || full > left)) {
            report.skipped.push(`posting ${p.id}: block of ${formatUnits(full, decimals)} is over this rule's limit`);
            continue;
          }
        } else {
          const bySize = p.sizeUsd ? parseUnits((p.sizeUsd / perToken).toFixed(Math.min(decimals, 8)), decimals) : maxPer;
          amount = [bySize, maxPer, left].reduce((a, b) => (a < b ? a : b));
        }
        if (amount <= 0n) continue;

        const wholeTokens = Number(formatUnits(amount, decimals));
        const totalUsd = wholeTokens * perToken;
        // the price in what the deal is paid in: USDG ~ $1, ETH and $OBSYN at their market price
        let payUsd: number | null = pay === "USDG" ? 1 : pay === "ETH" ? q.ethUsd : null;
        if (pay === "OBSYN") payUsd = (await this.deps.quote(burnToken!).catch(() => ({ usd: null }))).usd;
        const total = payUsd && payUsd > 0 ? totalUsd / payUsd : null;
        if (!total || !Number.isFinite(total) || total <= 0) {
          report.skipped.push(`posting ${p.id}: no ${pay} price to quote in ${pay}`);
          continue;
        }
        const totalStr = total.toFixed(pay === "ETH" ? 12 : 6);

        // funds: what we'd hand over must already be in the wallet
        if (me) {
          const asset = r.side === "sell" ? token : pay === "ETH" ? zeroAddress : pay === "OBSYN" ? getAddress(burnToken!) : getAddress(this.deps.usdg!);
          const need = r.side === "sell" ? amount : parseUnits(totalStr, pay === "USDG" ? 6 : 18);
          const have = await this.deps.balanceOf(asset, me).catch(() => 0n);
          if (have < need) {
            report.skipped.push(`posting ${p.id}: wallet doesn't hold enough to cover it`);
            continue;
          }
        }

        const what = `${r.side === "sell" ? "offer" : "bid"} ${formatUnits(amount, decimals)} for ${totalStr} ${pay} (${r.priceVsMarketPct >= 0 ? "+" : ""}${r.priceVsMarketPct}% vs market) on posting ${p.id}`;
        if (!this.live) {
          report.actions.push(`[dry run] would ${what}`);
          left -= amount;
          room--;
          continue;
        }
        const res = await this.agent.sendOffer({
          bidId: p.id,
          totalPrice: totalStr,
          amount: formatUnits(amount, decimals),
          payoutAddress: r.side === "sell" ? r.payoutAddress : undefined,
        });
        this.answers.set(res.offerId, { rule: i, rfqId: p.id, amount, state: "waiting" });
        answered.add(p.id);
        left -= amount;
        room--;
        report.actions.push(`sent ${what}`);
      }
    }

    this.cfg.rules.forEach((r, i) => {
      const { done, pending } = this.committed(i);
      const dec = this.decCache.get(getAddress(r.token).toLowerCase());
      const f = (v: bigint) => (dec === undefined ? v.toString() : formatUnits(v, dec));
      report.totals.push({ rule: i + 1, side: r.side, token: r.token, done: f(done), pending: f(pending), left: (Number(r.maxTotal) - Number(f(done)) - Number(f(pending))).toString() });
    });
    for (const line of [...report.actions, ...report.skipped]) this.log(line);
    return report;
  }

  /** Run until `stop()` (or the process ends), one tick every intervalSec. */
  async run(signal?: { stopped: boolean }) {
    const every = Math.max(10, this.cfg.intervalSec ?? 30) * 1000;
    this.log(`autopilot ${this.live ? "LIVE" : "dry run"}: ${this.cfg.rules.length} rule(s), every ${every / 1000}s`);
    while (!signal?.stopped) {
      try {
        await this.tick();
      } catch (e) {
        this.log(`tick failed: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, every));
    }
  }

}

/** An autopilot wired to the Obsyn API and chain through `agent`. Prices come from each token's deepest DEX pool. */
export async function createAutopilot(agent: OtcAgent, cfg: AutopilotConfig, log?: (line: string) => void) {
  const server = await agent.config();
  return new Autopilot(agent, cfg, {
    api: (path) => agent.get(path),
    quote: async (token) => {
      const m = await agent.get<{ priceUsd: number | null; ethUsd: number | null }>(`/token/${token}/market`);
      return { usd: m.priceUsd, ethUsd: m.ethUsd };
    },
    balanceOf: (asset, who) => agent.balanceOf(asset, who),
    decimals: (token) => agent.decimalsOf(token),
    usdg: server.usdg,
    burnToken: server.payTokens?.find((p) => p.symbol === "OBSYN")?.address ?? null,
    log,
  });
}
