import { createPublicClient, createWalletClient, defineChain, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";

export function robinhoodChain(cfg: Config): Chain {
  return defineChain({
    id: cfg.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  });
}

export function clients(cfg: Config) {
  const chain = robinhoodChain(cfg);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const account = cfg.relayerKey ? privateKeyToAccount(cfg.relayerKey) : null;
  const walletClient = account ? createWalletClient({ chain, account, transport: http(cfg.rpcUrl) }) : null;
  return { chain, publicClient, walletClient, relayerAddress: (account?.address ?? null) as Address | null };
}
