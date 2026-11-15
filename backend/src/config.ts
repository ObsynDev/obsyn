import { getAddress, type Address, type Hex } from "viem";

export interface Config {
  port: number;
  publicUrl: string;
  dbPath: string;
  chainId: number;
  rpcUrl: string;
  escrow: Address | null;
  usdg: Address | null;
  relayerKey: Hex | null;
  relayerMinFee: { eth: bigint; usdg: bigint };
}

function addr(v: string | undefined): Address | null {
  return v ? getAddress(v) : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Accept keys with or without 0x (wallets like MetaMask export them without it).
  const rawKey = env.RELAYER_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");
  const key = rawKey ? (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) : undefined;
  // Never echo the value: a malformed key must not end up in logs.
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RELAYER_PRIVATE_KEY must be 64 hex characters (with or without 0x)");
  return {
    port: Number(env.PORT ?? 8787),
    publicUrl: env.PUBLIC_URL ?? "http://localhost:8787",
    dbPath: env.DB_PATH ?? "./data/blockotc.db",
    chainId: Number(env.CHAIN_ID ?? 4663),
    rpcUrl: env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    escrow: addr(env.ESCROW_ADDRESS),
    usdg: addr(env.USDG_ADDRESS),
    relayerKey: key ? (key as Hex) : null,
    relayerMinFee: {
      eth: BigInt(env.RELAYER_MIN_FEE_ETH ?? "200000000000000"), // 0.0002 ETH
      usdg: BigInt(env.RELAYER_MIN_FEE_USDG ?? "500000"), // 0.5 USDG
    },
  };
}
