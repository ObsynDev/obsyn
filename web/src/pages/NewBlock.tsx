import { useEffect, useState } from "react";
import { getAddress, isAddress, parseUnits } from "viem";
import { api } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { newBoxKeys, toUrl } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Err, navigate, useAction } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";
import { PAY_TITLE, useKeepPayValid, usePayOptions, type PaySymbol } from "../lib/pay.ts";

const WINDOWS = [
  { label: "15m", s: 900 },
  { label: "1h", s: 3600 },
  { label: "4h", s: 14400 },
  { label: "24h", s: 86400 },
];

function useToken(addr: string) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setErr(null);
    if (!isAddress(addr)) return;
    tokenInfo(getAddress(addr)).then(setInfo, (e) => setErr(e?.message ?? "Couldn't read this token on Robinhood Chain."));
  }, [addr]);
  return { info, err };
}

/** Slide-over panel: post a buy bid or a sell listing. */
export function NewBlock({ initialSide, onClose }: { initialSide: "buy" | "sell"; onClose: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<PaySymbol>("USDG");
  const [win, setWin] = useState(3600);
  const [note, setNote] = useState("");
  const { info, err: tokenErr } = useToken(token.trim());
  const payOpts = usePayOptions(["USDG", "ETH"], info?.address);
  useKeepPayValid(pay, payOpts.options, setPay);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = useAction(async () => {
    if (!info) throw new Error("Enter a valid token address first.");
    const base = parseUnits(amount.replace(/[,\s]/g, ""), info.decimals);
    if (base <= 0n) throw new Error("Size must be above zero.");
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
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className={`sheet ${side}`}
        role="dialog"
        aria-modal="true"
        aria-label="New block"
        onSubmit={(e) => {
          e.preventDefault();
          submit.run();
        }}
      >
        <div className="sheet-head">
          <h2>New block</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="side-switch">
          <button type="button" className={side === "buy" ? "on buy" : ""} onClick={() => setSide("buy")}>
            Buy
          </button>
          <button type="button" className={side === "sell" ? "on sell" : ""} onClick={() => setSide("sell")}>
            Sell privately
          </button>
        </div>

        <label className="field">
          <span>Token</span>
          <div className="token-input">
            {info ? <TokenAvatar address={info.address} symbol={info.symbol} size={28} /> : <span className="token-ph" />}
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x… contract on Robinhood Chain" spellCheck={false} required />
          </div>
          {info && (
            <small className="ok">
              {info.symbol} · {info.name}
            </small>
          )}
          {tokenErr && <small className="err">{tokenErr}</small>}
        </label>

        <label className="field">
          <span>Size {info && <em>{info.symbol}</em>}</span>
          <input className="big" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250,000" inputMode="decimal" required />
        </label>

        <div className="row2">
          <div className="field">
            <span>{side === "buy" ? "Pay with" : "Get paid in"}</span>
            <div className="chips">
              {payOpts.options.map((p) => (
                <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)} title={PAY_TITLE[p]}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>{other} reply for</span>
            <div className="chips">
              {WINDOWS.map((w) => (
                <button type="button" key={w.s} className={win === w.s ? "on" : ""} onClick={() => setWin(w.s)}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="field">
          <span>
            Public note <em>optional</em>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder={side === "buy" ? "Can fill in one block" : "Whole block only"} />
        </label>

        <ul className="sheet-facts">
          <li>No account. You get a private link that controls this block.</li>
          <li>
            {other} answer with sealed {side === "buy" ? "offers" : "bids"}, signed by their wallet. Only you can read them.
          </li>
          <li>Settles in one contract transaction, or everyone is refunded.</li>
        </ul>

        <Err msg={submit.error} />
        <button className={`cta ${side}`} disabled={submit.busy}>
          {submit.busy ? "Creating…" : side === "buy" ? "Create private bid" : "Create private listing"}
        </button>
      </form>
    </div>
  );
}
