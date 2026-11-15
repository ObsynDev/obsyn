import type { Address, Hex } from "viem";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export interface ServerConfig {
  chainId: number;
  rpcUrl: string;
  escrow: Address | null;
  usdg: Address | null;
  relayer: { enabled: boolean; address: Address | null; minFee: { eth: string; usdg: string } };
}

export interface Rfq {
  id: string;
  /** buy: a buyer posted it, sellers answer. sell: a seller posted it, buyers answer. */
  side?: "buy" | "sell";
  token: Address;
  payToken: Address;
  amount: string | null;
  sizeUsd: number | null;
  note: string | null;
  /** Poster's key: encrypt answers to this. */
  encPubKey?: string;
  buyerEncPubKey: string;
  createdAt?: number;
  expiresAt: number;
  status: "open" | "accepted" | "cancelled";
  quoteCount: number;
}

export interface SealedQuote {
  id: string;
  sellerEncPubKey: string;
  nonce: string;
  ciphertext: string;
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
}

export type TermsJson = Record<
  "buyer" | "seller" | "token" | "amount" | "payToken" | "price" | "sellerPayout" | "referrer" | "relayerFee" | "deadline" | "salt",
  string
>;

export interface DealInfo {
  dealId: Hex;
  terms: TermsJson;
  escrow: Address | null;
  chainId: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.problems ? `: ${json.problems.join("; ")}` : json.issues ? `: ${json.issues.map((i: any) => i.message).join("; ")}` : "";
    throw new ApiError(res.status, (json.error ?? `HTTP ${res.status}`) + detail);
  }
  return json as T;
}

let cfgPromise: Promise<ServerConfig> | null = null;

export const api = {
  config: () => (cfgPromise ??= req<ServerConfig>("GET", "/health")),
  listRfqs: () => req<Rfq[]>("GET", "/rfqs"),
  getRfq: (id: string) => req<Rfq>("GET", `/rfqs/${id}`),
  createRfq: (body: {
    side: "buy" | "sell";
    token: string;
    payToken: "ETH" | "USDG";
    amount?: string;
    sizeUsd?: number;
    replySeconds: number;
    encPubKey: string;
    note?: string;
  }) => req<{ id: string; manageToken: string; expiresAt: number }>("POST", "/rfqs", body),
  cancelRfq: (id: string, t: string) => req<{ ok: true }>("POST", `/rfqs/${id}/cancel`, {}, t),
  listQuotes: (id: string, t: string) => req<SealedQuote[]>("GET", `/rfqs/${id}/quotes`, undefined, t),
  submitQuote: (id: string, body: { sellerEncPubKey: string; nonce: string; ciphertext: string }) =>
    req<{ quoteId: string; quoteToken: string }>("POST", `/rfqs/${id}/quotes`, body),
  accept: (id: string, t: string, quoteId: string, terms: TermsJson) =>
    req<DealInfo>("POST", `/rfqs/${id}/accept`, { quoteId, terms }, t),
  getDeal: (id: string, t: string) => req<DealInfo & { quoteId: string }>("GET", `/rfqs/${id}/deal`, undefined, t),
  getQuote: (id: string, t: string) =>
    req<{ id: string; status: SealedQuote["status"]; rfq: Rfq; dealId: Hex | null; terms: TermsJson | null }>(
      "GET",
      `/quotes/${id}`,
      undefined,
      t,
    ),
  token: (address: string) =>
    req<{ address: Address; isContract: boolean; name: string | null; symbol: string | null; decimals: number | null; permit: boolean }>(
      "GET",
      `/token/${address}`,
    ),
  relayDeposit: (body: unknown) => req<{ txHash: Hex; dealId: Hex }>("POST", "/relay/deposit", body),
};
