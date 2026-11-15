import { useMemo } from "react";
import { getAddress, type Hex } from "viem";
import { api } from "../lib/api.ts";
import { termsFromJson } from "../lib/chain.ts";
import { hashParams } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Copy, Pill, usePoll } from "../lib/ui.tsx";
import { DealPanel } from "./DealPanel.tsx";

/** /offer/:id#t=<quoteToken>[&g=<ghostKey>] — the seller's private page. */
export function SellerStatus({ id }: { id: string }) {
  const params = hashParams();
  const token = params.get("t") ?? "";
  const ghostKey = (params.get("g") as Hex | null) ?? undefined;
  const q = usePoll(() => api.getQuote(id, token), 5000, [id, token]);
  const mine = saved.offer(id);

  const terms = useMemo(() => (q.data?.terms ? termsFromJson(q.data.terms) : null), [q.data?.terms]);

  // The buyer builds the final terms. Check they match what we offered before depositing anything.
  const mismatch = useMemo(() => {
    if (!terms || !mine) return [];
    const o = mine.offer;
    const out: string[] = [];
    if (terms.price !== BigInt(o.price)) out.push("price");
    if (terms.amount !== BigInt(o.amount)) out.push("amount");
    if (terms.seller !== getAddress(o.seller)) out.push("seller address");
    if (terms.sellerPayout !== getAddress(o.sellerPayout)) out.push("payout address");
    if (terms.relayerFee !== BigInt(o.relayerFee)) out.push("relayer fee");
    return out;
  }, [terms, mine]);

  if (!token) return <p className="err">This private link is incomplete. Open the full link you saved after sending the offer.</p>;
  if (q.error && !q.data) return <p className="err">{q.error}</p>;
  if (!q.data) return <p className="muted">Loading your offer…</p>;

  const d = q.data;
  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>Your sealed offer</h2>
          <Pill tone={d.status === "accepted" ? "ok" : d.status === "rejected" ? "muted" : "info"}>
            {d.status === "pending" ? "waiting for buyer" : d.status === "rejected" ? "not selected" : "accepted"}
          </Pill>
        </div>
        <p className="muted">
          Keep this link: it's the only way back to this offer{ghostKey ? " and it holds your one-time wallet key" : ""}.{" "}
          <Copy text={window.location.href} label="Copy private link" />
        </p>
        {d.status === "pending" && <p className="muted">The buyer hasn't picked yet. This page updates on its own.</p>}
        {d.status === "rejected" && <p className="muted">The buyer went with another offer or cancelled the bid. Nothing was deposited.</p>}
      </section>

      {terms && mismatch.length > 0 && (
        <p className="err">
          Don't deposit: the deal terms differ from your offer ({mismatch.join(", ")}).
        </p>
      )}
      {terms && !mine && (
        <p className="muted">This browser has no copy of your original offer, so check the numbers below yourself before depositing.</p>
      )}
      {terms && d.dealId && mismatch.length === 0 && (
        <DealPanelWithEscrow dealId={d.dealId} terms={terms} ghostKey={ghostKey} />
      )}
    </div>
  );
}

function DealPanelWithEscrow({ dealId, terms, ghostKey }: { dealId: Hex; terms: ReturnType<typeof termsFromJson>; ghostKey?: Hex }) {
  const cfg = usePoll(api.config, 60_000, []);
  if (!cfg.data) return null;
  if (!cfg.data.escrow) return <p className="err">The server has no escrow address configured.</p>;
  return <DealPanel escrow={cfg.data.escrow} dealId={dealId} terms={terms} role="seller" ghostKey={ghostKey} />;
}
