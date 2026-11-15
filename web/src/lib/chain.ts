import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OtcEscrowAbi } from "../abi/OtcEscrow.ts";
import { api, type ServerConfig, type TermsJson } from "./api.ts";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

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

/** Reads go through the wallet when there is one (it already has a working RPC), else the public RPC. */
export async function publicClient(): Promise<PublicClient> {
  if (reader) return reader;
  const cfg = await api.config();
  reader = createPublicClient({
    chain: chainFor(cfg),
    transport: window.ethereum ? custom(window.ethereum) : http(cfg.rpcUrl),
  }) as PublicClient;
  return reader;
}

export async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask, Rabby or similar.");
  const cfg = await api.config();
  const chain = chainFor(cfg);
  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const hexId = `0x${cfg.chainId.toString(16)}` as const;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e: any) {
    if (e?.code !== 4902) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [cfg.rpcUrl],
          blockExplorerUrls: [chain.blockExplorers!.default.url],
        },
      ],
    });
  }
  const wallet = createWalletClient({ chain, account: getAddress(account), transport: custom(eth) });
  return { wallet, account: getAddress(account) };
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

const tokenCache = new Map<string, Promise<TokenInfo>>();

export function tokenInfo(address: Address): Promise<TokenInfo> {
  if (address === zeroAddress) return Promise.resolve({ address, symbol: "ETH", decimals: 18 });
  let p = tokenCache.get(address);
  if (!p) {
    p = (async () => {
      const c = await publicClient();
      const [symbol, decimals] = await Promise.all([
        c.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { address, symbol, decimals };
    })();
    p.catch(() => tokenCache.delete(address));
    tokenCache.set(address, p);
  }
  return p;
}

export type DealState = { status: "none" | "open" | "settled" | "refunded"; buyerFunded: boolean; sellerFunded: boolean };

export async function dealState(escrow: Address, id: Hex): Promise<DealState> {
  const c = await publicClient();
  const [s, buyerFunded, sellerFunded] = await c.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "deals", args: [id] });
  return { status: (["none", "open", "settled", "refunded"] as const)[s] ?? "none", buyerFunded, sellerFunded };
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
  } catch {
    throw new Error("This token doesn't support gasless permits (EIP-2612). Use a normal deposit.");
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
    domain: { name: "BlockOTC", version: "1", chainId: cfg.chainId, verifyingContract: escrow },
    types: { Deposit: [{ name: "dealId", type: "bytes32" }, { name: "relayer", type: "address" }] },
    primaryType: "Deposit",
    message: { dealId: id, relayer },
  });

  const { txHash } = await api.relayDeposit({
    terms: termsToJson(t),
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

export const explorerTx = (h: Hex) => `https://robinhoodchain.blockscout.com/tx/${h}`;
export const explorerAddr = (a: Address) => `https://robinhoodchain.blockscout.com/address/${a}`;
