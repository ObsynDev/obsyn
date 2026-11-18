import { useMemo } from "react";
import { getAddress, type Address, type Hex } from "viem";
import { api } from "../lib/api.ts";
import { termsFromJson } from "../lib/chain.ts";
import { hashParams, sideOf, type BuyerBid, type Offer } from "../lib/sealed.ts";
import { saved } from "../lib/store.ts";
import { Copy, Pill, usePoll } from "../lib/ui.tsx";
import { DealPanel } from "./DealPanel.tsx";

/**
 * /offer/:id#t=<quoteToken>[&g=<ghostKey>] — private page for an answer you sent:
 * a seller offer on someone's bid, or a buyer bid on someone's sell listing.
 */
export function SellerStatus({ id }: { id: string }) {
  const params = hashParams();
  const token = params.get("t") ?? "";
  const ghostKey = (params.get("g") as Hex | null) ?? undefined;
  const q = usePoll(() => api.getQuote(id, token), 5000, [id, token]);
  const mine = saved.offer(id);

  const terms = useMemo(() => (q.data?.terms ? termsFromJson(q.data.terms) : null), [q.data?.terms]);
  // Answering a buy bid makes you the seller; answering a sell listing makes you the buyer.
  const role = q.data ? (sideOf(q.data.rfq) === "buy" ? "seller" : "buyer") : null;

  // The poster builds the final terms. Check they match what we sent before depositing anything.
  const mismatch = useMemo(() => {
    if (!terms || !mine || !role) return [];
    const out: string[] = [];
    if (terms.price !== BigInt(mine.offer.price)) out.push("price");
    if (terms.amount !== BigInt(mine.offer.amount)) out.push("amount");
    if (role === "seller") {
      const o = mine.offer as Offer;
      if (terms.seller !== getAddress(o.seller)) out.push("seller address");
      if (terms.sellerPayout !== getAddress(o.sellerPayout)) out.push("payout address");
      if (terms.relayerFee !== BigInt(o.relayerFee)) out.push("relayer fee");
    } else {
      const b = mine.offer as BuyerBid;
      if (terms.buyer !== getAddress(b.buyer)) out.push("buyer address");
    }
    return out;
  }, [terms, mine, role]);

  if (!token) return <p className="err">This private link is incomplete. Open the full link you saved after answering.</p>;
  if (q.error && !q.data) return <p className="err">{q.error}</p>;
  if (!q.data || !role) return <p className="muted">Loading…</p>;

  const d = q.data;
  const noun = role === "seller" ? "offer" : "bid";
  return (
    <div className="narrow">
      <section className="card">
        <div className="card-head">
          <h2>Your sealed {noun}</h2>
          <Pill tone={d.status === "accepted" ? "ok" : d.status === "rejected" ? "muted" : "info"}>
            {d.status === "pending" ? `waiting for the ${role === "seller" ? "buyer" : "seller"}` : d.status === "rejected" ? "not selected" : "accepted"}
          </Pill>
        </div>
        <p className="muted">
          Keep this link: it's the only way back to this {noun}
          {ghostKey ? " and it holds your one-time wallet key" : ""}. <Copy text={window.location.href} label="Copy private link" />
        </p>
        {d.status === "pending" && <p className="muted">They haven't picked yet. This page updates on its own.</p>}
        {d.status === "rejected" && <p className="muted">They went with another answer or cancelled. Nothing was deposited.</p>}
      </section>

      {terms && mismatch.length > 0 && (
        <p className="err">Don't deposit: the deal terms differ from your {noun} ({mismatch.join(", ")}).</p>
      )}
      {terms && !mine && (
        <p className="muted">This browser has no copy of your original {noun}, so check the numbers below yourself before depositing.</p>
      )}
      {terms && d.dealId && mismatch.length === 0 && <DealPanelWithEscrow escrow={d.escrow} dealId={d.dealId} terms={terms} role={role} ghostKey={ghostKey} rfqId={d.rfq.id} />}
    </div>
  );
}

function DealPanelWithEscrow({
  escrow,
  dealId,
  terms,
  role,
  ghostKey,
  rfqId,
}: {
  /** the deal's own escrow, from the server (null on servers that don't say) */
  escrow: Address | null | undefined;
  dealId: Hex;
  terms: ReturnType<typeof termsFromJson>;
  role: "buyer" | "seller";
  ghostKey?: Hex;
  rfqId?: string;
}) {
  const cfg = usePoll(api.config, 60_000, []);
  if (!escrow && !cfg.data) return null;
  const on = escrow ?? cfg.data?.escrow;
  if (!on) return <p className="err">Trading isn't live yet: the server has no contract address configured.</p>;
  return <DealPanel escrow={on} dealId={dealId} terms={terms} role={role} ghostKey={role === "seller" ? ghostKey : undefined} rfqId={rfqId} />;
}
