import { useEffect, useState } from "react";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { OtcEscrowAbi } from "../abi/OtcEscrow.ts";
import {
  balanceOf,
  buyerDeposit,
  dealState,
  explorerAddr,
  fundGhost,
  ghostDeposit,
  publicClient,
  refund,
  sellerDeposit,
  tokenInfo,
  type Terms,
  type TokenInfo,
} from "../lib/chain.ts";
import { Copy, Err, fmtAmount, fmtLeft, Pill, short, useAction, useNow, usePoll } from "../lib/ui.tsx";

/** Shared deal view for both sides: terms, live escrow state, and the next action. */
export function DealPanel({
  escrow,
  dealId,
  terms,
  role,
  ghostKey,
}: {
  escrow: Address;
  dealId: Hex;
  terms: Terms;
  role: "buyer" | "seller";
  ghostKey?: Hex;
}) {
  const now = useNow();
  const [tok, setTok] = useState<TokenInfo | null>(null);
  const [pay, setPay] = useState<TokenInfo | null>(null);
  const [fees, setFees] = useState<{ protocol: bigint; referrer: bigint; proceeds: bigint } | null>(null);

  useEffect(() => {
    tokenInfo(terms.token).then(setTok, () => {});
    tokenInfo(terms.payToken).then(setPay, () => {});
    publicClient()
      .then((c) => c.readContract({ address: escrow, abi: OtcEscrowAbi, functionName: "quoteSettlement", args: [terms] }))
      .then(([protocol, referrer, proceeds]) => setFees({ protocol, referrer, proceeds }), () => {});
  }, [escrow, terms]);

  const state = usePoll(() => dealState(escrow, dealId), 4000, [escrow, dealId]);
  const ghost = ghostKey ? privateKeyToAccount(ghostKey).address : null;
  const ghostBal = usePoll(() => (ghost ? balanceOf(terms.token, ghost) : Promise.resolve(0n)), 6000, [ghost, terms.token]);

  const [tx, setTx] = useState<Hex | null>(null);
  const act = useAction(async (kind: "buy" | "sell" | "fund" | "ghost" | "refund") => {
    const r =
      kind === "buy"
        ? await buyerDeposit(escrow, terms)
        : kind === "sell"
          ? await sellerDeposit(escrow, terms)
          : kind === "fund"
            ? await fundGhost(terms.token, ghost!, terms.amount - (ghostBal.data ?? 0n))
            : kind === "ghost"
              ? await ghostDeposit(escrow, terms, ghostKey!)
              : await refund(escrow, terms);
    if (r.status !== "success") throw new Error("Transaction reverted");
    setTx(r.transactionHash);
  });

  const s = state.data;
  const expired = Number(terms.deadline) <= now;
  const myFunded = s && (role === "buyer" ? s.buyerFunded : s.sellerFunded);
  const ghostReady = ghostBal.data !== null && ghostBal.data >= terms.amount;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Deal</h2>
        {!s ? (
          <Pill tone="muted">loading</Pill>
        ) : s.status === "settled" ? (
          <Pill tone="ok">settled</Pill>
        ) : s.status === "refunded" ? (
          <Pill tone="muted">refunded</Pill>
        ) : expired ? (
          <Pill tone="warn">expired</Pill>
        ) : (
          <Pill tone="info">{fmtLeft(Number(terms.deadline) - now)} to fund</Pill>
        )}
      </div>

      <div className="swap">
        <div>
          <span className="muted">Buyer gets</span>
          <strong>
            {tok ? fmtAmount(terms.amount, tok.decimals) : "…"} {tok?.symbol}
          </strong>
          <span className="check">{s?.sellerFunded ? "✓ deposited" : "waiting"}</span>
        </div>
        <span className="arrow">⇄</span>
        <div>
          <span className="muted">Seller gets</span>
          <strong>
            {pay ? fmtAmount(terms.price, pay.decimals) : "…"} {pay?.symbol}
          </strong>
          <span className="check">{s?.buyerFunded ? "✓ deposited" : "waiting"}</span>
        </div>
      </div>

      {fees && pay && (
        <dl className="kv small">
          <dt>Fee at settlement</dt>
          <dd>
            {fmtAmount(fees.protocol + fees.referrer, pay.decimals, 6)} {pay.symbol}
          </dd>
          {terms.relayerFee > 0n && (
            <>
              <dt>Relayer fee</dt>
              <dd>
                {fmtAmount(terms.relayerFee, pay.decimals, 6)} {pay.symbol}
              </dd>
            </>
          )}
          <dt>Seller receives</dt>
          <dd>
            {fmtAmount(fees.proceeds, pay.decimals, 6)} {pay.symbol} → <span className="mono">{short(terms.sellerPayout)}</span>
          </dd>
          <dt>Deal id</dt>
          <dd className="mono">
            {short(dealId)} <Copy text={dealId} />
          </dd>
          <dt>Escrow</dt>
          <dd>
            <a href={explorerAddr(escrow)} target="_blank" rel="noreferrer" className="mono">
              {short(escrow)}
            </a>
          </dd>
        </dl>
      )}

      {s && s.status === "open" && !expired && !myFunded && role === "buyer" && (
        <button className="btn primary" disabled={act.busy} onClick={() => act.run("buy")}>
          {act.busy ? "Confirm in wallet…" : `Deposit ${pay ? fmtAmount(terms.price, pay.decimals) : ""} ${pay?.symbol ?? ""}`}
        </button>
      )}

      {/* Payment locks first: the seller only deposits once the buyer has paid in, so a buyer who
          never pays can't tie up the seller's tokens until the deadline. */}
      {s && s.status !== "settled" && s.status !== "refunded" && !expired && !myFunded && role === "seller" && !ghost && !s.buyerFunded && (
        <p className="muted">Waiting for the buyer to lock the payment. You deposit after that, and the swap settles in the same transaction.</p>
      )}
      {s && s.status !== "settled" && s.status !== "refunded" && !expired && !myFunded && role === "seller" && !ghost && s.buyerFunded && (
        <button className="btn primary" disabled={act.busy} onClick={() => act.run("sell")}>
          {act.busy ? "Confirm in wallet…" : `Payment locked. Deposit ${tok ? fmtAmount(terms.amount, tok.decimals) : ""} ${tok?.symbol ?? ""} to settle`}
        </button>
      )}

      {s && s.status !== "settled" && s.status !== "refunded" && !expired && !myFunded && role === "seller" && ghost && (
        <div className="steps">
          <div className={ghostReady ? "step done" : "step"}>
            <b>1. Fund the one-time wallet</b>
            <p className="muted">
              <span className="mono">{ghost}</span> holds {tok && ghostBal.data !== null ? fmtAmount(ghostBal.data, tok.decimals) : "…"} of{" "}
              {tok ? fmtAmount(terms.amount, tok.decimals) : "…"} {tok?.symbol}.
            </p>
            {!ghostReady && (
              <button className="btn" disabled={act.busy} onClick={() => act.run("fund")}>
                Send tokens from my wallet
              </button>
            )}
          </div>
          <div className={s.buyerFunded ? "step done" : "step"}>
            <b>2. Wait for the buyer's deposit</b>
            <p className="muted">{s.buyerFunded ? "Buyer has deposited." : "The relayer only submits once the buyer has paid in."}</p>
          </div>
          <div className="step">
            <b>3. Gasless deposit</b>
            <p className="muted">Signs in this browser; the relayer pays the gas and the swap settles in that transaction.</p>
            <button className="btn primary" disabled={act.busy || !ghostReady || !s.buyerFunded} onClick={() => act.run("ghost")}>
              {act.busy ? "Relaying…" : "Deposit via relayer"}
            </button>
          </div>
        </div>
      )}

      {s && myFunded && s.status === "open" && !expired && (
        <p className="muted">You're funded. Waiting for the other side; it settles automatically when they deposit.</p>
      )}

      {s && s.status === "open" && expired && (s.buyerFunded || s.sellerFunded) && (
        <>
          <p className="muted">The deadline passed before both sides funded. Anyone can trigger the refund.</p>
          <button className="btn" disabled={act.busy} onClick={() => act.run("refund")}>
            Refund deposits
          </button>
          {ghost && (
            <p className="muted">
              A ghost-mode refund returns tokens to the one-time wallet. To move them out you'll need a little ETH there.
            </p>
          )}
        </>
      )}

      {s?.status === "settled" && <p className="ok">Done. Both sides were swapped in one transaction.</p>}

      {ghostKey && (
        <details className="muted">
          <summary>One-time wallet key</summary>
          <p>Keep this until the deal is settled. Anyone with it controls the one-time wallet.</p>
          <p className="mono break">{ghostKey}</p>
          <Copy text={ghostKey} label="Copy key" />
        </details>
      )}

      <Err msg={act.error} />
      {tx && (
        <p className="ok">
          Confirmed:{" "}
          <a href={`https://robinhoodchain.blockscout.com/tx/${tx}`} target="_blank" rel="noreferrer" className="mono">
            {short(tx)}
          </a>
        </p>
      )}
      {state.error && <p className="err">Can't read the escrow: {state.error}</p>}
    </section>
  );
}
