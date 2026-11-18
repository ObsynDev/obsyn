# Security notes

Security notes kept while building the code. The full **security audit by the Obsyn team** is in [SECURITY-REVIEW.md](SECURITY-REVIEW.md) (no critical or high issues). An independent third-party audit is planned.

Deployed addresses and how to check them against this source: [DEPLOYMENTS.md](DEPLOYMENTS.md).

## Reporting a vulnerability

Please report privately, not in a public issue: use **"Report a vulnerability"** under this repository's Security tab (GitHub private vulnerability reporting), or DM [@Obsyntrade](https://x.com/Obsyntrade) on X. Include the steps to reproduce. We'll confirm receipt and keep you updated until it's fixed.

## Who can do what

Enforced by the contracts unless marked *(app)*. "Anyone" means any address, including us.

| Action | Buyer | Seller | Relayer | Vault owner | Anyone else |
|---|---|---|---|---|---|
| Post a bid or listing, send a sealed answer | yes | yes | — | — | yes *(app)* |
| Read the prices in sealed answers | the poster only *(app, encrypted)* | the poster only | no | no | no |
| Accept an answer | whoever holds the private link *(app)* | same | no | no | no |
| Deposit the payment | **only the buyer named in the deal** | no | no | no | no |
| Deposit the tokens | no | **only the seller named in the deal** | only with the seller's signature for that deal and that relayer | no | no |
| Change price, amount, payout or deadline of a deal | no: any change is a different deal id | no | no | no | no |
| Refund after the deadline | yes | yes | yes | yes | **yes**: anyone can trigger it; funds only go back to the side that paid them |
| Pause, upgrade or change the escrow | nobody: no owner, no admin key | | | | |
| Raise the fee above 2.5% | nobody: capped in code | | | | |
| Take fees out of the vault | nobody can withdraw them; the keeper can only spend them on a buy that burns $OBSYN | | | | |
| Set the $OBSYN token in the vault | — | — | — | **once, then never again** | no |
| Change the swap route (adapter) used for buy-and-burn | — | — | — | yes, **after a public 2-day delay** | no |
| Change the keeper / hand over ownership | — | — | — | yes (ownership in two steps) | no |

The vault owner and keeper are a **2-of-3 Safe multisig**, [`0x48d8970b6498dFA99CA47F117c4d0AA5A445833E`](https://app.safe.global/home?safe=robinhood:0x48d8970b6498dFA99CA47F117c4d0AA5A445833E): every action above needs two of three signers (see [DEPLOYMENTS.md](DEPLOYMENTS.md)). Its powers only touch fees that are already in the vault, never user deposits in the escrow.

## Is "no admin key" really true? The one dependency

`OtcEscrow` itself has no owner, no admin function, no pause and no upgrade path. It has exactly one outside dependency, fixed at deploy: its fee recipient, the `BuyBurnVault`, whose owner is currently the deployer wallet. Here is everything that dependency can do to the escrow:

1. **Fee discount lookup.** At settlement the escrow asks the vault `discountConfig()` through a `staticcall` capped at 30,000 gas (`OtcEscrow.discountConfig`). The answer only decides whether the 0.5% holder discount applies. If the call fails or misbehaves, the deal settles at the normal fee. It cannot block or redirect anything.
2. **Receiving the fee.** The protocol fee is sent to the vault (`_pay`). If an ETH transfer to it ever failed, the amount is credited to `owedEth` and settlement continues. ERC-20 transfers don't call the recipient at all.

The vault's code can't be changed. Its owner can set the $OBSYN token once, change the keeper, and change the buy-and-burn swap route after a public 2-day delay: all of that only touches fees already sitting in the vault. **Nothing the vault or its owner does can block a deposit, a settlement or a refund, or move a user's funds.** You can confirm this by reading `OtcEscrow.sol` (search for `feeRecipient`) and by running `contracts/scripts/verify-deployment.mjs` to check the live bytecode is this code.

## Worst cases, stated plainly

- **A bug in the escrow** (the Obsyn team's audit found no critical or high issues, but no audit rules out every bug) could put funds that are deposited in open deals at risk. Deals settle in one transaction, so funds sit in the contract only between the two deposits.
- **Our server goes down:** you can't post or read answers, but deposits are never stuck. After the deadline, anyone can call `refund(terms)` on the escrow directly from the explorer (Write contract). The deal panel has a "Copy for a manual refund" button with the terms in the exact format the explorer expects, and the SDK/MCP `refund` does it for you.
- **Our server or website is compromised:** it could show a wrong page or wrong terms. It still can't read sealed prices (they're encrypted to keys in your browser), and it can't move funds. Before depositing, the offer page checks the final terms against the answer saved in your own browser, and refuses on any mismatch. You can also run the app from this source.
- **The relayer key leaks:** it can only submit deposits that sellers have already signed for that relayer. Its ETH balance is kept small.
- **The vault owner and keeper act badly:** they could buy $OBSYN at a poor price with the fees in the vault (low `minOut`, or a bad adapter after the 2-day delay, which is public as an `AdapterQueued` event). User deposits are not affected.
- **You lose your private link:** nobody can recover it. Deposits are still safe: they refund after the deadline.

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
- Rate limiting is per client IP, taken from the address our proxy appends (`x-real-ip`, or the last `x-forwarded-for` entry), so a client can't spoof it. Request bodies are capped at 64 KB.
- CORS is open (`*`). That's safe because no request relies on cookies or ambient credentials.

## Answers are hostile input

Anyone can post an answer to a bid or listing, so the poster treats every decrypted answer as untrusted:

- Malformed answers (bad numbers, bad addresses, wrong shape) are dropped one by one; they can't break reading the rest.
- Every answer is signed (EIP-191) by the wallet it names, over the posting id, role, address, amount and price. Unsigned or mis-signed answers show as **unverified**, rank below verified ones, and need an explicit override to accept (`allowUnverified` in the SDK/MCP, a confirm dialog in the web app). This stops fake answers "from" someone else's wallet that would tie up the poster's deposit until the deadline.
- The poster also sees whether the named wallet currently holds enough to pay or deliver. Payment locks first: the web app and the SDK/MCP only let the seller deposit after the buyer has paid in, so a buyer who never pays can't tie up the seller's tokens. (The contract itself accepts either order; this rule is enforced in the clients.)

## Client side

- Private links put secrets in the URL `#fragment`, which browsers never send to servers. They **do** end up in browser history, and possibly in history sync. Treat a private link like a password.
- A ghost-mode link also contains the one-time wallet key. Anyone with the link controls that wallet until the deal settles.
- The SDK and MCP server keep bid and offer secrets in `~/.blockotc/state.json` (mode 600) or in memory. The agent's wallet key stays in its own process.

## Before mainnet

- [x] Security audit by the Obsyn team ([SECURITY-REVIEW.md](SECURITY-REVIEW.md))
- [ ] Independent third-party audit of `OtcEscrow` and `BuyBurnVault`
- [ ] Verify the Pons V2 curve interface on-chain
- [ ] Official addresses for USDG and an ETH/USD feed on Robinhood Chain
- [x] Vault owner = multisig (2-of-3 Safe, keeper too)
- [ ] Token allowlist in the UI (plain ERC-20s only)
- [ ] Reverse proxy that sets `x-forwarded-for`; backups of the SQLite file
- [ ] Monitoring on the relayer's ETH balance and on vault `AdapterQueued` events
