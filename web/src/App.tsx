import { useEffect, useState } from "react";
import { api } from "./lib/api.ts";
import { BRAND, Wordmark } from "./lib/brand.tsx";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Link, short, usePath } from "./lib/ui.tsx";
import { BuyerBid } from "./pages/BuyerBid.tsx";
import { Developers } from "./pages/Developers.tsx";
import { How } from "./pages/How.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Security } from "./pages/Security.tsx";
import { SellerOffer } from "./pages/SellerOffer.tsx";
import { SellerStatus } from "./pages/SellerStatus.tsx";
import { MyLinks, Terminal } from "./pages/Terminal.tsx";
import { Otc } from "./pages/Otc.tsx";
import { Roadmap } from "./pages/Roadmap.tsx";
import { Markets } from "./pages/Markets.tsx";
import { Docs } from "./pages/Docs.tsx";

/** Marketing pages get the site header; everything else is the app. */
const SITE_PAGES = new Set(["/", "/markets", "/how", "/developers", "/security", "/roadmap", "/docs"]);

function route(path: string) {
  let m: RegExpExecArray | null;
  if ((m = /^\/bid\/([\w-]+)$/.exec(path))) return <BuyerBid id={m[1]} />;
  if ((m = /^\/rfq\/([\w-]+)$/.exec(path))) return <SellerOffer id={m[1]} />;
  if ((m = /^\/offer\/([\w-]+)$/.exec(path))) return <SellerStatus id={m[1]} />;
  switch (path) {
    case "/":
      return <Landing />;
    case "/app":
      return <Terminal />;
    case "/otc":
      return <Otc />;
    case "/mine":
      return <MyLinks />;
    case "/how":
      return <How />;
    case "/developers":
      return <Developers />;
    case "/security":
      return <Security />;
    case "/roadmap":
      return <Roadmap />;
    case "/markets":
      return <Markets />;
    case "/docs":
      return <Docs />;
  }
  return (
    <div className="narrow">
      <h1>Not found</h1>
      <Link to="/">Back home</Link>
    </div>
  );
}

function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        if (!ready || !account) {
          return (
            <button className="wallet-btn" onClick={openConnectModal} aria-hidden={!ready} style={ready ? undefined : { opacity: 0 }}>
              <span className="dot" />
              Connect
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button className="wallet-btn wrong" onClick={openChainModal}>
              <span className="dot" />
              Wrong network
            </button>
          );
        }
        return (
          <button className="wallet-btn" onClick={openAccountModal} title={account.address}>
            <span className="dot on" />
            {account.ensName ?? short(account.address)}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

/** Status badge: always shown as live. */
function LiveBadge() {
  return (
    <span className="live on" title="Live on Robinhood Chain">
      ● LIVE
    </span>
  );
}

const SITE_NAV: [string, string][] = [
  ["/markets", "Markets"],
  ["/otc", "OTC desk"],
  ["/how", "How it works"],
  ["/docs", "Docs"],
  ["/roadmap", "Roadmap"],
  ["/developers", "Developers"],
];
const APP_NAV: [string, string][] = [
  ["/otc", "OTC desk"],
  ["/app", "Terminal"],
  ["/mine", "My blocks"],
  ["/how", "How it works"],
];

export function App() {
  const path = usePath();
  const site = SITE_PAGES.has(path);
  useEffect(() => {
    document.title = path === "/" ? `${BRAND.name} · ${BRAND.description}` : path === "/app" ? `${BRAND.name} · Terminal` : path === "/otc" ? `${BRAND.name} · OTC desk` : BRAND.name;
  }, [path]);
  const nav = site ? SITE_NAV : APP_NAV;

  return (
    <>
      <header className={`top ${site ? "site" : "app"}`}>
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          <Wordmark />
        </Link>
        <LiveBadge />
        <nav>
          {nav.map(([to, label]) => (
            <Link key={to} to={to} className={path === to ? "on" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        {site ? (
          <Link to="/app" className="cta buy sm">
            Launch app
          </Link>
        ) : (
          <>
            <span className="chain">Robinhood Chain</span>
            <WalletButton />
          </>
        )}
      </header>
      <main key={path} className={path === "/app" ? "wide" : site ? "site-main" : ""}>
        {route(path)}
      </main>
      <footer className="site-foot">
        <div className="fcol fbrand">
          <Wordmark />
          <p>Trade size. Stay private. Sealed OTC block trades on Robinhood Chain.</p>
        </div>
        <div className="fcol">
          <h4>PRODUCT</h4>
          <Link to="/markets">Markets</Link>
          <Link to="/app">Desk</Link>
          <Link to="/app?new=buy">Post a bid</Link>
          <Link to="/app?new=sell">Sell privately</Link>
          <Link to="/mine">My blocks</Link>
        </div>
        <div className="fcol">
          <h4>LEARN</h4>
          <Link to="/how">How it works</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/roadmap">Roadmap</Link>
          <Link to="/security">Security</Link>
        </div>
        <div className="fcol">
          <h4>BUILD</h4>
          <Link to="/developers">Developers</Link>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
          <a href="/api/sdk/obsyn.mjs" target="_blank" rel="noreferrer">
            SDK
          </a>
        </div>
        <div className="fine-row">
          <span>© {new Date().getFullYear()} {BRAND.name}</span>
          <span>Trades settle on-chain and are final. Not a regulated venue. Not investment advice. Not audited yet.</span>
        </div>
      </footer>
    </>
  );
}
