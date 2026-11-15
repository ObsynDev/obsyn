export function How() {
  return (
    <div className="narrow prose">
      <span className="label">How it works</span>
      <h1>
        Size moves. <span className="serif">The chart doesn't.</span>
      </h1>

      <div className="steps-grid">
        <div className="step-card">
          <span className="num">01 · POST</span>
          <h3>Bid or list a block</h3>
          <p>Name the token, the size and ETH or USDG. No account: you get a private link.</p>
        </div>
        <div className="step-card">
          <span className="num">02 · SEAL</span>
          <h3>Get sealed answers</h3>
          <p>The other side answers with a price encrypted to you and signed by their wallet.</p>
        </div>
        <div className="step-card">
          <span className="num">03 · SETTLE</span>
          <h3>Swap in one transaction</h3>
          <p>Both sides deposit into the escrow. The second deposit swaps both, or everyone is refunded.</p>
        </div>
      </div>

      <h2>1. Post a bid or a listing</h2>
      <p>
        A buyer posts a bid, or a seller lists a block ("sell privately"): token, size, ETH or USDG, and how long the other side can
        reply (15 minutes to 24 hours). There's no account: you get a private link. Open postings show up in the terminal so the
        other side can find them.
      </p>

      <h2>2. Sealed answers</h2>
      <p>
        The other side answers with a price: sellers send offers on a bid, buyers send bids on a listing. The answer is encrypted
        in their browser to a key only the poster's link holds, and signed by the wallet it names, so nobody can fake an answer
        in someone else's name. Our server stores ciphertext and can't read it. Other answerers can't see it, so there's nothing
        to front-run.
      </p>

      <h2>3. Escrow swap</h2>
      <p>
        The poster accepts one answer, which fixes the deal terms. Both sides deposit into the escrow contract. Whichever deposit
        lands second swaps both sides in that same transaction. If the funding deadline passes first, anyone can trigger
        refunds and each side gets back exactly what it put in.
      </p>
      <p>
        The escrow has no owner, no admin key, no pause and no upgrade. Its settings are fixed at deploy. Every step is a public
        transaction you can check.
      </p>

      <h2>Ghost mode (sellers)</h2>
      <p>
        The seller's offer can name a one-time wallet made in their browser. After acceptance, the seller moves the tokens into
        it, and our relayer deposits them with a signed permit, paying the gas. The proceeds go to whatever address the seller
        chose, ideally a fresh one. The relayer takes a small fee from the proceeds.
      </p>
      <p>
        What this hides: the buyer and anyone watching the escrow see only the one-time wallet. What it doesn't: the transfer
        into the one-time wallet is public, so on-chain analysis can still connect them. It isn't a mixer.
      </p>

      <h2>Fees</h2>
      <ul>
        <li>Bids and offers are free.</li>
        <li>At settlement: 2.5% under $10k, 2% from $10k, 1.5% from $100k. The contract caps it at 2.5%.</li>
        <li>0.5% lower when the buyer or seller holds the platform token.</li>
        <li>Partners earn half the fee: share any page with <span className="mono">?ref=0xYourWallet</span>.</li>
        <li>Fees buy the platform token and send it to the burn address.</li>
      </ul>

      <h2>Limits</h2>
      <ul>
        <li>Robinhood Chain only.</li>
        <li>Tokens that take a fee on transfer are rejected by the escrow.</li>
        <li>Trades are final once settled.</li>
        <li>This is a sealed-bid OTC market, not a regulated trading venue. Check the rules where you live.</li>
      </ul>
    </div>
  );
}
