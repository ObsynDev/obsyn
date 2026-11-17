import { useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, zeroAddress } from "viem";
import { useAccount } from "wagmi";
import { api, type ReferralSummary } from "../lib/api.ts";
import { connectWallet } from "../lib/chain.ts";
import { Copy, Err, short, useAction } from "../lib/ui.tsx";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const amt = (v: string, decimals: number, max: number) => Number(formatUnits(BigInt(v), decimals)).toLocaleString("en-US", { maximumFractionDigits: max });

/**
 * /refer — a wallet's referral link and what it has earned. The escrow pays the referrer half the
 * protocol fee at settlement, straight to the referrer's wallet; nothing here holds funds.
 */
export function Refer() {
  const { address: connected } = useAccount();
  const [lookup, setLookup] = useState("");
  const me = connected ?? null;
  const other = isAddress(lookup.trim()) ? getAddress(lookup.trim()) : null;
  const who = other ?? me;
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    if (!who) return;
    api.referrals(who).then(setData, (e) => setErr(e.message));
  }, [who]);

  const connect = useAction(async () => {
    await connectWallet();
  });

  const link = me ? `${window.location.origin}/?ref=${me}` : null;

  return (
    <div className="doc refer">
      <span className="label">Referrals</span>
      <h1>
        Bring a trader. <span className="copper">Earn half the fee.</span>
      </h1>
      <p className="lede">
        Share your link. When someone you sent accepts a deal and it settles, the escrow contract pays you half of the protocol fee, in ETH or
        USDG, straight to your wallet in the same transaction. No sign-up, no claiming, nothing to withdraw.
      </p>

      <section className="card refer-card">
        {!me ? (
          <>
            <p>Connect the wallet that should receive referral fees to get your link.</p>
            <button className="btn primary" disabled={connect.busy} onClick={() => connect.run()}>
              {connect.busy ? "Connecting…" : "Connect wallet"}
            </button>
            <Err msg={connect.error} />
          </>
        ) : (
          <>
            <span className="muted small">Your referral link</span>
            <div className="refer-link">
              <code className="mono break">{link}</code>
              <Copy text={link!} label="Copy link" />
            </div>
            <p className="muted small">
              Paid to <span className="mono">{short(me)}</span>. Any page works: add <span className="mono">?ref={short(me)}</span> to a trade or
              desk link, e.g. <span className="mono">/trade?ca=0x…&amp;ref=…</span>.
            </p>
          </>
        )}
      </section>

      {who && other && <p className="muted small">Showing referrals for <span className="mono">{short(other)}</span>. Clear the box below to see your own.</p>}
      {who && (
        <section className="stat-grid">
          <div className="stat-tile">
            <span className="stat-label">Deals referred</span>
            <b className="stat-value">{data ? data.deals.accepted : "…"}</b>
            <span className="stat-sub">{data ? `${data.deals.settled} settled` : " "}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Earned in ETH</span>
            <b className="stat-value">{data ? amt(data.earned.eth, 18, 6) : "…"}</b>
            <span className="stat-sub">paid at settlement</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Earned in USDG</span>
            <b className="stat-value">{data ? amt(data.earned.usdg, 6, 2) : "…"}</b>
            <span className="stat-sub">paid at settlement</span>
          </div>
        </section>
      )}
      {err && <p className="err">Couldn't load referrals: {err}</p>}

      {data && data.recent.length > 0 && (
        <section className="doc-sect">
          <h2>Settled referrals</h2>
          <ul className="refer-list">
            {data.recent.map((r) => (
              <li key={r.dealId}>
                <span className="muted small">{new Date(r.acceptedAt * 1000).toISOString().slice(0, 10)}</span>
                <b>
                  {r.payToken === zeroAddress ? `${amt(r.fee, 18, 6)} ETH` : `${amt(r.fee, 6, 2)} USDG`}
                </b>
                {r.settleTx ? (
                  <a href={`/receipt/${r.settleTx}`} className="mono small">
                    receipt ↗
                  </a>
                ) : (
                  <a href={`${EXPLORER}/address/${data.referrer}`} target="_blank" rel="noreferrer" className="mono small">
                    {short(r.dealId)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="doc-sect">
        <h2>How it works</h2>
        <ol className="refer-steps">
          <li>Someone opens a link with your <span className="mono">?ref=</span>. Their browser remembers your address (the latest link they opened wins).</li>
          <li>
            When they accept a deal on a bid or listing they posted, your address goes into the deal terms. Both sides see it before they
            deposit, and it can't change afterwards: the deal id is a hash of the terms.
          </li>
          <li>At settlement the escrow splits the protocol fee: half to the fee vault for the $OBSYN buy-and-burn, half to you.</li>
        </ol>
        <p className="muted small">
          A referrer can't be the buyer, the seller or the payout address of the same deal, so you can't refer yourself. Referral fees come out
          of the normal fee; traders pay nothing extra.
        </p>
      </section>

      <section className="doc-sect">
        <h2>Check any wallet</h2>
        <input
          className="refer-input mono"
          placeholder="0x… referrer address"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          spellCheck={false}
        />
      </section>
    </div>
  );
}
