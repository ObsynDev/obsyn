import { useEffect, useState } from "react";
import { api, type ServerConfig } from "../lib/api.ts";
import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { explorerAddr } from "../lib/chain.ts";
import { Reveal } from "../lib/motion.tsx";
import { Copy, short } from "../lib/ui.tsx";

const GUARANTEES: [string, string][] = [
  ["No admin, ever", "No owner, no admin key, no pause, no upgrade. Settings are fixed at deploy."],
  ["Funds have three exits", "Settle a deal, refund it, or claim ETH that couldn't be pushed. Nothing else moves money."],
  ["Terms can't be swapped", "The deal id is the hash of the full terms, so a deposit can't be redirected to other terms."],
  ["Fee capped in code", "2.5% is the hard maximum, written into the contract."],
  ["Refunds don't wait on the other side", "Each side refunds on its own, so a frozen token can't block the other."],
  ["Short deposits rejected", "Tokens that take a fee on transfer can't sneak in less than agreed."],
  ["Settlement never blocks on a price feed", "A broken feed falls back to the top fee tier instead of stopping the deal."],
];

const PRIVACY: [string, string][] = [
  ["Encrypted at the source", "Answers are encrypted in the sender's browser (NaCl box) to the poster's key."],
  ["Ciphertext only", "The server stores ciphertext and can't read a single price."],
  ["No accounts", "Private links carry random 256-bit keys. Only their hashes are stored."],
  ["Fakes get flagged", "Every answer is signed by the wallet it names. Anything else shows as unverified."],
];

const OPEN: [string, string][] = [
  ["No professional audit yet.", "There is an internal review and a full test suite. Use sizes you're comfortable with."],
  ["Ghost mode is not a mixer.", "Moving tokens into the one-time wallet is a public transaction."],
  ["A real but empty wallet can still stall a deal.", "The funds check shows it; the posting side should deposit after the other side."],
  ["Only list plain tokens.", "Tokens whose balances change on their own (rebasing) are not safe in any shared contract."],
  ["Private links are passwords.", "They live in your browser history; don't share them."],
];

export function Security() {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  useEffect(() => {
    api.config().then(setCfg, () => {});
  }, []);

  const contracts: [string, string | null | undefined, string][] = [
    ["Settlement contract", cfg?.escrow, "Holds deposits, settles or refunds. No admin."],
    ["USDG", cfg?.usdg, "Global Dollar, issued by Paxos"],
    ["Relayer", cfg?.relayer.address, "Pays gas for ghost-mode deposits"],
  ];

  return (
    <div className="dx sec">
      <header className="dx-head">
        <div>
          <span className="eyebrow mono">SECURITY</span>
          <h1>
            Trust the contract. <span className="copper">Not us.</span>
          </h1>
          <p className="dx-lede">
            Deposits sit in a contract contract nobody controls. Prices are sealed so nobody can front-run them. Here is what that
            means, and what is still open.
          </p>
        </div>
        <div className="dx-stats">
          <div>
            <span className="mono">CONTRACT</span>
            <b className={cfg?.escrow ? "ok-text" : "warn-text"}>{cfg ? (cfg.escrow ? "Live" : "Not live") : "…"}</b>
            <i>{cfg?.escrow ? short(cfg.escrow) : "settlement switches on at deploy"}</i>
          </div>
          <div>
            <span className="mono">ADMIN KEYS</span>
            <b className="mono">0</b>
            <i>no owner, pause or upgrade</i>
          </div>
          <div>
            <span className="mono">AUDIT</span>
            <b className="warn-text">Not yet</b>
            <i>internal review and full test suite</i>
          </div>
          <div>
            <span className="mono">FEE CAP</span>
            <b>2.5%</b>
            <i>hard maximum, in code</i>
          </div>
        </div>
      </header>

      <div className="dx-body sec-body">
        <section className="dx-sect">
          <span className="dx-n mono">01 · CONTRACT</span>
          <h2>What the contract guarantees</h2>
          <div className="sec-grid">
            {GUARANTEES.map(([t, d], i) => (
              <Reveal key={t} delay={i * 40} className="sec-card" as="div">
                <span className="sec-ic ok" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <b>{t}</b>
                  <p>{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="dx-sect">
          <span className="dx-n mono">02 · PRIVACY</span>
          <h2>Sealed means sealed</h2>
          <div className="sec-grid">
            {PRIVACY.map(([t, d], i) => (
              <Reveal key={t} delay={i * 40} className="sec-card" as="div">
                <span className="sec-ic ice" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
                  </svg>
                </span>
                <div>
                  <b>{t}</b>
                  <p>{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="dx-sect">
          <span className="dx-n mono">03 · OPEN ITEMS</span>
          <h2>What we're upfront about</h2>
          <div className="sec-open">
            {OPEN.map(([t, d]) => (
              <div key={t} className="sec-warn">
                <span className="sec-ic warn" aria-hidden="true">
                  !
                </span>
                <p>
                  <b>{t}</b> {d}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="dx-sect">
          <span className="dx-n mono">04 · CONTRACTS</span>
          <h2>Addresses on Robinhood Chain</h2>
          <table className="dx-table sec-table">
            <tbody>
              {contracts.map(([n, a, d]) => (
                <tr key={n}>
                  <td>
                    <b>{n}</b>
                    <div className="sec-sub">{d}</div>
                  </td>
                  <td className="mono">
                    {a ? (
                      <span className="sec-addr">
                        <a href={explorerAddr(a as `0x${string}`)} target="_blank" rel="noreferrer">
                          {short(a)} ↗
                        </a>
                        <Copy text={a} />
                      </span>
                    ) : (
                      <span className="dim">not deployed yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="dx-end">
        <h2>Read it yourself.</h2>
        <div className="btn-group">
          <SlotButton to="/docs#privacy">PRIVACY MODEL</SlotButton>
          <KeyButton to="/otc">OPEN THE DESK</KeyButton>
        </div>
      </section>
    </div>
  );
}
