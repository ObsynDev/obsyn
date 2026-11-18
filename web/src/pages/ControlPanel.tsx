import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { api, type ControlReport } from "../lib/api.ts";
import { explorerAddr } from "../lib/chain.ts";
import { Copy, short, useNow } from "../lib/ui.tsx";

const ADAPTER_NAMES: Record<string, string> = { "0xf20c97aedfad8de050e7e3ee797fa0434a16ab67": "V4BurnAdapter (Uniswap v4)" };

function Addr({ a }: { a: string }) {
  return (
    <span className="sec-addr">
      <a href={explorerAddr(a as `0x${string}`)} target="_blank" rel="noreferrer" className="mono">
        {short(a)} ↗
      </a>
      <Copy text={a} />
    </span>
  );
}

const when = (unix: number, now: number) => {
  const left = unix - now;
  const date = new Date(unix * 1000).toUTCString().replace(" GMT", " UTC").replace(/^\w+, /, "");
  if (left <= 0) return `ready since ${date}`;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return `in ${d ? `${d}d ` : ""}${h}h ${m}m · ${date}`;
};
const num = (v: string, dec: number, max = 4) => Number(formatUnits(BigInt(v), dec)).toLocaleString("en-US", { maximumFractionDigits: max });

/**
 * Who controls what, right now: read from the chain by the server every 30 seconds (GET /api/control).
 * Every row links to the contract so anyone can check it themselves.
 */
export function ControlPanel() {
  const [r, setR] = useState<ControlReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow();
  useEffect(() => {
    let alive = true;
    const load = () => api.control().then((x) => alive && (setR(x), setErr(null)), (e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (err && !r) return <p className="muted">Couldn't read the chain just now ({err}). The addresses below still work on the explorer.</p>;
  if (!r) return <p className="muted">Reading the contracts…</p>;

  const v = r.vault;
  const allTeam = r.safe ? r.safe.signers.every((s) => s.team) : false;
  const ownerText =
    v.ownerKind === "timelock" && r.timelock
      ? `A timelock: every change waits ${Math.round(r.timelock.minDelay / 86400)} days in public, then anyone can execute it.`
      : v.ownerKind === "safe" && r.safe
        ? `The team Safe: ${r.safe.threshold} of ${r.safe.signers.length} signatures for every change.`
        : `A ${v.ownerKind}.`;
  const route = v.route;

  return (
    <div className="ctl">
      <div className="ctl-grid">
        <div className="ctl-card">
          <span className="ctl-k mono">YOUR DEAL FUNDS</span>
          <b>In the escrow. No owner.</b>
          <p>No admin, pause or upgrade: there is no function anyone can call to move deposits. They go to the other side of the deal minus the fee, or back after the deadline.</p>
          {r.escrow.address && <Addr a={r.escrow.address} />}
          {r.escrow.legacy && (
            <p className="muted small">
              Deals from before 18 Nov 2026: <Addr a={r.escrow.legacy} />
            </p>
          )}
        </div>

        <div className="ctl-card">
          <span className="ctl-k mono">DESK FEES</span>
          <b>
            In the fee vault: {num(v.holds.eth, 18, 6)} ETH · {num(v.holds.usdg, 6, 2)} USDG
          </b>
          <p>Nobody can withdraw them. The vault can only buy $OBSYN and send it to the burn address. Fees on deals paid in $OBSYN are burned by the escrow at settlement.</p>
          <p className="muted small">Burned by the vault so far: {num(v.totalBurned, 18, 0)} $OBSYN</p>
          <Addr a={v.address} />
        </div>

        <div className="ctl-card">
          <span className="ctl-k mono">VAULT OWNER</span>
          <b>{ownerText}</b>
          <p>The owner can only change the burn route (behind the vault's own 2-day wait), the keeper and the owner. It can't move fees anywhere else.</p>
          <Addr a={v.owner} />
          {v.pendingOwner && (
            <p className="warn-text small">
              Ownership handover pending to <Addr a={v.pendingOwner} />
            </p>
          )}
        </div>

        <div className="ctl-card">
          <span className="ctl-k mono">KEEPER (RUNS BURNS)</span>
          <b>{v.keeperKind === "safe" && r.safe ? `The team Safe, ${r.safe.threshold} of ${r.safe.signers.length}` : `A ${v.keeperKind}`}</b>
          <p>Burns need the Safe's signatures, and every burn must send at least its minimum to the burn address or it reverts.</p>
          <Addr a={v.keeper} />
        </div>

        {r.safe && (
          <div className="ctl-card ctl-wide">
            <span className="ctl-k mono">SAFE SIGNERS · {r.safe.threshold} OF {r.safe.signers.length}</span>
            <ul className="ctl-signers">
              {r.safe.signers.map((s) => (
                <li key={s.address}>
                  <Addr a={s.address} /> <span className={`ctl-tag ${s.team ? "team" : "ext"}`}>{s.team ? "team" : "independent"}</span>
                </li>
              ))}
            </ul>
            {allTeam && <p className="muted small">All signers are held by the team today. Adding independent signers is the next step; it will show here, and as a Safe transaction, when it happens.</p>}
            <Addr a={r.safe.address} />
          </div>
        )}

        <div className="ctl-card">
          <span className="ctl-k mono">BURN ROUTE</span>
          <b>{route.active ? (ADAPTER_NAMES[route.active.toLowerCase()] ?? "Active") : "None active yet"}</b>
          {route.active && <Addr a={route.active} />}
          {route.pending && route.pendingEta > 0 && (
            <p className="small">
              Queued: {ADAPTER_NAMES[route.pending.toLowerCase()] ?? short(route.pending)}, can be switched on {when(route.pendingEta, now)}.
            </p>
          )}
        </div>

        {r.timelock && (
          <div className="ctl-card">
            <span className="ctl-k mono">QUEUED CHANGES</span>
            {!r.timelock.queuedKnown ? (
              <p className="muted small">Couldn't read the queue right now; check the timelock on the explorer.</p>
            ) : r.timelock.queued.length === 0 ? (
              <b>None. Nothing is waiting to change.</b>
            ) : (
              <ul className="ctl-queue">
                {r.timelock.queued.map((q) => (
                  <li key={q.id}>
                    <b>{q.label}</b> <span className="muted small">{when(q.readyAt, now)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Addr a={r.timelock.address} />
          </div>
        )}

        {r.burnedAtDead && (
          <div className="ctl-card">
            <span className="ctl-k mono">AT THE BURN ADDRESS</span>
            <b>{num(r.burnedAtDead, 18, 0)} $OBSYN</b>
            <p className="muted small">Everything ever sent to 0x…dEaD, from any source: the vault, deals paid in $OBSYN, buybacks and others.</p>
          </div>
        )}
      </div>
      <p className="muted small">Read from Robinhood Chain {Math.max(0, now - r.updatedAt)}s ago. Raw data: /api/control.</p>
    </div>
  );
}
