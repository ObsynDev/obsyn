import { useState } from "react";
import { connectWallet } from "./lib/chain.ts";
import { Link, short, usePath } from "./lib/ui.tsx";
import { BuyerBid } from "./pages/BuyerBid.tsx";
import { Home } from "./pages/Home.tsx";
import { How } from "./pages/How.tsx";
import { SellerOffer } from "./pages/SellerOffer.tsx";
import { SellerStatus } from "./pages/SellerStatus.tsx";

function route(path: string) {
  let m: RegExpExecArray | null;
  if ((m = /^\/bid\/([\w-]+)$/.exec(path))) return <BuyerBid id={m[1]} />;
  if ((m = /^\/rfq\/([\w-]+)$/.exec(path))) return <SellerOffer id={m[1]} />;
  if ((m = /^\/offer\/([\w-]+)$/.exec(path))) return <SellerStatus id={m[1]} />;
  if (path === "/how") return <How />;
  if (path === "/") return <Home />;
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
      className="btn sm"
      title={err ?? undefined}
      onClick={() =>
        connectWallet().then(
          (r) => (setAcct(r.account), setErr(null)),
          (e) => setErr(e?.shortMessage ?? e?.message),
        )
      }
    >
      {acct ? short(acct) : err ? "Wallet error" : "Connect"}
    </button>
  );
}

export function App() {
  const path = usePath();
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">
          <span className="logo" aria-hidden>
            <i />
            <i />
          </span>
          BlockOTC
        </Link>
        <nav>
          <Link to="/">Trade</Link>
          <Link to="/how">How it works</Link>
        </nav>
        <WalletButton />
      </header>
      <main key={path}>{route(path)}</main>
      <footer>
        Trades settle on Robinhood Chain and are final. Not a regulated venue. Not investment advice.
      </footer>
    </>
  );
}
