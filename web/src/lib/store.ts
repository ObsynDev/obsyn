/**
 * Per-browser convenience copies of your private links, so you can find your bids/offers again.
 * The link itself (with its #secret) is the real key; this is just a shortcut list.
 */
import type { Offer } from "./sealed.ts";

export interface SavedBid {
  id: string;
  link: string;
  token: string;
  createdAt: number;
}
export interface SavedOffer {
  id: string;
  rfqId: string;
  link: string;
  offer: Offer;
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
    localStorage.setItem(key, JSON.stringify(v.slice(0, 50)));
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
