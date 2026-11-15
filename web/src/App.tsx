import { useEffect, useState } from "react";
import { api } from "./lib/api.ts";
import { BRAND, Wordmark } from "./lib/brand.tsx";
import { connectWallet } from "./lib/chain.ts";
import { Link, short, usePath } from "./lib/ui.tsx";
import { BuyerBid } from "./pages/BuyerBid.tsx";
import { How } from "./pages/How.tsx";
import { SellerOffer } from "./pages/SellerOffer.tsx";
import { SellerStatus } from "./pages/SellerStatus.tsx";
import { MyLinks, Terminal } from "./pages/Terminal.tsx";

function route(path: string) {
  let m: RegExpExecArray | null;
  if ((m = /^\/bid\/([\w-]+)$/.exec(path))) return <BuyerBid id={m[1]} />;
  if ((m = /^\/rfq\/([\w-]+)$/.exec(path))) return <SellerOffer id={m[1]} />;
  if ((m = /^\/offer\/([\w-]+)$/.exec(path))) return <SellerStatus id={m[1]} />;
  if (path === "/how") return <How />;
  if (path === "/mine") return <MyLinks />;
  if (path === "/") return <Terminal />;
  return (
    <div className="narrow">
      <h1>Not found</h1>
      <Link to="/">Back to the terminal</Link>
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

/** Small live indicator: is settlement switched on (escrow configured)? */
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

export function App() {
  const path = usePath();
  useEffect(() => {
    document.title = path === "/" ? `${BRAND.name} · ${BRAND.description}` : BRAND.name;
  }, [path]);
  return (
    <>
      <header className="top">
        <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
          <Wordmark />
        </Link>
        <LiveBadge />
        <nav>
          <Link to="/" className={path === "/" ? "on" : ""}>
            Terminal
          </Link>
          <Link to="/mine" className={path === "/mine" ? "on" : ""}>
            My blocks
          </Link>
          <Link to="/how" className={path === "/how" ? "on" : ""}>
            How it works
          </Link>
        </nav>
        <span className="chain">Robinhood Chain</span>
        <WalletButton />
      </header>
      <main key={path} className={path === "/" ? "wide" : ""}>
        {route(path)}
      </main>
      <footer>
        <span>
          {BRAND.name} · {BRAND.description}
        </span>
        <span>Trades settle on-chain and are final. Not a regulated venue. Not investment advice.</span>
      </footer>
    </>
  );
}
