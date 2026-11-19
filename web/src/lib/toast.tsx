import { useEffect, useRef, useState } from "react";
import { api, type ActivityEvent } from "./api.ts";
import { saved } from "./store.ts";
import { knownToken } from "./tokens.ts";
import { fmtAmount, fmtUsd, Link } from "./ui.tsx";

/**
 * Small notifications in the bottom-left corner: your own transactions succeeding, and (unless muted)
 * live desk activity from everyone else. Purely cosmetic: nothing here can block or change a trade.
 */
export type ToastTone = "ok" | "info" | "live";
export interface ToastInput {
  tone: ToastTone;
  title: string;
  body?: string;
  link?: { to: string; label: string };
  /** a toast with the same key within a minute is dropped (two pages reporting the same deal) */
  key?: string;
}
interface Toast extends ToastInput {
  id: number;
}

const MAX_VISIBLE = 3;
const SHOW_MS = 6500;
let seq = 0;
let list: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const recentKeys = new Map<string, number>();

const emit = () => listeners.forEach((l) => l(list));

export function toast(t: ToastInput) {
  const nowMs = Date.now();
  if (t.key) {
    for (const [k, at] of recentKeys) if (nowMs - at > 60_000) recentKeys.delete(k);
    if (recentKeys.has(t.key)) return;
    recentKeys.set(t.key, nowMs);
  }
  list = [...list, { ...t, id: ++seq }].slice(-MAX_VISIBLE);
  emit();
}

function dismiss(id: number) {
  list = list.filter((t) => t.id !== id);
  emit();
}

