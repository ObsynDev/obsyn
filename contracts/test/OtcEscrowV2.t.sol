// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OtcEscrowV2} from "../src/OtcEscrowV2.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";
import {MockToken, MockFeed} from "./mocks/Mocks.sol";

/// @notice What's new in OtcEscrowV2: paying in the platform token. A flat 1.5% fee; the protocol's
///         share goes straight to the burn address, half to a referrer when there is one.
contract OtcEscrowV2Test is Test {
    OtcEscrowV2 esc;
    MockToken usdg;
    MockToken stock;
    MockToken obsyn;
    MockFeed feed;

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address buyer = makeAddr("buyer");
    address treasury = makeAddr("treasury");
    address payout = makeAddr("freshPayout");
    address ref = makeAddr("referrer");
    address relayer = makeAddr("relayer");
    uint256 sellerPk = 0xB0B;
    address seller;

    event FeeBurned(bytes32 indexed dealId, uint256 amount);

    function setUp() public {
        vm.warp(1_800_000_000);
        seller = vm.addr(sellerPk);
        usdg = new MockToken("Global Dollar", "USDG", 6);
        stock = new MockToken("Stock", "NVDAx", 18);
        obsyn = new MockToken("obsyn", "OBSYN", 18);
        feed = new MockFeed();
        feed.set(3_000e8, block.timestamp);
        esc = new OtcEscrowV2(address(usdg), address(feed), treasury, address(obsyn));

        stock.mint(seller, 1_000_000e18);
        obsyn.mint(buyer, 100_000_000e18);
        obsyn.mint(seller, 50_000_000e18);
        usdg.mint(buyer, 10_000_000e6);
        vm.deal(buyer, 1_000 ether);
        vm.startPrank(seller);
        stock.approve(address(esc), type(uint256).max);
        obsyn.approve(address(esc), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(buyer);
        usdg.approve(address(esc), type(uint256).max);
        obsyn.approve(address(esc), type(uint256).max);
        vm.stopPrank();
    }

    function _terms(address token, address payToken, uint256 price) internal view returns (OtcEscrowV2.Terms memory t) {
        t = OtcEscrowV2.Terms({
            buyer: buyer,
            seller: seller,
            token: token,
            amount: 100e18,
            payToken: payToken,
            price: price,
            sellerPayout: payout,
            referrer: address(0),
            relayerFee: 0,
            deadline: uint64(block.timestamp + 1 hours),
            salt: bytes32(0)
        });
    }

    function _settle(OtcEscrowV2.Terms memory t) internal {
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);
    }

    function _depositSig(OtcEscrowV2.Terms memory t, address relayer_) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(keccak256("Deposit(bytes32 dealId,address relayer)"), esc.dealId(t), relayer_));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", esc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ───────────────────────── paying in the platform token ─────────────────────────

    function test_paidInObsyn_feeIsBurnedInTheSameTransaction() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000_000e18); // 1M OBSYN
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.expectEmit(true, false, false, true, address(esc));
        emit FeeBurned(esc.dealId(t), 15_000e18);
        vm.prank(seller);
        esc.depositTokens(t);

        assertEq(stock.balanceOf(buyer), 100e18, "buyer got the tokens");
        assertEq(obsyn.balanceOf(payout), 985_000e18, "seller got 98.5%");
        assertEq(obsyn.balanceOf(DEAD), 15_000e18, "1.5% fee burned");
        assertEq(obsyn.balanceOf(treasury), 0, "nothing to the vault");
        assertEq(obsyn.balanceOf(address(esc)), 0, "escrow keeps nothing");
        (OtcEscrowV2.Status s,,,) = esc.deals(esc.dealId(t));
        assertEq(uint8(s), uint8(OtcEscrowV2.Status.Settled));
    }

    function test_paidInObsyn_sellerFirst_settlesTheSame() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 2_000_000e18);
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment(t);
        assertEq(obsyn.balanceOf(DEAD), 30_000e18);
        assertEq(obsyn.balanceOf(payout), 1_970_000e18);
    }

    function test_paidInObsyn_withReferrer_halfToReferrerHalfBurned() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000_000e18);
        t.referrer = ref;
        _settle(t);
        assertEq(obsyn.balanceOf(ref), 7_500e18, "referrer: half the fee");
        assertEq(obsyn.balanceOf(DEAD), 7_500e18, "burned: the other half");
        assertEq(obsyn.balanceOf(payout), 985_000e18);
    }

    function test_paidInObsyn_flatFeeAtAnySize_noTiers() public {
        assertEq(esc.feeBps(address(obsyn), 1e18), 150);
        assertEq(esc.feeBps(address(obsyn), 10_000_000_000e18), 150);
        // ETH and USDG keep their tiers
        assertEq(esc.feeBps(address(usdg), 5_000e6), 250);
        assertEq(esc.feeBps(address(usdg), 50_000e6), 200);
        assertEq(esc.feeBps(address(usdg), 500_000e6), 150);
    }

    function test_paidInObsyn_holderDiscountDoesNotStack() public {
        // plug the platform token into a real vault so the discount would otherwise apply
        BuyBurnVault vault = new BuyBurnVault(address(usdg), address(this), address(this));
        vault.setPlatformToken(address(obsyn), address(0), 1_000_000e18);
        OtcEscrowV2 e = new OtcEscrowV2(address(usdg), address(feed), address(vault), address(obsyn));
        vm.prank(buyer);
        obsyn.approve(address(e), type(uint256).max);
        vm.prank(seller);
        stock.approve(address(e), type(uint256).max);

        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000_000e18);
        (uint256 protocolFee,, uint256 proceeds) = e.quoteSettlement(t);
        assertEq(protocolFee, 15_000e18, "still a flat 1.5% although the buyer holds 1M+ OBSYN");
        assertEq(proceeds, 985_000e18);

        // ...while a USDG deal from the same holder does get the 0.5% off
        OtcEscrowV2.Terms memory u = _terms(address(stock), address(usdg), 5_000e6);
        (uint256 fee2,,) = e.quoteSettlement(u);
        assertEq(fee2, 100e6, "USDG: 2.5% - 0.5% = 2% for a holder");

        vm.prank(buyer);
        e.depositPayment(t);
        vm.prank(seller);
        e.depositTokens(t);
        assertEq(obsyn.balanceOf(DEAD), 15_000e18, "burned, not sent to the vault");
        assertEq(obsyn.balanceOf(address(vault)), 0);
    }

    function test_paidInObsyn_refundAfterDeadline_returnsEverything() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000_000e18);
        uint256 b0 = obsyn.balanceOf(buyer);
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.warp(t.deadline);
        esc.refund(t);
        assertEq(obsyn.balanceOf(buyer), b0, "buyer refunded in full");
        assertEq(obsyn.balanceOf(DEAD), 0, "nothing burned on a refund");
    }

    function test_paidInObsyn_ghostDeposit_relayerPaidInObsyn() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000_000e18);
        t.relayerFee = 1_000e18;
        vm.prank(buyer);
        esc.depositPayment(t);
        bytes memory sig = _depositSig(t, relayer);
        vm.prank(relayer);
        esc.depositTokensFor(t, OtcEscrowV2.Permit(0, 0, 0, 0), sig);
        assertEq(obsyn.balanceOf(relayer), 1_000e18);
        assertEq(obsyn.balanceOf(DEAD), 15_000e18);
        assertEq(obsyn.balanceOf(payout), 984_000e18);
    }

    function test_paidInObsyn_wrongEthValueReverts() public {
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), 1_000e18);
        vm.prank(buyer);
        vm.expectRevert(OtcEscrowV2.BadValue.selector);
        esc.depositPayment{value: 1}(t);
    }

    // ───────────────────────── what stays the same ─────────────────────────

    function test_tradingObsynItself_forUsdg_paysTheVaultAsBefore() public {
        OtcEscrowV2.Terms memory t = _terms(address(obsyn), address(usdg), 5_000e6);
        _settle(t);
        assertEq(obsyn.balanceOf(buyer), 100_000_000e18 + 100e18, "buyer got the OBSYN");
        assertEq(usdg.balanceOf(treasury), 125e6, "2.5% in USDG to the vault, as before");
        assertEq(obsyn.balanceOf(DEAD), 0);
    }

    function test_rejectsOtherPayTokensAndObsynForObsyn() public {
        MockToken other = new MockToken("Other", "OTH", 18);
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(other), 1e18);
        vm.prank(buyer);
        vm.expectRevert(OtcEscrowV2.BadTerms.selector);
        esc.depositPayment(t);

        OtcEscrowV2.Terms memory self = _terms(address(obsyn), address(obsyn), 1e18);
        vm.prank(buyer);
        vm.expectRevert(OtcEscrowV2.BadTerms.selector);
        esc.depositPayment(self);
    }

    function test_constructorRejectsBadBurnToken() public {
        vm.expectRevert(OtcEscrowV2.BadTerms.selector);
        new OtcEscrowV2(address(usdg), address(feed), treasury, address(0));
        vm.expectRevert(OtcEscrowV2.BadTerms.selector);
        new OtcEscrowV2(address(usdg), address(feed), treasury, address(usdg));
        vm.expectRevert(OtcEscrowV2.BadTerms.selector);
        new OtcEscrowV2(address(usdg), address(feed), treasury, makeAddr("noCode"));
    }

    /// Every unit the buyer pays ends up with the seller, the burn address, the referrer or the relayer.
    function testFuzz_paidInObsyn_conservation(uint96 price, bool withRef, uint32 relayerFee) public {
        vm.assume(price >= 1e6 && price <= 90_000_000e18);
        vm.assume(uint256(relayerFee) * 100 < price);
        OtcEscrowV2.Terms memory t = _terms(address(stock), address(obsyn), price);
        if (withRef) t.referrer = ref;
        t.relayerFee = relayerFee;
        uint256 b0 = obsyn.balanceOf(buyer);
        vm.prank(buyer);
        esc.depositPayment(t);
        bytes memory sig = _depositSig(t, relayer); // before prank: it calls the escrow itself
        vm.prank(relayer);
        esc.depositTokensFor(t, OtcEscrowV2.Permit(0, 0, 0, 0), sig);
        uint256 out = obsyn.balanceOf(payout) + obsyn.balanceOf(DEAD) + obsyn.balanceOf(ref) + obsyn.balanceOf(relayer);
        assertEq(b0 - obsyn.balanceOf(buyer), price);
        assertEq(out, price, "conserved");
        assertEq(obsyn.balanceOf(address(esc)), 0);
        (uint256 fee, uint256 refFee,) = esc.quoteSettlement(t);
        assertEq(obsyn.balanceOf(DEAD), fee);
        assertEq(fee + refFee, (uint256(price) * 150) / 10_000);
    }
}

