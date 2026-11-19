import { useState } from "react";
import { formatUnits, getAddress, parseUnits } from "viem";
import { api, type Rfq } from "../lib/api.ts";
import { connectWallet, type TokenInfo } from "../lib/chain.ts";
import { answerMessage, seal, unb64, type BuyerBid } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { useMarket, usePayUsd, vsLabel, vsMarket } from "../lib/market.ts";
import { Err, fmtAmount, fmtLeft, navigate, Pill, short, useAction, useNow } from "../lib/ui.tsx";
import { toast } from "../lib/toast.tsx";

/** /rfq/:id on a sell listing: a buyer answers with a sealed bid. */
export function BuyerAnswer({ rfq, tok, pay }: { rfq: Rfq; tok: TokenInfo; pay: TokenInfo }) {
  const now = useNow();
  const [wallet, setWallet] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [part, setPart] = useState("");
  const remaining = rfq.amount ? BigInt(rfq.amount) - BigInt(rfq.filledAmount ?? "0") : 0n;
  const market = useMarket(rfq.token);
  const payUsd = usePayUsd(rfq.payToken);

  const connect = useAction(async () => {
    const { account } = await connectWallet();
    setWallet(account);
  });

  const submit = useAction(async () => {
    if (!rfq.amount) throw new Error("This listing has no fixed size.");
    if (!wallet) throw new Error("Connect the wallet you'll pay from.");
    const priceBase = parseUnits(price.replace(/,/g, ""), pay.decimals);
    if (priceBase <= 0n) throw new Error("Price must be above zero.");
    let amount = rfq.amount;
    if (rfq.partial && part.trim()) {
      const base = parseUnits(part.replace(/[,\s]/g, ""), tok.decimals);
      if (base <= 0n || base > remaining) throw new Error(`You can bid for up to ${fmtAmount(remaining, tok.decimals, 4)} ${tok.symbol}.`);
      amount = base.toString();
    } else if (rfq.partial) amount = remaining.toString();
    const bid: BuyerBid = { amount, price: priceBase.toString(), buyer: wallet, message: message.trim() || undefined };
    // Sign with the wallet the bid names, so the seller can tell it isn't a fake in someone else's name.
    const { wallet: w, account } = await connectWallet();
    if (account !== getAddress(wallet)) throw new Error(`Switch your wallet back to ${wallet}.`);
    bid.sig = await w.signMessage({ account, message: answerMessage(rfq.id, "sell", wallet, bid.amount, bid.price) });
    const res = await api.submitQuote(rfq.id, seal(bid, unb64(rfq.encPubKey ?? rfq.buyerEncPubKey)));
    const link = `/offer/${res.quoteId}#t=${res.quoteToken}`;
    saved.addOffer({ id: res.quoteId, rfqId: rfq.id, side: "sell", link, offer: bid, createdAt: Date.now() });
    toast({ tone: "ok", title: "Sealed bid sent", body: "Only the seller can read it. You'll get a notice here if it's accepted.", key: `quote:${res.quoteId}` });
    navigate(link);
  });

  const left = rfq.expiresAt - now;
  const open = rfq.status === "open" && left > 0;
  const unit =
    price && rfq.amount && Number(price) > 0
      ? Number(price.replace(/,/g, "")) / Number(formatUnits(BigInt(rfq.amount), tok.decimals))
      : null;

  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>
            For sale: {rfq.amount ? fmtAmount(rfq.amount, tok.decimals, 2) : "—"} {tok.symbol}
          </h2>
          {open ? <Pill tone="info">{fmtLeft(left)} left</Pill> : <Pill tone="muted">{rfq.status === "open" ? "closed" : rfq.status}</Pill>}
        </div>
        <dl className="kv">
          <dt>Token</dt>
          <dd className="mono">{rfq.token}</dd>
          <dt>Seller wants</dt>
          <dd>{pay.symbol}</dd>
          <dt>Bids so far</dt>
          <dd>{rfq.quoteCount}</dd>
          {rfq.note && (
            <>
              <dt>Note</dt>
              <dd>{rfq.note}</dd>
            </>
          )}
        </dl>
      </section>

      {open && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            submit.run();
          }}
        >
          <div className="card-head">
            <h2>Send a sealed bid</h2>
            <span className="muted">Encrypted to the seller in your browser. Other buyers can't see it, and neither can we.</span>
          </div>

          {wallet ? (
            <p className="muted">You'll pay from {short(wallet)} and receive the tokens there.</p>
          ) : (
            <button type="button" className="btn" onClick={() => connect.run()} disabled={connect.busy}>
              Connect wallet
            </button>
          )}
          <Err msg={connect.error} />

          {rfq.partial && (
            <label>
              How many {tok.symbol} do you want? <span className="muted">(partial fills allowed: up to {fmtAmount(remaining, tok.decimals, 4)}; empty = all of it)</span>
              <input value={part} onChange={(e) => setPart(e.target.value)} inputMode="decimal" placeholder={fmtAmount(remaining, tok.decimals, 4)} />
            </label>
          )}
          <label>
            Total you'd pay ({pay.symbol}) for all {fmtAmount(rfq.amount ?? "0", tok.decimals, 2)} {tok.symbol}
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.0" required />
            {unit !== null && isFinite(unit) && (
              <small className="muted">
                ≈ {unit.toPrecision(6)} {pay.symbol} per {tok.symbol}
                {(() => {
                  try {
                    const pct = vsMarket({ market, amount: BigInt(rfq.amount ?? "0"), tokenDecimals: tok.decimals, price: parseUnits(price.replace(/,/g, ""), pay.decimals), payToken: rfq.payToken, payDecimals: pay.decimals, payUsd });
                    return pct === null ? null : ` · ${vsLabel(pct)}`;
                  } catch {
                    return null;
                  }
                })()}
              </small>
            )}
          </label>
          <label>
            Message to seller <span className="muted">(optional, sealed)</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} />
          </label>
          <Err msg={submit.error} />
          <button className="btn primary" disabled={submit.busy}>
            {submit.busy ? "Sealing…" : "Seal and send bid"}
          </button>
        </form>
      )}
    </div>
  );
}
