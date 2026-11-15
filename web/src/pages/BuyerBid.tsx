import { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress, toHex, zeroAddress, type Address, type Hex } from "viem";
import { api, ApiError, type DealInfo, type Rfq, type SealedQuote } from "../lib/api.ts";
import { connectWallet, termsFromJson, termsToJson, tokenInfo, type Terms, type TokenInfo } from "../lib/chain.ts";
import { fromUrl, hashParams, keysFromSecret, unseal, type Offer } from "../lib/sealed.ts";
import { referral } from "../lib/store.ts";
import { Copy, Err, fmtAmount, fmtLeft, Pill, short, useAction, useNow, usePoll } from "../lib/ui.tsx";
import { DealPanel } from "./DealPanel.tsx";

const FUND_WINDOWS = [
  { label: "1 hour", s: 3600 },
  { label: "6 hours", s: 21600 },
  { label: "24 hours", s: 86400 },
];

/** /bid/:id#t=<manageToken>&k=<boxSecret> — the buyer's private page. */
export function BuyerBid({ id }: { id: string }) {
  const params = hashParams();
  const token = params.get("t") ?? "";
  const secret = useMemo(() => {
    try {
      return keysFromSecret(fromUrl(params.get("k") ?? "")).secretKey;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const now = useNow();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);
  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [fundWindow, setFundWindow] = useState(3600);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRfq(id)
      .then(async (r) => {
        setRfq(r);
        setTok(await tokenInfo(r.token));
        setPay(await tokenInfo(r.payToken));
        if (r.status === "accepted") setDeal(await api.getDeal(id, token));
      })
      .catch((e) => setErr(e.message));
  }, [id, token]);

  const quotes = usePoll(
    () => (rfq && rfq.status === "open" ? api.listQuotes(id, token) : Promise.resolve([] as SealedQuote[])),
    5000,
    [id, token, rfq?.status],
  );

  const offers = useMemo(() => {
    if (!secret || !quotes.data || !rfq) return [];
    return quotes.data
      .map((q) => ({ q, o: unseal<Offer>(q, secret) }))
      .filter((x): x is { q: SealedQuote; o: Offer } => !!x.o && x.o.amount === rfq.amount)
      .sort((a, b) => (BigInt(a.o.price) < BigInt(b.o.price) ? -1 : 1));
  }, [quotes.data, secret, rfq]);

  const accept = useAction(async (quoteId: string, o: Offer) => {
    if (!rfq) return;
    const { account } = await connectWallet();
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
    const ref = referral();
    const terms: Terms = {
      buyer: account,
      seller: getAddress(o.seller),
      token: rfq.token,
      amount: BigInt(o.amount),
      payToken: rfq.payToken,
      price: BigInt(o.price),
      sellerPayout: getAddress(o.sellerPayout),
      referrer: (ref ? getAddress(ref) : zeroAddress) as Address,
      relayerFee: BigInt(o.relayerFee),
      deadline: BigInt(Math.floor(Date.now() / 1000) + fundWindow),
      salt,
    };
    setDeal(await api.accept(id, token, quoteId, termsToJson(terms)));
    setRfq({ ...rfq, status: "accepted" });
  });

  const cancel = useAction(async () => {
    await api.cancelRfq(id, token);
    setRfq((r) => (r ? { ...r, status: "cancelled" } : r));
  });

  if (!token || !secret) return <p className="err">This private link is incomplete. Open the full link you saved when creating the bid.</p>;
  if (err) return <p className="err">{err}</p>;
  if (!rfq || !tok || !pay) return <p className="muted">Loading your bid…</p>;

  const left = rfq.expiresAt - now;
  const amountWhole = Number(formatUnits(BigInt(rfq.amount ?? "0"), tok.decimals));

  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>
            Your bid: {rfq.amount ? fmtAmount(rfq.amount, tok.decimals, 2) : "—"} {tok.symbol}
          </h2>
          {rfq.status === "open" ? (
            <Pill tone={left > 0 ? "info" : "warn"}>{left > 0 ? `${fmtLeft(left)} for offers` : "offers closed"}</Pill>
          ) : (
            <Pill tone={rfq.status === "accepted" ? "ok" : "muted"}>{rfq.status}</Pill>
          )}
        </div>
        <p className="muted">
          This page is your key. Keep the link private: anyone with it can accept offers on your behalf.{" "}
          <Copy text={window.location.href} label="Copy private link" />
        </p>
        <p className="muted">
          Share with sellers: <span className="mono">{`${window.location.origin}/rfq/${id}`}</span>{" "}
          <Copy text={`${window.location.origin}/rfq/${id}`} />
        </p>
      </section>

      {rfq.status === "open" && (
        <section className="card">
          <div className="card-head">
            <h2>Sealed offers</h2>
            <span className="muted">Decrypted here, in your browser. Cheapest first.</span>
          </div>
          {quotes.error && (
            <p className="err">
              {quotes.error}
            </p>
          )}
          {offers.length === 0 && <p className="muted empty">No offers yet. They'll appear here as they arrive.</p>}
          <div className="offers">
            {offers.map(({ q, o }, i) => (
              <div key={q.id} className={i === 0 ? "offer best" : "offer"}>
                <div>
                  <strong>
                    {fmtAmount(o.price, pay.decimals)} {pay.symbol}
                  </strong>
                  <span className="muted">
                    {" "}
                    · {(Number(formatUnits(BigInt(o.price), pay.decimals)) / amountWhole).toPrecision(6)} {pay.symbol}/{tok.symbol}
                  </span>
                  <div className="muted small">
                    from <span className="mono">{short(o.seller)}</span>
                    {o.ghost && " · ghost mode"}
                    {o.message && ` · "${o.message}"`}
                  </div>
                </div>
                <button className="btn primary sm" disabled={accept.busy} onClick={() => accept.run(q.id, o)}>
                  Accept
                </button>
              </div>
            ))}
          </div>
          {offers.length > 0 && (
            <label className="inline">
              Funding window after accepting
              <select value={fundWindow} onChange={(e) => setFundWindow(Number(e.target.value))}>
                {FUND_WINDOWS.map((w) => (
                  <option key={w.s} value={w.s}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Err msg={accept.error} />
          <button className="btn ghost sm" disabled={cancel.busy} onClick={() => cancel.run()}>
            Cancel bid
          </button>
          <Err msg={cancel.error} />
        </section>
      )}

      {deal && deal.escrow && (
        <DealPanel escrow={deal.escrow} dealId={deal.dealId} terms={termsFromJson(deal.terms)} role="buyer" />
      )}
      {deal && !deal.escrow && <p className="err">The server has no escrow address configured.</p>}
      {rfq.status === "accepted" && !deal && <p className="muted">Loading deal…</p>}
    </div>
  );
}

export { ApiError };
