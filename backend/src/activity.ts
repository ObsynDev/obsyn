import type { DatabaseSync } from "node:sqlite";

/**
 * Public desk activity for the site's live notifications: a block posted, a sealed answer sent, a deal
 * accepted, a deal settled. Only what is already public (the posting's side, token and size, the
 * settlement transaction); never a price, an address or anything from a sealed answer.
 */
export type ActivityKind = "posted" | "answered" | "accepted" | "settled";

export interface ActivityEvent {
  id: number;
  kind: ActivityKind;
  rfqId: string;
  side: "buy" | "sell";
  token: string;
  payToken: string;
  /** token base units (the posting's size, or the deal's amount once accepted); null for a USD-sized bid */
  amount: string | null;
  sizeUsd: number | null;
  /** the settlement transaction and the deal it settled (settled only; both public on-chain) */
  tx: string | null;
  dealId: string | null;
  at: number;
}

type Row = { id: number; kind: ActivityKind; ref: string; rfq_id: string; side: string; token: string; pay_token: string; amount: string | null; size_usd: number | null; tx: string | null; at: number };

const KEEP = 2000;

export function openActivity(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    rfq_id TEXT NOT NULL,
    side TEXT NOT NULL,
    token TEXT NOT NULL,
    pay_token TEXT NOT NULL,
    amount TEXT,
    size_usd REAL,
    tx TEXT,
    at INTEGER NOT NULL,
    UNIQUE (kind, ref)
  )`);
  const put = db.prepare(
    "INSERT OR IGNORE INTO activity (kind, ref, rfq_id, side, token, pay_token, amount, size_usd, tx, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const prune = db.prepare("DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - ?");
  const after = db.prepare("SELECT * FROM activity WHERE id > ? ORDER BY id DESC LIMIT ?");
  const last = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM activity");
  let added = 0;

  const toEvent = (r: Row): ActivityEvent => ({
    id: Number(r.id),
    kind: r.kind,
    rfqId: r.rfq_id,
    side: r.side === "sell" ? "sell" : "buy",
    token: r.token,
    payToken: r.pay_token,
    amount: r.amount,
    sizeUsd: r.size_usd,
    tx: r.tx,
    dealId: r.kind === "settled" ? r.ref : null,
    at: Number(r.at),
  });

  return {
    /**
     * Record an event once: `ref` identifies it (the posting, the answer, the deal), so reporting the same
     * settlement twice adds nothing. Never throws: notifications must not break trading.
     */
    add(e: { kind: ActivityKind; ref: string; rfqId: string; side: string; token: string; payToken: string; amount: string | null; sizeUsd: number | null; tx?: string | null; at: number }) {
      try {
        put.run(e.kind, e.ref.toLowerCase(), e.rfqId, e.side === "sell" ? "sell" : "buy", e.token, e.payToken, e.amount, e.sizeUsd, e.tx ?? null, e.at);
        if (++added % 100 === 0) prune.run(KEEP);
      } catch {
        // ignore
      }
    },
    /** Events newer than `cursor`, oldest first (at most `limit`, the newest ones), and the new cursor. */
    since(cursor: number | null, limit = 20): { cursor: number; events: ActivityEvent[] } {
      const top = Number((last.get() as { id: number }).id);
      if (cursor === null || cursor > top) return { cursor: top, events: [] };
      const rows = after.all(cursor, limit) as unknown as Row[];
      return { cursor: top, events: rows.map(toEvent).reverse() };
    },
  };
}
