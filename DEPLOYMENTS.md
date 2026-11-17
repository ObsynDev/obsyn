# Deployments

Everything Obsyn runs on-chain, with the transaction that created it. Machine-readable copy: [`deployments/robinhood-4663.json`](deployments/robinhood-4663.json).

## Robinhood Chain (chain id 4663)

| Contract | Address | Deployed | Deploy tx |
|---|---|---|---|
| `OtcEscrow` | [`0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865`](https://robin.etherscan.io/address/0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865) | 2026-11-16 08:52:58 UTC, block 115638560 | [`0x918f40b7…`](https://robin.etherscan.io/tx/0x918f40b78804c90534b8081f000727ee1fcb00a36151f8f42183674dae72ca6c) |
| `BuyBurnVault` | [`0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221`](https://robin.etherscan.io/address/0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221) | 2026-11-16 08:52:30 UTC, block 115638297 | [`0x96e61067…`](https://robin.etherscan.io/tx/0x96e61067b39a05b18e6e0c6542ecc69174e256e3e6355049e11235fd5cab5133) |

Compiler: solc 0.8.24, optimizer on (10,000 runs), EVM `cancun`. Built from `contracts/src` in this repository.

### Constructor settings (fixed forever)

**OtcEscrow**
- `usdg`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (Global Dollar on Robinhood Chain)
- `ethUsdFeed`: none (`0x0`). Without a price feed, deals paid in ETH always pay the top fee tier (2.5%). USDG deals use the size tiers.
- `feeRecipient`: the `BuyBurnVault` above

**BuyBurnVault**
- `usdg`: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- `owner` and `keeper`: `0x533452c0e3C3455D33d551964F14D352597b21e1`. This is currently a single wallet (an EOA), not a multisig. What the owner can and can't do is listed in [SECURITY.md](SECURITY.md#who-can-do-what). Ownership can move to a multisig later with the two-step `transferOwnership`, which is public on-chain.

### Off-chain addresses

| Role | Address | Can do |
|---|---|---|
| Relayer (pays gas for ghost-mode deposits) | [`0x81D583e77A74571a6fD7b6EE16ECeba9CfE3a2DD`](https://robin.etherscan.io/address/0x81D583e77A74571a6fD7b6EE16ECeba9CfE3a2DD) | Submit a seller's deposit only with that seller's signature for that exact deal and relayer. It can't change terms or move funds anywhere else. |

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

Explorer source verification (the "verified contract" badge on robin.etherscan.io / Blockscout) is still pending. Until then, the script above is the way to confirm the deployed code.
