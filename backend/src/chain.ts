import { createPublicClient, createWalletClient, defineChain, fallback, http, type Address, type Chain } from "viem";
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

/** Public Robinhood Chain RPCs tried after the configured one, so one provider's outage doesn't stop the desk. */
export const MAINNET_BACKUP_RPCS = ["https://robinhood-rpc.publicnode.com", "https://4663.rpc.thirdweb.com"];

export function clients(cfg: Config) {
  const chain = robinhoodChain(cfg);
  const urls = cfg.chainId === 4663 ? [cfg.rpcUrl, ...MAINNET_BACKUP_RPCS.filter((u) => u !== cfg.rpcUrl)] : [cfg.rpcUrl];
  const transport = urls.length > 1 ? fallback(urls.map((u) => http(u, { timeout: 10_000 }))) : http(cfg.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = cfg.relayerKey ? privateKeyToAccount(cfg.relayerKey) : null;
  const walletClient = account ? createWalletClient({ chain, account, transport }) : null;
  return { chain, publicClient, walletClient, relayerAddress: (account?.address ?? null) as Address | null };
}
