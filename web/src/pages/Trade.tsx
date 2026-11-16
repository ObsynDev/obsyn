import { useEffect, useMemo, useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { api, type Rfq, type ServerConfig, type TokenMarket } from "../lib/api.ts";
import { KeyButton } from "../lib/buttons.tsx";
import { balanceOfAsset, connectWallet, tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { parseIntent, WINDOWS } from "../lib/describe.ts";
import { newBoxKeys, sideOf, toUrl } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { MARKETS, PAY_TOKENS } from "../lib/tokens.ts";
import { Err, fmtLeft, Link, navigate, useAction, useNow, usePoll } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

/**
 * /trade?ca=0x…&side=buy|sell — a trading page for one token: order ticket on the left,
 * your wallet and the open sealed blocks for that token on the right. Shareable per token.
 */

const WINDOW_LABEL: Record<number, string> = { 900: "15 min", 3600: "1 hour", 21600: "6 hours", 86400: "24 hours" };
const PRESETS = [25, 50, 75, 100];

const usd = (n: number | null | undefined, digits = 2) => {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
  return `$${n.toPrecision(4)}`;
};
const num = (n: number, max = 4) => n.toLocaleString("en-US", { maximumFractionDigits: max });
const bucket = (v: number | null) =>
  v === null ? "Size on request" : v < 500 ? "Under $500" : v < 5_000 ? "$500 – $5K" : v < 50_000 ? "$5K – $50K" : v < 250_000 ? "$50K – $250K" : "$250K+";

function readQuery() {
  const q = new URLSearchParams(window.location.search);
  const ca = q.get("ca") ?? q.get("token") ?? "";
  return { ca: isAddress(ca) ? getAddress(ca) : null, side: q.get("side") === "sell" ? ("sell" as const) : ("buy" as const) };
}

export function Trade() {
  const init = useMemo(readQuery, []);
  const [side, setSide] = useState<"buy" | "sell">(init.side);
  const [caInput, setCaInput] = useState(init.ca ?? "");
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [tokErr, setTokErr] = useState<string | null>(null);
  const [mkt, setMkt] = useState<TokenMarket | null>(null);
  const [pay, setPay] = useState<"ETH" | "USDG">("USDG");
  const [size, setSize] = useState(""); // USD on buy, tokens on sell
  const [win, setWin] = useState(86400);
  const [note, setNote] = useState("");
  const [describe, setDescribe] = useState("");
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const now = useNow();
  const { address: account, status } = useAccount();

  useEffect(() => {
    api.config().then(setCfg, () => {});
  }, []);

  // resolve the pasted address into a token + its market snapshot
  const ca = isAddress(caInput.trim()) ? getAddress(caInput.trim()) : null;
  useEffect(() => {
    setToken(null);
    setMkt(null);
    setTokErr(null);
    if (!ca) return;
    let alive = true;
    tokenInfo(ca).then(
      (t) => alive && setToken(t),
      (e) => alive && setTokErr(e.message),
    );
    api.tokenMarket(ca).then(
      (m) => alive && setMkt(m),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [ca]);

  // keep the URL shareable: /trade?ca=…&side=…
  useEffect(() => {
    const q = new URLSearchParams();
    if (ca) q.set("ca", ca);
    if (side === "sell") q.set("side", "sell");
    const url = `/trade${q.toString() ? `?${q}` : ""}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [ca, side]);

  // wallet balances: pay tokens, the selected token, and the listed markets (for "Sell privately")
  const usdgAddr = (cfg?.usdg ?? PAY_TOKENS.find((p) => p.symbol === "USDG")?.address ?? null) as Address | null;
  const watch = useMemo(() => {
    const set = new Map<string, Address>();
    if (ca) set.set(ca, ca);
    for (const m of MARKETS) set.set(m.address, m.address);
    return [...set.values()];
  }, [ca]);
  const balances = usePoll(
    async () => {
      if (!account) return null;
      const who = getAddress(account);
      const [eth, usdg, ...toks] = await Promise.all([
        balanceOfAsset(zeroAddress, who).catch(() => null),
        usdgAddr ? balanceOfAsset(usdgAddr, who).catch(() => null) : Promise.resolve(null),
        ...watch.map((t) => balanceOfAsset(t, who).catch(() => null)),
      ]);
      return { eth, usdg, toks: Object.fromEntries(watch.map((t, i) => [t, toks[i]])) as Record<string, bigint | null> };
    },
    20_000,
    [account, usdgAddr, watch.join()],
  );

  const ethUsd = mkt?.ethUsd ?? null;
  const price = mkt?.priceUsd ?? null;
  const tokenBal = ca && balances.data ? balances.data.toks[ca] ?? null : null;
  const buyingPower =
    !balances.data ? null : pay === "USDG" ? (balances.data.usdg !== null ? Number(formatUnits(balances.data.usdg, 6)) : null) : balances.data.eth !== null && ethUsd ? Number(formatUnits(balances.data.eth, 18)) * ethUsd : null;
  const sizeNum = Number(size.replace(/[,\s$]/g, ""));
  const estimate = !size || !isFinite(sizeNum) || sizeNum <= 0 || !price ? null : side === "buy" ? sizeNum / price : sizeNum * price;

  const preset = (pct: number) => {
    if (side === "buy") {
      if (buyingPower === null) return;
      setSize(String(Math.floor((buyingPower * pct) / 100)));
    } else {
      if (tokenBal === null || !token) return;
      const v = (tokenBal * BigInt(pct)) / 100n;
      setSize(formatUnits(v, token.decimals));
    }
  };

  const fill = () => {
    const syms = [...MARKETS.map((m) => m.symbol), "ETH", "USDG"];
    const it = parseIntent(describe, syms);
    if (it.side) setSide(it.side);
    if (it.token) {
      if (isAddress(it.token)) setCaInput(getAddress(it.token));
      else {
        const m = MARKETS.find((x) => x.symbol.toUpperCase() === it.token!.toUpperCase());
        if (m) setCaInput(m.address);
      }
    }
    if (it.pay) setPay(it.pay);
    if (it.window && (WINDOWS as readonly number[]).includes(it.window)) setWin(it.window);
    const s = it.side ?? side;
    if (s === "buy" && it.usd) setSize(String(it.usd));
    if (s === "sell" && it.amount) setSize(it.amount);
    if (s === "sell" && !it.amount && it.usd && price) setSize(String(+(it.usd / price).toPrecision(6)));
  };

  const connect = useAction(async () => {
    await connectWallet();
  });

  const submit = useAction(async () => {
    if (!ca) throw new Error("Paste the token's contract address first.");
    if (!token) throw new Error(tokErr ?? "Still reading the token. Try again in a second.");
    const keys = newBoxKeys();
    const encPubKey = btoa(String.fromCharCode(...keys.publicKey));
    let body: Parameters<typeof api.createRfq>[0];
    if (side === "buy") {
      if (!isFinite(sizeNum) || sizeNum < 5) throw new Error("Minimum $5.");
      body = { side, token: token.address, payToken: pay, sizeUsd: sizeNum, replySeconds: win, encPubKey };
    } else {
      const base = parseUnits(size.replace(/[,\s]/g, "") || "0", token.decimals);
      if (base <= 0n) throw new Error("Enter how many tokens you are selling.");
      if (tokenBal !== null && base > tokenBal) throw new Error(`You hold ${num(Number(formatUnits(tokenBal, token.decimals)))} ${token.symbol}.`);
      body = { side, token: token.address, payToken: pay, amount: base.toString(), replySeconds: win, encPubKey };
    }
    if (note.trim()) body.note = note.trim().slice(0, 140);
    const res = await api.createRfq(body);
    const link = `/bid/${res.id}#t=${res.manageToken}&k=${toUrl(keys.secretKey)}`;
    saved.addBid({ id: res.id, side, link, token: token.symbol, createdAt: Date.now() });
    navigate(link);
  });

  // open sealed blocks: for this token if one is set, else across the desk
  const rfqs = usePoll(api.listRfqs, 15_000, []);
  const open = (rfqs.data ?? []).filter((r) => r.status === "open" && r.expiresAt > now && (!ca || getAddress(r.token) === ca));
  const listings = open.filter((r) => sideOf(r) === "sell");
  const bids = open.filter((r) => sideOf(r) === "buy");
  const mine = saved.bids().filter((b) => !token || b.token === token.symbol).slice(0, 5);

  const holdings = balances.data
    ? watch
        .map((a) => ({ a, bal: balances.data!.toks[a] }))
        .filter((h): h is { a: Address; bal: bigint } => !!h.bal && h.bal > 0n)
        .map((h) => ({ ...h, m: MARKETS.find((x) => x.address === h.a) }))
    : [];

  const sellThis = (a: Address) => {
    setSide("sell");
    setCaInput(a);
    setSize("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sym = token?.symbol ?? mkt?.symbol ?? "token";
  const BlockList = ({ rows, kind }: { rows: Rfq[]; kind: "supply" | "demand" }) => (
    <div className="tr-rows">
      {rows.length === 0 && (
        <p className="muted small">
          {kind === "supply" ? `No sellers listed${ca ? ` for ${sym}` : ""} right now.` : `No open bids${ca ? ` for ${sym}` : ""} right now.`}
        </p>
      )}
      {rows.slice(0, 6).map((r) => {
        const known = MARKETS.find((m) => m.address === getAddress(r.token));
        const value = r.sizeUsd ?? (r.amount && token && price && getAddress(r.token) === ca ? Number(formatUnits(BigInt(r.amount), token.decimals)) * price : null);
        return (
          <div className="tr-row" key={r.id}>
            <TokenAvatar address={r.token} symbol={known?.symbol} size={34} side={kind === "supply" ? "sell" : "buy"} />
            <div className="tr-row-main">
              <b>{known?.symbol ?? (getAddress(r.token) === ca ? sym : `${r.token.slice(0, 6)}…`)}</b>
              <span className="muted small">
                {r.sizeUsd ? `~${usd(r.sizeUsd, 0)}` : bucket(value)} · {r.payToken === zeroAddress ? "ETH" : "USDG"} · {fmtLeft(r.expiresAt - now)} left
              </span>
            </div>
            <span className="tr-row-n mono">
              {r.quoteCount} {kind === "supply" ? "bid" : "offer"}
              {r.quoteCount === 1 ? "" : "s"}
            </span>
            <Link to={`/rfq/${r.id}`} className={`tr-go ${kind === "supply" ? "buy" : "sell"}`}>
              {kind === "supply" ? "Make offer" : "Sell to them"}
            </Link>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="trade">
      <header className="tr-head">
        <h1>{side === "buy" ? "Buy OTC" : "Sell OTC"}</h1>
        <p>
          {side === "buy" ? "Set your size. Sellers offer privately. Only you see the prices." : "List your size. Buyers bid privately. Only you see the bids."}
        </p>
        <p className="muted small">
          Pick one answer, both sides deposit into the contract, swap in one transaction. <Link to="/how">How it works</Link>
        </p>
      </header>

      <form
        className="tr-describe"
        onSubmit={(e) => {
          e.preventDefault();
          fill();
        }}
      >
        <span className="tr-spark" aria-hidden="true">
          ✦
        </span>
        <input
          value={describe}
          onChange={(e) => setDescribe(e.target.value)}
          placeholder={`Describe it: "Sell 500 NVDA for ETH within 1 hour"`}
          aria-label="Describe your trade"
          spellCheck={false}
        />
        <button type="submit" className="btn sm" disabled={!describe.trim()}>
          Fill
        </button>
        <small>Read in your browser only. Don't type personal details.</small>
      </form>

      <div className="tr-grid">
        <form
          className={`tr-ticket ${side}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit.run();
          }}
        >
          <div className="tr-ticket-head">
            <h2>Order ticket</h2>
            <div className="seg-mini" role="tablist">
              <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on buy" : ""} onClick={() => (setSide("buy"), setSize(""))}>
                Buy
              </button>
              <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => (setSide("sell"), setSize(""))}>
                Sell
              </button>
            </div>
          </div>

          <label className="tr-label">
            Contract address
            <input className="tr-input mono" value={caInput} onChange={(e) => setCaInput(e.target.value)} placeholder="0x… any token on Robinhood Chain" spellCheck={false} />
          </label>
          <div className="tr-chips" aria-label="Listed markets">
            {MARKETS.map((m) => (
              <button type="button" key={m.address} className={ca === m.address ? "on" : ""} onClick={() => setCaInput(m.address)}>
                {m.symbol}
              </button>
            ))}
          </div>

          {ca && (
            <div className="tr-token">
              {mkt?.imageUrl && !MARKETS.some((m) => m.address === ca) ? (
                <img src={mkt.imageUrl} alt="" width={44} height={44} className="tr-logo" />
              ) : (
                <TokenAvatar address={ca} symbol={token?.symbol} size={44} />
              )}
              <div>
                <b>
                  {token ? token.symbol : tokErr ? "Not a token" : "Reading…"}
                  {token && token.name && token.name !== token.symbol ? <span className="muted"> · {token.name}</span> : null}
                </b>
                <span className="muted small">
                  {tokErr ?? (
                    <>
                      Robinhood Chain · MC {usd(mkt?.marketCap)} · Price {usd(price, 6)}
                      {mkt?.change24h !== null && mkt?.change24h !== undefined && (
                        <i className={mkt.change24h >= 0 ? "up" : "down"}>
                          {" "}
                          {mkt.change24h >= 0 ? "+" : ""}
                          {mkt.change24h.toFixed(1)}%
                        </i>
                      )}
                      {mkt?.pairUrl && (
                        <>
                          {" · "}
                          <a href={mkt.pairUrl} target="_blank" rel="noreferrer">
                            chart ↗
                          </a>
                        </>
                      )}
                    </>
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="tr-power">
            <span>{side === "buy" ? "Buying power" : `Your ${sym}`}</span>
            {!account ? (
              <button type="button" className="text-link" onClick={() => connect.run()} disabled={connect.busy || status === "connecting"}>
                Connect wallet
              </button>
            ) : side === "buy" ? (
              <b>
                {buyingPower === null ? "…" : usd(buyingPower)} <span className="muted">in {pay}</span>
              </b>
            ) : (
              <b>{tokenBal === null || !token ? "…" : `${num(Number(formatUnits(tokenBal, token.decimals)))} ${token.symbol}`}</b>
            )}
          </div>

          <label className="tr-label">
            {side === "buy" ? "Size (USD)" : `Amount (${sym})`}
            <input className="tr-input big" value={size} onChange={(e) => setSize(e.target.value)} inputMode="decimal" placeholder="0" aria-label={side === "buy" ? "Size in USD" : "Amount of tokens"} />
          </label>
          <div className="tr-presets">
            {PRESETS.map((p) => (
              <button type="button" key={p} onClick={() => preset(p)} disabled={side === "buy" ? buyingPower === null : tokenBal === null}>
                {p === 100 ? "MAX" : `${p}%`}
              </button>
            ))}
          </div>
          <div className="tr-est">
            <span>{side === "buy" ? "≈ Tokens at market" : "≈ Value at market"}</span>
            <b>{estimate === null ? "–" : side === "buy" ? `${num(estimate)} ${sym}` : usd(estimate)}</b>
          </div>

          <div className="tr-opts">
            <div>
              <span className="muted small">{side === "buy" ? "Pay with" : "Get paid in"}</span>
              <div className="seg-mini">
                {(["USDG", "ETH"] as const).map((p) => (
                  <button type="button" key={p} className={pay === p ? "on" : ""} onClick={() => setPay(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="muted small">{side === "buy" ? "Offer window" : "Bid window"}</span>
              <div className="seg-mini">
                {WINDOWS.map((w) => (
                  <button type="button" key={w} className={win === w ? "on" : ""} onClick={() => setWin(w)}>
                    {WINDOW_LABEL[w]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <details className="tr-adv">
            <summary>Advanced</summary>
            <label className="tr-label">
              Note to {side === "buy" ? "sellers" : "buyers"} <span className="muted">(public, optional)</span>
              <input className="tr-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="e.g. can split, prefer USDG" />
            </label>
          </details>

          <Err msg={submit.error ?? connect.error} />
          <KeyButton type="submit" block tone={side === "buy" ? "green" : "red"} disabled={submit.busy}>
            {submit.busy ? "SEALING…" : side === "buy" ? "PLACE A PRIVATE BID" : "LIST PRIVATELY"}
          </KeyButton>
          <p className="tr-fine">Free to post. Prices are sealed to you. Fee only when it settles (2.5% max).</p>
        </form>

        <aside className="tr-side">
          <section className="tr-card">
            <div className="tr-card-head">
              <h3>Your wallet</h3>
              <span className="muted small">Robinhood Chain</span>
            </div>
            {!account ? (
              <>
                <p className="muted">Connect your wallet to see your tokens and sell them privately in one click.</p>
                <button type="button" className="btn" onClick={() => connect.run()} disabled={connect.busy}>
                  Connect wallet
                </button>
              </>
            ) : !balances.data ? (
              <p className="muted small">Reading balances…</p>
            ) : (
              <div className="tr-rows">
                <div className="tr-row plain">
                  <span className="muted small">Buying power</span>
                  <span className="mono small">
                    {balances.data.usdg !== null ? `${num(Number(formatUnits(balances.data.usdg, 6)), 2)} USDG` : "—"} ·{" "}
                    {balances.data.eth !== null ? `${num(Number(formatUnits(balances.data.eth, 18)), 4)} ETH` : "—"}
                  </span>
                </div>
                {holdings.length === 0 && <p className="muted small">No listed tokens in this wallet. Paste any token's address to sell it.</p>}
                {holdings.map((h) => (
                  <div className="tr-row" key={h.a}>
                    <TokenAvatar address={h.a} symbol={h.m?.symbol ?? (h.a === ca ? sym : undefined)} size={34} />
                    <div className="tr-row-main">
                      <b>{h.m?.symbol ?? (h.a === ca ? sym : `${h.a.slice(0, 6)}…`)}</b>
                      <span className="muted small mono">{num(Number(formatUnits(h.bal, h.a === ca && token ? token.decimals : 18)))}</span>
                    </div>
                    <button type="button" className="tr-go sell" onClick={() => sellThis(h.a)}>
                      Sell privately
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {side === "sell" ? (
            <>
              <section className="tr-card">
                <div className="tr-card-head">
                  <h3>Buyers waiting{ca ? ` for ${sym}` : ""}</h3>
                  <span className="muted small">sell into a bid, fastest exit</span>
                </div>
                <BlockList rows={bids} kind="demand" />
              </section>
              <section className="tr-card">
                <div className="tr-card-head">
                  <h3>Other sellers</h3>
                  <span className="muted small">anonymous</span>
                </div>
                <BlockList rows={listings} kind="supply" />
              </section>
            </>
          ) : (
            <section className="tr-card">
              <div className="tr-card-head">
                <h3>Sell-side supply</h3>
                <span className="muted small">anonymous</span>
              </div>
              <BlockList rows={listings} kind="supply" />
            </section>
          )}

          <section className="tr-card">
            <div className="tr-card-head">
              <h3>Your blocks</h3>
              <Link to="/mine" className="muted small">
                all →
              </Link>
            </div>
            {mine.length === 0 ? (
              <p className="muted small">Your bids and listings show up here. Private links are kept in this browser.</p>
            ) : (
              <div className="tr-rows">
                {mine.map((b) => (
                  <div className="tr-row plain" key={b.id}>
                    <span className={`tag ${b.side}`}>{b.side === "buy" ? "BID" : "LISTING"}</span>
                    <b>{b.token}</b>
                    <span className="muted small">{new Date(b.createdAt).toLocaleString()}</span>
                    <Link to={b.link} className="tr-go">
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
