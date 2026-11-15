import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type RfqStatus = "open" | "accepted" | "cancelled";
export type QuoteStatus = "pending" | "accepted" | "rejected";

export interface RfqRow {
  id: string;
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
  terms_json: string | null;
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
  return db;
}
