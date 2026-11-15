import { getAddress, type Address, type Hex } from "viem";

export interface Config {
  port: number;
  publicUrl: string;
  dbPath: string;
  chainId: number;
  rpcUrl: string;
  /** public WalletConnect / Reown project id for the web wallet modal (not a secret) */
  walletConnectProjectId: string | null;
  escrow: Address | null;
  usdg: Address | null;
  relayerKey: Hex | null;
  /** Why RELAYER_PRIVATE_KEY was ignored, if it was (never contains the value itself). */
  relayerKeyProblem: string | null;
  relayerMinFee: { eth: bigint; usdg: bigint };
}

function addr(v: string | undefined): Address | null {
  return v ? getAddress(v) : null;
}

/** Normalizes a pasted key: strips whitespace and quotes, adds 0x (MetaMask exports without it). */
function parseRelayerKey(raw: string | undefined): { key: Hex | null; problem: string | null } {
  const cleaned = raw?.replace(/\s+/g, "").replace(/^["']+|["']+$/g, "");
  if (!cleaned) return { key: null, problem: null };
  const key = cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(key)) return { key: key as Hex, problem: null };
  // Never echo the value: it must not end up in logs.
  const problem = /^0x[0-9a-fA-F]{40}$/.test(key)
    ? "RELAYER_PRIVATE_KEY looks like a wallet ADDRESS (40 hex chars), not a private key (64 hex chars). Relayer disabled."
    : `RELAYER_PRIVATE_KEY is not 64 hex characters (got ${key.length - 2}). Relayer disabled.`;
  return { key: null, problem };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A bad relayer key disables the relayer instead of taking the whole site down.
  const { key, problem } = parseRelayerKey(env.RELAYER_PRIVATE_KEY);
  return {
    port: Number(env.PORT ?? 8787),
    publicUrl: env.PUBLIC_URL ?? "http://localhost:8787",
    dbPath: env.DB_PATH ?? "./data/blockotc.db",
    chainId: Number(env.CHAIN_ID ?? 4663),
    rpcUrl: env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    walletConnectProjectId: env.WALLETCONNECT_PROJECT_ID?.trim() || null,
    escrow: addr(env.ESCROW_ADDRESS),
    usdg: addr(env.USDG_ADDRESS),
    relayerKey: key,
    relayerKeyProblem: problem,
    relayerMinFee: {
      eth: BigInt(env.RELAYER_MIN_FEE_ETH ?? "200000000000000"), // 0.0002 ETH
      usdg: BigInt(env.RELAYER_MIN_FEE_USDG ?? "500000"), // 0.5 USDG
    },
  };
}
