import type { Address, Hex } from "viem";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export interface ServerConfig {
  chainId: number;
  rpcUrl: string;
  escrow: Address | null;
  usdg: Address | null;
  /** public WalletConnect / Reown project id; null = browser wallets only */
  walletConnectProjectId?: string | null;
  /** $OBSYN, filled in from the server once it launches (PLATFORM_TOKEN_* env vars) */
  platformToken?: { address: Address | null; ponsUrl: string | null; discountMin: string | null };
  relayer: { enabled: boolean; address: Address | null; minFee: { eth: string; usdg: string } };
  /** what deals can be paid in; OBSYN only with an escrow that burns its fee (OtcEscrowV2) */
  payTokens?: { symbol: string; address: Address; decimals: number; feeBps?: number; feeBurned?: boolean }[];
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
  /** several answers can each fill part of it */
  partial?: boolean;
  filled?: number;
  /** token base units already covered by accepted fills (fixed-size postings) */
  filledAmount?: string | null;
}

export interface Fills {
  partial: boolean;
  complete: boolean;
  filledAmount: string | null;
  escrow: Address | null;
  chainId: number;
  /** each deal's own escrow (deals made before an escrow switch stay on the old one) */
  deals: { quoteId: string; dealId: Hex; terms: TermsJson; settleTx: Hex | null; escrow?: Address | null }[];
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

export interface MarketRow {
  symbol: string;
  name: string;
  address: Address;
  kind: "stock" | "etf" | "crypto";
  /** delayed reference price of the underlying listing; null when the source is unavailable */
  ref: {
    source: string;
    ticker: string;
    exchange: string | null;
    currency: string;
    price: number;
    prevClose: number | null;
    changePct: number | null;
    weekChangePct: number | null;
    time: number;
    spark: number[];
  } | null;
  desk: { open: number; buy: number; sell: number };
}
/** Public receipt of a settled deal, rebuilt from the chain */
/** per pay currency, base units; obsyn: deals paid in $OBSYN (absent on older servers) */
type Amounts = { eth: string; usdg: string; obsyn?: string };

/** GET /stats: settled volume and fees in base units (ETH wei, USDG 6 decimals), plus the fee vault. */
export interface DeskStats {
  deals: { accepted: number; settled: number; refunded: number; open: number };
  volume: Amounts;
  fees: { protocol: Amounts; referrer: Amounts };
  /** $OBSYN the escrow burned itself at settlement (the fee on deals paid in $OBSYN) */
  burnedOnSettle?: string;
  /** totals over settled deals with a DEX snapshot: what buyers saved and sellers gained vs DEX market orders */
  vsDex?: { deals: number; buyersSavedUsd: number; sellersGainedUsd: number };
  volumeUsd: number | null;
  ethUsd: number | null;
  postings: { total: number; open: number; answers: number };
  tokensTraded: number;
  vault: {
    address: string;
    ethWaiting: string;
    usdgWaiting: string;
    totalBurned: string;
    burnedAtDead: string | null;
    /** buy route in use, and one queued behind the 2-day timelock (eta in unix seconds, 0 = none) */
    route: { active: string; pending: string; pendingEta: number } | null;
  } | null;
  updatedAt: number;
}

export interface ReferralSummary {
  referrer: string;
  deals: { accepted: number; settled: number };
  earned: Amounts;
  recent: { dealId: string; payToken: string; fee: string; settleTx: string | null; acceptedAt: number }[];
}

export interface DealReceipt {
  txHash: Hex;
  dealId: Hex;
  block: string;
  timestamp: number;
  settledBy: "depositPayment" | "depositTokens" | "depositTokensFor";
  terms: Record<string, string>;
  protocolFee: string;
  referrerFee: string;
  relayerFee: string;
  sellerProceeds: string;
  /** the block against a DEX market order of the same size, at settlement (null: no snapshot) */
  vsDex?: VsDex | null;
}

/** GET /control: who controls what, read live from the chain. */
export interface ControlReport {
  escrow: { address: Address | null; legacy: Address | null; owner: null; note: string };
  vault: {
    address: Address;
    owner: Address;
    ownerKind: "safe" | "timelock" | "account" | "contract";
    keeper: Address;
    keeperKind: "safe" | "timelock" | "account" | "contract";
    pendingOwner: Address | null;
    route: { active: Address | null; pending: Address | null; pendingEta: number };
    holds: { eth: string; usdg: string };
    totalBurned: string;
  };
  safe: { address: Address; threshold: number; signers: { address: Address; team: boolean }[]; version: string | null } | null;
  timelock: { address: Address; minDelay: number; queued: { id: Hex; target: Address; selector: string; label: string; readyAt: number }[]; queuedKnown: boolean } | null;
  burnedAtDead: string | null;
  updatedAt: number;
}

export interface VsDex {
  sizeUsd: number;
  dealUsd: number;
  tokenUsd: number;
  liquidityUsd: number;
  buyerSavedUsd: number | null;
  sellerGainedUsd: number | null;
  buyImpactPct: number | null;
  sellImpactPct: number | null;
  thin: boolean;
}
/** DEX snapshot of any token (reference only; deals settle at the sealed price) */
export interface TokenMarket {
  address: Address;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  imageUrl: string | null;
  pairUrl: string | null;
  pools: number;
  ethUsd: number | null;
}
export type ChartRange ="1d" | "5d" | "1mo" | "6mo" | "1y";
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
export interface MarketChart {
  symbol: string;
  range: ChartRange;
  exchange: string | null;
  currency: string;
  price: number;
  prevClose: number | null;
  changePct: number | null;
  rangeChangePct: number | null;
  time: number;
  candles: Candle[];
}

let cfgPromise: Promise<ServerConfig> | null = null;

export const api = {
  config: () => (cfgPromise ??= req<ServerConfig>("GET", "/health")),
  listRfqs: () => req<Rfq[]>("GET", "/rfqs"),
  markets: () => req<MarketRow[]>("GET", "/markets"),
  marketChart: (symbol: string, range: ChartRange) => req<MarketChart>("GET", `/markets/${symbol}/chart?range=${range}`),
  getRfq: (id: string) => req<Rfq>("GET", `/rfqs/${id}`),
  createRfq: (body: {
    side: "buy" | "sell";
    token: string;
    payToken: "ETH" | "USDG" | "OBSYN";
    amount?: string;
    sizeUsd?: number;
    replySeconds: number;
    encPubKey: string;
    note?: string;
    allowPartial?: boolean;
  }) => req<{ id: string; manageToken: string; expiresAt: number }>("POST", "/rfqs", body),
  cancelRfq: (id: string, t: string) => req<{ ok: true }>("POST", `/rfqs/${id}/cancel`, {}, t),
  listQuotes: (id: string, t: string) => req<SealedQuote[]>("GET", `/rfqs/${id}/quotes`, undefined, t),
  submitQuote: (id: string, body: { sellerEncPubKey: string; nonce: string; ciphertext: string }) =>
    req<{ quoteId: string; quoteToken: string }>("POST", `/rfqs/${id}/quotes`, body),
  accept: (id: string, t: string, quoteId: string, terms: TermsJson) =>
    req<DealInfo & { complete?: boolean }>("POST", `/rfqs/${id}/accept`, { quoteId, terms }, t),
  deals: (id: string, t: string) => req<Fills>("GET", `/rfqs/${id}/deals`, undefined, t),
  getDeal: (id: string, t: string) => req<DealInfo & { quoteId: string }>("GET", `/rfqs/${id}/deal`, undefined, t),
  getQuote: (id: string, t: string) =>
    req<{ id: string; status: SealedQuote["status"]; rfq: Rfq; dealId: Hex | null; terms: TermsJson | null; escrow: Address | null }>(
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
  tokenMarket: (address: string) => req<TokenMarket>("GET", `/token/${address}/market`),
  receipt: (tx: string) => req<DealReceipt>("GET", `/receipts/${tx}`),
  dealReceipt: (dealId: string) => req<{ txHash: Hex }>("GET", `/deals/${dealId}/receipt`),
  control: () => req<ControlReport>("GET", "/control"),
  stats: () => req<DeskStats>("GET", "/stats"),
  referrals: (address: string) => req<ReferralSummary>("GET", `/referrals/${address}`),
  reportSettled: (rfqId: string, txHash: string) => req<{ ok: true; txHash: Hex }>("POST", `/rfqs/${rfqId}/settled`, { txHash }),
  relayDeposit: (body: unknown) => req<{ txHash: Hex; dealId: Hex }>("POST", "/relay/deposit", body),
};
