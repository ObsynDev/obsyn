// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OtcEscrow} from "../src/OtcEscrow.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// Smoke test against the LIVE deployment on Robinhood Chain, run on a fork (no real funds move).
/// Skipped unless LIVE_RPC is set:
///   LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract LiveFork -vv
contract LiveForkTest is Test {
    OtcEscrow constant ESC = OtcEscrow(payable(0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865));
    address constant VAULT = 0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;

    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address payout = makeAddr("payout");
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        deal(TSLA, seller, 1e18, true);
        deal(USDG, buyer, 10e6, true);
        vm.deal(buyer, 1 ether);
        vm.prank(seller);
        IERC20(TSLA).approve(address(ESC), type(uint256).max);
        vm.prank(buyer);
        IERC20(USDG).approve(address(ESC), type(uint256).max);
    }

    function _terms(address payToken, uint256 price) internal view returns (OtcEscrow.Terms memory) {
        return OtcEscrow.Terms({
            buyer: buyer,
            seller: seller,
            token: TSLA,
            amount: 0.02e18,
            payToken: payToken,
            price: price,
            sellerPayout: payout,
            referrer: address(0),
            relayerFee: 0,
            deadline: uint64(block.timestamp + 1 hours),
            salt: keccak256(abi.encode(payToken, price))
        });
    }

    function test_live_wiring() public view {
        if (!live) return;
        assertEq(ESC.usdg(), USDG);
        assertEq(ESC.feeRecipient(), VAULT);
        assertEq(BuyBurnVault(payable(VAULT)).owner(), 0x533452c0e3C3455D33d551964F14D352597b21e1);
    }

    function test_live_usdgDeal_settles_feeToVault() public {
        if (!live) return;
        OtcEscrow.Terms memory t = _terms(USDG, 8e6); // $8 → 2.5% = $0.20
        uint256 vaultBefore = IERC20(USDG).balanceOf(VAULT);
        vm.prank(buyer);
        ESC.depositPayment(t);
        vm.prank(seller);
        ESC.depositTokens(t);
        assertEq(IERC20(TSLA).balanceOf(buyer), 0.02e18, "buyer got the stock token");
        assertEq(IERC20(USDG).balanceOf(payout), 7.8e6, "seller got price minus 2.5%");
        assertEq(IERC20(USDG).balanceOf(VAULT) - vaultBefore, 0.2e6, "fee reached the vault");
        (OtcEscrow.Status s,,,) = ESC.deals(ESC.dealId(t));
        assertEq(uint8(s), uint8(OtcEscrow.Status.Settled));
    }

    function test_live_ethDeal_sellerFirst_settles() public {
        if (!live) return;
        OtcEscrow.Terms memory t = _terms(address(0), 0.004 ether);
        uint256 vaultBefore = VAULT.balance;
        vm.prank(seller);
        ESC.depositTokens(t);
        vm.prank(buyer);
        ESC.depositPayment{value: 0.004 ether}(t);
        assertEq(IERC20(TSLA).balanceOf(buyer), 0.02e18);
        assertEq(payout.balance, 0.0039 ether, "no ETH/USD feed: top tier 2.5%");
        assertEq(VAULT.balance - vaultBefore, 0.0001 ether);
    }

    function test_live_refund_afterDeadline() public {
        if (!live) return;
        OtcEscrow.Terms memory t = _terms(USDG, 8e6);
        vm.prank(buyer);
        ESC.depositPayment(t);
        vm.warp(t.deadline + 1);
        vm.prank(buyer);
        ESC.refund(t);
        assertEq(IERC20(USDG).balanceOf(buyer), 10e6, "buyer got everything back");
    }
}

/// Dry run of the one-time `setPlatformToken` and a real buy-and-burn through the live Pons curve, on a fork.
///   LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract LivePlatformToken -vv
contract LivePlatformTokenTest is Test {
    BuyBurnVault constant VAULT = BuyBurnVault(payable(0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221));
    OtcEscrow constant ESC = OtcEscrow(payable(0x41c1dcd0bf252C86C4b0cb78dec42830DD1d0865));
    address constant OBSYN = 0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351;
    address constant CURVE = 0x1D6A7a3fAB6592cb5E6AA5873B915Bc6f93B0499;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
    }

    function test_live_setPlatformToken_thenBurnViaCurve() public {
        if (!live) return;
        address owner = VAULT.owner();
        vm.prank(owner);
        VAULT.setPlatformToken(OBSYN, CURVE, 100_000e18);

        (address dToken, uint256 dMin) = ESC.discountConfig();
        assertEq(dToken, OBSYN, "escrow sees the discount token");
        assertEq(dMin, 100_000e18);
        assertTrue(VAULT.curveOpen());

        // pretend fees arrived, then burn 0.01 ETH of them through the curve
        vm.deal(address(VAULT), 0.05 ether);
        uint256 deadBefore = IERC20(OBSYN).balanceOf(DEAD);
        vm.prank(owner); // owner is also the keeper
        VAULT.burnViaCurve(0.01 ether, 1);
        uint256 burned = IERC20(OBSYN).balanceOf(DEAD) - deadBefore;
        emit log_named_decimal_uint("OBSYN burned for 0.01 ETH", burned, 18);
        assertGt(burned, 0);
        assertEq(VAULT.totalBurned(), burned);
        assertEq(address(VAULT).balance, 0.04 ether, "only the 0.01 ETH was spent");

        // it can't be set twice
        vm.prank(owner);
        vm.expectRevert(BuyBurnVault.TokenAlreadySet.selector);
        VAULT.setPlatformToken(OBSYN, CURVE, 1);
    }
}
