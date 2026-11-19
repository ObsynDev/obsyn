# Incident reports

What went wrong on Obsyn, what it affected, and what we changed. Newest first. Dates are UTC.

## 2026-11-19 · Deal page showed "Can't read the contract" when the wallet was on another network

**Status:** fixed and live the same day. **Funds at risk:** none. **Deals lost:** none.

### What happened

Our first user listed 20,000 $OBSYN for ETH and accepted a buyer's sealed bid. The deal panel then showed:

> Can't read the contract: The contract function "deals" returned no data ("0x")

They reported it to us straight away.

### Why

1. **The deal page read the escrow through the visitor's wallet.** Their wallet was connected to a different network, so the page asked that network for the deal. The escrow doesn't exist there, so the read came back empty. Robinhood Chain and the escrow were fine the whole time; the deal was safe on-chain.
2. **Accept didn't say which wallet it would use.** If a wallet had been connected to the site before, Accept used it silently. The seller couldn't see which address would be asked to deliver the tokens.

No money moved in a wrong way: a deposit always goes through the wallet's own confirmation and network switch, and the escrow only settles when both sides have deposited the exact agreed amounts. The bug stopped the page from showing the deal; it couldn't send funds anywhere.

### What we changed

- **The server reads the deal for you.** New endpoint `GET /api/deals/{dealId}/state` reads the deal's status and deposits on Robinhood Chain. It answers only for Obsyn's own escrow contracts and caches for 4 seconds.
- **The browser never reads through the wallet again.** If our server can't be reached, the page reads Robinhood Chain directly over several public RPCs in turn (the configured one, then publicnode, then thirdweb). The wallet's network no longer matters for reading. Deposits still ask the wallet to switch to Robinhood Chain.
- **Backup RPCs on the server too**, so one provider's outage doesn't stop the desk.
- **Accept names the wallet.** The accept section now reads "Accepting as 0x…", and if no wallet is connected it shows "Connect wallet" and keeps Accept disabled until one is.
- **Every deposit is reported for verification.** The server checks on-chain whether the transaction settled the deal, so both sides always get the receipt link.

### How we tested it

On a fork of Robinhood Chain mainnet, through the real site in a browser, with a test wallet deliberately sitting on the wrong network:

- **The reported case** (list 20,000 OBSYN for ETH, buyer bids, seller accepts from their own wallet to a fresh payout address, both deposits, settlement, receipt): every step passed.
- Deals paid in USDG and in $OBSYN (fee burned), partial fills, referrals and ghost mode: all settled.
- Backend test suite: 87 of 87 pass, including new tests for the endpoint (it reads the current and the legacy escrow, and refuses any other contract or a malformed deal id).

### Code

[`web/src/lib/chain.ts`](web/src/lib/chain.ts), [`web/src/pages/DealPanel.tsx`](web/src/pages/DealPanel.tsx), [`web/src/pages/BuyerBid.tsx`](web/src/pages/BuyerBid.tsx), [`backend/src/app.ts`](backend/src/app.ts), [`backend/src/chain.ts`](backend/src/chain.ts), tests in [`backend/test/control.test.ts`](backend/test/control.test.ts).

Found a problem? Tell us on X [@Obsyntrade](https://x.com/Obsyntrade) or open an issue. See [SECURITY.md](SECURITY.md) for anything security-related.
