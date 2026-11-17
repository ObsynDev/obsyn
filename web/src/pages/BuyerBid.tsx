import { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress, isAddress, toHex, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, ApiError, type DealInfo, type Rfq, type SealedQuote, type ServerConfig } from "../lib/api.ts";
import { balanceOfAsset, connectWallet, ghostSupported, NO_GHOST, termsFromJson, termsToJson, tokenInfo, verifyAnswerSig, type Terms, type TokenInfo } from "../lib/chain.ts";
import { answerMessage, fromUrl, hashParams, keysFromSecret, sideOf, unseal, type BuyerBid as BuyerBidMsg, type Offer } from "../lib/sealed.ts";
import { referral, saved } from "../lib/store.ts";
import { Copy, Err, fmtAmount, fmtLeft, Pill, short, useAction, useNow, usePoll } from "../lib/ui.tsx";
import { DealPanel } from "./DealPanel.tsx";
import { useMarket, vsLabel, vsMarket } from "../lib/market.ts";

const FUND_WINDOWS = [
  { label: "1 hour", s: 3600 },
  { label: "6 hours", s: 21600 },
  { label: "24 hours", s: 86400 },
];

type Answer = { q: SealedQuote; price: bigint; amount: string; from: string; ghost: boolean; message?: string; raw: Offer | BuyerBidMsg };

