import { useEffect, useState } from "react";
import { api, type ServerConfig } from "../lib/api.ts";
import { explorerAddr } from "../lib/chain.ts";
import { Copy } from "../lib/ui.tsx";

export function Security() {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  useEffect(() => {
    api.config().then(setCfg, () => {});
  }, []);

  const contracts: [string, string | null | undefined, string][] = [
    ["OtcEscrow", cfg?.escrow, "Holds deposits, settles or refunds. No admin."],
    ["USDG", cfg?.usdg, "Global Dollar, issued by Paxos"],
    ["Relayer", cfg?.relayer.address, "Pays gas for ghost-mode deposits"],
  ];

  return (
    <div className="doc">
      <span className="label">Security</span>
      <h1>
        Trust the contract. <span className="serif">Not us.</span>
      </h1>
      <p className="lede">
        Deposits sit in an escrow contract nobody controls. Prices are sealed so nobody can front-run them. Here is what that means,
        and what is still open.
      </p>

      <div className="status-strip">
        <div>
          <span>Escrow</span>
          <b className={cfg?.escrow ? "ok" : "warn-text"}>{cfg ? (cfg.escrow ? "deployed" : "not deployed yet") : "…"}</b>
        </div>
        <div>
          <span>Admin keys</span>
          <b className="ok">0</b>
        </div>
        <div>
          <span>Audit</span>
          <b className="warn-text">not yet</b>
        </div>
        <div>
          <span>Review</span>
          <b>internal</b>
        </div>
      </div>

      <section className="doc-sect">
        <span className="num">01 · ESCROW</span>
        <h2>What the contract guarantees</h2>
        <ul className="checks-list">
          <li>No owner, no admin key, no pause, no upgrade. Settings are fixed at deploy</li>
          <li>Funds move only to settle a deal, to refund it, or to claim ETH that couldn't be pushed</li>
          <li>The deal id is the hash of the full terms: a deposit can't be redirected to other terms</li>
          <li>Fee capped at 2.5% in code</li>
          <li>Each side refunds independently, so a frozen token can't block the other side</li>
          <li>Short deposits (fee-on-transfer tokens) are rejected</li>
          <li>A broken price feed falls back to the top fee tier instead of blocking settlement</li>
        </ul>
      </section>

      <section className="doc-sect">
        <span className="num">02 · PRIVACY</span>
        <h2>Sealed means sealed</h2>
        <ul className="checks-list">
          <li>Answers are encrypted in the sender's browser (NaCl box) to the poster's key</li>
          <li>The server stores ciphertext only and can't read prices</li>
          <li>No accounts: private links carry random 256-bit keys; only their hashes are stored</li>
          <li>Every answer is signed by the wallet it names, so fakes are flagged</li>
        </ul>
      </section>

      <section className="doc-sect">
        <span className="num">03 · OPEN ITEMS</span>
        <h2>What we're upfront about</h2>
        <ul className="risk-list">
          <li>
            <b>No professional audit yet.</b> There is an internal review and a full test suite. Use sizes you're comfortable with.
          </li>
          <li>
            <b>Ghost mode is not a mixer.</b> Moving tokens into the one-time wallet is a public transaction.
          </li>
          <li>
            <b>A real but empty wallet can still stall a deal.</b> The funds check shows it; the posting side should deposit after the
            other side.
          </li>
          <li>
            <b>Only list plain tokens.</b> Tokens whose balances change on their own (rebasing) are not safe in any shared escrow.
          </li>
          <li>
            <b>Private links are passwords.</b> They live in your browser history; don't share them.
          </li>
        </ul>
      </section>

      <section className="doc-sect">
        <span className="num">04 · CONTRACTS</span>
        <h2>Addresses on Robinhood Chain</h2>
        <div className="table-wrap">
          <table className="plain">
            <tbody>
              {contracts.map(([n, a, d]) => (
                <tr key={n}>
                  <td>
                    <b>{n}</b>
                    <div className="muted small">{d}</div>
                  </td>
                  <td className="mono">
                    {a ? (
                      <>
                        <a href={explorerAddr(a as `0x${string}`)} target="_blank" rel="noreferrer">
                          {a}
                        </a>{" "}
                        <Copy text={a} />
                      </>
                    ) : (
                      <span className="dim">not deployed yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
