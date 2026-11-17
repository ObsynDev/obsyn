import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { api, type ServerConfig } from "./lib/api.ts";
import { captureReferral } from "./lib/store.ts";
import { PLATFORM_TOKEN } from "./lib/brand.tsx";
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
    // $OBSYN details come from the server, so launching the token needs no rebuild
    const pt = cfg.platformToken;
    if (pt?.address) Object.assign(PLATFORM_TOKEN, { address: pt.address, ponsUrl: pt.ponsUrl, discountMin: pt.discountMin });
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <WalletProviders config={makeWalletConfig(cfg)}>
          <App />
        </WalletProviders>
      </StrictMode>,
    );
  });
