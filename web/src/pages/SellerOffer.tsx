import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, type Rfq, type ServerConfig } from "../lib/api.ts";
import { connectWallet, ghostSupported, NO_GHOST, tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { ghostPayable, NO_GHOST_PAY } from "../lib/pay.ts";
import { answerMessage, seal, sideOf, unb64, type Offer } from "../lib/sealed.ts";
import { BuyerAnswer } from "./BuyerAnswer.tsx";
import { useMarket, usePayUsd, vsLabel, vsMarket } from "../lib/market.ts";
import { saved } from "../lib/store.ts";
import { Err, fmtAmount, fmtLeft, navigate, Pill, short, useAction, useNow } from "../lib/ui.tsx";
import { toast } from "../lib/toast.tsx";

/** /rfq/:id — a seller answers a bid with a sealed offer. */
export function SellerOffer({ id }: { id: string }) {
  const now = useNow();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Ghost mode only works for tokens with EIP-2612 permits; null = not known yet
  const [ghostOk, setGhostOk] = useState<boolean | null>(null);

  const [mode, setMode] = useState<"wallet" | "ghost">("wallet");
  const [wallet, setWallet] = useState<string | null>(null);
  const [ghostKey] = useState<Hex>(() => generatePrivateKey());
  const ghostAddr = privateKeyToAccount(ghostKey).address;
  const [price, setPrice] = useState("");
  // Only used when the bid is sized in USD: the seller names how many tokens they offer.
  const [offerAmount, setOfferAmount] = useState("");
  const [payout, setPayout] = useState("");
  const [message, setMessage] = useState("");
  const market = useMarket(rfq?.token);
  const payUsd = usePayUsd(rfq?.payToken);

  useEffect(() => {
    Promise.all([api.getRfq(id), api.config()])
      .then(async ([r, c]) => {
        setRfq(r);
        setCfg(c);
        const [t, p] = await Promise.all([tokenInfo(r.token), tokenInfo(r.payToken)]);
        setTok(t);
        setPay(p);
        ghostSupported(r.token).then(setGhostOk);
      })
      .catch((e) => setLoadErr(e.message));
  }, [id]);

  const connect = useAction(async () => {
    const { account } = await connectWallet();
    setWallet(account);
    if (!payout) setPayout(account);
  });

  const submit = useAction(async () => {
    if (!rfq || !tok || !pay || !cfg) return;
    const seller = mode === "ghost" ? ghostAddr : wallet;
    if (!seller) throw new Error("Connect the wallet that holds the tokens.");
    if (!isAddress(payout)) throw new Error("Enter the address that should receive the payment.");
    const priceBase = parseUnits(price.replace(/,/g, ""), pay.decimals);
    if (priceBase <= 0n) throw new Error("Price must be above zero.");
    const relayerFee =
      mode === "ghost" ? BigInt(pay.symbol === "ETH" ? cfg.relayer.minFee.eth : cfg.relayer.minFee.usdg) : 0n;
    if (mode === "ghost" && !cfg.relayer.enabled) throw new Error("Ghost mode is unavailable: the relayer is offline.");
    if (mode === "ghost" && !ghostPayable(rfq.payToken, cfg.usdg)) throw new Error(NO_GHOST_PAY);
    if (mode === "ghost" && (await ghostSupported(rfq.token)) === false) throw new Error(NO_GHOST(tok.symbol));

    let amount = rfq.amount;
    const left = rfq.amount ? BigInt(rfq.amount) - BigInt(rfq.filledAmount ?? "0") : null;
    if (rfq.amount && rfq.partial) {
      // part of a partial bid: default to everything that's left
      const base = offerAmount.trim() ? parseUnits(offerAmount.replace(/[,\s]/g, ""), tok.decimals) : left!;
      if (base <= 0n) throw new Error("Enter how many tokens you are offering.");
      if (base > left!) throw new Error(`Only ${fmtAmount(left!, tok.decimals, 4)} ${tok.symbol} is left to fill.`);
      amount = base.toString();
    } else if (!amount) {
      const base = parseUnits(offerAmount.replace(/[,\s]/g, "") || "0", tok.decimals);
      if (base <= 0n) throw new Error("Enter how many tokens you are offering.");
      amount = base.toString();
    }
    const offer: Offer = {
      amount,
      price: priceBase.toString(),
      seller,
      sellerPayout: getAddress(payout),
      relayerFee: relayerFee.toString(),
      ghost: mode === "ghost",
      message: message.trim() || undefined,
    };
    // Sign with the wallet the offer names, so the buyer can tell it isn't a fake in someone else's name.
    const msg = answerMessage(rfq.id, "buy", seller, offer.amount, offer.price);
    if (mode === "ghost") {
      offer.sig = await privateKeyToAccount(ghostKey).signMessage({ message: msg });
    } else {
      const { wallet: w, account } = await connectWallet();
      if (account !== getAddress(seller)) throw new Error(`Switch your wallet back to ${seller}.`);
      offer.sig = await w.signMessage({ account, message: msg });
    }
    const res = await api.submitQuote(rfq.id, seal(offer, unb64(rfq.encPubKey ?? rfq.buyerEncPubKey)));
    const link = `/offer/${res.quoteId}#t=${res.quoteToken}${mode === "ghost" ? `&g=${ghostKey}` : ""}`;
    saved.addOffer({ id: res.quoteId, rfqId: rfq.id, side: "buy", link, offer, createdAt: Date.now() });
    toast({ tone: "ok", title: "Sealed offer sent", body: "Only the buyer can read it. You'll get a notice here if it's accepted.", key: `quote:${res.quoteId}` });
    navigate(link);
  });

  if (loadErr) return <p className="err">{loadErr}</p>;
  if (!rfq || !tok || !pay) return <p className="muted">Loading…</p>;
  // ghost mode needs a deal paid in ETH or USDG, and a token with gasless approvals
  const noGhost = cfg && !ghostPayable(rfq.payToken, cfg.usdg) ? NO_GHOST_PAY : ghostOk === false ? NO_GHOST(tok.symbol) : null;
  if (sideOf(rfq) === "sell") return <BuyerAnswer rfq={rfq} tok={tok} pay={pay} />;

  const left = rfq.expiresAt - now;
  const open = rfq.status === "open" && left > 0;
  const unit =
    price && Number(price) > 0 && (rfq.amount || Number(offerAmount) > 0)
      ? Number(price.replace(/,/g, "")) / (rfq.amount ? Number(formatUnits(BigInt(rfq.amount), tok.decimals)) : Number(offerAmount.replace(/,/g, "")))
      : null;

  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>
            Bid for {rfq.amount ? `${fmtAmount(rfq.amount, tok.decimals, 2)} ${tok.symbol}` : `~$${(rfq.sizeUsd ?? 0).toLocaleString("en-US")} of ${tok.symbol}`}
          </h2>
          {open ? <Pill tone="info">{fmtLeft(left)} left</Pill> : <Pill tone="muted">{rfq.status === "open" ? "closed" : rfq.status}</Pill>}
        </div>
        <dl className="kv">
          <dt>Token</dt>
          <dd className="mono">{rfq.token}</dd>
          <dt>Buyer pays in</dt>
          <dd>{pay.symbol}</dd>
          <dt>Offers so far</dt>
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
            <h2>Send a sealed offer</h2>
            <span className="muted">Encrypted to the buyer in your browser. Nobody else can read it, us included.</span>
          </div>

          <div className="seg wide">
            <button type="button" className={mode === "wallet" ? "on" : ""} onClick={() => setMode("wallet")}>
              From my wallet
            </button>
            <button
              type="button"
              className={mode === "ghost" ? "on" : ""}
              onClick={() => setMode("ghost")}
              disabled={!!noGhost}
              title={noGhost ?? undefined}
            >
              Ghost mode
            </button>
          </div>
          {noGhost && <p className="muted small">{noGhost}</p>}

          {mode === "wallet" ? (
            wallet ? (
              <p className="muted">Tokens will come from {short(wallet)}.</p>
            ) : (
              <button type="button" className="btn" onClick={() => connect.run()} disabled={connect.busy}>
                Connect wallet
              </button>
            )
          ) : (
            <div className="note">
              <p>
                A one-time wallet <span className="mono">{short(ghostAddr)}</span> was made in this browser. After the buyer
                accepts, you move the tokens into it and our relayer deposits them for you, so it never needs ETH. The relayer
                fee is taken from the proceeds.
              </p>
              <p className="muted">
                The buyer sees only the one-time address. The transfer into it is still public on-chain, so this hides you from
                the counterparty and casual watchers, not from chain analysis.
              </p>
            </div>
          )}
          <Err msg={connect.error} />

          {rfq.amount && rfq.partial && (
            <label>
              How many {tok.symbol} are you offering?{" "}
              <span className="muted">
                (partial fills allowed: up to {fmtAmount(BigInt(rfq.amount) - BigInt(rfq.filledAmount ?? "0"), tok.decimals, 4)} left; empty = all of it)
              </span>
              <input value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} inputMode="decimal" placeholder={fmtAmount(BigInt(rfq.amount) - BigInt(rfq.filledAmount ?? "0"), tok.decimals, 4)} />
            </label>
          )}
          {!rfq.amount && (
            <label>
              How many {tok.symbol} are you offering? <span className="muted">(the buyer asked for about ${(rfq.sizeUsd ?? 0).toLocaleString("en-US")} worth)</span>
              <input value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} inputMode="decimal" placeholder="0" required />
            </label>
          )}
          <label>
            Total price ({pay.symbol}) for {rfq.amount ? `the full ${fmtAmount(rfq.amount, tok.decimals, 2)}` : "your"} {tok.symbol}
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.0" required />
            {unit !== null && isFinite(unit) && (
              <small className="muted">
                ≈ {unit.toPrecision(6)} {pay.symbol} per {tok.symbol}
                {(() => {
                  try {
                    const amt = rfq.amount && !(rfq.partial && offerAmount.trim()) ? BigInt(rfq.amount) : parseUnits(offerAmount.replace(/[,\s]/g, "") || "0", tok.decimals);
                    const pct = vsMarket({ market, amount: amt, tokenDecimals: tok.decimals, price: parseUnits(price.replace(/,/g, ""), pay.decimals), payToken: rfq.payToken, payDecimals: pay.decimals, payUsd });
                    return pct === null ? null : ` · ${vsLabel(pct)}`;
                  } catch {
                    return null;
                  }
                })()}
              </small>
            )}
          </label>
          <label>
            Send payment to
            <input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder="0x… (a fresh address keeps it private)" spellCheck={false} required />
          </label>
          <label>
            Message to buyer <span className="muted">(optional, sealed)</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={200} />
          </label>
          <Err msg={submit.error} />
          <button className="btn primary" disabled={submit.busy}>
            {submit.busy ? "Sealing…" : "Seal and send offer"}
          </button>
        </form>
      )}
    </div>
  );
}
