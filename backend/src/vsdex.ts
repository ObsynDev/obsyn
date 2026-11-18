/**
 * "Saved vs DEX": what a settled block was worth against doing the same size as a market order on the
 * token's deepest DEX pool, using that pool's price and liquidity at settlement time.
 *
 * Same constant-product estimate as the price-impact hint on the desk (half the pool's liquidity per side):
 *   buying $S at spot on the DEX costs about S * (1 + S/Y)
 *   selling $S at spot on the DEX returns about S * (1 - S/(Y+S))
 * The buyer's saving is that DEX cost minus what the block cost; the seller's gain is what the block paid
 * minus what a DEX sell would have returned. Both are before fees, and both can be negative: we show
 * them as they come out. When the size is more than half the pool, the model says little, so no number.
 */
import type { DatabaseSync } from "node:sqlite";

export interface VsDexInput {
  /** whole tokens bought */
  amount: number;
  /** whole units of the pay token paid */
  paid: number;
  tokenUsd: number;
  payUsd: number;
  liquidityUsd: number;
}

export interface VsDex {
  /** block size at the DEX price, USD */
  sizeUsd: number;
  /** what the block cost, USD (price in the pay token at its USD price) */
  dealUsd: number;
  /** the DEX price per token at settlement */
  tokenUsd: number;
  liquidityUsd: number;
  /** null when the pool is too thin for the estimate to mean anything */
  buyerSavedUsd: number | null;
  sellerGainedUsd: number | null;
  /** estimated DEX price impact for this size, percent */
  buyImpactPct: number | null;
  sellImpactPct: number | null;
  thin: boolean;
}

export function vsDex(i: VsDexInput): VsDex | null {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!ok(i.amount) || !ok(i.paid) || !ok(i.tokenUsd) || !ok(i.payUsd) || !ok(i.liquidityUsd)) return null;
  const sizeUsd = i.amount * i.tokenUsd;
  const dealUsd = i.paid * i.payUsd;
  const y = i.liquidityUsd / 2;
  const thin = sizeUsd > y;
  const buyImpact = sizeUsd / y;
  const sellImpact = sizeUsd / (y + sizeUsd);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sizeUsd: r2(sizeUsd),
    dealUsd: r2(dealUsd),
    tokenUsd: i.tokenUsd,
    liquidityUsd: r2(i.liquidityUsd),
    buyerSavedUsd: thin ? null : r2(sizeUsd * (1 + buyImpact) - dealUsd),
    sellerGainedUsd: thin ? null : r2(dealUsd - sizeUsd * (1 - sellImpact)),
    buyImpactPct: thin ? null : r2(buyImpact * 100),
    sellImpactPct: thin ? null : r2(sellImpact * 100),
    thin,
  };
}

/** One snapshot per settled deal, taken when the settlement is first seen (and only if it is recent). */
export function openVsDexStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS deal_vs_dex (
    deal_id TEXT PRIMARY KEY,
    tx TEXT NOT NULL,
    at INTEGER NOT NULL,
    json TEXT NOT NULL
  )`);
  const get = db.prepare("SELECT json FROM deal_vs_dex WHERE deal_id = ?");
  const put = db.prepare("INSERT OR IGNORE INTO deal_vs_dex (deal_id, tx, at, json) VALUES (?, ?, ?, ?)");
  const all = db.prepare("SELECT json FROM deal_vs_dex");
  return {
    get(dealId: string): VsDex | null {
      const r = get.get(dealId.toLowerCase()) as { json: string } | undefined;
      return r ? (JSON.parse(r.json) as VsDex) : null;
    },
    put(dealId: string, tx: string, at: number, v: VsDex) {
      put.run(dealId.toLowerCase(), tx.toLowerCase(), at, JSON.stringify(v));
    },
    /** totals over every snapshot that has numbers */
    totals() {
      let buyers = 0;
      let sellers = 0;
      let deals = 0;
      for (const r of all.all() as { json: string }[]) {
        const v = JSON.parse(r.json) as VsDex;
        if (v.buyerSavedUsd === null || v.sellerGainedUsd === null) continue;
        buyers += v.buyerSavedUsd;
        sellers += v.sellerGainedUsd;
        deals++;
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return { deals, buyersSavedUsd: r2(buyers), sellersGainedUsd: r2(sellers) };
    },
  };
}
