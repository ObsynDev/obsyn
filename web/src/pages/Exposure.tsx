import { getAddress, type Address, type Hex } from "viem";
import { Pill, short } from "../lib/ui.tsx";

/**
 * Exposure check for a ghost-mode deal: which public on-chain hops connect the one-time
 * wallet back to the seller. Built from what this browser saw (who funded the one-time
 * wallet) and the deal terms (where the payment goes), so it needs no indexer.
 */
type Funding = { from: Address; tx: Hex };
const key = (ghost: Address) => `obsyn.ghostfund.${ghost.toLowerCase()}`;

export function rememberFunding(ghost: Address, from: Address, tx: Hex) {
  try {
    localStorage.setItem(key(ghost), JSON.stringify({ from: getAddress(from), tx }));
  } catch {
    /* storage blocked: the check just knows less */
  }
}

function recalled(ghost: Address): Funding | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(ghost)) ?? "null");
    return v && typeof v.from === "string" && typeof v.tx === "string" ? { from: getAddress(v.from), tx: v.tx } : null;
  } catch {
    return null;
  }
}

type Finding = { tone: "ok" | "warn" | "muted"; title: string; body: string };

export function exposureFindings(ghost: Address, payout: Address, funding: Funding | null, ghostFunded: boolean): Finding[] {
  const out: Finding[] = [];
  if (funding) {
    out.push({
      tone: "warn",
      title: "Funding transfer is public",
      body: `${short(funding.from)} sent the tokens to the one-time wallet ${short(ghost)}. Anyone who looks at the one-time wallet sees where its tokens came from.`,
    });
  } else if (ghostFunded) {
    out.push({
      tone: "muted",
      title: "Funding source not seen here",
      body: "The one-time wallet holds the tokens, but they weren't sent from this browser. Whatever wallet sent them is linked to it on-chain.",
    });
  } else {
    out.push({
      tone: "muted",
      title: "Not funded yet",
      body: "Whatever wallet sends the tokens to the one-time wallet will be linked to it on-chain. An exchange withdrawal or a fresh wallet hides your main wallet.",
    });
  }
  if (funding && getAddress(payout) === funding.from) {
    out.push({
      tone: "warn",
      title: "Payment returns to the funding wallet",
      body: `The payment goes to ${short(payout)}, the same wallet that funded the one-time wallet. That closes the loop: one hop each way.`,
    });
  } else {
    out.push({
      tone: "ok",
      title: "Payment goes to a separate address",
      body: `The payment goes to ${short(payout)}${funding ? ", not to the wallet that funded the one-time wallet" : ""}. It still shows on-chain as the receiver of this deal.`,
    });
  }
  out.push({
    tone: "ok",
    title: "The deal itself names the one-time wallet",
    body: "On-chain the seller is the one-time wallet, and the relayer pays its gas, so no ETH transfer ties it to you.",
  });
  return out;
}

export function Exposure({ ghost, payout, ghostFunded }: { ghost: Address; payout: Address; ghostFunded: boolean }) {
  const funding = recalled(ghost);
  const findings = exposureFindings(ghost, payout, funding, ghostFunded);
  const links = findings.filter((f) => f.tone === "warn").length;
  return (
    <details className="exposure">
      <summary>
        Exposure check{" "}
        <Pill tone={links === 0 ? "ok" : "warn"}>{links === 0 ? "no direct link seen" : `${links} public link${links > 1 ? "s" : ""}`}</Pill>
      </summary>
      <ul className="exposure-list">
        {findings.map((f) => (
          <li key={f.title}>
            <Pill tone={f.tone}>{f.tone === "warn" ? "linked" : f.tone === "ok" ? "ok" : "note"}</Pill>
            <div>
              <b>{f.title}</b>
              <p className="muted small">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">
        For the most privacy: fund the one-time wallet from an exchange withdrawal or a fresh wallet, and take the payment
        to a fresh address. This check only covers this deal's own transfers.
      </p>
    </details>
  );
}
