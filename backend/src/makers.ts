/**
 * Makers: wallets that answer blocks on the desk (often with the autopilot), listed by their own choice.
 * Anyone can be a maker without listing; listing only adds a name and a public track record.
 *
 * A maker lists (or unlists) by signing a short message with the wallet itself: no gas, no account.
 * The track record comes from deals the server can already see (accepted terms name both wallets),
 * each checked against the escrow on-chain, so it can't be padded by reporting.
 */
import type { DatabaseSync } from "node:sqlite";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";

export const MAKER_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$/;
/** How long a signed listing message stays valid (seconds). */
export const SIGNATURE_WINDOW = 600;

export type MakerAction = "list" | "unlist";

/** The exact text a maker signs. The web page and the SDK build it the same way. */
export function makerMessage(action: MakerAction, address: Address, name: string, issuedAt: number) {
  return `Obsyn maker\nAction: ${action}\nName: ${name}\nWallet: ${getAddress(address)}\nIssued: ${issuedAt}`;
}

export class MakerError extends Error {}

type Row = { address: string; name: string; listed_at: number; issued_at: number; listed: number };

export interface MakerStats {
  /** deals where this wallet answered and the poster accepted */
  accepted: number;
  settled: number;
  /** still inside their funding window */
  open: number;
  /** past their deadline without settling (refunded or waiting for a refund) */
  unsettled: number;
  /** settled of finished deals, 0..1; null before any finished deal */
  settleRate: number | null;
}

export interface DealRef {
  dealId: string;
  escrow: string | null;
  answerer: string;
  deadline: number;
  settleTx: string | null;
}

export function openMakers(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS makers (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    listed_at INTEGER NOT NULL,
    issued_at INTEGER NOT NULL,
    listed INTEGER NOT NULL DEFAULT 1
  )`);
  const get = db.prepare("SELECT * FROM makers WHERE address = ?");
  const byName = db.prepare("SELECT address FROM makers WHERE name_key = ? AND listed = 1 AND address != ?");
  const upsert = db.prepare(
    `INSERT INTO makers (address, name, name_key, listed_at, issued_at, listed) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET name = excluded.name, name_key = excluded.name_key,
       listed_at = CASE WHEN makers.listed = 1 AND excluded.listed = 1 THEN makers.listed_at ELSE excluded.listed_at END,
       issued_at = excluded.issued_at, listed = excluded.listed`,
  );
  const listed = db.prepare("SELECT * FROM makers WHERE listed = 1 ORDER BY listed_at");

  return {
    /**
     * List or unlist a maker from a signed message. Throws MakerError with a reason for the caller.
     * Replays are refused: each message must be newer than the last one this wallet used.
     */
    async apply(input: { action: unknown; address: unknown; name: unknown; issuedAt: unknown; signature: unknown }, now: number) {
      const { action, address, name, issuedAt, signature } = input;
      if (action !== "list" && action !== "unlist") throw new MakerError("action must be list or unlist");
      if (typeof address !== "string" || !isAddress(address)) throw new MakerError("invalid wallet address");
      if (typeof name !== "string" || !MAKER_NAME.test(name)) throw new MakerError("name: 2-24 letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit");
      if (/obsyn/i.test(name)) throw new MakerError("name can't contain \"Obsyn\"");
      if (typeof issuedAt !== "number" || !Number.isInteger(issuedAt) || Math.abs(now - issuedAt) > SIGNATURE_WINDOW) throw new MakerError("the signed message has expired; sign again");
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new MakerError("invalid signature");
      const wallet = getAddress(address);
      const ok = await verifyMessage({ address: wallet, message: makerMessage(action, wallet, name, issuedAt), signature: signature as Hex }).catch(() => false);
      if (!ok) throw new MakerError("the signature doesn't match this wallet and message");
      const prev = get.get(wallet) as Row | undefined;
      if (prev && issuedAt <= prev.issued_at) throw new MakerError("this message was already used; sign again");
      const key = name.trim().toLowerCase().replace(/\s+/g, " ");
      if (action === "list" && byName.get(key, wallet)) throw new MakerError("that name is taken");
      upsert.run(wallet, name.trim(), key, now, issuedAt, action === "list" ? 1 : 0);
      return { address: wallet, name: name.trim(), listed: action === "list" };
    },
    listed(): { address: Address; name: string; listedAt: number }[] {
      return (listed.all() as unknown as Row[]).map((r) => ({ address: getAddress(r.address), name: r.name, listedAt: Number(r.listed_at) }));
    },
  };
}

/**
 * Every accepted deal the server knows, with the wallet that answered it (the seller on a buy bid,
 * the buyer on a sell listing). One row per deal, partial fills included.
 */
export function answeredDeals(db: DatabaseSync): DealRef[] {
  const rows = db
    .prepare(
      `SELECT q.deal_id AS deal_id, q.terms_json AS terms_json, q.settle_tx AS settle_tx, COALESCE(q.escrow, r.escrow) AS escrow, r.side AS side
         FROM quotes q JOIN rfqs r ON r.id = q.rfq_id
        WHERE q.status = 'accepted' AND q.deal_id IS NOT NULL AND q.terms_json IS NOT NULL
       UNION
       SELECT r.deal_id, r.terms_json, r.settle_tx, r.escrow, r.side
         FROM rfqs r
        WHERE r.deal_id IS NOT NULL AND r.terms_json IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.rfq_id = r.id AND q.deal_id = r.deal_id AND q.terms_json IS NOT NULL)`,
    )
    .all() as unknown as { deal_id: string; terms_json: string; settle_tx: string | null; escrow: string | null; side: string }[];
  const seen = new Set<string>();
  const out: DealRef[] = [];
  for (const r of rows) {
    const id = r.deal_id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const t = JSON.parse(r.terms_json) as { buyer: string; seller: string; deadline: string };
      out.push({ dealId: id, escrow: r.escrow, answerer: (r.side === "sell" ? t.buyer : t.seller).toLowerCase(), deadline: Number(t.deadline), settleTx: r.settle_tx });
    } catch {
      /* malformed terms: skip */
    }
  }
  return out;
}

/** A deal's on-chain status: 0 none, 1 open, 2 settled, 3 refunded. */
export type ReadStatus = (escrow: string | null, dealId: string) => Promise<number>;

/** Track records for the given wallets. Settled and refunded deals are final, so their reads are cached by the caller. */
export async function makerStats(wallets: string[], deals: DealRef[], readStatus: ReadStatus, now: number): Promise<Map<string, MakerStats>> {
  const want = new Set(wallets.map((w) => w.toLowerCase()));
  const out = new Map<string, MakerStats>();
  for (const w of want) out.set(w, { accepted: 0, settled: 0, open: 0, unsettled: 0, settleRate: null });
  await Promise.all(
    deals
      .filter((d) => want.has(d.answerer))
      .map(async (d) => {
        const s = out.get(d.answerer)!;
        s.accepted++;
        // a reported settlement was verified on-chain when it was recorded; otherwise ask the escrow
        const status = d.settleTx ? 2 : await readStatus(d.escrow, d.dealId).catch(() => -1);
        if (status === 2) s.settled++;
        else if (status === 3 || (status !== -1 && d.deadline <= now)) s.unsettled++;
        else s.open++; // inside its window, or the chain couldn't be read: not counted against anyone
      }),
  );
  for (const s of out.values()) {
    const finished = s.settled + s.unsettled;
    s.settleRate = finished ? s.settled / finished : null;
  }
  return out;
}