/**
 * /bid/:id#t=<manageToken>&k=<boxSecret>[&g=<ghostKey>] — private page for something you posted.
 * A buy bid (you are the buyer, sellers answer) or a sell listing (you are the seller, buyers answer).
 */
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
  const [ghostKey, setGhostKey] = useState<Hex | undefined>(() => (params.get("g") as Hex | null) ?? undefined);
  const now = useNow();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);
  const [deal, setDeal] = useState<DealInfo | null>(null);
  const [fundWindow, setFundWindow] = useState(3600);
  const [err, setErr] = useState<string | null>(null);
  // sell listings only: how the seller wants to settle
  const [ghost, setGhost] = useState(false);
  const [ghostOk, setGhostOk] = useState<boolean | null>(null);
  const [payout, setPayout] = useState("");

  useEffect(() => {
    Promise.all([api.getRfq(id), api.config()])
      .then(async ([r, c]) => {
        setRfq(r);
        setCfg(c);
        setTok(await tokenInfo(r.token));
        setPay(await tokenInfo(r.payToken));
        if (sideOf(r) === "sell") ghostSupported(r.token).then(setGhostOk);
        if (r.status === "accepted") setDeal(await api.getDeal(id, token));
      })
      .catch((e) => setErr(e.message));
  }, [id, token]);

  const side = rfq ? sideOf(rfq) : "buy";
  const market = useMarket(rfq?.token);
  const role = side === "buy" ? "buyer" : "seller";

  const quotes = usePoll(
    () => (rfq && rfq.status === "open" ? api.listQuotes(id, token) : Promise.resolve([] as SealedQuote[])),
    5000,
    [id, token, rfq?.status],
  );

  // Buy bid: seller offers, cheapest first. Sell listing: buyer bids, highest first.
  const answers = useMemo<Answer[]>(() => {
    if (!secret || !quotes.data || !rfq) return [];
    const out: Answer[] = [];
    for (const q of quotes.data) {
      const o = unseal<Offer & BuyerBidMsg>(q, secret);
      // Hostile input: skip anything malformed instead of breaking the list.
      const uint = (v: unknown) => typeof v === "string" && /^\d{1,78}$/.test(v);
      if (!o || typeof o !== "object" || !uint(o.price) || !uint(o.amount) || BigInt(o.amount) === 0n) continue;
      // Fixed-size postings only take answers for exactly that size; USD-sized bids take any size.
      if (rfq.amount && o.amount !== rfq.amount) continue;
      if (side === "buy" && (!isAddress(String(o.sellerPayout)) || !uint(o.relayerFee))) continue;
      const from = side === "buy" ? o.seller : o.buyer;
      if (!from || !isAddress(from)) continue;
      out.push({ q, price: BigInt(o.price), amount: o.amount, from, ghost: side === "buy" && !!o.ghost, message: o.message, raw: o });
    }
    // Rank by price per token (amounts can differ on USD-sized bids). Cross-multiply to stay exact.
    const cmp = (a: Answer, b: Answer) => {
      const l = a.price * BigInt(b.amount);
      const r = b.price * BigInt(a.amount);
      return l === r ? 0 : l < r ? -1 : 1;
    };
    return out.sort((a, b) => (side === "buy" ? cmp(a, b) : cmp(b, a)));
  }, [quotes.data, secret, rfq, side]);

  // Per answer: signed by the wallet it names? Does that wallet hold enough right now?
  const [checks, setChecks] = useState<Record<string, { verified: boolean; hasFunds: boolean | null }>>({});
  useEffect(() => {
    if (!rfq) return;
    let alive = true;
    for (const a of answers) {
      if (checks[a.q.id]) continue;
      const who = getAddress(a.from);
      Promise.all([
        verifyAnswerSig(who, answerMessage(id, side, who, a.amount, a.price.toString()), (a.raw as { sig?: unknown }).sig),
        a.ghost
          ? Promise.resolve(null) // a one-time wallet is only funded after acceptance
          : (side === "buy" ? balanceOfAsset(rfq.token, who).then((b) => b >= BigInt(a.amount)) : balanceOfAsset(rfq.payToken, who).then((b) => b >= a.price)).catch(
              () => null,
            ),
      ]).then(([verified, hasFunds]) => alive && setChecks((c) => ({ ...c, [a.q.id]: { verified, hasFunds } })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, rfq, side, id]);

  // Verified answers first, then best price.
  const ranked = useMemo(
    () => [...answers].sort((a, b) => Number(checks[b.q.id]?.verified ?? false) - Number(checks[a.q.id]?.verified ?? false)),
    [answers, checks],
  );

  const accept = useAction(async (a: Answer) => {
    if (!rfq) return;
    if (!checks[a.q.id]?.verified) {
      const ok = window.confirm(
        "This answer isn't signed by the wallet it names. It may be fake: someone using another wallet's address to tie up your deal until the deadline. Accept anyway?",
      );
      if (!ok) return;
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex;
    const ref = referral();
    const referrer = (ref ? getAddress(ref) : zeroAddress) as Address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + fundWindow);
    let terms: Terms;

    if (side === "buy") {
      const o = a.raw as Offer;
      const { account } = await connectWallet();
      terms = {
        buyer: account,
        seller: getAddress(o.seller),
        token: rfq.token,
        amount: BigInt(o.amount),
        payToken: rfq.payToken,
        price: BigInt(o.price),
        sellerPayout: getAddress(o.sellerPayout),
        referrer,
        relayerFee: BigInt(o.relayerFee),
        deadline,
        salt,
      };
    } else {
      const b = a.raw as BuyerBidMsg;
      if (!isAddress(payout)) throw new Error("Enter the address that should receive the payment.");
      let seller: Address;
      let relayerFee = 0n;
      if (ghost) {
        if (!cfg?.relayer.enabled) throw new Error("Ghost mode is unavailable: the relayer is offline.");
        if ((await ghostSupported(rfq.token)) === false) throw new Error(NO_GHOST(tok?.symbol ?? "This token"));
        const key = ghostKey ?? generatePrivateKey();
        seller = privateKeyToAccount(key).address;
        relayerFee = BigInt(rfq.payToken === zeroAddress ? cfg.relayer.minFee.eth : cfg.relayer.minFee.usdg);
        // Put the one-time key in this page's link before telling the server anything,
        // so reloading or reopening the saved link never loses it.
        const p = hashParams();
        p.set("g", key);
        const link = `/bid/${id}#${p.toString()}`;
        window.history.replaceState(null, "", link);
        saved.addBid({ id, side: "sell", link, token: tok?.symbol ?? "", createdAt: Date.now() });
        setGhostKey(key);
      } else {
        seller = (await connectWallet()).account;
      }
      terms = {
        buyer: getAddress(b.buyer),
        seller,
        token: rfq.token,
        amount: BigInt(b.amount),
        payToken: rfq.payToken,
        price: BigInt(b.price),
        sellerPayout: getAddress(payout),
        referrer,
        relayerFee,
        deadline,
        salt,
      };
    }
    setDeal(await api.accept(id, token, a.q.id, termsToJson(terms)));
    setRfq({ ...rfq, status: "accepted" });
  });

  const cancel = useAction(async () => {
    await api.cancelRfq(id, token);
    setRfq((r) => (r ? { ...r, status: "cancelled" } : r));
  });

  if (!token || !secret) return <p className="err">This private link is incomplete. Open the full link you saved when posting.</p>;
  if (err) return <p className="err">{err}</p>;
  if (!rfq || !tok || !pay) return <p className="muted">Loading…</p>;

  const left = rfq.expiresAt - now;
  const others = side === "buy" ? "sellers" : "buyers";
  const answerNoun = side === "buy" ? "offers" : "bids";

  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>
            {side === "buy" ? "Your bid" : "Your listing"}:{" "}
            {rfq.amount ? `${fmtAmount(rfq.amount, tok.decimals, 2)} ${tok.symbol}` : `~$${(rfq.sizeUsd ?? 0).toLocaleString("en-US")} of ${tok.symbol}`}
          </h2>
          {rfq.status === "open" ? (
            <Pill tone={left > 0 ? "info" : "warn"}>{left > 0 ? `${fmtLeft(left)} for ${answerNoun}` : `${answerNoun} closed`}</Pill>
          ) : (
            <Pill tone={rfq.status === "accepted" ? "ok" : "muted"}>{rfq.status}</Pill>
          )}
        </div>
        <p className="muted">
          This page is your key. Keep the link private: anyone with it can accept {answerNoun} on your behalf
          {ghostKey ? " and controls your one-time wallet" : ""}. <Copy text={window.location.href} label="Copy private link" />
        </p>
        <p className="muted">
          Share with {others}: <span className="mono">{`${window.location.origin}/rfq/${id}`}</span>{" "}
          <Copy text={`${window.location.origin}/rfq/${id}`} />
        </p>
      </section>

      {rfq.status === "open" && (
        <section className="card">
          <div className="card-head">
            <h2>Sealed {answerNoun}</h2>
            <span className="muted">Decrypted here, in your browser. {side === "buy" ? "Cheapest" : "Highest"} first.</span>
          </div>
          {quotes.error && <p className="err">{quotes.error}</p>}
          {answers.length === 0 && <p className="muted empty">No {answerNoun} yet. They'll appear here as they arrive.</p>}

          {side === "sell" && answers.length > 0 && (
            <div className="form">
              <div className="seg wide">
                <button type="button" className={!ghost ? "on" : ""} onClick={() => setGhost(false)}>
                  Deliver from my wallet
                </button>
                <button
                  type="button"
                  className={ghost ? "on" : ""}
                  onClick={() => setGhost(true)}
                  disabled={ghostOk === false}
                  title={ghostOk === false ? NO_GHOST(tok.symbol) : undefined}
                >
                  Ghost mode
                </button>
              </div>
              {ghostOk === false && <p className="muted small">{NO_GHOST(tok.symbol)}</p>}
              {ghost && (
                <p className="muted small">
                  A one-time wallet is made in this browser. After accepting you move the tokens into it and the relayer deposits
                  them for you. The buyer sees only the one-time address; the relayer fee comes out of the proceeds.
                </p>
              )}
              <label>
                Send payment to
                <input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x… (a fresh address keeps it private)" spellCheck={false} />
              </label>
            </div>
          )}

          <div className="offers">
            {ranked.map((a, i) => (
              <div key={a.q.id} className={i === 0 && checks[a.q.id]?.verified ? "offer best" : "offer"}>
                <div>
                  <strong>
                    {fmtAmount(a.price, pay.decimals)} {pay.symbol}
                  </strong>
                  <span className="muted">
                    {" "}
                    {" "}for {fmtAmount(a.amount, tok.decimals, 4)} {tok.symbol} · {(Number(formatUnits(a.price, pay.decimals)) / Number(formatUnits(BigInt(a.amount), tok.decimals))).toPrecision(6)} {pay.symbol}/{tok.symbol}
                  </span>
                  <div className="muted small">
                    from <span className="mono">{short(a.from)}</span>
                    {a.ghost && " · ghost mode"}
                    {a.message && ` · "${a.message.slice(0, 200)}"`}
                  </div>
                  <div className="checks">
                    {(() => {
                      // a buyer wants under market, a seller wants over
                      const pct = vsMarket({ market, amount: BigInt(a.amount), tokenDecimals: tok.decimals, price: a.price, payToken: rfq.payToken, payDecimals: pay.decimals });
                      if (pct === null) return null;
                      const good = side === "buy" ? pct <= 0 : pct >= 0;
                      return (
                        <span title="Against the token's on-chain DEX price. Reference only.">
                          <Pill tone={Math.abs(pct) < 0.05 ? "muted" : good ? "ok" : "warn"}>{vsLabel(pct)}</Pill>
                        </span>
                      );
                    })()}
                    {!checks[a.q.id] ? (
                      <Pill tone="muted">checking…</Pill>
                    ) : (
                      <>
                        <Pill tone={checks[a.q.id].verified ? "ok" : "warn"}>{checks[a.q.id].verified ? "signed by this wallet" : "unverified"}</Pill>
                        {checks[a.q.id].hasFunds === true && <Pill tone="ok">{side === "buy" ? "holds the tokens" : "has the funds"}</Pill>}
                        {checks[a.q.id].hasFunds === false && <Pill tone="warn">{side === "buy" ? "doesn't hold the tokens" : "not enough funds"}</Pill>}
                        {checks[a.q.id].hasFunds === null && a.ghost && <Pill tone="muted">funded after accept</Pill>}
                      </>
                    )}
                  </div>
                </div>
                <button className="btn primary sm" disabled={accept.busy} onClick={() => accept.run(a)}>
                  Accept
                </button>
              </div>
            ))}
          </div>
          {answers.length > 0 && (
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
            Cancel {side === "buy" ? "bid" : "listing"}
          </button>
          <Err msg={cancel.error} />
        </section>
      )}

      {deal && deal.escrow && (
        <DealPanel
          escrow={deal.escrow}
          dealId={deal.dealId}
          terms={termsFromJson(deal.terms)}
          role={role}
          ghostKey={role === "seller" ? ghostKey : undefined}
          rfqId={id}
        />
      )}
      {deal && !deal.escrow && <p className="err">Trading isn't live yet: the server has no contract address configured.</p>}
      {rfq.status === "accepted" && !deal && <p className="muted">Loading deal…</p>}
    </div>
  );
}

export { ApiError };
