/**
 * Agent-side client for BlockOTC. Runs on the agent's machine:
 *  - sealed offers are encrypted/decrypted here, so the server only sees ciphertext;
 *  - the wallet key (optional) never leaves this process. Without one, deposit tools
 *    return unsigned transactions for a human or another signer to send.
 */
import nacl from "tweetnacl";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  http,
  parseAbi,
  parseUnits,
  toHex,
  verifyMessage,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { OtcEscrowAbi } from "../abi/OtcEscrow.ts";
import { dealId as computeDealId, termsFromJson, termsToJson, type Terms } from "../terms.ts";

interface ServerConfig {
  chainId: number;
  rpcUrl: string;
  escrow: Address | null;
  usdg: Address | null;
  relayer: { enabled: boolean; address: Address | null; minFee: { eth: string; usdg: string } };
}

interface Rfq {
  id: string;
  /** buy: a buyer posted it, sellers answer. sell: a seller posted it, buyers answer. */
  side?: "buy" | "sell";
  token: Address;
  payToken: Address;
  amount: string | null;
  sizeUsd: number | null;
  note: string | null;
  buyerEncPubKey: string;
  expiresAt: number;
  status: string;
  quoteCount: number;
}

export interface Offer {
  amount: string;
  price: string;
  seller: string;
  sellerPayout: string;
  relayerFee: string;
  ghost: boolean;
  message?: string;
  /** Signature by `seller` over answerMessage(...) */
  sig?: Hex;
}

/** What a buyer puts inside the sealed box when answering a sell listing. Base units. */
export interface BuyerBid {
  amount: string;
  price: string;
  buyer: string;
  message?: string;
  /** Signature by `buyer` over answerMessage(...) */
  sig?: Hex;
}

export interface State {
  /** Things this agent posted: buy bids or sell listings (side defaults to "buy" for older state files). */
  bids: Record<string, { manageToken: string; boxSecret: string; createdAt: number; side?: "buy" | "sell"; ghostKey?: Hex }>;
  /** Answers this agent sent: seller offers on bids, or buyer bids on sell listings. */
  offers: Record<string, { quoteToken: string; rfqId: string; offer: Offer | BuyerBid; side?: "buy" | "sell"; ghostKey?: Hex; createdAt: number }>;
}

const sideOf = (r: { side?: "buy" | "sell" }) => r.side ?? "buy";

/**
 * Text an answerer signs with the wallet named in their answer. The poster checks it, so nobody
 * can post a fake answer in someone else's name. Must match web/src/lib/sealed.ts exactly.
 */
export function answerMessage(postingId: string, side: "buy" | "sell", address: string, amount: string, price: string) {
  return [
    "BlockOTC sealed answer",
    `posting: ${postingId}`,
    `role: ${side === "buy" ? "seller" : "buyer"}`,
    `address: ${getAddress(address)}`,
    `amount: ${amount}`,
    `price: ${price}`,
  ].join("\n");
}

async function verifyAnswer(pc: PublicClient, postingId: string, side: "buy" | "sell", who: Address, o: { amount: string; price: string; sig?: unknown }) {
  if (typeof o.sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(o.sig)) return false;
  const message = answerMessage(postingId, side, who, o.amount, o.price);
  const signature = o.sig as Hex;
  try {
    if (await verifyMessage({ address: who, message, signature })) return true; // plain wallets, offline
  } catch {
    /* fall through to the on-chain check */
  }
  try {
    return await pc.verifyMessage({ address: who, message, signature }); // smart wallets (ERC-1271/6492)
  } catch {
    return false;
  }
}

const isUint = (v: unknown): v is string => typeof v === "string" && /^\d{1,78}$/.test(v);

export interface StateStore {
  load(): State;
  save(s: State): void;
}

export class MemoryStore implements StateStore {
  private s: State = { bids: {}, offers: {} };
  load() {
    return structuredClone(this.s);
  }
  save(s: State) {
    this.s = structuredClone(s);
  }
}

export interface UnsignedTx {
  description: string;
  to: Address;
  data: Hex;
  value: string;
}

