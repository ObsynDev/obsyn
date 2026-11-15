import { useEffect, useState } from "react";
import { isAddress, parseUnits, getAddress } from "viem";
import { api, type Rfq } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { newBoxKeys, sideOf, toUrl } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Err, fmtAmount, fmtLeft, fmtUsd, Link, navigate, useAction, useNow, usePoll } from "../lib/ui.tsx";

const WINDOWS = [
  { label: "15 min", s: 900 },
  { label: "1 hour", s: 3600 },
  { label: "4 hours", s: 14400 },
  { label: "24 hours", s: 86400 },
];

function useToken(addr: string) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setErr(null);
    if (!isAddress(addr)) return;
    tokenInfo(getAddress(addr)).then(setInfo, () => setErr("Couldn't read this token on Robinhood Chain."));
  }, [addr]);
  return { info, err };
}

function BidForm() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<"ETH" | "USDG">("ETH");
  const [win, setWin] = useState(3600);
  const [note, setNote] = useState("");
  const { info, err: tokenErr } = useToken(token.trim());

  const submit = useAction(async () => {
    if (!info) throw new Error("Enter a valid token address first.");
    const base = parseUnits(amount.replace(/,/g, ""), info.decimals);
    if (base <= 0n) throw new Error("Amount must be above zero.");
    const keys = newBoxKeys();
    const res = await api.createRfq({
      side,
      token: info.address,
      payToken: pay,
      amount: base.toString(),
      replySeconds: win,
      encPubKey: btoa(String.fromCharCode(...keys.publicKey)),
      note: note.trim() || undefined,
    });
    const link = `/bid/${res.id}#t=${res.manageToken}&k=${toUrl(keys.secretKey)}`;
    saved.addBid({ id: res.id, side, link, token: info.symbol, createdAt: Date.now() });
    navigate(link);
  });
  const other = side === "buy" ? "Sellers" : "Buyers";

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        submit.run();
      }}
    >
      <div className="seg wide">
        <button type="button" className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button type="button" className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>
          Sell privately
        </button>
      </div>
      <div className="card-head">
        <h2>{side === "buy" ? "Place a bid" : "List a block for sale"}</h2>
        <span className="muted">
          No account. You get a private link. {other} answer with sealed {side === "buy" ? "offers" : "bids"} only you can read.
        </span>
      </div>
      <label>
        Token address
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x… on Robinhood Chain" spellCheck={false} required />
        {info && <small className="ok">{info.symbol} · {info.decimals} decimals</small>}
        {tokenErr && <small className="err">{tokenErr}</small>}
      </label>
      <label>
        Size {info && <span className="muted">({info.symbol})</span>}
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250000" inputMode="decimal" required />
      </label>
      <div className="row2">
        <label>
          {side === "buy" ? "Pay with" : "Get paid in"}
          <div className="seg">
            {(["ETH", "USDG"] as const).map((p) => (
              <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)}>
                {p}
              </button>
            ))}
          </div>
        </label>
        <label>
          {other} can reply for
          <select value={win} onChange={(e) => setWin(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w.s} value={w.s}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Note to {other.toLowerCase()} <span className="muted">(optional, public)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          placeholder={side === "buy" ? "Can fill in one block" : "Whole block only"}
        />
      </label>
      <Err msg={submit.error} />
      <button className="btn primary" disabled={submit.busy}>
        {submit.busy ? "Creating…" : side === "buy" ? "Create private bid" : "Create private listing"}
      </button>
    </form>
  );
}

function RfqRow({ r, now }: { r: Rfq; now: number }) {
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [payTok, setPayTok] = useState<TokenInfo | null>(null);
  useEffect(() => {
    tokenInfo(r.token).then(setTok, () => {});
    tokenInfo(r.payToken).then(setPayTok, () => {});
  }, [r.token, r.payToken]);
  return (
    <Link to={`/rfq/${r.id}`} className="feed-row">
      <span className="sym">
        <span className={`side ${sideOf(r)}`}>{sideOf(r) === "buy" ? "Buying" : "Selling"}</span> {tok?.symbol ?? r.token.slice(0, 8)}
      </span>
      <span className="num">
        {r.amount && tok ? fmtAmount(r.amount, tok.decimals, 2) : r.sizeUsd ? fmtUsd(r.sizeUsd) : "—"}
      </span>
      <span className="muted">{payTok?.symbol ?? "…"}</span>
      <span className="muted">
        {r.quoteCount} {sideOf(r) === "buy" ? "offer" : "bid"}
        {r.quoteCount === 1 ? "" : "s"}
      </span>
      <span className="left">{fmtLeft(r.expiresAt - now)}</span>
    </Link>
  );
}

function DemandFeed() {
  const now = useNow();
  const { data, error } = usePoll(api.listRfqs, 10_000, []);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Open bids and listings</h2>
        <span className="muted">Sell into real demand, or buy a block someone is offloading. Your answer is sealed.</span>
      </div>
      {error && <p className="err">Backend unreachable: {error}</p>}
      {data && data.length === 0 && <p className="muted empty">Nothing open right now.</p>}
      <div className="feed">
        {data?.map((r) => (
          <RfqRow key={r.id} r={r} now={now} />
        ))}
      </div>
    </section>
  );
}

function MyLinks() {
  const bids = saved.bids();
  const offers = saved.offers();
  if (!bids.length && !offers.length) return null;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Your links on this device</h2>
      </div>
      <ul className="links">
        {bids.map((b) => (
          <li key={b.id}>
            <Link to={b.link}>{b.side === "sell" ? "Listing" : "Bid"} · {b.token}</Link> <span className="muted">{new Date(b.createdAt).toLocaleString()}</span>
          </li>
        ))}
        {offers.map((o) => (
          <li key={o.id}>
            <Link to={o.link}>{o.side === "sell" ? "Bid on a listing" : "Offer"} {"ghost" in o.offer && o.offer.ghost ? "· ghost" : ""}</Link>{" "}
            <span className="muted">{new Date(o.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Private OTC on Robinhood Chain</p>
          <h1>
            Trade size.
            <br />
            <span className="accent">Keep the chart quiet.</span>
          </h1>
          <p className="lede">
            Buyers post a bid. Sellers answer with sealed offers only the buyer can read. One escrow transaction swaps both
            sides, or everyone gets their funds back.
          </p>
          <ul className="facts">
            <li>
              <b>Sealed</b> offers, encrypted in your browser
            </li>
            <li>
              <b>1</b> transaction to settle
            </li>
            <li>
              <b>0</b> admin keys on the escrow
            </li>
          </ul>
        </div>
        <BidForm />
      </section>
      <DemandFeed />
      <MyLinks />
    </>
  );
}
