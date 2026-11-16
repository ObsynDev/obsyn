import { KeyButton, SlotButton } from "../lib/buttons.tsx";
import { Reveal } from "../lib/motion.tsx";
import { market } from "../lib/tokens.ts";
import { Link } from "../lib/ui.tsx";
import { TokenAvatar } from "./Terminal.tsx";

/** A visual walkthrough: four steps, each with a small, honest mock of the screen it happens on. */

const TSLA = market("TSLA");

function MockPost() {
  return (
    <div className="hw-mock">
      <div className="hw-row head">
        <TokenAvatar address={TSLA.address} symbol="TSLA" size={28} />
        <b>Bid for TSLA</b>
        <span className="hw-chip mono">BUY</span>
      </div>
      <div className="hw-kv">
        <span>Size</span>
        <b className="mono">$250,000</b>
      </div>
      <div className="hw-kv">
        <span>Pay in</span>
        <b className="mono">USDG</b>
      </div>
      <div className="hw-kv">
        <span>Replies open for</span>
        <b className="mono">1 hour</b>
      </div>
      <div className="hw-link mono">
        <i aria-hidden="true">KEY</i> /bid/3f9c…#k=•••••• <span>private link</span>
      </div>
    </div>
  );
}

function MockSeal() {
  return (
    <div className="hw-mock">
      <div className="hw-row head">
        <b>Answers to your bid</b>
        <span className="hw-chip mono ice">ONLY YOU CAN READ</span>
      </div>
      {[
        ["signed", "has funds"],
        ["signed", "has funds"],
        ["unverified", "no funds"],
      ].map(([sig, funds], i) => (
        <div key={i} className={`hw-ans ${sig === "unverified" ? "bad" : ""}`} style={{ animationDelay: `${i * 0.25}s` }}>
          <span className="hw-redact" />
          <span className="mono">{sig}</span>
          <span className="mono">{funds}</span>
        </div>
      ))}
      <div className="hw-server mono">
        <span>our server sees</span> 9f2c41e0b7…aa13e1 <span>(ciphertext)</span>
      </div>
    </div>
  );
}

function MockAccept() {
  return (
    <div className="hw-mock">
      <div className="hw-row head">
        <b>Deal terms</b>
        <span className="hw-chip mono">FIXED</span>
      </div>
      {[
        ["Buyer", "0x7a3c…c01d"],
        ["Seller", "one-time 0x9b1e…07fa"],
        ["Gets", "641.7 TSLA"],
        ["Pays", "$250,000 USDG"],
        ["Deadline", "in 2 days"],
      ].map(([k, v]) => (
        <div key={k} className="hw-kv">
          <span>{k}</span>
          <b className="mono">{v}</b>
        </div>
      ))}
      <div className="hw-hash mono">deal id = keccak256(terms) → 0x5a0e…c9d2</div>
    </div>
  );
}

function MockSettle() {
  return (
    <div className="hw-mock hw-settle">
      <div className="hw-side">
        <span className="mono">BUYER</span>
        <b className="mono">$250,000</b>
        <i className="mono">USDG</i>
      </div>
      <div className="hw-escrow">
        <span className="hw-flow a" aria-hidden="true" />
        <span className="hw-flow b" aria-hidden="true" />
        <div className="hw-box">
          <b>Contract</b>
          <span className="mono">no admin key</span>
        </div>
        <span className="hw-pulse mono">1 transaction</span>
      </div>
      <div className="hw-side">
        <span className="mono">SELLER</span>
        <b className="mono">641.7</b>
        <i className="mono">TSLA</i>
      </div>
    </div>
  );
}

const STEPS = [
  {
    k: "01 · POST",
    t: "Bid or list a block.",
    d: "Name the token, the size and ETH or USDG, and how long the other side can reply: 15 minutes to 24 hours. No account. You get a private link, and the block shows up in the terminal so the other side can find it. Other traders see the token and the size, nothing else.",
    m: <MockPost />,
  },
  {
    k: "02 · SEAL",
    t: "Get sealed answers.",
    d: "Sellers answer a bid, buyers answer a listing. Each price is encrypted in their browser to a key only your link holds, and signed by the wallet it names, so nobody can fake an answer in someone else's name. Our server stores ciphertext it can't read, and other answerers can't see it, so there's nothing to front-run.",
    m: <MockSeal />,
  },
  {
    k: "03 · ACCEPT",
    t: "Pick one. The terms lock.",
    d: "Accepting an answer fixes the deal: both wallets, the token, the amount, the price and a deadline. The deal id is the hash of those terms, so a deposit can never be redirected to different ones.",
    m: <MockAccept />,
  },
  {
    k: "04 · SETTLE",
    t: "Swap in one transaction.",
    d: "The payment locks into the contract first, then the tokens. Whichever deposit lands second swaps both sides in that same transaction. If the deadline passes first, each side gets back exactly what it put in. The contract has no owner, no admin key, no pause and no upgrade.",
    m: <MockSettle />,
  },
];

