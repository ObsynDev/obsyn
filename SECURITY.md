# Security notes

This is an internal review written while building the code. **It is not an audit.** Get the contracts professionally audited before they hold real funds.

## What the escrow guarantees

`OtcEscrow` has no owner, admin key, pause or upgrade. Its settings (USDG, ETH/USD feed, fee recipient) are fixed at deploy.

- Funds move in only three ways: settlement (both sides deposited before the deadline), refund (deadline passed), or `withdraw()` of ETH that couldn't be pushed.
- Only the named buyer can deposit payment. Only the named seller can deposit tokens, either directly or through a relayer holding the seller's EIP-712 `Deposit(dealId, relayer)` signature. That signature is bound to one relayer and one deal.
- The deal id is the hash of the full terms. Changing any field (price, payout, deadline…) produces a different deal, so a deposit can never be redirected to other terms.
- The fee is capped at 2.5% in code. The relayer fee must leave the seller something even at the cap.
- Each refund side is independent. A frozen token on one side can't block the other side's refund.
- If an ETH payout reverts, the amount is credited to `owedEth` instead of reverting, so a hostile recipient can't block settlement.
- A broken, stale, future-dated or absurd price feed falls back to the top fee tier and never reverts.
- Tokens that deliver less than the stated amount on deposit (fee-on-transfer) are rejected.
- Reentrancy is blocked on every state-changing entry point.

## Reviewed and not exploitable

| Scenario | Why it fails |
|---|---|
| Front-running a deposit | Deposits are tied to `msg.sender` (buyer/seller) or to a signature bound to the relayer |
| Replaying a ghost signature | Bound to dealId and relayer; a deal funds once; settled or refunded deals reject deposits |
| Front-running the permit | The permit call is wrapped in try/catch; only the allowance matters |
| Gas-starving the discount lookup to change the fee | A starved fixed-gas staticcall leaves under 1/64 of the gas, so the rest of settlement runs out and the whole tx reverts |
| Depositing after the deadline | Every deposit checks `block.timestamp < deadline` |
| Seller accepting terms other than their offer | The deal id commits to the terms; the web app and SDK compare accepted terms to the seller's own offer and refuse to deposit on mismatch |

## Known risks (accepted or for the operator to manage)

1. **Rebasing or upgradeable tokens.** All deals in the same token share one balance. A token that later shrinks balances (negative rebase, fee added on transfer-out, admin seizure) could leave the escrow short for other deals in that token. Mitigation: only list plain ERC-20s in the UI. Check how Robinhood stock tokens handle splits and corporate actions before listing them.
2. **Holder discount can be borrowed.** The discount checks balances at settlement, so a contract buyer could flash-borrow the platform token for one transaction to save 0.5%. The loss is bounded at 0.5% of that deal's fee.
3. **Fee recipient trust.** The escrow reads the discount token from the fee recipient (the vault). The vault owner sets it once and can't change it. It can't affect deposits, only whether the 0.5% discount applies.
4. **Funds sitting in the escrow are public.** Anyone can see what is deposited and when; "ghost mode" only hides the seller's main wallet from the counterparty. The transfer into the one-time wallet is on-chain.

## BuyBurnVault

- No function sends ETH or USDG anywhere except a buy that must deliver at least `minOut` platform tokens to the dead address.
- The owner (use a multisig) can rotate the keeper, set the platform token once, and change the swap adapter behind a 2-day timelock. Ownership transfer is two-step.
- **Trust:** a colluding owner and keeper could swap fees at a bad price (low `minOut`, or a malicious adapter after the timelock). Fee funds are at risk from them; user deposits are not. Watch `AdapterQueued` events.
- **The Pons curve interface** (`buy`, `pairToken`, `isNativeQuote`, `graduated`, `readyToGraduate`, `currentSnipeTaxBps`) came from docs.ponsfamily.com/v2. The explorers refused automated reads, so it is **not verified on-chain**. Check it against the verified source before calling `setPlatformToken` with a curve.

## Backend and relayer

- No accounts. Bids and offers are controlled by random 256-bit capability tokens; only their SHA-256 hashes are stored, and checks are constant-time.
- Sealed offers are encrypted client-side (NaCl box with a one-off key per offer). The server stores ciphertext and can't read prices.
- The relayer only submits when the buyer has already funded, so the relayed deposit settles and pays the relayer at once. It simulates before sending. A race (e.g. the one-time wallet moving its tokens between simulation and inclusion) can still cost the relayer gas; the minimum relayer fee covers that. Keep the relayer key's ETH balance small.
- Rate limiting is per IP from `x-forwarded-for`. That header is only trustworthy behind a proxy that overwrites it; set one up in production.
- CORS is open (`*`). That's safe because no request relies on cookies or ambient credentials.

## Client side

- Private links put secrets in the URL `#fragment`, which browsers never send to servers. They **do** end up in browser history, and possibly in history sync. Treat a private link like a password.
- A ghost-mode link also contains the one-time wallet key. Anyone with the link controls that wallet until the deal settles.
- The SDK and MCP server keep bid and offer secrets in `~/.blockotc/state.json` (mode 600) or in memory. The agent's wallet key stays in its own process.

## Before mainnet

- [ ] Professional audit of `OtcEscrow` and `BuyBurnVault`
- [ ] Verify the Pons V2 curve interface on-chain
- [ ] Official addresses for USDG and an ETH/USD feed on Robinhood Chain
- [ ] Vault owner = multisig
- [ ] Token allowlist in the UI (plain ERC-20s only)
- [ ] Reverse proxy that sets `x-forwarded-for`; backups of the SQLite file
- [ ] Monitoring on the relayer's ETH balance and on vault `AdapterQueued` events
