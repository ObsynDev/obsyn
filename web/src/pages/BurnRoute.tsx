import { useEffect, useState } from "react";
import { api, type DeskStats } from "../lib/api.ts";
import { PLATFORM_TOKEN } from "../lib/brand.tsx";
import { Link, short, useNow } from "../lib/ui.tsx";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const ZERO = "0x0000000000000000000000000000000000000000";
/** The Uniswap v4 route queued on 2026-11-17 (see DEPLOYMENTS.md). Live values come from the vault. */
const ROUTE = {
  adapter: "0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67",
  queueTx: "0xd8a83043d507ea7441d62d1169ab7933985303ab53269d4c49e114804e19a397",
  eta: 1795119504, // 2026-11-19 20:18:24 UTC, used only until the vault has been read
};

const two = (n: number) => String(n).padStart(2, "0");
/** US Eastern time, e.g. "Thu, Nov 19, 3:18 PM EST". */
const usTime = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/**
 * The fee vault's switch to its Uniswap v4 buy route, shown with the vault's own public timelock:
 * a countdown while it waits, then "ready", then live. Read from the vault through /api/stats.
 */
export function BurnRoute() {
  const T = PLATFORM_TOKEN.symbol;
  const now = useNow();
  const [route, setRoute] = useState<NonNullable<NonNullable<DeskStats["vault"]>["route"]> | null>(null);
  const [vault, setVault] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      api.stats().then(
        (s) => {
          if (s.vault?.route) setRoute(s.vault.route);
          if (s.vault) setVault(s.vault.address);
        },
        () => {},
      );
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const adapter = (route?.pending !== ZERO && route?.pending) || (route?.active !== ZERO && route?.active) || ROUTE.adapter;
  // applyAdapter leaves pendingAdapter set to the same address with eta 0, so "live" only needs the active route
  const live = !!route && route.active !== ZERO && route.active.toLowerCase() === adapter.toLowerCase() && (route.pending === ZERO || route.pending.toLowerCase() === route.active.toLowerCase() || route.pendingEta === 0);
  const eta = route && route.pendingEta > 0 ? route.pendingEta : ROUTE.eta;
  const left = Math.max(0, eta - now);
  const state: "live" | "ready" | "waiting" = live ? "live" : left === 0 ? "ready" : "waiting";
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const when = new Date(eta * 1000);

  return (
    <div className={`brt brt-${state}`} data-spot>
      <div className="brt-head">
        <span className="tk-label mono">BURN ROUTE UPGRADE · PUBLIC 2-DAY TIMELOCK</span>
        <span className={`brt-pill mono brt-pill-${state}`}>{state === "live" ? "LIVE" : state === "ready" ? "READY" : "QUEUED"}</span>
      </div>

      <div className="brt-main">
        <div className="brt-copy">
          <h3>
            ${T} graduated to Uniswap v4. <span>The burn follows it.</span>
          </h3>
          <p>
            Fees used to buy ${T} on its Pons curve. The curve closed when ${T} graduated, so the fee vault gets a new route that buys on
            the Uniswap v4 pool. The vault can't switch routes on the spot: a new route waits two days in public before it can be turned on.
          </p>
        </div>

        <div className="brt-clock" aria-live="polite">
          {state === "waiting" ? (
            <>
              <div className="brt-digits mono">
                <span>
                  <b>{d}</b>
                  <i>days</i>
                </span>
                <span>
                  <b>{two(h)}</b>
                  <i>hrs</i>
                </span>
                <span>
                  <b>{two(m)}</b>
                  <i>min</i>
                </span>
                <span>
                  <b>{two(s)}</b>
                  <i>sec</i>
                </span>
              </div>
              <p className="brt-when mono">
                Can be turned on from {usTime(when)}
              </p>
            </>
          ) : state === "ready" ? (
            <p className="brt-status">The wait is over. The route switches on as soon as the vault owner confirms it.</p>
          ) : (
            <p className="brt-status">Live: desk fees now buy ${T} on Uniswap v4 and send it to the burn address.</p>
          )}
        </div>
      </div>

      <ol className="brt-steps">
        <li className="done">
          <b>Queued on-chain</b>
          <span>The new route was deployed and queued in the vault. Anyone can read it.</span>
        </li>
        <li className={state !== "waiting" ? "done" : "on"}>
          <b>2 days in public</b>
          <span>Time for anyone to check the route before it touches a single fee.</span>
        </li>
        <li className={live ? "done" : state === "ready" ? "on" : ""}>
          <b>Switched on</b>
          <span>Only after the wait. From then, fees buy ${T} and burn it.</span>
        </li>
      </ol>

      <ul className="brt-facts">
        <li>The route has no owner and no settings. Only the vault can use it, and it holds nothing between burns.</li>
        <li>Bought ${T} goes straight to 0x…dEaD. Every burn must hit a minimum, checked twice.</li>
        <li>{live ? "Nobody can withdraw the fees: the vault can only buy and burn." : "Until it's on, fees simply collect in the vault. Nobody can withdraw them."}</li>
      </ul>

      <div className="brt-links mono">
        <a href={`https://repo.sourcify.dev/4663/${adapter}`} target="_blank" rel="noreferrer">
          Route contract {short(adapter)} · verified ↗
        </a>
        <a href={`${EXPLORER}/tx/${ROUTE.queueTx}`} target="_blank" rel="noreferrer">
          Queue transaction ↗
        </a>
        {vault && (
          <a href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">
            Fee vault ↗
          </a>
        )}
        <Link to="/docs#token">How the burn works →</Link>
      </div>
    </div>
  );
}
