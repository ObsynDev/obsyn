import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, parseUnits, type Address } from "viem";
import { api } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { newBoxKeys, toUrl } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Err, navigate, useAction } from "../lib/ui.tsx";
import { DotWave } from "./DotWave.tsx";
import { TokenAvatar } from "./Terminal.tsx";

const WINDOWS = [
  { label: "15 min", s: 900 },
  { label: "1 hour", s: 3600 },
  { label: "6 hours", s: 21600 },
  { label: "24 hours", s: 86400 },
];

/** Known real tokens on Robinhood Chain, plus whatever is being traded on the desk right now. */
const KNOWN: Address[] = ["0x39dBED3a2bd333467115dE45665cC57F813C4571"]; // PONS

// ───────────────────────── token picker ─────────────────────────

function TokenPicker({ onPick, onClose }: { onPick: (t: TokenInfo) => void; onClose: () => void }) {
  const [list, setList] = useState<TokenInfo[]>([]);
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "ok" | "err"; t?: TokenInfo; msg?: string }>({ state: "idle" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // tokens from open blocks + known tokens, resolved through our server
  useEffect(() => {
    let alive = true;
    api
      .listRfqs()
      .catch(() => [])
      .then((rows) => {
        const addrs = [...new Set([...rows.map((r) => r.token), ...KNOWN].map((a) => getAddress(a)))];
        return Promise.all(addrs.map((a) => tokenInfo(a).catch(() => null)));
      })
      .then(async (ts) => {
        // USDG is the payment currency here, not something to trade
        const usdg = (await api.config().catch(() => null))?.usdg;
        if (alive) setList(ts.filter((t): t is TokenInfo => !!t && t.address !== usdg));
      });
    return () => {
      alive = false;
    };
  }, []);

  // pasted contract address → look it up on-chain
  useEffect(() => {
    const v = q.trim();
    if (!isAddress(v)) return setLookup({ state: "idle" });
    setLookup({ state: "loading" });
    tokenInfo(getAddress(v)).then(
      (t) => setLookup({ state: "ok", t }),
      (e) => setLookup({ state: "err", msg: e?.message ?? "Not a token on Robinhood Chain." }),
    );
  }, [q]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle && !isAddress(q.trim()) ? list.filter((t) => `${t.symbol} ${t.name}`.toLowerCase().includes(needle)) : list),
    [list, needle, q],
  );

  return (
    <div className="sheet-backdrop center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-modal="true" aria-label="Select a token">
        <div className="picker-head">
          <b>Select a token</b>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <input autoFocus className="picker-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or paste a contract address" spellCheck={false} />
        {lookup.state === "loading" && <p className="muted small picker-note">Reading the contract…</p>}
        {lookup.state === "err" && <p className="err small picker-note">{lookup.msg}</p>}
        <div className="picker-list">
          {lookup.state === "ok" && lookup.t && (
            <button className="picker-row" onClick={() => onPick(lookup.t!)}>
              <TokenAvatar address={lookup.t.address} symbol={lookup.t.symbol} size={34} />
              <span>
                <b>{lookup.t.symbol}</b>
                <i>{lookup.t.name}</i>
              </span>
              <em className="mono dim">pasted</em>
            </button>
          )}
          {shown.map((t) => (
            <button key={t.address} className="picker-row" onClick={() => onPick(t)}>
              <TokenAvatar address={t.address} symbol={t.symbol} size={34} />
              <span>
                <b>{t.symbol}</b>
                <i>{t.name}</i>
              </span>
              <em className="mono dim">
                {t.address.slice(0, 6)}…{t.address.slice(-4)}
              </em>
            </button>
          ))}
          {!shown.length && lookup.state !== "ok" && <p className="muted small picker-note">No match. Paste the token's contract address.</p>}
        </div>
        <p className="fine picker-note">Any ERC-20 on Robinhood Chain. Always check the contract address.</p>
      </div>
    </div>
  );
}

// ───────────────────────── page ─────────────────────────

export function Otc() {
  const [side, setSide] = useState<"buy" | "sell">(() => (new URLSearchParams(window.location.search).get("side") === "sell" ? "sell" : "buy"));
  const [usd, setUsd] = useState("");
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<"ETH" | "USDG">("USDG");
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [win, setWin] = useState(86400);
  const [picking, setPicking] = useState(false);

  const submit = useAction(async () => {
    if (!token) throw new Error("Select the token first.");
    const keys = newBoxKeys();
    const encPubKey = btoa(String.fromCharCode(...keys.publicKey));
    let body: Parameters<typeof api.createRfq>[0];
    if (side === "buy") {
      const v = Number(usd.replace(/[,\s$]/g, ""));
      if (!isFinite(v) || v < 5) throw new Error("Minimum $5.");
      body = { side, token: token.address, payToken: pay, sizeUsd: v, replySeconds: win, encPubKey };
    } else {
      const base = parseUnits(amount.replace(/[,\s]/g, "") || "0", token.decimals);
      if (base <= 0n) throw new Error("Enter how many tokens you are selling.");
      body = { side, token: token.address, payToken: pay, amount: base.toString(), replySeconds: win, encPubKey };
    }
    const res = await api.createRfq(body);
    const link = `/bid/${res.id}#t=${res.manageToken}&k=${toUrl(keys.secretKey)}`;
    saved.addBid({ id: res.id, side, link, token: token.symbol, createdAt: Date.now() });
    navigate(link);
  });

  const TokenButton = (
    <button type="button" className={`tok-btn ${token ? "set" : ""}`} onClick={() => setPicking(true)}>
      {token ? (
        <>
          <TokenAvatar address={token.address} symbol={token.symbol} size={24} />
          {token.symbol}
        </>
      ) : (
        "Select token"
      )}
      <span aria-hidden="true">▾</span>
    </button>
  );

  return (
    <div className="otc">
      <DotWave height={260} />
      <div className="otc-head">
        <h1>
          Private block trades. <span className="copper">Sealed until settled.</span>
        </h1>
      </div>

      <form
        className={`otc-card ${side}`}
        onSubmit={(e) => {
          e.preventDefault();
          submit.run();
        }}
      >
        <div className="otc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on buy" : ""} onClick={() => setSide("buy")}>
            Buy
          </button>
          <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>

        {side === "buy" ? (
          <>
            <div className="otc-box">
              <span className="otc-k">You pay</span>
              <div className="otc-row">
                <span className="otc-dollar">$</span>
                <input className="otc-amt" value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Amount in USD" />
                <span className="otc-unit">USD</span>
              </div>
              <div className="otc-sub">
                <span className="dim">Minimum $5</span>
                <span className="otc-pay">
                  Pay with
                  {(["ETH", "USDG"] as const).map((p) => (
                    <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)}>
                      {p}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <div className="otc-arrow" aria-hidden="true">
              ↓
            </div>
            <div className="otc-box">
              <span className="otc-k">You buy</span>
              <div className="otc-row">
                <span className="otc-amt otc-sealed mono">sealed offers</span>
                {TokenButton}
              </div>
              <div className="otc-sub dim">{token ? `Sellers answer with how many ${token.symbol} and a price, sealed to you.` : "Pick the token you want to buy."}</div>
            </div>
          </>
        ) : (
          <>
            <div className="otc-box">
              <span className="otc-k">You sell</span>
              <div className="otc-row">
                <input className="otc-amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Amount of tokens" />
                {TokenButton}
              </div>
              <div className="otc-sub dim">{token ? `${token.name}` : "Pick the token you want to sell."}</div>
            </div>
            <div className="otc-arrow" aria-hidden="true">
              ↓
            </div>
            <div className="otc-box">
              <span className="otc-k">You get</span>
              <div className="otc-row">
                <span className="otc-amt otc-sealed mono">sealed bids</span>
                <span className="otc-pay">
                  {(["ETH", "USDG"] as const).map((p) => (
                    <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)}>
                      {p}
                    </button>
                  ))}
                </span>
              </div>
              <div className="otc-sub dim">Buyers answer with a price, sealed to you. You pick the best one.</div>
            </div>
          </>
        )}

        <div className="otc-window">
          <span className="dim">Open for</span>
          <span className="otc-chips">
            {WINDOWS.map((w) => (
              <button type="button" key={w.s} className={win === w.s ? "on" : ""} onClick={() => setWin(w.s)}>
                {w.label}
              </button>
            ))}
          </span>
        </div>

        <Err msg={submit.error} />
        <button className={`otc-go ${side}`} disabled={submit.busy}>
          {submit.busy ? "CREATING…" : side === "buy" ? "CREATE PRIVATE BID" : "LIST PRIVATELY"}
        </button>
      </form>

      <p className="otc-foot">
        <span className="green">Non-custodial.</span> Settled on-chain in one transaction. <span className="copper">Prices sealed to you.</span>
      </p>

      {picking && (
        <TokenPicker
          onClose={() => setPicking(false)}
          onPick={(t) => {
            setToken(t);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
