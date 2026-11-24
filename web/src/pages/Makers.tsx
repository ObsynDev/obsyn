import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { useAccount } from "wagmi";
import { api, makerMessage, type Maker } from "../lib/api.ts";
import { connectWallet } from "../lib/chain.ts";
import { MARKETS } from "../lib/tokens.ts";
import { Copy, Err, Link, short, useAction } from "../lib/ui.tsx";

const MCP_VERSION = "0.4.0";
const PKG = `https://github.com/ObsynDev/obsyn/releases/download/mcp-v${MCP_VERSION}/obsyn-mcp-${MCP_VERSION}.tgz`;
const EXPLORER = "https://robinhoodchain.blockscout.com";

type Side = "both" | "sell" | "buy";
type Pay = "any" | "USDG" | "ETH" | "OBSYN";

/** The same limits the autopilot enforces, checked here so a downloaded file always runs. */
function problemsOf(f: { side: Side; pct: string; perDeal: string; total: string; floor: string; ceiling: string }) {
  const out: string[] = [];
  const pct = Number(f.pct);
  if (f.pct.trim() === "" || !Number.isFinite(pct)) out.push(f.side === "both" ? "Set a spread." : "Set a price against the market.");
  else if (f.side === "both" && (pct <= 0 || pct > 20)) out.push("The spread must be above 0% and at most 20%.");
  else if (f.side === "sell" && (pct < -20 || pct > 50)) out.push("Selling: between −20% and +50% against the market.");
  else if (f.side === "buy" && (pct > 20 || pct < -50)) out.push("Buying: between −50% and +20% against the market.");
  const per = Number(f.perDeal);
  const tot = Number(f.total);
  if (!/^\d+(\.\d+)?$/.test(f.perDeal) || per <= 0) out.push("Most per deal must be a positive number of tokens.");
  if (!/^\d+(\.\d+)?$/.test(f.total) || tot <= 0) out.push("Most in total must be a positive number of tokens.");
  if (per > tot) out.push("Most per deal can't be more than most in total.");
  if (f.floor.trim() && !(Number(f.floor) > 0)) out.push("The floor must be a positive USD price.");
  if (f.ceiling.trim() && !(Number(f.ceiling) > 0)) out.push("The ceiling must be a positive USD price.");
  return out;
}

/**
 * /makers — anyone can make markets on Obsyn: run the autopilot with their own key and answer blocks by
 * rules. This page builds the rules file, shows how to run it, lets a maker list itself with a signature,
 * and shows every listed maker's track record (checked on-chain).
 */
