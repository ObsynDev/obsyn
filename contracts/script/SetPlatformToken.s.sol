// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";

/// Run once the platform token has launched. Irreversible.
///   VAULT=0x... TOKEN=0x... PONS_CURVE=0x... DISCOUNT_MIN_BALANCE=10000000000000000000000 \
///   forge script script/SetPlatformToken.s.sol --rpc-url robinhood --broadcast --private-key $OWNER_PK
contract SetPlatformToken is Script {
    function run() external {
        BuyBurnVault vault = BuyBurnVault(payable(vm.envAddress("VAULT")));
        address token = vm.envAddress("TOKEN");
        address curve = vm.envOr("PONS_CURVE", address(0));
        uint256 minBal = vm.envOr("DISCOUNT_MIN_BALANCE", uint256(0));

        vm.startBroadcast();
        vault.setPlatformToken(token, curve, minBal);
        vm.stopBroadcast();
    }
}
