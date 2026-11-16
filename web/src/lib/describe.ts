/**
 * "Describe it": turn a plain sentence into an order ticket, locally (nothing is sent anywhere).
 *   "Buy $5k of NVDA, reply within 6 hours"
 *   "sell 1,200 PONS for ETH in 15 min"
 *   "bid 25000 usd on 0xabc… paid in usdg, 1 day"
 * Pure function so it can be tested with plain node.
 */

export type Intent = {
  side?: "buy" | "sell";
  /** USD size (buy side) */
  usd?: number;
  /** token amount as typed (sell side) */
  amount?: string;
  /** token symbol as typed, or a contract address */
  token?: string;
  pay?: "ETH" | "USDG";
  /** reply window in seconds, snapped to the desk's choices */
  window?: number;
};

export const WINDOWS = [900, 3600, 21600, 86400] as const;

const mult = (s: string | undefined) => (!s ? 1 : /^k$/i.test(s) ? 1e3 : /^m$/i.test(s) ? 1e6 : 1);
const toNum = (n: string, suffix?: string) => Number(n.replace(/,/g, "")) * mult(suffix);

function snapWindow(sec: number) {
  return WINDOWS.reduce((best, w) => (Math.abs(w - sec) < Math.abs(best - sec) ? w : best), WINDOWS[0] as number);
}

export function parseIntent(text: string, symbols: string[]): Intent {
  const t = ` ${text.trim()} `;
  const out: Intent = {};
  const known = new Set(symbols.map((s) => s.toUpperCase()));

  if (/\b(sell|selling|dump|offload|list|exit)\b/i.test(t)) out.side = "sell";
  else if (/\b(buy|buying|bid|get|accumulate|ape)\b/i.test(t)) out.side = "buy";

  // payment token: "for ETH", "in usdg", "with eth", "pay(ing) in ETH", "paid in USDG"
  const pay = /\b(?:for|in|with|pay(?:ing)?(?:\s+(?:in|with))?|paid\s+(?:in|with))\s+(eth|usdg)\b/i.exec(t);
  if (pay) out.pay = pay[1].toUpperCase() as "ETH" | "USDG";

  // token: a contract address wins, else the first known symbol that isn't the payment token
  const ca = /\b0x[a-fA-F0-9]{40}\b/.exec(t);
  if (ca) out.token = ca[0];
  else {
    for (const w of t.match(/\$?[A-Za-z][A-Za-z0-9.]{1,11}/g) ?? []) {
      const s = w.replace(/^\$/, "").toUpperCase();
      if (!known.has(s)) continue;
      if ((s === "ETH" || s === "USDG") && (out.pay === s || !out.token)) {
        // "ETH"/"USDG" only count as the traded token if nothing else is named
        if (out.pay === s) continue;
      }
      out.token = s;
      if (s !== "ETH" && s !== "USDG") break;
    }
  }

  // USD size: "$5k", "5k usd", "25,000 dollars"
  const usd = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/i.exec(t) ?? /\b(\d[\d,]*(?:\.\d+)?)\s*([km])?\s*(?:usd|dollars?|bucks)\b/i.exec(t);
  if (usd) out.usd = toNum(usd[1], usd[2]);

  // token amount: "1,200 PONS", "1.5k NVDA" (a number right before a symbol)
  if (out.token && !/^0x/.test(out.token)) {
    // not a dollar figure ("$2m aapl" is a USD size, not 2m AAPL)
    const re = new RegExp(`(?<![$\\d.,])(\\d[\\d,]*(?:\\.\\d+)?)\\s*([km])?\\s*\\$?${out.token}\\b`, "i");
    const a = re.exec(t);
    if (a) out.amount = String(toNum(a[1], a[2]));
  } else if (out.side === "sell" && !usd) {
    const a = /\b(?:sell|selling|dump|offload|list|exit)\s+(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/i.exec(t);
    if (a) out.amount = String(toNum(a[1], a[2]));
  }

  // reply window: "15 min", "1 hour", "6h", "a day", "24 hours"
  // "m" alone means million ($2m), so minutes need "min"
  const mins = /(?<![$\d.,])(\d+)\s*(?:min|mins|minutes?)\b/i.exec(t);
  const hours = /(?<![$\d.,])(\d+)\s*(?:h|hr|hrs|hours?)\b/i.exec(t);
  const days = /\b(?:(\d+)\s*days?|a\s+day|one\s+day)\b/i.exec(t);
  if (mins) out.window = snapWindow(Number(mins[1]) * 60);
  else if (hours) out.window = snapWindow(Number(hours[1]) * 3600);
  else if (days) out.window = snapWindow(Number(days[1] ?? 1) * 86400);
  else if (/\b(an|one)\s+hour\b/i.test(t)) out.window = 3600;

  return out;
}
