import { useEffect, useState } from "react";
import { api } from "./lib/api.ts";
import { BRAND, Wordmark } from "./lib/brand.tsx";
import { connectWallet } from "./lib/chain.ts";
import { Link, short, usePath } from "./lib/ui.tsx";
import { BuyerBid } from "./pages/BuyerBid.tsx";
import { Developers } from "./pages/Developers.tsx";
import { How } from "./pages/How.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Security } from "./pages/Security.tsx";
import { SellerOffer } from "./pages/SellerOffer.tsx";
import { SellerStatus } from "./pages/SellerStatus.tsx";
import { MyLinks, Terminal } from "./pages/Terminal.tsx";

/** Marketing pages get the site header; everything else is the app. */
const SITE_PAGES = new Set(["/", "/how", "/developers", "/security"]);

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
    case "/mine":
      return <MyLinks />;
    case "/how":
      return <How />;
    case "/developers":
      return <Developers />;
    case "/security":
      return <Security />;
  }
  return (
    <div className="narrow">
      <h1>Not found</h1>
      <Link to="/">Back home</Link>
    </div>
  );
}

function WalletButton() {
  const [acct, setAcct] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <button
      className="wallet-btn"
      title={err ?? undefined}
      onClick={() =>
        connectWallet().then(
          (r) => (setAcct(r.account), setErr(null)),
          (e) => setErr(e?.shortMessage ?? e?.message),
        )
      }
    >
      <span className={`dot ${acct ? "on" : ""}`} />
      {acct ? short(acct) : err ? "Wallet error" : "Connect"}
    </button>
  );
}

/** Is settlement switched on (escrow configured)? */
function LiveBadge() {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    api.config().then((c) => setLive(!!c.escrow), () => setLive(null));
  }, []);
  if (live === null) return null;
  return (
    <span className={`live ${live ? "on" : ""}`} title={live ? "Escrow is live: deals settle on-chain" : "Escrow not deployed yet: posting and sealed answers work, settlement is off"}>
      {live ? "● LIVE" : "○ PREVIEW"}
    </span>
  );
}

const SITE_NAV: [string, string][] = [
  ["/how", "How it works"],
  ["/developers", "Developers"],
  ["/security", "Security"],
];
const APP_NAV: [string, string][] = [
  ["/app", "Terminal"],
  ["/mine", "My blocks"],
  ["/how", "How it works"],
];

export function App() {
  const path = usePath();
  const site = SITE_PAGES.has(path);
  useEffect(() => {
    document.title = path === "/" ? `${BRAND.name} · ${BRAND.description}` : path === "/app" ? `${BRAND.name} · Terminal` : BRAND.name;
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
          <Link to="/app">Desk</Link>
          <Link to="/app?new=buy">Post a bid</Link>
          <Link to="/app?new=sell">Sell privately</Link>
          <Link to="/mine">My blocks</Link>
        </div>
        <div className="fcol">
          <h4>LEARN</h4>
          <Link to="/how">How it works</Link>
          <Link to="/security">Security</Link>
        </div>
        <div className="fcol">
          <h4>BUILD</h4>
          <Link to="/developers">Developers</Link>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
          <a href="/api/sdk/blockotc.mjs" target="_blank" rel="noreferrer">
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
