import { useEffect, useState, type CSSProperties } from "react";
import { api } from "./lib/api.ts";
import { BRAND, GitHubIcon, Wordmark, XIcon } from "./lib/brand.tsx";
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
import { Trade } from "./pages/Trade.tsx";
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
    case "/trade":
      return <Trade />;
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


const SITE_NAV: [string, string][] = [
  ["/markets", "Markets"],
  ["/otc", "OTC desk"],
  ["/trade", "Trade"],
  ["/how", "How it works"],
  ["/docs", "Docs"],
  ["/roadmap", "Roadmap"],
  ["/developers", "Developers"],
];
const APP_NAV: [string, string][] = [
  ["/otc", "OTC desk"],
  ["/trade", "Trade"],
  ["/app", "Terminal"],
  ["/mine", "My blocks"],
  ["/how", "How it works"],
];

export function App() {
  const path = usePath();
  const site = SITE_PAGES.has(path);
  useEffect(() => {
    document.title = path === "/" ? `${BRAND.name} · ${BRAND.description}` : path === "/app" ? `${BRAND.name} · Terminal` : path === "/otc" ? `${BRAND.name} · OTC desk` : path === "/trade" ? `${BRAND.name} · Trade` : BRAND.name;
  }, [path]);
  const nav = site ? SITE_NAV : APP_NAV;
  // the phone menu: closes on navigation and Escape
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <>
      <header className={`top ${site ? "site" : "app"}${menu ? " menu-open" : ""}`}>
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          <Wordmark />
        </Link>
        <nav>
          {nav.map(([to, label]) => (
            <Link key={to} to={to} className={path === to ? "on" : ""}>
              {label}
            </Link>
          ))}
        </nav>
        <a href={BRAND.github} className="x-link" target="_blank" rel="noreferrer" aria-label={`${BRAND.name} source code on GitHub`}>
          <GitHubIcon />
        </a>
        <a href={BRAND.x} className="x-link" target="_blank" rel="noreferrer" aria-label={`${BRAND.name} on X`}>
          <XIcon />
        </a>
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
        <button
          type="button"
          className="burger"
          aria-label={menu ? "Close menu" : "Open menu"}
          aria-expanded={menu}
          aria-controls="mnav"
          onClick={() => setMenu((m) => !m)}
        >
          <span />
          <span />
          <span />
        </button>
        <div id="mnav" className="mnav" aria-hidden={!menu}>
          <div className="mnav-inner">
            {nav.map(([to, label], i) => (
              <Link key={to} to={to} className={path === to ? "on" : ""} style={{ ["--i" as string]: i } as CSSProperties} tabIndex={menu ? 0 : -1}>
                {label}
                <span aria-hidden="true">→</span>
              </Link>
            ))}
            {site ? (
              <Link to="/app" className="mnav-cta" style={{ ["--i" as string]: nav.length } as CSSProperties} tabIndex={menu ? 0 : -1}>
                Launch app
              </Link>
            ) : (
              <Link to="/" className="mnav-sub" style={{ ["--i" as string]: nav.length } as CSSProperties} tabIndex={menu ? 0 : -1}>
                ← Back to site
              </Link>
            )}
            <a href={BRAND.x} className="mnav-x" target="_blank" rel="noreferrer" style={{ ["--i" as string]: nav.length + 1 } as CSSProperties} tabIndex={menu ? 0 : -1}>
              <XIcon size={15} /> Follow {BRAND.xHandle}
            </a>
            <a href={BRAND.github} className="mnav-x" target="_blank" rel="noreferrer" style={{ ["--i" as string]: nav.length + 2 } as CSSProperties} tabIndex={menu ? 0 : -1}>
              <GitHubIcon size={15} /> Source on GitHub
            </a>
          </div>
        </div>
      </header>
      {menu && <div className="mnav-scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
      <main key={path} className={path === "/app" ? "wide" : site ? "site-main" : ""}>
        {route(path)}
      </main>
      <footer className="site-foot">
        <div className="fcol fbrand">
          <Wordmark />
          <p>Trade size. Stay private. Sealed OTC block trades on Robinhood Chain.</p>
          <span className="foot-social">
            <a href={BRAND.x} className="foot-x" target="_blank" rel="noreferrer">
              <XIcon size={14} /> {BRAND.xHandle}
            </a>
            <a href={BRAND.github} className="foot-x" target="_blank" rel="noreferrer">
              <GitHubIcon size={14} /> GitHub
            </a>
          </span>
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
          <a href={BRAND.github} target="_blank" rel="noreferrer">
            Source code
          </a>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
          <a href="/api/sdk/obsyn.mjs" target="_blank" rel="noreferrer">
            SDK
          </a>
        </div>
        <div className="fine-row">
          <span>© {new Date().getFullYear()} {BRAND.name}</span>
          <span>Trades settle on-chain and are final. Not a regulated venue. Not investment advice. Internal security review only, no independent audit yet.</span>
        </div>
      </footer>
    </>
  );
}