function ToastItem({ t }: { t: Toast }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(SHOW_MS);
  useEffect(() => {
    if (paused) return;
    const start = Date.now();
    const timer = setTimeout(() => dismiss(t.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(1500, left.current - (Date.now() - start));
    };
  }, [paused, t.id]);
  return (
    <div
      className={`toast ${t.tone}`}
      role={t.tone === "live" ? undefined : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-dot" aria-hidden="true" />
      <div className="toast-text">
        <b>{t.title}</b>
        {t.body && <span>{t.body}</span>}
        {t.link && (
          <Link to={t.link.to} className="toast-link">
            {t.link.label} →
          </Link>
        )}
      </div>
      <div className="toast-side">
        <button type="button" className="toast-x" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
          ×
        </button>
        {t.tone === "live" && (
          <button type="button" className="toast-mute" onClick={() => (setMuted(true), dismiss(t.id))}>
            Mute
          </button>
        )}
      </div>
    </div>
  );
}

/** Renders the stack. Mounted once, in the app shell. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>(list);
  useEffect(() => {
    listeners.add(setItems);
    return () => void listeners.delete(setItems);
  }, []);
  return (
    <div className="toasts" aria-live="polite" aria-label="Notifications">
      {items.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

// ── live desk activity ──

const MUTE_KEY = "obsyn.activity.muted";
const muteListeners = new Set<(m: boolean) => void>();
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function setMuted(m: boolean) {
  try {
    if (m) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // storage blocked: muted for this page view only
  }
  mutedNow = m;
  muteListeners.forEach((l) => l(m));
}
let mutedNow = readMuted();

/** Footer switch for the live activity notifications. */
export function ActivityToggle() {
  const [muted, set] = useState(mutedNow);
  useEffect(() => {
    muteListeners.add(set);
    return () => void muteListeners.delete(set);
  }, []);
  return (
    <button type="button" className="activity-toggle" aria-pressed={!muted} onClick={() => setMuted(!muted)}>
      Live activity: {muted ? "off" : "on"}
    </button>
  );
}

const tokenCache = new Map<string, Promise<{ symbol: string; decimals: number }>>();
function tokenFacts(address: string): Promise<{ symbol: string; decimals: number }> {
  const k = knownToken(address);
  if (k) return Promise.resolve({ symbol: k.symbol, decimals: k.symbol === "USDG" ? 6 : 18 });
  const key = address.toLowerCase();
  let p = tokenCache.get(key);
  if (!p) {
    p = api.token(address).then(
      (t) => ({ symbol: t.symbol ?? "tokens", decimals: t.decimals ?? 18 }),
      () => ({ symbol: "tokens", decimals: 18 }),
    );
    tokenCache.set(key, p);
  }
  return p;
}

/** "20,000 OBSYN", "$25,000 of NVDA", or just "NVDA" when the size isn't known. */
async function sizeText(e: ActivityEvent): Promise<string> {
  const t = await tokenFacts(e.token);
  if (e.amount && /^\d+$/.test(e.amount)) {
    const whole = fmtAmount(e.amount, t.decimals, 2);
    return `${whole} ${t.symbol}`;
  }
  if (e.sizeUsd) return `${fmtUsd(e.sizeUsd)} of ${t.symbol}`;
  return t.symbol;
}

/** Turn one event into a toast, or null to skip it. Exported for tests. */
export async function activityToast(e: ActivityEvent, mine: { bids: Map<string, string>; offers: Map<string, string> }): Promise<ToastInput | null> {
  const size = await sizeText(e);
  const pay = (await tokenFacts(e.payToken)).symbol;
  const what = e.side === "sell" ? "listing" : "bid";
  const myPost = mine.bids.get(e.rfqId);
  const myAnswer = mine.offers.get(e.rfqId);
  if (myPost) {
    // your own posting: tell you about answers and settlement; you already saw "posted" and "accepted"
    if (e.kind === "answered") return { tone: "ok", title: `Your ${what} got a sealed answer`, body: size, link: { to: myPost, label: "Open your block" }, key: `ans:${e.id}` };
    if (e.kind === "settled") return { tone: "ok", title: "Your deal settled", body: `${size} for ${pay}`, link: e.tx ? { to: `/receipt/${e.tx}`, label: "View receipt" } : undefined, key: e.dealId ? `settled:${e.dealId}` : undefined };
    return null;
  }
  if (myAnswer) {
    // a block you answered (the answer itself may be yours, so stay quiet about answers)
    if (e.kind === "accepted") return { tone: "ok", title: `A deal was struck on a ${what} you answered`, body: `${size} · check whether it's yours`, link: { to: myAnswer, label: "Open your answer" }, key: `acc:${e.id}` };
    if (e.kind === "settled") return { tone: "ok", title: "A deal you answered settled", body: `${size} for ${pay}`, link: e.tx ? { to: `/receipt/${e.tx}`, label: "View receipt" } : undefined, key: e.dealId ? `settled:${e.dealId}` : undefined };
    return null;
  }
  if (mutedNow) return null;
  switch (e.kind) {
    case "posted":
      return { tone: "live", title: e.side === "sell" ? "New listing" : "New bid", body: `${size} · paid in ${pay}`, link: { to: `/rfq/${e.rfqId}`, label: e.side === "sell" ? "Make a bid" : "Make an offer" } };
    case "answered":
      return { tone: "live", title: `Sealed answer on a ${what}`, body: size, link: { to: `/rfq/${e.rfqId}`, label: "View block" } };
    case "accepted":
      return { tone: "live", title: "Deal struck", body: `${size} for ${pay} · waiting for deposits` };
    case "settled":
      return { tone: "live", title: "Deal settled on-chain", body: `${size} for ${pay}`, link: e.tx ? { to: `/receipt/${e.tx}`, label: "View receipt" } : undefined, key: e.dealId ? `settled:${e.dealId}` : undefined };
  }
  return null;
}

function myBlocks() {
  const bids = new Map<string, string>();
  const offers = new Map<string, string>();
  for (const b of saved.bids()) bids.set(b.id, b.link);
  for (const o of saved.offers()) offers.set(o.rfqId, o.link);
  return { bids, offers };
}

const POLL_MS = 15_000;
/** at most this many toasts from one poll; the rest are summarised */
const PER_POLL = 2;

/** Polls the desk's public activity while the tab is visible and shows what's new since the page opened. */
export function ActivityFeed() {
  useEffect(() => {
    let cursor: number | null = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await api.activity(cursor);
        if (!alive) return;
        const first = cursor === null;
        cursor = r.cursor;
        if (first || !r.events.length) return;
        const mine = myBlocks();
        const shown: ToastInput[] = [];
        for (const e of r.events) {
          const t = await activityToast(e, mine).catch(() => null);
          if (t) shown.push(t);
        }
        if (!alive) return;
        // your own news first, then the newest live activity
        const own = shown.filter((t) => t.tone !== "live");
        const live = shown.filter((t) => t.tone === "live");
        own.forEach(toast);
        const room = Math.max(0, PER_POLL - own.length);
        (room ? live.slice(-room) : []).forEach(toast);
        const more = live.length - room;
        if (room && more > 0 && !mutedNow) toast({ tone: "live", title: `${more} more on the desk`, link: { to: "/otc", label: "Open the desk" } });
      } catch {
        // offline or the server is redeploying: try again next tick
      } finally {
        busy = false;
      }
    };

    const loop = () => {
      timer = setTimeout(async () => {
        await tick();
        if (alive) loop();
      }, POLL_MS);
    };
    tick().finally(() => alive && loop());
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
