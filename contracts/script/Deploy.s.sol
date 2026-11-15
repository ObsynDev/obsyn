// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OtcEscrow} from "../src/OtcEscrow.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";

/// Deploys the fee vault and the escrow. The platform token is NOT needed yet:
/// once it launches, the vault owner calls
///   vault.setPlatformToken(token, ponsCurve, discountMinBalance)
/// once, and the holder discount + buy-and-burn switch on. The escrow never changes.
///
/// Usage:
///   USDG=0x... ETH_USD_FEED=0x... VAULT_OWNER=0x<multisig> KEEPER=0x... \
///   forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --private-key $PK
contract Deploy is Script {
    function run() external returns (BuyBurnVault vault, OtcEscrow esc) {
        address usdg = vm.envAddress("USDG");
        address feed = vm.envOr("ETH_USD_FEED", address(0));
        address owner = vm.envAddress("VAULT_OWNER"); // use a multisig
        address keeper = vm.envOr("KEEPER", owner);

        vm.startBroadcast();
        vault = new BuyBurnVault(usdg, owner, keeper);
        esc = new OtcEscrow(usdg, feed, address(vault));
        vm.stopBroadcast();

        console.log("BUYBURN_VAULT=%s", address(vault));
        console.log("ESCROW_ADDRESS=%s", address(esc));
    }
}
