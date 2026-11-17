import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** buy: a buyer posted it, sellers answer. sell: a seller posted it, buyers answer. */
export type RfqSide = "buy" | "sell";
export type RfqStatus = "open" | "accepted" | "cancelled";
export type QuoteStatus = "pending" | "accepted" | "rejected";

export interface RfqRow {
  id: string;
  side: RfqSide;
  manage_hash: string;
  token: string;
  pay_token: string;
  amount: string | null;
  size_usd: number | null;
  buyer_enc_pubkey: string;
  note: string | null;
  expires_at: number;
  created_at: number;
  status: RfqStatus;
  accepted_quote_id: string | null;
  deal_id: string | null;
  settle_tx?: string | null;
  terms_json: string | null;
  /** 1 = several answers can each fill part of it (partial fills) */
  partial?: number;
}

export interface QuoteRow {
  id: string;
  rfq_id: string;
  quote_hash: string;
  seller_enc_pubkey: string;
  nonce: string;
  ciphertext: string;
  created_at: number;
  status: QuoteStatus;
  /** set when this answer was accepted: its own deal (partial fills give each fill its own deal) */
  deal_id?: string | null;
  terms_json?: string | null;
  settle_tx?: string | null;
}

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rfqs (
      id TEXT PRIMARY KEY,
      manage_hash TEXT NOT NULL,
      token TEXT NOT NULL,
      pay_token TEXT NOT NULL,
      amount TEXT,
      size_usd REAL,
      buyer_enc_pubkey TEXT NOT NULL,
      note TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      accepted_quote_id TEXT,
      deal_id TEXT,
      terms_json TEXT
    );
    CREATE INDEX IF NOT EXISTS rfqs_open ON rfqs(status, expires_at);
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL REFERENCES rfqs(id),
      quote_hash TEXT NOT NULL,
      seller_enc_pubkey TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS quotes_rfq ON quotes(rfq_id);
  `);
  // migration: sell-side listings (existing rows are buy-side bids)
  const cols = db.prepare("PRAGMA table_info(rfqs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "side")) db.exec("ALTER TABLE rfqs ADD COLUMN side TEXT NOT NULL DEFAULT 'buy'");
  // migration: the settlement transaction, for public deal receipts
  if (!cols.some((c) => c.name === "settle_tx")) db.exec("ALTER TABLE rfqs ADD COLUMN settle_tx TEXT");
  // migration: partial fills (each accepted answer is its own deal)
  if (!cols.some((c) => c.name === "partial")) db.exec("ALTER TABLE rfqs ADD COLUMN partial INTEGER NOT NULL DEFAULT 0");
  const qcols = db.prepare("PRAGMA table_info(quotes)").all() as { name: string }[];
  for (const col of ["deal_id", "terms_json", "settle_tx"]) if (!qcols.some((c) => c.name === col)) db.exec(`ALTER TABLE quotes ADD COLUMN ${col} TEXT`);
  return db;
}