interface IERC20L {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice The same flow with the live $OBSYN token, USDG and the deployed fee vault on a fork.
///         LIVE_RPC=https://robinhood-rpc.publicnode.com forge test --match-contract OtcEscrowV2Live -vv
contract OtcEscrowV2LiveTest is Test {
    address constant OBSYN = 0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant VAULT = 0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bool live;
    OtcEscrowV2 esc;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        esc = new OtcEscrowV2(USDG, address(0), VAULT, OBSYN);
    }

    function test_nvdaPaidInLiveObsyn_burnsTheFee() public {
        if (!live) return;
        address buyer = makeAddr("buyer");
        address seller = makeAddr("seller");
        address payout = makeAddr("payout");
        deal(OBSYN, buyer, 2_000_000e18);
        deal(NVDA, seller, 1e18, true);
        vm.prank(buyer);
        IERC20L(OBSYN).approve(address(esc), type(uint256).max);
        vm.prank(seller);
        IERC20L(NVDA).approve(address(esc), type(uint256).max);

        OtcEscrowV2.Terms memory t = OtcEscrowV2.Terms({
            buyer: buyer, seller: seller, token: NVDA, amount: 1e18, payToken: OBSYN, price: 1_000_000e18,
            sellerPayout: payout, referrer: address(0), relayerFee: 0, deadline: uint64(block.timestamp + 1 hours), salt: bytes32(uint256(7))
        });
        uint256 dead0 = IERC20L(OBSYN).balanceOf(DEAD);
        uint256 vault0 = IERC20L(OBSYN).balanceOf(VAULT);
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);
        assertEq(IERC20L(NVDA).balanceOf(buyer), 1e18, "buyer got 1 NVDA");
        assertEq(IERC20L(OBSYN).balanceOf(payout), 985_000e18, "seller got 98.5% in OBSYN");
        assertEq(IERC20L(OBSYN).balanceOf(DEAD) - dead0, 15_000e18, "15,000 OBSYN burned");
        assertEq(IERC20L(OBSYN).balanceOf(VAULT), vault0, "the vault got nothing");
    }
}
