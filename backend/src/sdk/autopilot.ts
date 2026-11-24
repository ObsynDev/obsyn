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
  /**
   * sell: answer buy bids with offers. buy: answer sell listings with bids.
   * both: a maker quote on both sides of one token, `spreadPct` above the market when selling and below it when buying.
   */
  side: "sell" | "buy" | "both";
  /** Token contract on Robinhood Chain, or a listed symbol like "NVDA" (resolved when the autopilot starts). */
  token: string;
  /** Which payment to accept (sell) or pay with (buy). Default: any. OBSYN only where the server accepts it. */
  payWith?: "ETH" | "USDG" | "OBSYN" | "any";
  /** Most tokens to sell (or buy) over the whole run, whole tokens. */
  maxTotal: string;
  /** Most tokens per deal, whole tokens. */
  maxPerDeal: string;
  /** Price against the token's DEX price: +5 = 5% above, -3 = 3% below. (sell and buy rules) */
  priceVsMarketPct?: number;
  /** both rules: sell this many % above the market and buy this many % below it (0 < spread ≤ 20). */
  spreadPct?: number;
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

type Answer = { key: string; rfqId: string; amount: bigint; state: "waiting" | "accepted" | "settled" | "dropped" };

export interface TickReport {
  live: boolean;
  actions: string[];
  skipped: string[];
  totals: { rule: number; side: "sell" | "buy"; token: string; done: string; pending: string; left: string }[];
}

const RULE_KEYS = new Set(["side", "token", "payWith", "maxTotal", "maxPerDeal", "priceVsMarketPct", "spreadPct", "minPriceUsd", "maxPriceUsd", "payoutAddress"]);

/** A one-sided rule, as the autopilot runs it (a `both` rule becomes one sell and one buy rule). */
type SidedRule = AutopilotRule & { side: "sell" | "buy"; priceVsMarketPct: number };

/** Turn `both` rules into a sell rule above the market and a buy rule below it, each with the same caps. */
export function expandRules(rules: AutopilotRule[]): SidedRule[] {
  const out: SidedRule[] = [];
  for (const r of rules) {
    if (r.side !== "both") {
      out.push(r as SidedRule);
      continue;
    }
    const { spreadPct, side: _side, minPriceUsd, maxPriceUsd, payoutAddress, ...common } = r;
    const s = Number(spreadPct);
    out.push({ ...common, side: "sell", priceVsMarketPct: s, ...(minPriceUsd !== undefined ? { minPriceUsd } : {}), ...(payoutAddress ? { payoutAddress } : {}) });
    out.push({ ...common, side: "buy", priceVsMarketPct: -s, ...(maxPriceUsd !== undefined ? { maxPriceUsd } : {}) });
  }
  return out;
}

/** Caps and settled totals are tracked per side, token and payment, so they survive edits to the rule list. */
const ruleKey = (r: SidedRule) => `${r.side}:${String(r.token).toLowerCase()}:${r.payWith ?? "any"}`;

/** What the autopilot must remember across restarts: answers still in play (it owes a deposit once accepted) and what settled. */
export interface LedgerData {
  answers: { offerId: string; key: string; rfqId: string; amount: string; state: Answer["state"] }[];
  done: Record<string, string>;
}
export interface Ledger {
  load(): LedgerData | null;
  save(d: LedgerData): void;
}

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
    if (r?.side !== "sell" && r?.side !== "buy" && r?.side !== "both") out.push(`${at}: side must be "sell", "buy" or "both"`);
    if (!isAddress(String(r?.token))) out.push(`${at}: token must be a contract address`);
    if (r?.payWith && !["ETH", "USDG", "OBSYN", "any"].includes(r.payWith)) out.push(`${at}: payWith must be ETH, USDG, OBSYN or any`);
    for (const k of ["maxTotal", "maxPerDeal"] as const) if (!/^\d+(\.\d+)?$/.test(String(r?.[k])) || Number(r?.[k]) <= 0) out.push(`${at}: ${k} must be a positive number of tokens`);
    if (Number(r?.maxPerDeal) > Number(r?.maxTotal)) out.push(`${at}: maxPerDeal can't exceed maxTotal`);
    if (r?.side === "both") {
      if (r.priceVsMarketPct !== undefined) out.push(`${at}: a "both" rule takes spreadPct, not priceVsMarketPct`);
      if (typeof r.spreadPct !== "number" || !Number.isFinite(r.spreadPct) || r.spreadPct <= 0 || r.spreadPct > 20) out.push(`${at}: spreadPct must be a number above 0 and at most 20`);
    } else {
      if (r?.spreadPct !== undefined) out.push(`${at}: spreadPct is for "both" rules`);
      if (typeof r?.priceVsMarketPct !== "number" || !Number.isFinite(r.priceVsMarketPct) || Math.abs(r.priceVsMarketPct) > 50) out.push(`${at}: priceVsMarketPct must be a number between -50 and 50`);
      else if (r.side === "sell" && r.priceVsMarketPct < -20) out.push(`${at}: selling more than 20% under market looks like a mistake`);
      else if (r.side === "buy" && r.priceVsMarketPct > 20) out.push(`${at}: buying more than 20% over market looks like a mistake`);
    }
    if (r?.payoutAddress && !isAddress(r.payoutAddress)) out.push(`${at}: payoutAddress must be an address`);
    if (r?.payoutAddress && r.side === "buy") out.push(`${at}: payoutAddress is for sell rules`);
    if (r?.minPriceUsd !== undefined && r.side === "buy") out.push(`${at}: minPriceUsd is for sell rules (use maxPriceUsd)`);
    if (r?.maxPriceUsd !== undefined && r.side === "sell") out.push(`${at}: maxPriceUsd is for buy rules (use minPriceUsd)`);
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
  /** Where answers in play and settled totals are kept, so a restart still deposits on accepted answers. Default: memory only. */
  ledger?: Ledger;
}