export function Makers() {
  const [token, setToken] = useState(MARKETS.find((m) => m.symbol === "NVDA")?.address ?? MARKETS[0].address);
  const [side, setSide] = useState<Side>("both");
  const [pct, setPct] = useState("1.5");
  const [pay, setPay] = useState<Pay>("USDG");
  const [perDeal, setPerDeal] = useState("5");
  const [total, setTotal] = useState("50");
  const [floor, setFloor] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [live, setLive] = useState(false);

  const tok = MARKETS.find((m) => m.address === token)!;
  const payOk = !(pay === "OBSYN" && tok.symbol === "OBSYN");
  const problems = [...problemsOf({ side, pct, perDeal, total, floor, ceiling }), ...(payOk ? [] : ["$OBSYN can't be paid for in $OBSYN: pick another payment."])];

  const rules = useMemo(() => {
    const rule: Record<string, unknown> = { side, token: tok.address, payWith: pay, maxTotal: total, maxPerDeal: perDeal };
    if (side === "both") rule.spreadPct = Number(pct);
    else rule.priceVsMarketPct = Number(pct);
    if (floor.trim() && side !== "buy") rule.minPriceUsd = Number(floor);
    if (ceiling.trim() && side !== "sell") rule.maxPriceUsd = Number(ceiling);
    return JSON.stringify({ live, intervalSec: 30, maxOpenAnswers: 5, rules: [rule] }, null, 2);
  }, [side, tok, pay, total, perDeal, pct, floor, ceiling, live]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([rules + "\n"], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rules.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── listed makers ──
  const [makers, setMakers] = useState<Maker[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const load = () => api.makers().then(setMakers, (e) => setLoadErr(e.message));
  useEffect(() => {
    load();
  }, []);

  const { address: connected } = useAccount();
  const me = connected ? getAddress(connected) : null;
  const mine = makers?.find((m) => me && m.address === me) ?? null;
  const [name, setName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const connect = useAction(async () => {
    await connectWallet();
  });
  const sign = useAction(async (action: "list" | "unlist") => {
    setDone(null);
    const { wallet, account } = await connectWallet();
    const address = getAddress(account);
    const n = (action === "unlist" ? mine?.name ?? name : name).trim();
    if (!n) throw new Error("Pick a name first.");
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await wallet.signMessage({ account: address, message: makerMessage(action, address, n, issuedAt) });
    const r = await api.setMaker({ action, address, name: n, issuedAt, signature });
    setDone(r.listed ? `Listed as "${r.name}".` : "Unlisted.");
    await load();
  });

  return (
    <div className="doc makers">
      <span className="label">Makers</span>
      <h1>
        Make markets on Obsyn. <span className="copper">Keep your keys.</span>
      </h1>
      <p className="lede">
        A maker answers blocks: "I'll sell NVDA at 1.5% over the DEX price, up to 50 tokens". The poster gets a whole block with no slippage, you
        earn the spread. Anyone can do it, with no sign-up and no permission: the autopilot runs on your own machine with your own wallet, answers
        matching bids and listings with sealed, signed prices, and deposits by itself when an answer is accepted.
      </p>

      <p className="muted small">
        Step-by-step guide: <Link to="/docs#makers">in the docs</Link> or{" "}
        <a href="https://github.com/ObsynDev/obsyn/blob/main/MAKERS.md" target="_blank" rel="noreferrer">
          MAKERS.md on GitHub
        </a>
        .
      </p>

      <section className="mk-points">
        <div className="card">
          <b>You set the rules</b>
          <p className="muted small">Which tokens, which side, your spread against the live DEX price, a cap per deal and in total, an optional price floor or ceiling.</p>
        </div>
        <div className="card">
          <b>It never overreaches</b>
          <p className="muted small">No reference price, no answer. Balance checked before every answer. It never deposits before the deal says so, and stops at your caps.</p>
        </div>
        <div className="card">
          <b>It finishes its deals</b>
          <p className="muted small">Answers in play are written to disk, so a restart still deposits on ones accepted while it was down.</p>
        </div>
      </section>

      <h2>1. Build your rules</h2>
      <section className="card mk-form">
        <div className="mk-row">
          <label>
            <span className="muted small">Token</span>
            <select value={token} onChange={(e) => setToken(e.target.value as typeof token)}>
              {MARKETS.map((m) => (
                <option key={m.address} value={m.address}>
                  {m.symbol} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted small">Paid in</span>
            <select value={pay} onChange={(e) => setPay(e.target.value as Pay)}>
              <option value="USDG">USDG</option>
              <option value="ETH">ETH</option>
              <option value="OBSYN">$OBSYN</option>
              <option value="any">Any</option>
            </select>
          </label>
        </div>
        <div className="seg" role="group" aria-label="Side">
          {(["both", "sell", "buy"] as const).map((s) => (
            <button
              type="button"
              key={s}
              className={side === s ? "on" : ""}
              onClick={() => {
                setSide(s);
                setPct(s === "buy" ? "-1.5" : "1.5");
              }}
            >
              {s === "both" ? "Both sides" : s === "sell" ? "Sell only" : "Buy only"}
            </button>
          ))}
        </div>
        <div className="mk-row">
          <label>
            <span className="muted small">{side === "both" ? "Spread, % each side of the DEX price" : side === "sell" ? "Sell at, % vs the DEX price (+1.5 = above)" : "Buy at, % vs the DEX price (−1.5 = below)"}</span>
            <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
          </label>
          <label>
            <span className="muted small">Most per deal ({tok.symbol})</span>
            <input inputMode="decimal" value={perDeal} onChange={(e) => setPerDeal(e.target.value.trim())} />
          </label>
          <label>
            <span className="muted small">Most in total, each side ({tok.symbol})</span>
            <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.trim())} />
          </label>
        </div>
        <div className="mk-row">
          {side !== "buy" && (
            <label>
              <span className="muted small">Never sell under (USD per token, optional)</span>
              <input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value.trim())} />
            </label>
          )}
          {side !== "sell" && (
            <label>
              <span className="muted small">Never buy over (USD per token, optional)</span>
              <input inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value.trim())} />
            </label>
          )}
        </div>
        <label className="mk-live">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <span>
            Live <span className="muted small">(off = a dry run: it only prints what it would answer. Start with it off.)</span>
          </span>
        </label>
        {problems.length > 0 ? (
          <ul className="err mk-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <>
            <pre className="mono mk-json">{rules}</pre>
            <div className="mk-acts">
              <button type="button" className="btn primary" onClick={download}>
                Download rules.json
              </button>
              <Copy text={rules} label="Copy" />
            </div>
          </>
        )}
      </section>

      <h2>2. Run it</h2>
      <section className="card mk-run">
        <p className="muted small">
          Node 20 or newer. Use a dedicated wallet holding only what you're willing to trade (the tokens you sell and the USDG, ETH or $OBSYN you
          buy with, plus a little ETH for gas). The key stays on your machine.
        </p>
        <span className="muted small">macOS / Linux</span>
        <div className="cmd-bar block-cmd">
          <pre>{`OBSYN_PRIVATE_KEY=0x… npx -y ${PKG} autopilot rules.json`}</pre>
          <Copy text={`OBSYN_PRIVATE_KEY=0x... npx -y ${PKG} autopilot rules.json`} />
        </div>
        <span className="muted small">Windows (PowerShell)</span>
        <div className="cmd-bar block-cmd">
          <pre>{`$env:OBSYN_PRIVATE_KEY="0x…"; npx -y ${PKG} autopilot rules.json`}</pre>
          <Copy text={`$env:OBSYN_PRIVATE_KEY="0x..."; npx -y ${PKG} autopilot rules.json`} />
        </div>
        <p className="muted small">
          Watch a dry run first. When the answers look right, set <span className="mono">"live": true</span> and start it again. Stop with Ctrl+C;
          answers still in play are kept in <span className="mono">~/.obsyn/autopilot.json</span> and picked up on the next start.
        </p>
      </section>

      <h2>3. List yourself (optional)</h2>
      <section className="card mk-list">
        <p className="muted small">
          Listing adds a name and a public track record to your answers: posters see a Maker badge on answers signed by your wallet. It's a signed
          message, no gas, and you can unlist any time. Unlisted makers trade exactly the same.
        </p>
        {!me ? (
          <>
            <button className="btn primary" disabled={connect.busy} onClick={() => connect.run()}>
              {connect.busy ? "Connecting…" : "Connect the maker wallet"}
            </button>
            <Err msg={connect.error} />
          </>
        ) : mine ? (
          <>
            <p>
              <span className="mono">{short(me)}</span> is listed as <b>{mine.name}</b>.
            </p>
            <button className="btn" disabled={sign.busy} onClick={() => sign.run("unlist")}>
              {sign.busy ? "Sign in your wallet…" : "Unlist"}
            </button>
          </>
        ) : (
          <div className="mk-row">
            <label>
              <span className="muted small">Desk name (2–24 characters)</span>
              <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Desk" />
            </label>
            <button className="btn primary" disabled={sign.busy || !name.trim()} onClick={() => sign.run("list")}>
              {sign.busy ? "Sign in your wallet…" : `List ${short(me)}`}
            </button>
          </div>
        )}
        <Err msg={sign.error} />
        {done && <p className="ok">{done}</p>}
        <p className="muted small">
          From the command line, with the same key: <span className="mono">obsyn-mcp maker list "Your desk name"</span>
        </p>
      </section>

      <h2>Listed makers</h2>
      {loadErr && <p className="err">{loadErr}</p>}
      {!makers ? (
        !loadErr && <p className="muted">Loading…</p>
      ) : makers.length === 0 ? (
        <p className="muted">No listed makers yet. The first one gets the whole desk.</p>
      ) : (
        <div className="table-wrap">
          <table className="plain mk-table">
            <thead>
              <tr>
                <th>Maker</th>
                <th>Deals accepted</th>
                <th>Settled</th>
                <th>Open</th>
                <th>Didn't settle</th>
              </tr>
            </thead>
            <tbody>
              {makers.map((m) => (
                <tr key={m.address}>
                  <td>
                    <b>{m.name}</b>{" "}
                    <a className="mono muted small" href={`${EXPLORER}/address/${m.address}`} target="_blank" rel="noreferrer">
                      {short(m.address)} ↗
                    </a>
                  </td>
                  <td className="mono">{m.stats.accepted}</td>
                  <td className="mono">
                    {m.stats.settled}
                    {m.stats.settleRate !== null && <span className="muted"> ({Math.round(m.stats.settleRate * 100)}%)</span>}
                  </td>
                  <td className="mono">{m.stats.open}</td>
                  <td className="mono">{m.stats.unsettled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        From deals where the maker's answer was accepted, each checked against the escrow on-chain. "Didn't settle" counts deals that passed their
        deadline, whichever side didn't deposit. Names are chosen by the makers themselves.
      </p>
    </div>
  );
}
