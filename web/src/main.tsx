import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { api, type ServerConfig } from "./lib/api.ts";
import { captureReferral } from "./lib/store.ts";
import { makeWalletConfig, WalletProviders } from "./lib/wallet.tsx";
import "./styles.css";

captureReferral();

// The wallet config needs the chain from the server; fall back to Robinhood Chain mainnet if it can't be read.
const FALLBACK: ServerConfig = {
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  escrow: null,
  usdg: null,
  walletConnectProjectId: null,
  relayer: { enabled: false, address: null, minFee: { eth: "0", usdg: "0" } },
};

api
  .config()
  .catch(() => FALLBACK)
  .then((cfg) => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <WalletProviders config={makeWalletConfig(cfg)}>
          <App />
        </WalletProviders>
      </StrictMode>,
    );
  });
