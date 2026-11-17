/**
 * Per-browser convenience copies of your private links, so you can find your bids/offers again.
 * The link itself (with its #secret) is the real key; this is just a shortcut list.
 */
import type { BuyerBid, Offer } from "./sealed.ts";

export interface SavedBid {
  id: string;
  side?: "buy" | "sell";
  link: string;
  token: string;
  createdAt: number;
}
export interface SavedOffer {
  id: string;
  rfqId: string;
  link: string;
  side?: "buy" | "sell";
  offer: Offer | BuyerBid;
  createdAt: number;
}

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
function write<T>(key: string, v: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(v.slice(0, 200)));
  } catch {
    // storage unavailable (private mode): the link still works
  }
}

export const saved = {
  bids: () => read<SavedBid>("blockotc.bids"),
  addBid: (b: SavedBid) => write("blockotc.bids", [b, ...read<SavedBid>("blockotc.bids").filter((x) => x.id !== b.id)]),
  offers: () => read<SavedOffer>("blockotc.offers"),
  addOffer: (o: SavedOffer) => write("blockotc.offers", [o, ...read<SavedOffer>("blockotc.offers").filter((x) => x.id !== o.id)]),
  offer: (id: string) => read<SavedOffer>("blockotc.offers").find((o) => o.id === id),
};

// ── backup: move your private links to another browser or device ──

const LINK = /^\/(bid|offer)\/[\w-]{1,64}#[\w\-=&.%~]{1,2000}$/;
const isBid = (x: unknown): x is SavedBid => {
  const b = x as SavedBid;
  return !!b && typeof b.id === "string" && /^[\w-]{1,64}$/.test(b.id) && typeof b.link === "string" && LINK.test(b.link) && b.link.startsWith("/bid/") && typeof b.token === "string" && b.token.length <= 40 && typeof b.createdAt === "number" && (b.side === undefined || b.side === "buy" || b.side === "sell");
};
const isOffer = (x: unknown): x is SavedOffer => {
  const o = x as SavedOffer;
  return !!o && typeof o.id === "string" && /^[\w-]{1,64}$/.test(o.id) && typeof o.rfqId === "string" && /^[\w-]{1,64}$/.test(o.rfqId) && typeof o.link === "string" && LINK.test(o.link) && o.link.startsWith("/offer/") && typeof o.offer === "object" && o.offer !== null && typeof o.createdAt === "number";
};

/** Everything needed to get back to your blocks. Whoever holds this file controls them. */
export function exportBackup(): string {
  return JSON.stringify({ app: "obsyn", kind: "private-links", version: 1, exportedAt: new Date().toISOString(), bids: saved.bids(), offers: saved.offers() }, null, 2);
}

/** Merge a backup into this browser. Only well-formed Obsyn links are accepted; anything else is skipped. */
export function importBackup(text: string): { bids: number; offers: number; skipped: number } {
  let data: { app?: unknown; bids?: unknown; offers?: unknown };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a backup (not valid JSON).");
  }
  if (!data || data.app !== "obsyn" || !Array.isArray(data.bids) || !Array.isArray(data.offers)) throw new Error("This file isn't an Obsyn backup.");
  const bids = data.bids.filter(isBid);
  const offers = data.offers.filter(isOffer);
  const skipped = data.bids.length + data.offers.length - bids.length - offers.length;
  const mergedBids = [...bids, ...saved.bids()].filter((b, i, a) => a.findIndex((x) => x.id === b.id) === i).sort((a, b) => b.createdAt - a.createdAt);
  const mergedOffers = [...offers, ...saved.offers()].filter((o, i, a) => a.findIndex((x) => x.id === o.id) === i).sort((a, b) => b.createdAt - a.createdAt);
  write("blockotc.bids", mergedBids);
  write("blockotc.offers", mergedOffers);
  return { bids: bids.length, offers: offers.length, skipped };
}

/** Partner referral: ?ref=0x… on any page is remembered and earns that wallet half the fee. */
export function captureReferral() {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref)) {
    try {
      localStorage.setItem("blockotc.ref", ref);
    } catch {
      /* ignore */
    }
  }
}
export function referral(): string | null {
  try {
    return localStorage.getItem("blockotc.ref");
  } catch {
    return null;
  }
}
