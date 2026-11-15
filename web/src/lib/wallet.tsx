import "@rainbow-me/rainbowkit/styles.css";
import { connectorsForWallets, darkTheme, RainbowKitProvider, useConnectModal, type Theme } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { getAddress, type Address } from "viem";
import { createConfig, http, WagmiProvider, type Config } from "wagmi";
import { getAccount, getWalletClient, switchChain, watchAccount } from "wagmi/actions";
import type { ServerConfig } from "./api.ts";
import { BRAND } from "./brand.tsx";
import { chainFor } from "./chain.ts";

/**
 * Wallet connection through RainbowKit + wagmi.
 * The chain comes from the server's /health (same as the rest of the app). WalletConnect-based
 * wallets (mobile, QR) only appear when the server provides a public WalletConnect project id;
 * without one, browser-extension wallets still work.
 */

let wagmiConfig: Config | null = null;
let serverCfg: ServerConfig | null = null;

export function makeWalletConfig(cfg: ServerConfig): Config {
  serverCfg = cfg;
  const chain = chainFor(cfg);
  const projectId = cfg.walletConnectProjectId ?? "";
  const connectors = connectorsForWallets(
    [
      {
        groupName: "Recommended",
        wallets: projectId
          ? [metaMaskWallet, rabbyWallet, rainbowWallet, coinbaseWallet, walletConnectWallet]
          : [injectedWallet, rabbyWallet, coinbaseWallet],
      },
    ],
    { appName: BRAND.name, projectId: projectId || "browser-wallets-only" },
  );
  wagmiConfig = createConfig({
    chains: [chain],
    connectors,
    transports: { [chain.id]: http(cfg.rpcUrl) },
  });
  return wagmiConfig;
}

// ── the ember palette for the modal ──
const theme: Theme = (() => {
  const t = darkTheme({
    accentColor: "#ff6a2b",
    accentColorForeground: "#160700",
    borderRadius: "medium",
    overlayBlur: "small",
  });
  t.fonts.body = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
  t.colors.modalBackground = "#13110e";
  t.colors.modalBorder = "#35302a";
  t.colors.generalBorder = "#26231f";
  t.colors.menuItemBackground = "#1c1a17";
  t.colors.profileForeground = "#13110e";
  t.colors.closeButtonBackground = "#1c1a17";
  t.colors.actionButtonSecondaryBackground = "#1c1a17";
  t.colors.modalTextSecondary = "#a39b90";
  t.colors.connectButtonBackground = "#13110e";
  t.colors.error = "#ff5277";
  t.shadows.dialog = "0 40px 80px -30px rgb(0 0 0 / 0.9)";
  return t;
})();

// ── bridge: let plain async code (connectWallet) open the React modal and wait for it ──
let openModal: (() => void) | undefined;
const modalListeners = new Set<(open: boolean) => void>();

function ModalBridge() {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  useEffect(() => {
    openModal = openConnectModal;
  }, [openConnectModal]);
  useEffect(() => {
    modalListeners.forEach((f) => f(connectModalOpen));
  }, [connectModalOpen]);
  return null;
}

const queryClient = new QueryClient();

export function WalletProviders({ config, children }: { config: Config; children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName: BRAND.name, learnMoreUrl: "/how" }}>
          <ModalBridge />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** Wait out a page-load reconnect so we don't open the modal over a wallet that is coming back. */
function settled(config: Config): Promise<void> {
  const s = getAccount(config).status;
  if (s !== "reconnecting" && s !== "connecting") return Promise.resolve();
  return new Promise((resolve) => {
    const un = watchAccount(config, {
      onChange(a) {
        if (a.status !== "reconnecting" && a.status !== "connecting") {
          un();
          resolve();
        }
      },
    });
    setTimeout(() => (un(), resolve()), 4000);
  });
}

/** Open the RainbowKit modal and resolve once a wallet is connected; reject if it is closed first. */
function connectViaModal(config: Config): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!openModal) return reject(new Error("The wallet picker isn't ready yet. Try again in a second."));
    let sawOpen = false;
    const done = (fn: () => void) => {
      un();
      modalListeners.delete(onModal);
      fn();
    };
    const un = watchAccount(config, {
      onChange(a) {
        if (a.status === "connected") done(resolve);
      },
    });
    const onModal = (open: boolean) => {
      if (open) sawOpen = true;
      else if (sawOpen)
        // closed: give a just-approved connection a moment to land before calling it cancelled
        setTimeout(() => {
          if (getAccount(config).status !== "connected") done(() => reject(new Error("Wallet connection cancelled.")));
        }, 400);
    };
    modalListeners.add(onModal);
    openModal();
  });
}

/** Connected wallet client on the desk's chain (switching or adding the chain if needed). */
export async function connectWithKit() {
  const config = wagmiConfig;
  const cfg = serverCfg;
  if (!config || !cfg) throw new Error("Wallet support is still loading.");
  await settled(config);
  if (getAccount(config).status !== "connected") await connectViaModal(config);
  if (getAccount(config).chainId !== cfg.chainId) await switchChain(config, { chainId: cfg.chainId });
  const wallet = await getWalletClient(config, { chainId: cfg.chainId });
  return { wallet, account: getAddress(wallet.account.address) as Address };
}
