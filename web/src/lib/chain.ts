import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  fallback,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OtcEscrowAbi } from "../abi/OtcEscrow.ts";
import { api, type ServerConfig, type TermsJson } from "./api.ts";

// window.ethereum is typed by the wallet SDKs RainbowKit pulls in; narrow it where we use it.
const injected = (): EIP1193Provider | undefined => (window as { ethereum?: EIP1193Provider }).ethereum;

export interface Terms {
  buyer: Address;
  seller: Address;
  token: Address;
  amount: bigint;
  payToken: Address;
  price: bigint;
  sellerPayout: Address;
  referrer: Address;
  relayerFee: bigint;
  deadline: bigint;
  salt: Hex;
}

export const termsFromJson = (j: TermsJson): Terms => ({
  buyer: getAddress(j.buyer),
  seller: getAddress(j.seller),
  token: getAddress(j.token),
  amount: BigInt(j.amount),
  payToken: getAddress(j.payToken),
  price: BigInt(j.price),
  sellerPayout: getAddress(j.sellerPayout),
  referrer: getAddress(j.referrer),
  relayerFee: BigInt(j.relayerFee),
  deadline: BigInt(j.deadline),
  salt: j.salt as Hex,
});

export const termsToJson = (t: Terms): TermsJson =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])) as TermsJson;

export function chainFor(cfg: ServerConfig): Chain {
  return defineChain({
    id: cfg.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  });
}

let reader: PublicClient | null = null;

/** Public Robinhood Chain RPCs tried after the server's, so one blocked or failing provider doesn't break the page. */
const BACKUP_RPCS = ["https://robinhood-rpc.publicnode.com", "https://4663.rpc.thirdweb.com"];

/**
 * Reads always go to Robinhood Chain over HTTP, never through the visitor's wallet: a wallet sitting on
 * another network would read the wrong chain ("returned no data"). Several RPCs, tried in turn.
 */
export async function publicClient(): Promise<PublicClient> {
  if (reader) return reader;
  const cfg = await api.config();
  const urls = [cfg.rpcUrl, ...(cfg.chainId === 4663 ? BACKUP_RPCS.filter((u) => u !== cfg.rpcUrl) : [])];
  reader = createPublicClient({
    chain: chainFor(cfg),
    transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { timeout: 10_000 }))) : http(cfg.rpcUrl),
  }) as PublicClient;
  return reader;
}

/** Connect through the RainbowKit modal (see lib/wallet.tsx); returns a wallet client on the desk's chain. */
export async function connectWallet() {
  const { connectWithKit } = await import("./wallet.tsx");
  return connectWithKit();
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

const tokenCache = new Map<string, Promise<TokenInfo>>();

export function tokenInfo(address: Address): Promise<TokenInfo> {
  if (address === zeroAddress) return Promise.resolve({ address, symbol: "ETH", name: "Ether", decimals: 18 });
  let p = tokenCache.get(address);
  if (!p) {
    p = (async () => {
      // Ask our server first: it reads the chain for us, so this works even when the
      // visitor's own RPC is blocked (some ISPs block Robinhood Chain's RPC).
      // our server first (retry once: a fresh read can hit a lagging RPC node)
      const viaServer = () => api.token(address);
      try {
        const t = await viaServer().catch(() => new Promise<Awaited<ReturnType<typeof viaServer>>>((r, j) => setTimeout(() => viaServer().then(r, j), 800)));
        if (t.isContract && t.symbol && t.decimals !== null) return { address, symbol: t.symbol, name: t.name ?? t.symbol, decimals: t.decimals };
        if (!t.isContract) throw new Error("No token contract at this address on Robinhood Chain.");
      } catch (e) {
        if ((e as Error).message.startsWith("No token contract")) throw e;
      }
      const c = await publicClient();
      const [symbol, name, decimals] = await Promise.all([
        c.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        c.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => ""),
        c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { address, symbol, name: name || symbol, decimals };
    })();
    p.catch(() => tokenCache.delete(address));
    tokenCache.set(address, p);
  }
  return p;
}

export type DealState = { status: "none" | "open" | "settled" | "refunded"; buyerFunded: boolean; sellerFunded: boolean };

/** A deal's state: read by our server first (works whatever network the wallet is on), else straight from the chain. */
export async function dealState(escrow: Address, id: Hex): Promise<DealState> {
  const toState = (s: number, buyerFunded: boolean, sellerFunded: boolean): DealState => ({ status: (["none", "open", "settled", "refunded"] as const)[s] ?? "none", buyerFunded, sellerFunded });
  try {
    const r = await api.dealState(escrow, id);
    return toState(r.status, r.buyerFunded, r.sellerFunded);
  } catch {
    const c = await publicClient();
    const [s, buyerFunded, sellerFunded] = await c.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [id] });
    return toState(s, buyerFunded, sellerFunded);
  }
}

async function ensureAllowance(wallet: Awaited<ReturnType<typeof connectWallet>>["wallet"], token: Address, spender: Address, amount: bigint) {
  const c = await publicClient();
  const owner = wallet.account.address;
  const current = await c.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (current >= amount) return;
  const hash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await c.waitForTransactionReceipt({ hash });
}

export async function buyerDeposit(escrow: Address, t: Terms) {
  const { wallet, account } = await connectWallet();
  if (account !== t.buyer) throw new Error(`Connect the buyer wallet ${t.buyer}`);
  const c = await publicClient();
  if (t.payToken !== zeroAddress) await ensureAllowance(wallet, t.payToken, escrow, t.price);
  const hash = await wallet.writeContract({
    address: escrow,
    abi: OtcEscrowAbi,
    functionName: "depositPayment",
    args: [t],
    value: t.payToken === zeroAddress ? t.price : 0n,
  });
  return c.waitForTransactionReceipt({ hash });
}

