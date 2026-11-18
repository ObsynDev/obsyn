import { useEffect, useState } from "react";
import { formatUnits, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { api, type DealReceipt } from "../lib/api.ts";
import { tokenInfo, type TokenInfo } from "../lib/chain.ts";
import { Copy, Link, short } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

const EXPLORER = "https://robinhoodchain.blockscout.com";

/**
 * /receipt/:tx — public receipt of a settled deal, rebuilt by the server from the settlement
 * transaction alone (its input holds the terms, its Settled event the fee split).
 */
export function Receipt({ tx }: { tx: Hex }) {
  const [r, setR] = useState<DealReceipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);

  useEffect(() => {
    api.receipt(tx).then(
      async (rec) => {
        setR(rec);
        const [t, p] = await Promise.all([tokenInfo(getAddress(rec.terms.token)), tokenInfo(getAddress(rec.terms.payToken))]);
        setTok(t);
        setPay(p);
      },
      (e) => setErr(e.message),
    );
  }, [tx]);

  if (err) return <div className="narrow"><p className="err">This isn't a settled Obsyn deal: {err}</p></div>;
  if (!r || !tok || !pay) return <div className="narrow"><p className="muted">Reading the settlement from Robinhood Chain…</p></div>;

  const t = r.terms;
  const amount = Number(formatUnits(BigInt(t.amount), tok.decimals));
  const price = Number(formatUnits(BigInt(t.price), pay.decimals));
  const f = (v: string) => `${Number(formatUnits(BigInt(v), pay.decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${pay.symbol}`;
  const totalFee = BigInt(r.protocolFee) + BigInt(r.referrerFee);
  const addr = (a: string) => (
    <a href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" className="mono">
      {short(a)}
    </a>
  );
  const when = new Date(r.timestamp * 1000);
  const link = `${window.location.origin}/receipt/${r.txHash}`;
  const card = `/api/receipts/${r.txHash}/card.png`;
  const v = r.vsDex ?? null;
  const usd = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) < 1000 ? 2 : 0, minimumFractionDigits: Math.abs(n) < 1000 ? 2 : 0 });
  const pct = (p: number | null) => (p === null ? "–" : p < 0.01 ? "<0.01%" : `~${p}%`);
  const signed = (n: number) => (n > 0 ? "+" : "") + usd(n);
  const qty = amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const tweet = [
    `Settled ${qty} ${tok.symbol} privately on @Obsyntrade: one price, no slippage, one transaction.`,
    v && v.buyerSavedUsd !== null && v.buyerSavedUsd > 0 ? `Buyer ${signed(v.buyerSavedUsd)} vs a DEX market buy.` : "",
    pay.symbol === "OBSYN" ? `${Number(formatUnits(BigInt(r.protocolFee), pay.decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 })} $OBSYN fee burned.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shareX = `https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(link)}`;

  return (
    <div className="narrow receipt">
      <section className="card">
        <div className="rc-head">
          <span className="rc-badge">SETTLED</span>
          <span className="muted small">{when.toUTCString().replace("GMT", "UTC")}</span>
        </div>
        <div className="rc-main">
          <TokenAvatar address={getAddress(t.token) as Address} symbol={tok.symbol} size={48} />
          <div>
            <b className="rc-amount">
              {amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {tok.symbol}
            </b>
            <span className="muted">
              for {price.toLocaleString("en-US", { maximumFractionDigits: 6 })} {pay.symbol} · {(price / amount).toPrecision(6)} {pay.symbol} per {tok.symbol}
            </span>
          </div>
        </div>
        <p className="muted small">Both sides swapped in one transaction on Robinhood Chain. This receipt is read from the chain, not from our database.</p>
      </section>

      {v && (
        <section className="card rc-vs">
          <h3>Against a DEX market order</h3>
          {v.thin || v.buyerSavedUsd === null || v.sellerGainedUsd === null ? (
            <p className="muted small">
              At settlement the token's deepest DEX pool held about {usd(v.liquidityUsd)}, too thin for a block this size ({usd(v.sizeUsd)}) to compare fairly.
            </p>
          ) : (
            <>
              <div className="rc-vs-grid">
                <div>
                  <span className="muted small">Buyer vs a DEX buy</span>
                  <b className={v.buyerSavedUsd >= 0 ? "pos" : "neg"}>{signed(v.buyerSavedUsd)}</b>
                  <span className="muted small">DEX impact {pct(v.buyImpactPct)}</span>
                </div>
                <div>
                  <span className="muted small">Seller vs a DEX sell</span>
                  <b className={v.sellerGainedUsd >= 0 ? "pos" : "neg"}>{signed(v.sellerGainedUsd)}</b>
                  <span className="muted small">DEX impact {pct(v.sellImpactPct)}</span>
                </div>
              </div>
              <p className="muted small">
                Estimate at settlement: {usd(v.sizeUsd)} of {tok.symbol} at the DEX price ({usd(v.tokenUsd)}) on a pool with about {usd(v.liquidityUsd)} of liquidity,
                against the {usd(v.dealUsd)} this block cost. Before fees.
              </p>
            </>
          )}
        </section>
      )}

      <section className="card rc-share">
        <img src={card} alt={`Share card: ${qty} ${tok.symbol} settled privately`} width={1200} height={630} loading="lazy" />
        <div className="rc-share-row">
          <a className="btn primary" href={shareX} target="_blank" rel="noreferrer">
            Share on X
          </a>
          <a className="btn ghost" href={card} download={`obsyn-${r.txHash.slice(2, 10)}.png`}>
            Download card
          </a>
          <Copy text={link} label="Copy link" />
        </div>
      </section>

      <section className="card">
        <dl className="kv">
          <dt>Buyer</dt>
          <dd>{addr(t.buyer)}</dd>
          <dt>Seller</dt>
          <dd>
            {addr(t.seller)}
            {r.settledBy === "depositTokensFor" && <span className="muted small"> · one-time wallet (ghost mode)</span>}
          </dd>
          <dt>Seller received</dt>
          <dd>
            {f(r.sellerProceeds)} → {addr(t.sellerPayout)}
          </dd>
          <dt>Fee</dt>
          <dd>
            {f(totalFee.toString())}
            {BigInt(r.referrerFee) > 0n && <span className="muted small"> (half to the referrer)</span>}
            {pay.symbol === "OBSYN" && <span className="muted small"> · burned</span>}
          </dd>
          {BigInt(r.relayerFee) > 0n && (
            <>
              <dt>Relayer fee</dt>
              <dd>{f(r.relayerFee)}</dd>
            </>
          )}
          <dt>Paid in</dt>
          <dd>{t.payToken === zeroAddress ? "ETH" : pay.symbol}</dd>
          <dt>Deal id</dt>
          <dd className="mono">
            {short(r.dealId)} <Copy text={r.dealId} />
          </dd>
          <dt>Block</dt>
          <dd className="mono">{Number(r.block).toLocaleString("en-US")}</dd>
          <dt>Transaction</dt>
          <dd>
            <a href={`${EXPLORER}/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="mono">
              {short(r.txHash)} ↗
            </a>{" "}
            <Copy text={`${window.location.origin}/receipt/${r.txHash}`} label="Copy receipt link" />
          </dd>
        </dl>
      </section>
      <p className="muted small rc-foot">
        Want to move size like this? <Link to="/otc">Open the desk →</Link>
      </p>
    </div>
  );
}
