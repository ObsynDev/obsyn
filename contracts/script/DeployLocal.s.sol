// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OtcEscrow} from "../src/OtcEscrow.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";
import {MockToken, MockFeed} from "../test/mocks/Mocks.sol";

/// Local demo on anvil only: mock USDG, a mock stock token with EIP-2612 permit, an ETH/USD feed,
/// and the escrow. Anvil account #0 = buyer (gets USDG), account #1 = seller (gets TSLAx).
///   anvil
///   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployLocal is Script {
    address constant BUYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // anvil #0
    address constant SELLER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // anvil #1
    address constant TREASURY = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720; // anvil #9

    function run() external {
        require(block.chainid == 31337, "local anvil only");
        vm.startBroadcast();
        MockToken usdg = new MockToken("Global Dollar", "USDG", 6);
        MockToken stock = new MockToken("Tesla xStock", "TSLAx", 18);
        MockFeed feed = new MockFeed();
        feed.set(3_000e8, block.timestamp); // goes stale after 1h: ETH deals then pay the top 2.5% tier
        BuyBurnVault vault = new BuyBurnVault(address(usdg), TREASURY, TREASURY); // token plugged in later
        OtcEscrow esc = new OtcEscrow(address(usdg), address(feed), address(vault));

        usdg.mint(BUYER, 1_000_000e6);
        stock.mint(SELLER, 10_000e18);
        vm.stopBroadcast();

        console.log("USDG_ADDRESS=%s", address(usdg));
        console.log("STOCK_TOKEN=%s", address(stock));
        console.log("BUYBURN_VAULT=%s", address(vault));
        console.log("ESCROW_ADDRESS=%s", address(esc));
    }
}