export class Autopilot {
  private answers = new Map<string, Answer>();
  private decCache = new Map<string, number>();
  private done = new Map<string, bigint>();
  private agent: OtcAgent;
  private cfg: AutopilotConfig;
  private rules: SidedRule[];
  private deps: AutopilotDeps;

  constructor(agent: OtcAgent, cfg: AutopilotConfig, deps: AutopilotDeps) {
    const problems = validateConfig(cfg);
    if (problems.length) throw new Error("Autopilot config: " + problems.join("; "));
    this.agent = agent;
    this.cfg = cfg;
    this.rules = expandRules(cfg.rules);
    this.deps = deps;
    const saved = deps.ledger?.load();
    if (saved) {
      for (const a of saved.answers ?? []) this.answers.set(a.offerId, { key: a.key, rfqId: a.rfqId, amount: BigInt(a.amount), state: a.state });
      for (const [k, v] of Object.entries(saved.done ?? {})) this.done.set(k, BigInt(v));
    }
  }

  /** Write the ledger (answers still in play, and settled totals). Finished answers are dropped from it. */
  private persist() {
    if (!this.deps.ledger) return;
    const answers: LedgerData["answers"] = [];
    for (const [offerId, a] of this.answers) if (a.state === "waiting" || a.state === "accepted") answers.push({ offerId, key: a.key, rfqId: a.rfqId, amount: a.amount.toString(), state: a.state });
    const done: Record<string, string> = {};
    for (const [k, v] of this.done) done[k] = v.toString();
    this.deps.ledger.save({ answers, done });
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
  private committed(key: string) {
    let pending = 0n;
    for (const a of this.answers.values()) if (a.key === key && (a.state === "waiting" || a.state === "accepted")) pending += a.amount;
    return { done: this.done.get(key) ?? 0n, pending };
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
          this.done.set(a.key, (this.done.get(a.key) ?? 0n) + a.amount);
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
        const msg = (e as Error).message;
        if (/wasn't sent by this agent/.test(msg)) {
          // the ledger names an answer this wallet's state store doesn't know (another key or state file): stop tracking it
          a.state = "dropped";
          report.actions.push(`answer ${offerId} isn't in this agent's state store (another wallet or state file?); no longer tracked`);
        } else report.skipped.push(`answer ${offerId}: ${msg}`);
      }
    }

    this.persist();

    // 2. answer new postings that match a rule
    const open = [...this.answers.values()].filter((a) => a.state === "waiting").length;
    let room = Math.max(0, (this.cfg.maxOpenAnswers ?? 5) - open);
    const postings = await this.deps.api<Posting[]>("/rfqs");
    const now = this.deps.now?.() ?? Math.floor(Date.now() / 1000);
    const answered = new Set([...this.answers.values()].map((a) => a.rfqId));

    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i];
      const key = ruleKey(r);
      const token = getAddress(r.token);
      const want = r.side === "sell" ? "buy" : "sell"; // we answer the opposite side
      const { done, pending } = this.committed(key);
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
        this.answers.set(res.offerId, { key, rfqId: p.id, amount, state: "waiting" });
        this.persist(); // right away: a crash before the end of the tick must not forget an answer we owe a deposit on
        answered.add(p.id);
        left -= amount;
        room--;
        report.actions.push(`sent ${what}`);
      }
    }

    this.rules.forEach((r, i) => {
      const { done, pending } = this.committed(ruleKey(r));
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
    this.log(`autopilot ${this.live ? "LIVE" : "dry run"}: ${this.rules.length} rule(s), every ${every / 1000}s${this.answers.size ? `, ${this.answers.size} answer(s) in play from the ledger` : ""}`);
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
export async function createAutopilot(agent: OtcAgent, cfg: AutopilotConfig, log?: (line: string) => void, ledger?: Ledger) {
  // rules may name tokens by symbol ("NVDA", "$OBSYN"); the autopilot works on addresses
  cfg = { ...cfg, rules: await Promise.all(cfg.rules.map(async (r) => ({ ...r, token: await agent.resolveToken(String(r.token)) }))) };
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
    ledger,
  });
}