export interface AgentOptions {
  apiUrl: string;
  /** Where bid/offer secrets live. Default: in memory (lost on exit). Use FileStore in Node. */
  store?: StateStore;
  privateKey?: Hex;
  /** Override the RPC the server advertises (e.g. when it's blocked on your network). */
  rpcUrl?: string;
  fetch?: typeof fetch;
}

// tweetnacl only auto-detects randomness via `self.crypto` (browsers) or `require("crypto")` (CommonJS).
// Bundled as ESM in Node it finds neither, so wire it to Web Crypto, which both environments have.
if (!globalThis.crypto?.getRandomValues) throw new Error("BlockOTC SDK needs Web Crypto (crypto.getRandomValues)");
nacl.setPRNG((out, n) => {
  const buf = new Uint8Array(n);
  globalThis.crypto.getRandomValues(buf);
  out.set(buf);
  buf.fill(0);
});

const b64 = (u: Uint8Array) => { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const permitAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function eip712Domain() view returns (bytes1, string name, string version, uint256 chainId, address verifyingContract, bytes32, uint256[])",
]);

export class OtcAgent {
  private opts: AgentOptions;
  private cfg: ServerConfig | null = null;
  private pc: PublicClient | null = null;
  private fetch: typeof fetch;
  private store: StateStore;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.fetch = opts.fetch ?? fetch;
    this.store = opts.store ?? new MemoryStore();
  }

  // ─────────────────────────── plumbing ───────────────────────────

  private loadState(): State {
    return this.store.load();
  }

  private saveState(s: State) {
    this.store.save(s);
  }

  private async api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const res = await this.fetch(this.opts.apiUrl.replace(/\/$/, "") + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const extra = json.problems ? `: ${json.problems.join("; ")}` : json.issues ? `: ${json.issues.map((i: any) => i.message).join("; ")}` : "";
      throw new Error(`${json.error ?? `HTTP ${res.status}`}${extra}`);
    }
    return json as T;
  }

  async config(): Promise<ServerConfig> {
    return (this.cfg ??= await this.api<ServerConfig>("GET", "/health"));
  }

  private async chain() {
    const cfg = await this.config();
    const rpc = this.opts.rpcUrl ?? cfg.rpcUrl;
    const chain = defineChain({
      id: cfg.chainId,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    this.pc ??= createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
    return { cfg, chain, pc: this.pc, rpc };
  }

  private async wallet() {
    if (!this.opts.privateKey) return null;
    const { chain, rpc } = await this.chain();
    return createWalletClient({ chain, account: privateKeyToAccount(this.opts.privateKey), transport: http(rpc) });
  }

  get address(): Address | null {
    return this.opts.privateKey ? privateKeyToAccount(this.opts.privateKey).address : null;
  }

  private requireAddress(what: string): Address {
    const a = this.address;
    if (!a) throw new Error(`${what} needs a wallet: set BLOCKOTC_PRIVATE_KEY, or pass the address explicitly.`);
    return a;
  }

  private async token(address: Address) {
    if (address === zeroAddress) return { address, symbol: "ETH", decimals: 18 };
    const { pc } = await this.chain();
    const [symbol, decimals] = await Promise.all([
      pc.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      pc.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol, decimals };
  }

  private async escrow(): Promise<Address> {
    const cfg = await this.config();
    if (!cfg.escrow) throw new Error("The server has no escrow configured.");
    return cfg.escrow;
  }

  // ─────────────────────────── market ───────────────────────────

  async info() {
    const cfg = await this.config();
    return {
      chainId: cfg.chainId,
      escrow: cfg.escrow,
      usdg: cfg.usdg,
      relayer: cfg.relayer,
      agentWallet: this.address,
      signing: this.address ? "this agent signs and sends transactions" : "no key: deposit tools return unsigned transactions",
      fees: "2.5% under $10k, 2% from $10k, 1.5% from $100k (cap 2.5%), charged at settlement; bids/offers free",
    };
  }

  async listBids() {
    const rows = await this.api<Rfq[]>("GET", "/rfqs");
    const now = Math.floor(Date.now() / 1000);
    return Promise.all(
      rows.map(async (r) => {
        const [t, p] = await Promise.all([this.token(r.token).catch(() => null), this.token(r.payToken).catch(() => null)]);
        return {
          bidId: r.id,
          side: sideOf(r),
          token: r.token,
          symbol: t?.symbol ?? null,
          amount: r.amount && t ? formatUnits(BigInt(r.amount), t.decimals) : null,
          payWith: p?.symbol ?? r.payToken,
          offers: r.quoteCount,
          secondsLeft: r.expiresAt - now,
          note: r.note,
        };
      }),
    );
  }

  // ─────────────────────────── posting ───────────────────────────

  private async post(side: "buy" | "sell", a: { token: string; amount: string; payWith: "ETH" | "USDG"; replyMinutes: number; note?: string }) {
    const tok = await this.token(getAddress(a.token));
    const amount = parseUnits(a.amount, tok.decimals);
    const keys = nacl.box.keyPair();
    const res = await this.api<{ id: string; manageToken: string; shareUrl: string; expiresAt: number }>("POST", "/rfqs", {
      side,
      token: tok.address,
      payToken: a.payWith,
      amount: amount.toString(),
      replySeconds: Math.round(a.replyMinutes * 60),
      encPubKey: b64(keys.publicKey),
      note: a.note,
    });
    const s = this.loadState();
    s.bids[res.id] = { manageToken: res.manageToken, boxSecret: b64(keys.secretKey), createdAt: Date.now(), side };
    this.saveState(s);
    return { bidId: res.id, side, token: tok.symbol, amount: a.amount, payWith: a.payWith, shareUrl: res.shareUrl, expiresAt: res.expiresAt };
  }

  /** Buyer posts first: sellers answer with sealed offers. */
  createBid(a: { token: string; amount: string; payWith: "ETH" | "USDG"; replyMinutes: number; note?: string }) {
    return this.post("buy", a);
  }

  /** Seller posts first ("sell privately"): buyers answer with sealed bids. */
  createListing(a: { token: string; amount: string; payWith: "ETH" | "USDG"; replyMinutes: number; note?: string }) {
    return this.post("sell", a);
  }

  private bid(bidId: string) {
    const b = this.loadState().bids[bidId];
    if (!b) throw new Error(`Bid ${bidId} wasn't created by this agent (no key in its state store).`);
    return b;
  }

  /**
   * Decrypt the sealed answers on something this agent posted.
   * On a buy bid: seller offers, cheapest first. On a sell listing: buyer bids, highest first.
   */
  async getOffers(bidId: string) {
    const b = this.bid(bidId);
    const rfq = await this.api<Rfq>("GET", `/rfqs/${bidId}`);
    const side = sideOf(rfq);
    const quotes = await this.api<{ id: string; sellerEncPubKey: string; nonce: string; ciphertext: string; status: string }[]>(
      "GET",
      `/rfqs/${bidId}/quotes`,
      undefined,
      b.manageToken,
    );
    const [tok, pay] = await Promise.all([this.token(rfq.token), this.token(rfq.payToken)]);
    const secret = unb64(b.boxSecret);
    const amountWhole = rfq.amount ? Number(formatUnits(BigInt(rfq.amount), tok.decimals)) : NaN;
    const { pc } = await this.chain();
    const rows = await Promise.all(
      quotes.map(async (q) => {
        let o: Offer & BuyerBid;
        try {
          const opened = nacl.box.open(unb64(q.ciphertext), unb64(q.nonce), unb64(q.sellerEncPubKey), secret);
          if (!opened) return null;
          o = JSON.parse(new TextDecoder().decode(opened));
        } catch {
          return null;
        }
        // Anyone can post an answer, so treat its contents as hostile: one malformed answer
        // must never break reading the others.
        if (!o || typeof o !== "object" || o.amount !== rfq.amount || !isUint(o.price)) return null;
        if (side === "buy" && (!isAddress(String(o.seller)) || !isAddress(String(o.sellerPayout)) || !isUint(o.relayerFee))) return null;
        if (side === "sell" && !isAddress(String(o.buyer))) return null;

        const who = getAddress(side === "buy" ? o.seller : o.buyer);
        // Signed by the wallet it names? Stops fake answers "from" someone else's wallet.
        const verified = await verifyAnswer(pc, bidId, side, who, o);
        // Can that wallet actually pay / deliver right now? (A ghost wallet is funded only after acceptance.)
        const hasFunds =
          side === "buy" && o.ghost
            ? null
            : await (side === "buy"
                ? pc.readContract({ address: rfq.token, abi: erc20Abi, functionName: "balanceOf", args: [who] }).then((x) => x >= BigInt(o.amount))
                : (rfq.payToken === zeroAddress
                    ? pc.getBalance({ address: who })
                    : pc.readContract({ address: rfq.payToken, abi: erc20Abi, functionName: "balanceOf", args: [who] })
                  ).then((x) => x >= BigInt(o.price))
              ).catch(() => null);

        const total = Number(formatUnits(BigInt(o.price), pay.decimals));
        const common = {
          offerId: q.id,
          totalPrice: formatUnits(BigInt(o.price), pay.decimals),
          payWith: pay.symbol,
          unitPrice: total / amountWhole,
          verified,
          hasFunds,
          message: typeof o.message === "string" ? o.message.slice(0, 200) : null,
          status: q.status,
        };
        return side === "buy"
          ? { ...common, seller: who, ghost: !!o.ghost, relayerFee: formatUnits(BigInt(o.relayerFee), pay.decimals), _offer: o as Offer }
          : { ...common, buyer: who, _offer: o as BuyerBid };
      }),
    );
    // Verified answers first, then best price.
    return rows
      .filter((x) => x !== null)
      .sort((x, y) => Number(y.verified) - Number(x.verified) || (side === "buy" ? x.unitPrice - y.unitPrice : y.unitPrice - x.unitPrice));
  }

  /**
   * Fix the deal with one answer.
   * Buy bid: this agent is the buyer. Sell listing: this agent is the seller, and may choose
   * a payout address and ghost mode (a one-time wallet + gasless relayed deposit).
   */
  async acceptOffer(a: {
    bidId: string;
    offerId: string;
    fundingMinutes: number;
    buyer?: string;
    seller?: string;
    payoutAddress?: string;
    ghost?: boolean;
    referrer?: string;
    /** Accept an answer whose signature doesn't check out (not recommended). */
    allowUnverified?: boolean;
  }) {
    const b = this.bid(a.bidId);
    const rfq = await this.api<Rfq>("GET", `/rfqs/${a.bidId}`);
    const side = sideOf(rfq);
    const answer = (await this.getOffers(a.bidId)).find((o) => o.offerId === a.offerId);
    if (!answer) throw new Error("Answer not found or unreadable for this posting.");
    if (!answer.verified && !a.allowUnverified) {
      throw new Error(
        "This answer isn't signed by the wallet it names, so it may be fake (someone using another wallet's address to stall you). Pass allowUnverified=true to accept it anyway.",
      );
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.round(a.fundingMinutes * 60));
    const referrer = a.referrer ? getAddress(a.referrer) : zeroAddress;

    let terms: Terms;
    if (side === "buy") {
      const o = answer._offer as Offer;
      terms = {
        buyer: a.buyer ? getAddress(a.buyer) : this.requireAddress("Accepting"),
        seller: getAddress(o.seller),
        token: rfq.token,
        amount: BigInt(o.amount),
        payToken: rfq.payToken,
        price: BigInt(o.price),
        sellerPayout: getAddress(o.sellerPayout),
        referrer,
        relayerFee: BigInt(o.relayerFee),
        deadline,
        salt: toHex(nacl.randomBytes(32)),
      };
    } else {
      const o = answer._offer as BuyerBid;
      const cfg = await this.config();
      let seller: Address;
      let ghostKey: Hex | undefined;
      if (a.ghost) {
        if (!cfg.relayer.enabled) throw new Error("Ghost mode is unavailable: the relayer is offline.");
        ghostKey = generatePrivateKey();
        seller = privateKeyToAccount(ghostKey).address;
      } else {
        seller = a.seller ? getAddress(a.seller) : this.requireAddress("Accepting");
      }
      const payout = a.payoutAddress ? getAddress(a.payoutAddress) : this.address;
      if (!payout) throw new Error("Give payoutAddress (where the payment should go).");
      terms = {
        buyer: getAddress(o.buyer),
        seller,
        token: rfq.token,
        amount: BigInt(o.amount),
        payToken: rfq.payToken,
        price: BigInt(o.price),
        sellerPayout: payout,
        referrer,
        relayerFee: a.ghost ? BigInt(rfq.payToken === zeroAddress ? cfg.relayer.minFee.eth : cfg.relayer.minFee.usdg) : 0n,
        deadline,
        salt: toHex(nacl.randomBytes(32)),
      };
      if (ghostKey) {
        // keep the one-time key before telling the server, so it is never lost
        const s = this.loadState();
        s.bids[a.bidId] = { ...s.bids[a.bidId], ghostKey };
        this.saveState(s);
      }
    }
    const res = await this.api<{ dealId: Hex }>("POST", `/rfqs/${a.bidId}/accept`, { quoteId: a.offerId, terms: termsToJson(terms) }, b.manageToken);
    return {
      dealId: res.dealId,
      terms: termsToJson(terms),
      ghostWallet: side === "sell" && a.ghost ? terms.seller : null,
      next: side === "buy" ? "Deposit the payment with otc_deposit." : "Deposit the tokens with otc_deposit.",
    };
  }

  // ─────────────────────────── answering ───────────────────────────

  /**
   * Answer someone else's posting with a sealed price, encrypted to the poster.
   * On a buy bid this is a seller offer (ghost mode available). On a sell listing it is a buyer bid.
   */
  async sendOffer(a: { bidId: string; totalPrice: string; payoutAddress?: string; ghost?: boolean; message?: string; seller?: string; buyer?: string }) {
    const cfg = await this.config();
    const rfq = await this.api<Rfq & { encPubKey?: string }>("GET", `/rfqs/${a.bidId}`);
    const side = sideOf(rfq);
    if (!rfq.amount) throw new Error("This posting has no fixed size.");
    const pay = await this.token(rfq.payToken);
    const price = parseUnits(a.totalPrice, pay.decimals).toString();
    let ghostKey: Hex | undefined;
    let payload: Offer | BuyerBid;
    let who: Address;

    if (side === "buy") {
      if (a.ghost) {
        if (!cfg.relayer.enabled) throw new Error("Ghost mode is unavailable: the relayer is offline.");
        ghostKey = generatePrivateKey();
        who = privateKeyToAccount(ghostKey).address;
      } else {
        who = a.seller ? getAddress(a.seller) : this.requireAddress("Offering");
      }
      const payout = a.payoutAddress ? getAddress(a.payoutAddress) : this.address;
      if (!payout) throw new Error("Give payoutAddress (where the payment should go).");
      const relayerFee = a.ghost ? BigInt(rfq.payToken === zeroAddress ? cfg.relayer.minFee.eth : cfg.relayer.minFee.usdg) : 0n;
      payload = { amount: rfq.amount, price, seller: who, sellerPayout: payout, relayerFee: relayerFee.toString(), ghost: Boolean(a.ghost), message: a.message };
    } else {
      if (a.ghost) throw new Error("Ghost mode is for sellers. On a sell listing you are the buyer.");
      who = a.buyer ? getAddress(a.buyer) : this.requireAddress("Bidding");
      payload = { amount: rfq.amount, price, buyer: who, message: a.message };
    }

    // Prove the named wallet is ours. Without a key for it (an explicit seller/buyer address and
    // no private key) the answer goes out unsigned and the poster sees it as unverified.
    const signer = ghostKey ? privateKeyToAccount(ghostKey) : this.opts.privateKey ? privateKeyToAccount(this.opts.privateKey) : null;
    if (signer && signer.address === who) {
      payload.sig = await signer.signMessage({ message: answerMessage(a.bidId, side, who, rfq.amount, price) });
    }

    const eph = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const box = nacl.box(new TextEncoder().encode(JSON.stringify(payload)), nonce, unb64(rfq.encPubKey ?? rfq.buyerEncPubKey), eph.secretKey);
    const res = await this.api<{ quoteId: string; quoteToken: string }>("POST", `/rfqs/${a.bidId}/quotes`, {
      sellerEncPubKey: b64(eph.publicKey),
      nonce: b64(nonce),
      ciphertext: b64(box),
    });
    const s = this.loadState();
    s.offers[res.quoteId] = { quoteToken: res.quoteToken, rfqId: a.bidId, offer: payload, side, ghostKey, createdAt: Date.now() };
    this.saveState(s);
    return {
      offerId: res.quoteId,
      sealed: true,
      as: side === "buy" ? "seller" : "buyer",
      address: who,
      ghostWallet: ghostKey ? who : null,
      next: "Poll otc_deal_status with this offerId until it is accepted, then otc_deposit.",
    };
  }

  private offer(offerId: string) {
    const o = this.loadState().offers[offerId];
    if (!o) throw new Error(`Offer ${offerId} wasn't sent by this agent (no record in its state store).`);
    return o;
  }

  // ─────────────────────────── deals ───────────────────────────

  /**
   * Resolve the deal for something this agent posted (bidId) or answered (offerId).
   * Role: posting a buy bid or answering a sell listing = buyer; the other two = seller.
   */
  private async deal(ref: { bidId?: string; offerId?: string }) {
    if (ref.bidId) {
      const b = this.bid(ref.bidId);
      const role = sideOf(b) === "buy" ? ("buyer" as const) : ("seller" as const);
      const d = await this.api<{ dealId: Hex; terms: Record<string, string> }>("GET", `/rfqs/${ref.bidId}/deal`, undefined, b.manageToken);
      return { role, dealId: d.dealId, terms: termsFromJson(d.terms), ghostKey: role === "seller" ? b.ghostKey : undefined };
    }
    if (ref.offerId) {
      const rec = this.offer(ref.offerId);
      const role = sideOf(rec) === "buy" ? ("seller" as const) : ("buyer" as const);
      const q = await this.api<{ status: string; dealId: Hex | null; terms: Record<string, string> | null }>(
        "GET",
        `/quotes/${ref.offerId}`,
        undefined,
        rec.quoteToken,
      );
      if (q.status !== "accepted" || !q.terms || !q.dealId) return { role, pending: q.status };
      const terms = termsFromJson(q.terms);
      // The other side wrote these terms. Refuse to proceed if they differ from what we sent.
      const sent = rec.offer as Partial<Offer & BuyerBid>;
      const bad =
        role === "seller"
          ? [
              terms.price !== BigInt(sent.price!) && "price",
              terms.amount !== BigInt(sent.amount!) && "amount",
              terms.seller !== getAddress(sent.seller!) && "seller",
              terms.sellerPayout !== getAddress(sent.sellerPayout!) && "payout address",
              terms.relayerFee !== BigInt(sent.relayerFee!) && "relayer fee",
            ]
          : [
              terms.price !== BigInt(sent.price!) && "price",
              terms.amount !== BigInt(sent.amount!) && "amount",
              terms.buyer !== getAddress(sent.buyer!) && "buyer",
            ];
      const problems = bad.filter(Boolean);
      if (problems.length) throw new Error(`Accepted terms don't match what we sent (${problems.join(", ")}). Do not deposit.`);
      if (computeDealId(terms) !== q.dealId) throw new Error("Deal id mismatch. Do not deposit.");
      return { role, dealId: q.dealId, terms, ghostKey: rec.ghostKey };
    }
    throw new Error("Pass bidId (something you posted) or offerId (something you answered).");
  }

  async dealStatus(ref: { bidId?: string; offerId?: string }) {
    const d = await this.deal(ref);
    if (!("dealId" in d) || !d.dealId) return { role: d.role, offer: d.pending, deal: null };
    const { pc } = await this.chain();
    const escrow = await this.escrow();
    const [status, buyerFunded, sellerFunded] = await pc.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [d.dealId] });
    const [tok, pay] = await Promise.all([this.token(d.terms.token), this.token(d.terms.payToken)]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    return {
      role: d.role,
      dealId: d.dealId,
      status: (["not funded yet", "open", "settled", "refunded"] as const)[status],
      buyerFunded,
      sellerFunded,
      expired: d.terms.deadline <= now,
      secondsLeft: Number(d.terms.deadline - now),
      buyerGets: `${formatUnits(d.terms.amount, tok.decimals)} ${tok.symbol}`,
      sellerGets: `${formatUnits(d.terms.price, pay.decimals)} ${pay.symbol} (before fees)`,
      ghostWallet: d.ghostKey ? privateKeyToAccount(d.ghostKey).address : null,
    };
  }

  async deposit(ref: { bidId?: string; offerId?: string }) {
    const d = await this.deal(ref);
    if (!("dealId" in d) || !d.dealId) throw new Error(`The offer is ${d.pending}; nothing to deposit yet.`);
    const escrow = await this.escrow();
    const { pc } = await this.chain();
    const t = d.terms;
    const [status, buyerFunded, sellerFunded] = await pc.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [d.dealId] });
    if (status >= 2) return { done: true, message: "Deal already settled or refunded." };
    if (t.deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Funding deadline passed. Use otc_refund.");

    if (d.role === "seller" && d.ghostKey) return this.ghostDeposit(escrow, t, d.ghostKey, buyerFunded, sellerFunded);

    const txs: UnsignedTx[] = [];
    if (d.role === "buyer") {
      if (buyerFunded) return { done: true, message: "Payment already deposited." };
      if (t.payToken !== zeroAddress) {
        const allowance = await pc.readContract({ address: t.payToken, abi: erc20Abi, functionName: "allowance", args: [t.buyer, escrow] });
        if (allowance < t.price) txs.push(this.approveTx(t.payToken, escrow, t.price));
      }
      txs.push({
        description: "Deposit payment into the escrow",
        to: escrow,
        data: encodeFunctionData({ abi: OtcEscrowAbi, functionName: "depositPayment", args: [t] }),
        value: t.payToken === zeroAddress ? t.price.toString() : "0",
      });
      return this.sendOrReturn(txs, t.buyer);
    }

    if (sellerFunded) return { done: true, message: "Tokens already deposited." };
    const allowance = await pc.readContract({ address: t.token, abi: erc20Abi, functionName: "allowance", args: [t.seller, escrow] });
    if (allowance < t.amount) txs.push(this.approveTx(t.token, escrow, t.amount));
    txs.push({
      description: "Deposit tokens into the escrow",
      to: escrow,
      data: encodeFunctionData({ abi: OtcEscrowAbi, functionName: "depositTokens", args: [t] }),
      value: "0",
    });
    return this.sendOrReturn(txs, t.seller);
  }

  private approveTx(token: Address, spender: Address, amount: bigint): UnsignedTx {
    return {
      description: `Approve the escrow to take ${amount} base units`,
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
      value: "0",
    };
  }

  private async sendOrReturn(txs: UnsignedTx[], from: Address) {
    const w = await this.wallet();
    if (!w || w.account.address !== from) {
      return { signed: false, from, transactions: txs, message: "Send these in order from the address shown." };
    }
    const { pc } = await this.chain();
    const hashes: Hex[] = [];
    for (const tx of txs) {
      const hash = await w.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
      const r = await pc.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`Transaction reverted: ${tx.description} (${hash})`);
      hashes.push(hash);
    }
    return { signed: true, transactions: hashes };
  }

  private async ghostDeposit(escrow: Address, t: Terms, ghostKey: Hex, buyerFunded: boolean, sellerFunded: boolean) {
    if (sellerFunded) return { done: true, message: "Tokens already deposited." };
    const { cfg, pc } = await this.chain();
    const ghost = privateKeyToAccount(ghostKey);
    const steps: string[] = [];

    // 1. move tokens from the agent's main wallet into the one-time wallet
    const bal = await pc.readContract({ address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [ghost.address] });
    if (bal < t.amount) {
      const fund: UnsignedTx = {
        description: `Send tokens to the one-time wallet ${ghost.address}`,
        to: t.token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ghost.address, t.amount - bal] }),
        value: "0",
      };
      const w = await this.wallet();
      if (!w) return { signed: false, transactions: [fund], message: "Fund the one-time wallet, then call otc_deposit again." };
      const r = await this.sendOrReturn([fund], w.account.address);
      steps.push(`funded one-time wallet: ${JSON.stringify(r.transactions)}`);
    }

    // 2. the relayer only submits once the buyer has paid in
    if (!buyerFunded) {
      return { done: false, steps, message: "One-time wallet is funded. Waiting for the buyer's deposit; call otc_deposit again after it lands." };
    }

    // 3. sign permit + deposit authorization with the one-time key, relayer pays gas
    const relayer = cfg.relayer.address;
    if (!cfg.relayer.enabled || !relayer) throw new Error("The relayer is offline.");
    let name: string;
    let version = "1";
    try {
      const dom = await pc.readContract({ address: t.token, abi: permitAbi, functionName: "eip712Domain" });
      name = dom[1];
      version = dom[2];
    } catch {
      name = await pc.readContract({ address: t.token, abi: permitAbi, functionName: "name" });
    }
    const nonce = await pc.readContract({ address: t.token, abi: permitAbi, functionName: "nonces", args: [ghost.address] }).catch(() => {
      throw new Error("Token has no EIP-2612 permit; ghost mode can't deposit it gaslessly.");
    });
    const permitSig = await ghost.signTypedData({
      domain: { name, version, chainId: cfg.chainId, verifyingContract: t.token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: ghost.address, spender: escrow, value: t.amount, nonce, deadline: t.deadline },
    });
    const sellerSig = await ghost.signTypedData({
      domain: { name: "BlockOTC", version: "1", chainId: cfg.chainId, verifyingContract: escrow },
      types: { Deposit: [{ name: "dealId", type: "bytes32" }, { name: "relayer", type: "address" }] },
      primaryType: "Deposit",
      message: { dealId: computeDealId(t), relayer },
    });
    const res = await this.api<{ txHash: Hex }>("POST", "/relay/deposit", {
      terms: termsToJson(t),
      sellerSig,
      permit: {
        deadline: t.deadline.toString(),
        r: `0x${permitSig.slice(2, 66)}`,
        s: `0x${permitSig.slice(66, 130)}`,
        v: parseInt(permitSig.slice(130, 132), 16),
      },
    });
    const r = await pc.waitForTransactionReceipt({ hash: res.txHash });
    if (r.status !== "success") throw new Error(`Relayed deposit reverted: ${res.txHash}`);
    steps.push(`relayed deposit: ${res.txHash}`);
    return { done: true, steps, message: "Deposited gaslessly; the deal settled in that transaction." };
  }

  async refund(ref: { bidId?: string; offerId?: string }) {
    const d = await this.deal(ref);
    if (!("dealId" in d) || !d.dealId) throw new Error("No accepted deal.");
    const escrow = await this.escrow();
    const tx: UnsignedTx = {
      description: "Refund both sides after the deadline (callable by anyone)",
      to: escrow,
      data: encodeFunctionData({ abi: OtcEscrowAbi, functionName: "refund", args: [d.terms] }),
      value: "0",
    };
    const w = await this.wallet();
    return w ? this.sendOrReturn([tx], w.account.address) : { signed: false, transactions: [tx] };
  }

  async price(token: string, source: string) {
    return this.api("GET", `/price/${getAddress(token)}?source=${encodeURIComponent(source)}`);
  }
}