export function How() {
  return (
    <div className="hw">
      <header className="hw-head">
        <span className="eyebrow mono">HOW IT WORKS</span>
        <h1>
          Size moves. <span className="tone">The chart doesn't.</span>
        </h1>
        <p className="dx-lede">Four steps from a private post to a settlement on Robinhood Chain. Every step is a public transaction you can check, except the prices: those stay sealed until a deposit.</p>
      </header>

      <div className="hw-steps">
        {STEPS.map((s, i) => (
          <Reveal key={s.k} className={`hw-step ${i % 2 ? "flip" : ""}`}>
            <div className="hw-copy">
              <span className="hw-k mono">{s.k}</span>
              <h2>{s.t}</h2>
              <p>{s.d}</p>
            </div>
            <div data-spot className="hw-visual">
              {s.m}
            </div>
          </Reveal>
        ))}
      </div>

      <section className="hw-extra">
        <div className="dx-sect">
          <span className="dx-n mono">GHOST MODE · SELLERS</span>
          <h2>Deliver from a one-time wallet.</h2>
          <p className="dx-p">
            Your offer can name a one-time wallet made in your browser. After acceptance you move the tokens into it, and the relayer
            deposits them with a signed permit, paying the gas. Proceeds go to whatever address you choose, ideally a fresh one. The
            relayer takes a small fee from the proceeds.
          </p>
          <div className="dx-two">
            <div>
              <b>What it hides</b>
              <p>The buyer, and anyone watching the contract, only ever see the one-time wallet.</p>
            </div>
            <div>
              <b>What it doesn't</b>
              <p>The transfer into the one-time wallet is public, so on-chain analysis can still connect them. It isn't a mixer.</p>
            </div>
          </div>
        </div>

        <div className="dx-sect">
          <span className="dx-n mono">FEES</span>
          <h2>Free to post. Paid only when it settles.</h2>
          <table className="dx-table mono">
            <thead>
              <tr>
                <th>Deal size</th>
                <th>Fee</th>
                <th>Holding the token</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Under $10k</td>
                <td>2.5%</td>
                <td>2.0%</td>
              </tr>
              <tr>
                <td>From $10k</td>
                <td>2.0%</td>
                <td>1.5%</td>
              </tr>
              <tr>
                <td>From $100k</td>
                <td>1.5%</td>
                <td>1.0%</td>
              </tr>
            </tbody>
          </table>
          <ul className="dx-list">
            <li>The contract caps the fee at 2.5%.</li>
            <li>
              Partners earn half the fee: share any page with <span className="mono">?ref=0xYourWallet</span>.
            </li>
            <li>Fees buy the platform token and send it to the burn address.</li>
          </ul>
        </div>

        <div className="dx-sect">
          <span className="dx-n mono">LIMITS</span>
          <h2>Good to know.</h2>
          <div className="dx-cards">
            {[
              ["Robinhood Chain only", "Every block, deposit and settlement happens there."],
              ["Plain tokens only", "Tokens that take a fee on transfer are rejected by the contract."],
              ["Final once settled", "There's no undo after the swap. Check the terms before you deposit."],
              ["Not a regulated venue", "It's a sealed-bid OTC market. Check the rules where you live."],
            ].map(([t, d]) => (
              <div key={t} className="dx-card plain">
                <b>{t}</b>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="dx-end">
        <h2>Ready when you are.</h2>
        <p className="dx-lede">
          The full details, including the privacy model and the API, are in the <Link to="/docs">docs</Link>.
        </p>
        <div className="btn-group">
          <SlotButton to="/docs">READ THE DOCS</SlotButton>
          <KeyButton to="/otc">OPEN THE DESK</KeyButton>
        </div>
      </section>
    </div>
  );
}
