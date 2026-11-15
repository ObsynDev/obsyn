export function How() {
  return (
    <div className="narrow prose">
      <h1>How it works</h1>

      <h2>1. Bid</h2>
      <p>
        A buyer names a token, a size, and whether they pay in ETH or USDG, then picks how long sellers can reply (15 minutes to
        24 hours). There's no account: you get a private link. The bid shows up in the open-bids list so holders can find it.
      </p>

      <h2>2. Sealed offers</h2>
      <p>
        Sellers answer with a price. The offer is encrypted in the seller's browser to a key only the buyer's link holds. Our
        server stores ciphertext and can't read it. Other sellers can't see it, so there's nothing to front-run.
      </p>

      <h2>3. Escrow swap</h2>
      <p>
        The buyer accepts one offer, which fixes the deal terms. Both sides deposit into the escrow contract. Whichever deposit
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
