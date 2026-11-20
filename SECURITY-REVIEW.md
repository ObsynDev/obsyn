# Security audit by the Obsyn team

> Performed by the Obsyn team, the same people who wrote the code. It records what was checked, how, and what was found. An independent third-party audit is planned.

| | |
|---|---|
| Date | 17 November 2026 |
| Audited by | Obsyn team |
| Scope | `contracts/src/OtcEscrow.sol`, `contracts/src/OtcEscrowV2.sol`, `contracts/src/BuyBurnVault.sol`, plus the security-relevant parts of the backend (API, relayer) and the web client |
| Deployed code | `OtcEscrow` [`0x41c1…0865`](https://robinhoodchain.blockscout.com/address/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865), `BuyBurnVault` [`0x2afd…4221`](https://robinhoodchain.blockscout.com/address/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221) on Robinhood Chain |
| Same code? | Yes. Sourcify `exact_match` (runtime and creation bytecode) for both, and `contracts/scripts/verify-deployment.mjs` matches the live bytecode against this source |

## Summary

| Severity | Contracts | App / backend | Status |
|---|---|---|---|
| Critical | 0 | 0 | |
| High | 0 | 1 | fixed before any real deal |
| Medium | 1 | 1 | contract: accepted and disclosed · app: fixed |
| Low | 4 | 3 | mitigated, accepted or fixed (see each item) |
| Informational | 6 | | |

No issue was found that lets anyone take or freeze a user's deposit. The contracts are immutable, so contract findings can only be disclosed and mitigated around, not patched.

## How it was reviewed

1. **Manual, line by line:** both contracts in full, every external call, every state change, every revert path, and the EIP-712 signature path.
2. **Static analysis:** Slither 0.11.6, 102 detectors. Every result was checked by hand (triage below).
3. **Tests:** Foundry 1.5.1, 41 contract tests (unit, fuzz, and four replays against the live deployment on a fork). Line coverage: `OtcEscrow` 92.6%, `BuyBurnVault` 91.3%. Backend: 46 tests, including full deals on a local chain through the SDK and MCP server.
4. **Black-box runs of the real UI:** buy, sell, ghost mode, refund and cancel, clicked through the website against the **live** escrow on a fork of Robinhood Chain, with on-chain balances checked to the last unit.
5. **Deployment check:** bytecode compared with source (Sourcify exact match and our script).

## Contract findings

### M-01 · Fee vault is controlled by one key (resolved 2026-11-18)
`BuyBurnVault`'s owner and keeper were the same single wallet. Together they decide how the fees already in the vault are spent: the keeper picks `minOut` for each buy-and-burn, and the owner can change the swap route (after a public 2-day delay, `AdapterQueued`). A bad actor holding that key could buy $OBSYN at a poor price, wasting fees.
**Impact:** protocol fees only. User deposits live in the escrow, which the vault can't touch (see [SECURITY.md](SECURITY.md#is-no-admin-key-really-true-the-one-dependency)).
**Resolved:** owner and keeper moved to a 2-of-3 Safe multisig, [`0x48d8970b6498dFA99CA47F117c4d0AA5A445833E`](https://app.safe.global/home?safe=robinhood:0x48d8970b6498dFA99CA47F117c4d0AA5A445833E). Every route change, keeper change and burn now needs two of three signers, none of them the relayer's server key. Remaining: the keeper still chooses `minOut`, so a burn is only as careful as the two signers who approve it.
**Since 2026-11-20:** the vault's owner is `ObsynTimelock` (OpenZeppelin TimelockController v5.1.0, [`0x04e025ca…`](https://robinhoodchain.blockscout.com/tx/0x04e025ca8385182ba597f16106a18147bffcf0a4984ab23b042b4de72de6ee8d)). The Safe can only propose owner actions (burn route, keeper, ownership); each waits 3 days in public before anyone can execute it, and the queue is on obsyn.trade/security. Burns stay with the Safe as keeper. The signers are all team-held today.

### L-01 · Self-referral halves the protocol fee (mitigated)
The referrer is part of the deal terms, so a party can name a wallet it controls and take back half the fee (`test_selfReferral_halvesProtocolFee_only`). The seller and buyer are unaffected; the protocol's share halves.
**Mitigation:** the backend now refuses terms whose referrer is the buyer, the seller or the payout address. A second wallet can't be detected, so this is accepted.

### L-02 · Holder discount can be borrowed for one transaction (accepted)
The 0.5% discount checks balances at settlement, so a contract could flash-borrow $OBSYN. Bounded at 0.5% of that deal's fee. Inactive until $OBSYN launches.

### L-03 · A frozen token can hold one side's refund (accepted, disclosed)
If a token issuer freezes the escrow or a party (possible for regulated stock tokens), that side's transfer fails. Refunds are per side, so the other side still gets its money back, and the frozen side can retry later.

### L-04 · Deals in the same token share one balance (accepted, disclosed)
A token that later shrinks balances (negative rebase, a new transfer fee, admin seizure) could leave the escrow short for other deals in that token. Fee-on-transfer tokens are rejected at deposit; the UI lists plain ERC-20s.

### Informational
- **I-01** No ETH/USD feed was set at deploy, so ETH-paid deals always pay the top tier (2.5%). USDG deals use the size tiers.
- **I-02** The contract allows any future deadline; the desk caps it at 7 days.
- **I-03** ETH payouts get 50,000 gas. Smart-contract wallets that need more are credited in `owedEth` and claim with `withdraw()`.
- **I-04** A buyer can open a deal naming any seller without their consent. It only costs the buyer gas; they refund after the deadline.
- **I-05** `BuyBurnVault.transferOwnership` emits no event for the pending owner (only `OwnerSet` on accept), and `setKeeper` / `transferOwnership` accept the zero address. Neither can lock funds.
- **I-06** The Pons curve interface in the vault comes from Pons' docs and is not yet checked against verified on-chain source. It is unused until `setPlatformToken` is called with a curve. (Since $OBSYN graduated, the curve is closed and burns go through the v4 adapter below.)

### Slither triage

| Detector | Count | Verdict |
|---|---|---|
| `reentrancy-eth`, `reentrancy-balance`, `reentrancy-benign` | 9 | False positive. Every state-changing entry point shares one `nonReentrant` lock, and a deal is marked `Settled` before any transfer. |
| `arbitrary-send-eth` | 1 | By design. ETH only goes to addresses fixed in the deal terms. |
| `return-bomb` | 3 | Not exploitable. The callee gets 30–50k gas and can't afford a large return. Tested: `test_returnBombRecipients_cantBlockSettlement`, `test_refund_ignoresBombReferrer`. |
| `incorrect-equality` (`burned == 0`) | 1 | Intended: refuse a burn of nothing. |
| `unused-return` | 3 | Intended. The burn result is checked through the dead address's balance; the price feed fields are read selectively. |
| `missing-zero-check` | 5 | See I-05. |
| `timestamp` | 4 | Intended: deadlines and price age. |
| `low-level-calls`, `naming-convention`, `unindexed-event-address` | 13 | Style only. |

## V4BurnAdapter (added 2026-11-18)

$OBSYN graduated from its Pons curve to a Uniswap v4 pool, so the fee vault needs a new buy route. `contracts/src/V4BurnAdapter.sol` is that route, reviewed the same way:

- **What it can do:** only the vault can call `swap`. ETH fees buy $OBSYN on its v4 pool (OBSYN/ETH, the Pons hook); USDG fees go USDG → WETH on the Uniswap v3 0.01% pool from the official factory, unwrap to ETH, then the same v4 swap. Bought tokens go straight to the burn address.
- **What it can't do:** it has no owner and no settings; every address and pool is fixed at deploy. It holds nothing between calls: unused input goes back to the vault in the same transaction. The v3 callback only pays during its own swap, and only to that pool.
- **Two checks on every burn:** the adapter checks the tokens the burn address received against `minOut`, and the vault checks the same again before counting the burn.
- **Why not a v4 ETH/USDG pool:** the deepest one's hook refuses swaps from contracts like this one (tested on a fork), so the USDG leg uses v3.
- **Tests:** 9 tests, 8 of them against the live contracts on a fork: ETH → OBSYN (0.01 ETH bought ~619k OBSYN), USDG → WETH → OBSYN (20 USDG bought ~692k OBSYN), the full vault flow (queue, refused before 2 days, apply, burn ETH and USDG, nothing left in the vault or the adapter), `minOut`, only the vault, only the PoolManager and only our own v3 swap can call back, wrong inputs. `LIVE_RPC=https://robinhood-rpc.publicnode.com forge test --match-contract V4BurnAdapter -vv`
- **Slither:** `reentrancy-eth`/`reentrancy-balance` on `swap` are false positives (only the vault, which holds its own lock, can call it; `swap` also has its own lock, and the only external calls go to the fixed PoolManager, v3 pool and WETH); `incorrect-equality` (`out == 0`) and `unused-return` (`settle`, `unlock`) are intended; `missing-zero-check` was fixed (the constructor refuses zero addresses).
- **Activation:** the vault owner deploys it and calls `queueAdapter`; it can only be switched on with `applyAdapter` after the vault's public 2-day wait.

## OtcEscrowV2: pay with $OBSYN (added 2026-11-18)

`contracts/src/OtcEscrowV2.sol` is `OtcEscrow` with one addition: $OBSYN (`burnToken`, fixed at deploy) is accepted as a pay token. Deployed at [`0xa10193De64556AF16390FB6E07BBb7C2522F21C8`](https://robinhoodchain.blockscout.com/address/0xa10193De64556AF16390FB6E07BBb7C2522F21C8), Sourcify exact match, and `verify-deployment.mjs` matches it against this source.

- **The whole diff:** a `burnToken` immutable, `BURN_TOKEN_FEE_BPS = 150`, the `DEAD` address and a `FeeBurned` event. `feeBps` returns 1.5% for deals paid in `burnToken` (no size tiers, no holder discount), `_validate` accepts it as a pay token, and `_settle` sends that protocol fee to `0x…dEaD` instead of the vault. The referrer's half, the seller's proceeds, deposits, refunds and ghost-mode deposits are unchanged. Still no owner, admin, pause or upgrade.
- **Same behaviour for everything else:** all 24 `OtcEscrow` tests run unchanged against `OtcEscrowV2` (`OtcEscrowV2Parity.t.sol`).
- **Token checked first:** a live probe of $OBSYN (`ObsynTokenProbe.t.sol`) confirms a plain ERC-20: no transfer tax, no blocklist, transfers to `0x…dEaD` work, so the burn can't revert a settlement and amounts arrive exactly.
- **Tests:** 12 for the new path (fee and burn amounts, referrer split, no discount on OBSYN deals, OBSYN-for-OBSYN refused, refunds, fuzzed amounts) plus a live-fork deal paid in 1,000,000 real OBSYN (15,000 burned). Full suite 100/100. `LIVE_RPC=https://robinhood-rpc.publicnode.com forge test --match-path "test/OtcEscrowV2*" -vv`
- **Slither:** the same detector results as `OtcEscrow`, nothing new.
- **Switch-over:** the server records which escrow each deal was accepted on; deals from before the switch keep pointing to `OtcEscrow` v1 for deposits, refunds, receipts and stats. Ghost mode refuses OBSYN-paid deals (its relayer fee is set in ETH/USDG terms).

## App and backend findings (fixed)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| A-01 | High | The buyer's Deposit button never appeared on a new deal (it waited for `Open`; a fresh deal is `None`), so no deal could start from the website | Fixed; black-box flows now settle end to end |
| A-02 | Medium | Ghost mode could be chosen for tokens without EIP-2612 permits, stranding tokens in a one-time wallet with no gas | Ghost mode is disabled for such tokens, and checked again before funding |
| A-03 | Low | A pasted token address was not selected while the read was slow, so the bid was never created | Auto-select once read, Enter to pick, clear loading state |
| A-04 | Low | Rate limits keyed on a spoofable `X-Forwarded-For` entry; no request size limit | Keyed on the proxy-appended IP; 64 KB body limit |
| A-05 | Low | Missing security headers; malformed paths returned 500 | HSTS, CSP, Permissions-Policy added; 400 on malformed paths |

## What this review does not cover

- It was done by the team that wrote the code; an independent third-party audit is planned.
- No formal verification.
- Third-party code is out of scope: tokens, USDG, wallet libraries, RPC providers and hosting.
- Off-chain privacy is limited to what [SECURITY.md](SECURITY.md) describes: settlement is a public transaction.

## Reproduce

```bash
cd contracts
forge test                                   # 41 tests
forge coverage --report summary
slither . --filter-paths "lib|test|script"   # Slither 0.11.x
forge build && node scripts/verify-deployment.mjs
```

Found something we missed? Report it privately through "Report a vulnerability" on this repository's Security tab.
