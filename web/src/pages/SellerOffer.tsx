import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { api, type Rfq, type ServerConfig } from "../lib/api.ts";
import { connectWallet, tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { seal, unb64, type Offer } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Err, fmtAmount, fmtLeft, navigate, Pill, short, useAction, useNow } from "../lib/ui.tsx";

/** /rfq/:id — a seller answers a bid with a sealed offer. */
export function SellerOffer({ id }: { id: string }) {
  const now = useNow();
  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [mode, setMode] = useState<"wallet" | "ghost">("wallet");
  const [wallet, setWallet] = useState<string | null>(null);
  const [ghostKey] = useState<Hex>(() => generatePrivateKey());
  const ghostAddr = privateKeyToAccount(ghostKey).address;
  const [price, setPrice] = useState("");
  const [payout, setPayout] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([api.getRfq(id), api.config()])
      .then(async ([r, c]) => {
        setRfq(r);
        setCfg(c);
        const [t, p] = await Promise.all([tokenInfo(r.token), tokenInfo(r.payToken)]);
        setTok(t);
        setPay(p);
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
    if (!rfq.amount) throw new Error("This bid has no fixed size.");
    const seller = mode === "ghost" ? ghostAddr : wallet;
    if (!seller) throw new Error("Connect the wallet that holds the tokens.");
    if (!isAddress(payout)) throw new Error("Enter the address that should receive the payment.");
    const priceBase = parseUnits(price.replace(/,/g, ""), pay.decimals);
    if (priceBase <= 0n) throw new Error("Price must be above zero.");
    const relayerFee =
      mode === "ghost" ? BigInt(pay.symbol === "ETH" ? cfg.relayer.minFee.eth : cfg.relayer.minFee.usdg) : 0n;
    if (mode === "ghost" && !cfg.relayer.enabled) throw new Error("Ghost mode is unavailable: the relayer is offline.");

    const offer: Offer = {
      amount: rfq.amount,
      price: priceBase.toString(),
      seller,
      sellerPayout: getAddress(payout),
      relayerFee: relayerFee.toString(),
      ghost: mode === "ghost",
      message: message.trim() || undefined,
    };
    const res = await api.submitQuote(rfq.id, seal(offer, unb64(rfq.buyerEncPubKey)));
    const link = `/offer/${res.quoteId}#t=${res.quoteToken}${mode === "ghost" ? `&g=${ghostKey}` : ""}`;
    saved.addOffer({ id: res.quoteId, rfqId: rfq.id, link, offer, createdAt: Date.now() });
    navigate(link);
  });

  if (loadErr) return <p className="err">{loadErr}</p>;
  if (!rfq || !tok || !pay) return <p className="muted">Loading bid…</p>;

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
            Bid for {rfq.amount ? fmtAmount(rfq.amount, tok.decimals, 2) : "—"} {tok.symbol}
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
            <button type="button" className={mode === "ghost" ? "on" : ""} onClick={() => setMode("ghost")}>
              Ghost mode
            </button>
          </div>

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

          <label>
            Total price ({pay.symbol}) for the full {fmtAmount(rfq.amount ?? "0", tok.decimals, 2)} {tok.symbol}
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.0" required />
            {unit !== null && isFinite(unit) && (
              <small className="muted">
                ≈ {unit.toPrecision(6)} {pay.symbol} per {tok.symbol}
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