export async function sellerDeposit(escrow: Address, t: Terms) {
  const { wallet, account } = await connectWallet();
  if (account !== t.seller) throw new Error(`Connect the seller wallet ${t.seller}`);
  const c = await publicClient();
  await ensureAllowance(wallet, t.token, escrow, t.amount);
  const hash = await wallet.writeContract({ address: escrow, abi: OtcEscrowAbi, functionName: "depositTokens", args: [t] });
  return c.waitForTransactionReceipt({ hash });
}

export async function refund(escrow: Address, t: Terms) {
  const { wallet } = await connectWallet();
  const c = await publicClient();
  const hash = await wallet.writeContract({ address: escrow, abi: OtcEscrowAbi, functionName: "refund", args: [t] });
  return c.waitForTransactionReceipt({ hash });
}

/** Main wallet sends the tokens to the one-time ghost wallet. */
export async function fundGhost(token: Address, ghost: Address, amount: bigint) {
  const { wallet } = await connectWallet();
  const c = await publicClient();
  const hash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [ghost, amount] });
  return c.waitForTransactionReceipt({ hash });
}

export async function balanceOf(token: Address, who: Address) {
  const c = await publicClient();
  return c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

const permitAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function eip712Domain() view returns (bytes1, string name, string version, uint256 chainId, address verifyingContract, bytes32, uint256[])",
]);

/**
 * Ghost deposit: the one-time wallet (key held in this browser) signs an EIP-2612 permit and
 * the escrow's Deposit authorization. The relayer submits both and pays the gas, so the
 * ghost wallet never needs ETH.
 */
export async function ghostDeposit(escrow: Address, t: Terms, ghostKey: Hex) {
  const cfg = await api.config();
  const relayer = cfg.relayer.address;
  if (!cfg.relayer.enabled || !relayer) throw new Error("The relayer is offline. Deposit from a normal wallet instead.");
  const ghost = privateKeyToAccount(ghostKey);
  if (ghost.address !== t.seller) throw new Error("This ghost key doesn't match the deal's seller address.");
  const c = await publicClient();

  let name: string;
  let version = "1";
  try {
    const d = await c.readContract({ address: t.token, abi: permitAbi, functionName: "eip712Domain" });
    name = d[1];
    version = d[2];
  } catch {
    name = await c.readContract({ address: t.token, abi: permitAbi, functionName: "name" });
  }
  let nonce: bigint;
  try {
    nonce = await c.readContract({ address: t.token, abi: permitAbi, functionName: "nonces", args: [ghost.address] });
  } catch (e) {
    // A revert means the token has no permit; anything else is the connection, so say so and let them retry.
    const reverted = e instanceof BaseError && !!e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError);
    throw new Error(
      reverted
        ? "This token doesn't support gasless permits (EIP-2612). Use a normal deposit."
        : "Couldn't reach Robinhood Chain to prepare the gasless deposit. Check your connection and try again.",
    );
  }

  const permitDeadline = t.deadline;
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
    message: { owner: ghost.address, spender: escrow, value: t.amount, nonce, deadline: permitDeadline },
  });
  const id = await c.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "dealId", args: [t] });
  const sellerSig = await ghost.signTypedData({
    domain: { name: "Obsyn", version: "1", chainId: cfg.chainId, verifyingContract: escrow },
    types: { Deposit: [{ name: "dealId", type: "bytes32" }, { name: "relayer", type: "address" }] },
    primaryType: "Deposit",
    message: { dealId: id, relayer },
  });

  const { txHash } = await api.relayDeposit({
    terms: termsToJson(t),
    escrow,
    sellerSig,
    permit: {
      deadline: permitDeadline.toString(),
      r: `0x${permitSig.slice(2, 66)}`,
      s: `0x${permitSig.slice(66, 130)}`,
      v: parseInt(permitSig.slice(130, 132), 16),
    },
  });
  return c.waitForTransactionReceipt({ hash: txHash });
}

/**
 * Can this token do ghost mode (EIP-2612 gasless approvals)? Asked through our server so it
 * works when the visitor's RPC is blocked. null = couldn't tell right now.
 */
const permitCache = new Map<string, Promise<boolean | null>>();
export function ghostSupported(token: Address): Promise<boolean | null> {
  let p = permitCache.get(token);
  if (!p) {
    p = api.token(token).then(
      (t) => (t.isContract ? t.permit : null),
      () => null,
    );
    p.then((v) => v === null && permitCache.delete(token));
    permitCache.set(token, p);
  }
  return p;
}

export const NO_GHOST = (symbol: string) =>
  `Ghost mode needs gasless approvals (EIP-2612), and ${symbol} doesn't have them. Deliver from your wallet instead.`;

export const explorerTx = (h: Hex) => `https://robinhoodchain.blockscout.com/tx/${h}`;
export const explorerAddr = (a: Address) => `https://robinhoodchain.blockscout.com/address/${a}`;

/** Is this answer signed by the wallet it names? Plain wallets offline, smart wallets on-chain. */
export async function verifyAnswerSig(address: Address, message: string, sig: unknown): Promise<boolean> {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) return false;
  try {
    if (await verifyMessage({ address, message, signature: sig as Hex })) return true;
  } catch {
    /* fall through */
  }
  try {
    return await (await publicClient()).verifyMessage({ address, message, signature: sig as Hex });
  } catch {
    return false;
  }
}

/** Balance of ETH (address(0)) or an ERC-20. */
export async function balanceOfAsset(asset: Address, who: Address): Promise<bigint> {
  const c = await publicClient();
  return asset === zeroAddress ? c.getBalance({ address: who }) : c.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
