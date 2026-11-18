// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OtcEscrowV2 as OtcEscrow} from "../src/OtcEscrowV2.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";
import {MockToken, FeeOnTransferToken, MockFeed, EthRejecter, ReturnBomb} from "./mocks/Mocks.sol";

/// @notice Every OtcEscrow test, run unchanged against OtcEscrowV2: paying in ETH or USDG must behave
///         exactly as before. Generated from OtcEscrow.t.sol (only the import and constructor differ).
contract OtcEscrowV2ParityTest is Test {
    MockToken burnTok;
    OtcEscrow esc;
    MockToken usdg;
    MockToken stock;
    MockFeed feed;
    MockToken platform;

    address buyer = makeAddr("buyer");
    address treasury = makeAddr("treasury");
    address payout = makeAddr("freshPayout");
    address ref = makeAddr("referrer");
    address relayer = makeAddr("relayer");
    uint256 sellerPk = 0xA11CE;
    address seller;

    function setUp() public {
        vm.warp(1_800_000_000);
        seller = vm.addr(sellerPk);
        usdg = new MockToken("Global Dollar", "USDG", 6);
        stock = new MockToken("Stock", "TSLAx", 18);
        feed = new MockFeed();
        feed.set(3_000e8, block.timestamp); // $3,000 / ETH
        platform = new MockToken("Platform", "PLAT", 18);
        burnTok = new MockToken("Obsyn", "OBSYN", 18);
        esc = new OtcEscrow(address(usdg), address(feed), treasury, address(burnTok));

        stock.mint(seller, 1_000_000e18);
        usdg.mint(buyer, 10_000_000e6);
        vm.deal(buyer, 1_000 ether);
        vm.prank(seller);
        stock.approve(address(esc), type(uint256).max);
        vm.prank(buyer);
        usdg.approve(address(esc), type(uint256).max);
    }

    function _terms(address payToken, uint256 price) internal view returns (OtcEscrow.Terms memory t) {
        t = OtcEscrow.Terms({
            buyer: buyer,
            seller: seller,
            token: address(stock),
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

    function _noPermit() internal pure returns (OtcEscrow.Permit memory p) {}

    function _depositSig(OtcEscrow.Terms memory t, address relayer_) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(keccak256("Deposit(bytes32 dealId,address relayer)"), esc.dealId(t), relayer_));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", esc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sellerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ───────────────────────── happy paths ─────────────────────────

    function test_usdg_buyerFirst_settles() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6); // $5k → 2.5%
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);

        assertEq(stock.balanceOf(buyer), 100e18);
        assertEq(usdg.balanceOf(treasury), 125e6);
        assertEq(usdg.balanceOf(payout), 4_875e6);
        (OtcEscrow.Status s,,,) = esc.deals(esc.dealId(t));
        assertEq(uint8(s), uint8(OtcEscrow.Status.Settled));
    }

    function test_feeTiers() public view {
        assertEq(esc.feeBps(address(usdg), 9_999e6), 250);
        assertEq(esc.feeBps(address(usdg), 10_000e6), 200);
        assertEq(esc.feeBps(address(usdg), 100_000e6), 150);
        assertEq(esc.feeBps(address(0), 3 ether), 250); // $9k
        assertEq(esc.feeBps(address(0), 4 ether), 200); // $12k
        assertEq(esc.feeBps(address(0), 40 ether), 150); // $120k
    }

    function test_eoaFeeRecipient_noDiscount() public {
        platform.mint(buyer, 1_000_000e18);
        (address d,) = esc.discountConfig();
        assertEq(d, address(0));
        (uint256 p,,) = esc.quoteSettlement(_terms(address(usdg), 5_000e6));
        assertEq(p, 125e6);
    }

    /// Escrow deployed before the token exists; the discount switches on once the vault learns the token.
    function test_holderDiscount_pluggedInLater() public {
        address owner = makeAddr("multisig");
        BuyBurnVault vault = new BuyBurnVault(address(usdg), owner, owner);
        OtcEscrow e = new OtcEscrow(address(usdg), address(feed), address(vault), address(burnTok));
        vm.prank(seller);
        stock.approve(address(e), type(uint256).max);
        vm.prank(buyer);
        usdg.approve(address(e), type(uint256).max);

        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6); // 2.5%
        platform.mint(buyer, 10_000e18);
        (uint256 p,,) = e.quoteSettlement(t);
        assertEq(p, 125e6, "no token set yet: no discount");

        vm.prank(owner);
        vault.setPlatformToken(address(platform), address(0), 10_001e18);
        (p,,) = e.quoteSettlement(t);
        assertEq(p, 125e6, "below threshold: no discount");

        platform.mint(buyer, 1e18);
        vm.prank(buyer);
        e.depositPayment(t);
        vm.prank(seller);
        e.depositTokens(t);
        assertEq(usdg.balanceOf(address(vault)), 100e6); // 2.0%
        assertEq(usdg.balanceOf(payout), 4_900e6);

        vm.prank(owner);
        vm.expectRevert(BuyBurnVault.TokenAlreadySet.selector);
        vault.setPlatformToken(address(usdg), address(0), 1);
    }

    function test_futureDatedFeed_doesNotBrickEthDeals() public {
        feed.set(3_000e8, block.timestamp + 1 days); // updatedAt in the future
        assertEq(esc.feeBps(address(0), 40 ether), 250);

        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether}(t);
        assertEq(stock.balanceOf(buyer), 100e18);
    }

    function test_brokenFeed_doesNotBrickEthDeals() public {
        feed.set(-1, block.timestamp);
        assertEq(esc.feeBps(address(0), 40 ether), 250);
        feed.set(type(int256).max, block.timestamp);
        assertEq(esc.feeBps(address(0), 40 ether), 250);
    }

    function test_staleFeed_usesTopTier() public {
        vm.warp(block.timestamp + 2 hours);
        assertEq(esc.feeBps(address(0), 40 ether), 250);
    }

    function test_eth_sellerFirst_withReferrer() public {
        OtcEscrow.Terms memory t = _terms(address(0), 40 ether); // $120k → 1.5%
        t.referrer = ref;
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment{value: 40 ether}(t);

        uint256 fee = 0.6 ether;
        assertEq(ref.balance, fee / 2);
        assertEq(treasury.balance, fee / 2);
        assertEq(payout.balance, 40 ether - fee);
        assertEq(stock.balanceOf(buyer), 100e18);
    }

    function test_ghostDeposit_viaRelayer_withPermit() public {
        // fresh ghost wallet holds the tokens, has zero ETH and no approval
        uint256 ghostPk = 0xB0B;
        address ghost = vm.addr(ghostPk);
        stock.mint(ghost, 100e18);

        OtcEscrow.Terms memory t = _terms(address(usdg), 20_000e6); // 2%
        t.seller = ghost;
        t.relayerFee = 5e6;

        // permit signed by ghost
        uint256 dl = block.timestamp + 1 hours;
        bytes32 permitHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                stock.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        ghost,
                        address(esc),
                        t.amount,
                        0,
                        dl
                    )
                )
            )
        );
        (uint8 pv, bytes32 pr, bytes32 ps) = vm.sign(ghostPk, permitHash);

        bytes32 depHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                esc.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(keccak256("Deposit(bytes32 dealId,address relayer)"), esc.dealId(t), relayer))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ghostPk, depHash);

        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(relayer);
        esc.depositTokensFor(t, OtcEscrow.Permit(dl, pv, pr, ps), abi.encodePacked(r, s, v));

        assertEq(ghost.balance, 0);
        assertEq(stock.balanceOf(buyer), 100e18);
        assertEq(usdg.balanceOf(relayer), 5e6);
        assertEq(usdg.balanceOf(treasury), 400e6);
        assertEq(usdg.balanceOf(payout), 20_000e6 - 400e6 - 5e6);
    }

    function test_relayerFee_returnedToSeller_whenNoRelayer() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        t.relayerFee = 5e6;
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);
        assertEq(usdg.balanceOf(payout), 4_875e6);
    }

    // ───────────────────────── refunds ─────────────────────────

    function test_refund_afterDeadline() public {
        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether}(t);
        uint256 bal = buyer.balance;

        vm.expectRevert(OtcEscrow.NotExpired.selector);
        esc.refund(t);

        vm.warp(t.deadline);
        esc.refund(t); // anyone can call
        assertEq(buyer.balance, bal + 1 ether);

        vm.prank(seller);
        vm.expectRevert(OtcEscrow.Expired.selector);
        esc.depositTokens(t);
    }

    function test_refund_frozenSeller_doesNotBlockBuyer() public {
        // both sides deposited, but buyer frozen → settlement reverts, deal stays one-sided
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        vm.prank(seller);
        esc.depositTokens(t);
        stock.setFrozen(seller, true);

        vm.warp(t.deadline);
        esc.refund(t); // seller refund fails, deal stays Open
        (OtcEscrow.Status s,, bool sellerFunded,) = esc.deals(esc.dealId(t));
        assertEq(uint8(s), uint8(OtcEscrow.Status.Open));
        assertTrue(sellerFunded);

        stock.setFrozen(seller, false);
        esc.refund(t);
        assertEq(stock.balanceOf(seller), 1_000_000e18);
    }

    function test_ethRejectingPayout_isCredited() public {
        EthRejecter rej = new EthRejecter();
        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        t.sellerPayout = address(rej);
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether}(t);

        assertEq(stock.balanceOf(buyer), 100e18); // settlement still went through
        assertEq(esc.owedEth(address(rej)), 0.975 ether);
    }

    // ───────────────────────── review: griefing and economics ─────────────────────────

    /// A referrer (or payout) contract that "return bombs" can't block settlement: it gets 50k gas,
    /// can't afford a large return, the call fails and its share is credited instead.
    function test_returnBombRecipients_cantBlockSettlement() public {
        ReturnBomb bomb = new ReturnBomb();
        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        t.referrer = address(bomb);
        t.sellerPayout = address(bomb);
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether, gas: 400_000}(t);
        assertEq(stock.balanceOf(buyer), 100e18);
        (OtcEscrow.Status s,,,) = esc.deals(esc.dealId(t));
        assertEq(uint8(s), uint8(OtcEscrow.Status.Settled));
    }

    /// Documented economic limit: the referrer is part of the terms, so a party can name its own
    /// second wallet and take back half the fee. The protocol share halves; nobody else loses.
    function test_selfReferral_halvesProtocolFee_only() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6); // 2.5% = 125 USDG
        t.referrer = buyer;
        uint256 before = usdg.balanceOf(buyer);
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);
        assertEq(usdg.balanceOf(treasury), 62.5e6, "protocol keeps half");
        assertEq(before - usdg.balanceOf(buyer), 5_000e6 - 62.5e6, "buyer got half the fee back");
        assertEq(usdg.balanceOf(payout), 4_875e6, "seller unaffected");
    }

    /// Refunds stay independent of any third party: no referrer, relayer or fee recipient is paid on refund.
    function test_refund_ignoresBombReferrer() public {
        ReturnBomb bomb = new ReturnBomb();
        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        t.referrer = address(bomb);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether}(t);
        vm.warp(t.deadline);
        esc.refund(t);
        assertEq(buyer.balance, 1_000 ether);
    }

    // ───────────────────────── rejections ─────────────────────────

    function test_onlyBuyer_onlySeller() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        vm.expectRevert(OtcEscrow.NotBuyer.selector);
        esc.depositPayment(t);
        vm.expectRevert(OtcEscrow.NotSeller.selector);
        esc.depositTokens(t);
    }

    function test_doubleDeposit_reverts() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        vm.startPrank(buyer);
        esc.depositPayment(t);
        vm.expectRevert(OtcEscrow.AlreadyFunded.selector);
        esc.depositPayment(t);
        vm.stopPrank();
    }

    function test_wrongEthValue_reverts() public {
        OtcEscrow.Terms memory t = _terms(address(0), 1 ether);
        vm.prank(buyer);
        vm.expectRevert(OtcEscrow.BadValue.selector);
        esc.depositPayment{value: 0.5 ether}(t);
    }

    function test_feeOnTransfer_reverts() public {
        FeeOnTransferToken tax = new FeeOnTransferToken();
        tax.mint(seller, 100e18);
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        t.token = address(tax);
        vm.startPrank(seller);
        tax.approve(address(esc), type(uint256).max);
        vm.expectRevert(OtcEscrow.FeeOnTransfer.selector);
        esc.depositTokens(t);
        vm.stopPrank();
    }

    function test_badTerms_revert() public {
        OtcEscrow.Terms memory t = _terms(address(stock), 5_000e6); // payToken not ETH/USDG
        vm.prank(buyer);
        vm.expectRevert(OtcEscrow.BadTerms.selector);
        esc.depositPayment(t);

        t = _terms(address(usdg), 5_000e6);
        t.relayerFee = 4_900e6; // would eat all proceeds
        vm.prank(buyer);
        vm.expectRevert(OtcEscrow.BadTerms.selector);
        esc.depositPayment(t);
    }

    function test_relayerSig_boundToRelayer() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        bytes memory sig = _depositSig(t, relayer);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(OtcEscrow.BadSignature.selector);
        esc.depositTokensFor(t, _noPermit(), sig);
    }

    function test_changedTerms_isDifferentDeal() public {
        OtcEscrow.Terms memory t = _terms(address(usdg), 5_000e6);
        vm.prank(buyer);
        esc.depositPayment(t);
        t.price = 1e6; // seller can't settle at a different price
        vm.prank(seller);
        esc.depositTokens(t);
        assertEq(stock.balanceOf(buyer), 0);
    }

    // ───────────────────────── fuzz ─────────────────────────

    function testFuzz_conservation(uint256 price, bool withRef) public {
        price = bound(price, 1e6, 5_000_000e6);
        OtcEscrow.Terms memory t = _terms(address(usdg), price);
        if (withRef) t.referrer = ref;
        uint256 before = usdg.balanceOf(buyer);
        vm.prank(buyer);
        esc.depositPayment(t);
        vm.prank(seller);
        esc.depositTokens(t);

        uint256 paidOut = usdg.balanceOf(payout) + usdg.balanceOf(treasury) + usdg.balanceOf(ref);
        assertEq(paidOut, price);
        assertEq(before - usdg.balanceOf(buyer), price);
        assertEq(usdg.balanceOf(address(esc)), 0);
        assertLe(usdg.balanceOf(treasury) + usdg.balanceOf(ref), price * 250 / 10_000);
    }
}
