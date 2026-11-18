# Deployments

Everything Obsyn runs on-chain, with the transaction that created it. Machine-readable copy: [`deployments/robinhood-4663.json`](deployments/robinhood-4663.json).

## Robinhood Chain (chain id 4663)

| Contract | Address | Deployed | Deploy tx |
|---|---|---|---|
| `OtcEscrowV2` (settlement since 2026-11-18) | [`0xa10193De64556AF16390FB6E07BBb7C2522F21C8`](https://robinhoodchain.blockscout.com/address/0xa10193De64556AF16390FB6E07BBb7C2522F21C8) | 2026-11-18 05:45:06 UTC, block 117174692 | [`0x494fac4a…`](https://robinhoodchain.blockscout.com/tx/0x494fac4a564e54f7d676352a310c32bae4704d5e4fa2c71994e7a1cae374a573) |
| `OtcEscrow` (v1; deals accepted before 2026-11-18) | [`0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865`](https://robinhoodchain.blockscout.com/address/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865) | 2026-11-16 08:52:58 UTC, block 115638560 | [`0x918f40b7…`](https://robinhoodchain.blockscout.com/tx/0x918f40b78804c90534b8081f000727ee1fcb00a36151f8f42183674dae72ca6c) |
| `BuyBurnVault` | [`0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221`](https://robinhoodchain.blockscout.com/address/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221) | 2026-11-16 08:52:30 UTC, block 115638297 | [`0x96e61067…`](https://robinhoodchain.blockscout.com/tx/0x96e61067b39a05b18e6e0c6542ecc69174e256e3e6355049e11235fd5cab5133) |
| `V4BurnAdapter` (the vault's buy route since $OBSYN graduated) | [`0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67`](https://robinhoodchain.blockscout.com/address/0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67) | 2026-11-17 20:18:14 UTC, block 116852320 | [`0x257f50cd…`](https://robinhoodchain.blockscout.com/tx/0x257f50cd59b664902016f360630649e13bf1d49b9f7053421dd3edaf7c95050c) |

Compiler: solc 0.8.24, optimizer on (10,000 runs), EVM `cancun`. Built from `contracts/src` in this repository.

### Constructor settings (fixed forever)

**OtcEscrowV2** (the same as `OtcEscrow`, plus `burnToken`)
- `usdg`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- `ethUsdFeed`: none (`0x0`), as in v1
- `feeRecipient`: the `BuyBurnVault` below
- `burnToken`: $OBSYN `0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351`. Deals may be paid in it; their fee is a flat 1.5% (`BURN_TOKEN_FEE_BPS`), sent to `0x…dEaD` in the settlement transaction (`FeeBurned` event). A referrer still gets half.

The site switched to it on 2026-11-18. Deals accepted before that are recorded against `OtcEscrow` v1, and their pages, receipts and refunds keep using it. v1 has no owner either, so nothing about it changes.

**OtcEscrow** (v1)
- `usdg`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (Global Dollar on Robinhood Chain)
- `ethUsdFeed`: none (`0x0`). Without a price feed, deals paid in ETH always pay the top fee tier (2.5%). USDG deals use the size tiers.
- `feeRecipient`: the `BuyBurnVault` above

**BuyBurnVault**
- `usdg`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- `owner` and `keeper` at deploy: `0x533452c0e3C3455D33d551964F14D352597b21e1` (a single wallet).
- **Since 2026-11-18, both are a 2-of-3 Safe multisig:** [`0x48d8970b6498dFA99CA47F117c4d0AA5A445833E`](https://app.safe.global/home?safe=robinhood:0x48d8970b6498dFA99CA47F117c4d0AA5A445833E) ([explorer](https://robinhoodchain.blockscout.com/address/0x48d8970b6498dFA99CA47F117c4d0AA5A445833E)). Signers: `0x533452c0e3C3455D33d551964F14D352597b21e1`, `0xD3b32872b311c29A0DBBbbbc76fE5871Cb0b994A`, `0x9743307CebE092eea55756A2526EeB24Ddd4bA86`; any action needs two of them. The keeper moved with `setKeeper`, ownership with the two-step `transferOwnership` / `acceptOwnership`. The old wallet can no longer change anything in the vault. What the owner can and can't do is listed in [SECURITY.md](SECURITY.md#who-can-do-what).

### $OBSYN plugged into the fee vault

`BuyBurnVault.setPlatformToken` was called once (it can never be called again) on 2026-11-17 in [`0xa28306d9…`](https://robinhoodchain.blockscout.com/tx/0xa28306d997d26c80770840e92367100425a981b9c38d04cd82bc0487284173d5):

| Setting | Value |
|---|---|
| Platform token ($OBSYN) | [`0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351`](https://robinhoodchain.blockscout.com/token/0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351) |
| Pons bonding curve (pair: ETH; graduated, now trades on Uniswap v4) | [`0x1D6A7a3fAB6592cb5E6AA5873B915Bc6f93B0499`](https://robinhoodchain.blockscout.com/address/0x1D6A7a3fAB6592cb5E6AA5873B915Bc6f93B0499) |
| Holder discount threshold | 1,000,000 OBSYN (0.1% of supply) |

From now on a buyer or seller holding at least 1,000,000 OBSYN pays 0.5% less fee, and fees in the vault can only be spent buying $OBSYN and sending it to `0x…dEaD`.

### Burn route after graduation (V4BurnAdapter)

$OBSYN graduated from its Pons curve to Uniswap v4, so the vault buys through `V4BurnAdapter`. It has no owner and no settings; everything below is fixed at deploy:

| Setting | Value |
|---|---|
| `poolManager` | Uniswap v4 PoolManager [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://robinhoodchain.blockscout.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |
| `vault` (the only caller) | `BuyBurnVault` above |
| OBSYN pool (v4) | ETH / OBSYN, fee 0, tick spacing 200, hook [`0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`](https://robinhoodchain.blockscout.com/address/0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044) (Pons) |
| USDG leg (v3) | WETH / USDG 0.01% [`0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`](https://robinhoodchain.blockscout.com/address/0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca), official Uniswap v3 factory |
| `weth` | [`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`](https://robinhoodchain.blockscout.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) |

Queued in the vault on 2026-11-17 20:18:24 UTC in [`0xd8a83043…`](https://robinhoodchain.blockscout.com/tx/0xd8a83043d507ea7441d62d1169ab7933985303ab53269d4c49e114804e19a397). The vault's public 2-day wait ends **2026-11-19 20:18:24 UTC**; only then can the owner switch it on with `applyAdapter`. Verified on Sourcify (exact match): [V4BurnAdapter](https://repo.sourcify.dev/4663/0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67).

### Off-chain addresses

| Role | Address | Can do |
|---|---|---|
| Relayer (pays gas for ghost-mode deposits) | [`0x81D583e77A74571a6fD7b6EE16ECeba9CfE3a2DD`](https://robinhoodchain.blockscout.com/address/0x81D583e77A74571a6fD7b6EE16ECeba9CfE3a2DD) | Submit a seller's deposit only with that seller's signature for that exact deal and relayer. It can't change terms or move funds anywhere else. |

## Check it yourself

You don't have to trust this page. From a clone of this repository:

```bash
cd contracts
forge build
node scripts/verify-deployment.mjs
# RPC blocked where you are? RPC_URL=https://4663.rpc.thirdweb.com node scripts/verify-deployment.mjs
```

The script downloads the bytecode at each address, blanks out the values fixed at deploy time (immutables), compares the rest byte for byte with what `forge build` produced, and prints every setting it reads from the contracts. Expected output ends with `All deployed contracts match the source in this repository.`

You can also replay real deals against the live contracts on a local fork (no real funds move):

```bash
cd contracts
LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract LiveFork -vv
```

Every contract is verified on Sourcify with an **exact match** (runtime and creation bytecode, including metadata), so explorers that read Sourcify show the source:

- [OtcEscrowV2 on Sourcify](https://repo.sourcify.dev/4663/0xa10193De64556AF16390FB6E07BBb7C2522F21C8)
- [OtcEscrow v1 on Sourcify](https://repo.sourcify.dev/4663/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865)
- [BuyBurnVault on Sourcify](https://repo.sourcify.dev/4663/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221)
- [V4BurnAdapter on Sourcify](https://repo.sourcify.dev/4663/0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67)

The Robinhood Chain explorer (Blockscout) shows them as verified, with the source under the Contract tab: [OtcEscrowV2](https://robinhoodchain.blockscout.com/address/0xa10193De64556AF16390FB6E07BBb7C2522F21C8?tab=contract) · [OtcEscrow v1](https://robinhoodchain.blockscout.com/address/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865?tab=contract) · [BuyBurnVault](https://robinhoodchain.blockscout.com/address/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221?tab=contract).
