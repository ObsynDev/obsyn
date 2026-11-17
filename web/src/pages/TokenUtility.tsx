import { useEffect, useState } from "react";
import { fomoUrl, PLATFORM_TOKEN } from "../lib/brand.tsx";
import { reducedMotion } from "../lib/motion.tsx";
import { Copy, short } from "../lib/ui.tsx";

/**
 * What holding the platform token does. Only what the contracts enforce:
 *  - OtcEscrow sends the protocol fee to BuyBurnVault, which buys the token and sends it to 0x…dEaD
 *  - OtcEscrow takes HOLDER_DISCOUNT_BPS (0.5%) off the fee when buyer or seller holds the minimum
 * No staking, yield or governance exists, so none is described.
 */

const T = PLATFORM_TOKEN.symbol;

const LOOP = [
  { k: "01", h: "A deal settles", p: "Buyer and seller swap in one contract transaction." },
  { k: "02", h: "Fee goes to the vault", p: "The protocol's share of the fee, in ETH or USDG, lands in the BuyBurnVault contract." },
  { k: "03", h: `The vault buys $${T}`, p: "On its Uniswap v4 pool (it graduated from the Pons curve), with a minimum-out check." },
  { k: "04", h: "Burned for good", p: "Bought tokens go straight to 0x…dEaD. The running total is public on-chain." },
];

const TIERS: [string, string, string][] = [
  ["Under $10k", "2.5%", "2.0%"],
  ["From $10k", "2.0%", "1.5%"],
  ["From $100k", "1.5%", "1.0%"],
];

export function TokenUtility() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % LOOP.length), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="tk">
      <div className="tk-grid">
        {/* buy-and-burn loop */}
        <div className="tk-loop" data-spot>
          <span className="tk-label mono">BUY-AND-BURN · IN THE CONTRACT</span>
          <ol>
            {LOOP.map((s, n) => (
              <li key={s.k} className={n === i ? "on" : n < i ? "done" : ""}>
                <span className="tk-k mono">{s.k}</span>
                <div>
                  <b>{s.h}</b>
                  <p>{s.p}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="tk-back mono" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            More deals on the desk, more ${T} bought and burned.
          </div>
        </div>

        {/* holder discount */}
        <div className="tk-disc" data-spot>
          <span className="tk-label mono">HOLDER DISCOUNT</span>
          <h3>
            Hold ${T}, pay <span>0.5% less</span> on every deal.
          </h3>
          <table className="mono">
            <thead>
              <tr>
                <th>Deal size</th>
                <th>Fee</th>
                <th>Holding ${T}</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map(([size, fee, held]) => (
                <tr key={size}>
                  <td>{size}</td>
                  <td className="dim">{fee}</td>
                  <td className="hl">{held}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Either side of the deal holding the minimum is enough; the contract checks both wallets at settlement. Minimum
            holding: {PLATFORM_TOKEN.discountMin ? `${PLATFORM_TOKEN.discountMin} $${T}` : "set once at launch"}.
          </p>
        </div>
      </div>

      {/* contract address bar */}
      <div className="tk-ca">
        <span className="tk-coin mono" aria-hidden="true">
          {T.slice(0, 1)}
        </span>
        <b>${T}</b>
        <span className="tk-ca-k mono">CA</span>
        {PLATFORM_TOKEN.address ? (
          <>
            <span className="mono">{short(PLATFORM_TOKEN.address)}</span>
            <Copy text={PLATFORM_TOKEN.address} />
          </>
        ) : (
          <span className="mono dim">not launched yet</span>
        )}
        <span className="tk-sep" />
        {PLATFORM_TOKEN.ponsUrl ? (
          <a className="mono" href={PLATFORM_TOKEN.ponsUrl} target="_blank" rel="noreferrer">
            Buy ${T} on Pons ↗
          </a>
        ) : (
          <span className="mono dim">Launching on Pons</span>
        )}
        {fomoUrl() && (
          <>
            <span className="tk-sep" />
            <a className="mono" href={fomoUrl()!} target="_blank" rel="noreferrer">
              Buy ${T} on fomo ↗
            </a>
          </>
        )}
      </div>

      <p className="tk-note small dim">
        ${T} is a utility token for this desk, not an investment. The desk works without it. Burns depend on how much trades
        here, and nothing on this page promises a price or a return.
      </p>
    </div>
  );
}
