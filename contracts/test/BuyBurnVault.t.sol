// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BuyBurnVault, ISwapAdapter} from "../src/BuyBurnVault.sol";
import {OtcEscrow} from "../src/OtcEscrow.sol";
import {MockToken, MockFeed} from "./mocks/Mocks.sol";

/// Simplified stand-in for a Pons V2 curve: fixed price, same external interface as the docs.
contract MockCurve {
    MockToken public immutable launch;
    address public immutable pair; // address(0) = ETH
    uint256 public immutable tokensPerQuote; // tokens (wei) per 1 unit of quote (wei)
    bool public graduated;
    bool public readyToGraduate;
    uint256 public snipeTax;

    constructor(MockToken l, address p, uint256 rate) {
        launch = l;
        pair = p;
        tokensPerQuote = rate;
    }

    function pairToken() external view returns (address) {
        return pair;
    }

    function isNativeQuote() external view returns (bool) {
        return pair == address(0);
    }

    function currentSnipeTaxBps(address) external view returns (uint256) {
        return snipeTax;
    }

    function setState(bool g, bool r, uint256 s) external {
        graduated = g;
        readyToGraduate = r;
        snipeTax = s;
    }

    function buy(uint256 quoteIn, uint256 minOut, address recipient) external payable returns (uint256 out) {
        if (pair == address(0)) require(msg.value == quoteIn, "NativeValueMismatch");
        else MockToken(pair).transferFrom(msg.sender, address(this), quoteIn);
        out = quoteIn * tokensPerQuote;
        require(out >= minOut, "SlippageExceeded");
        launch.mint(recipient, out);
    }
}

contract MockAdapter is ISwapAdapter {
    MockToken public immutable launch;
    uint256 public payoutPerUnit;

    constructor(MockToken l, uint256 p) {
        launch = l;
        payoutPerUnit = p;
    }

    function swap(address tokenIn, uint256 amountIn, address, uint256, address recipient) external payable {
        if (tokenIn != address(0)) MockToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        launch.mint(recipient, amountIn * payoutPerUnit);
    }
}

contract BuyBurnVaultTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    MockToken usdg;
    MockToken plat;
    MockCurve curve;
    BuyBurnVault vault;
    address owner = makeAddr("multisig");
    address keeper = makeAddr("keeper");

    function setUp() public {
        usdg = new MockToken("Global Dollar", "USDG", 6);
        plat = new MockToken("Platform", "PLAT", 18);
        curve = new MockCurve(plat, address(0), 1_000); // ETH-paired launch
        vault = _vault(address(curve));
        vm.deal(address(vault), 10 ether);
        usdg.mint(address(vault), 1_000e6);
    }

    function _vault(address c) internal returns (BuyBurnVault v) {
        v = new BuyBurnVault(address(usdg), owner, keeper);
        vm.prank(owner);
        v.setPlatformToken(address(plat), c, 10_000e18);
    }

    function test_beforeTokenSet_feesAccumulate_noBurns() public {
        BuyBurnVault v = new BuyBurnVault(address(usdg), owner, keeper);
        vm.deal(address(v), 1 ether);
        (address t, uint256 m) = v.discountConfig();
        assertEq(t, address(0));
        assertEq(m, 0);
        vm.startPrank(keeper);
        vm.expectRevert(BuyBurnVault.CurveClosed.selector);
        v.burnViaCurve(1 ether, 0);
        vm.expectRevert(BuyBurnVault.TokenNotSet.selector);
        v.burnViaAdapter(address(0), 1 ether, 0);
        vm.stopPrank();
        assertEq(address(v).balance, 1 ether);
    }

    function test_twoStepOwnership() public {
        address next = makeAddr("newMultisig");
        vm.prank(owner);
        vault.transferOwnership(next);
        assertEq(vault.owner(), owner, "not moved until accepted");
        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.NotOwner.selector);
        vault.acceptOwnership();
        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_setPlatformToken_onlyOwner_once() public {
        BuyBurnVault v = new BuyBurnVault(address(usdg), owner, keeper);
        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.NotOwner.selector);
        v.setPlatformToken(address(plat), address(0), 1);

        vm.startPrank(owner);
        vm.expectRevert(BuyBurnVault.BadAsset.selector);
        v.setPlatformToken(address(usdg), address(0), 1);
        v.setPlatformToken(address(plat), address(0), 1);
        vm.expectRevert(BuyBurnVault.TokenAlreadySet.selector);
        v.setPlatformToken(address(plat), address(curve), 1);
        vm.stopPrank();
        (address t, uint256 m) = v.discountConfig();
        assertEq(t, address(plat));
        assertEq(m, 1);
    }

    function test_burnViaCurve_eth() public {
        vm.prank(keeper);
        vault.burnViaCurve(1 ether, 1_000 ether);
        assertEq(plat.balanceOf(DEAD), 1_000 ether);
        assertEq(vault.totalBurned(), 1_000 ether);
        assertEq(address(vault).balance, 9 ether);
    }

    function test_burnViaCurve_usdgPair() public {
        MockCurve c = new MockCurve(plat, address(usdg), 1e12);
        BuyBurnVault v = _vault(address(c));
        usdg.mint(address(v), 100e6);
        vm.prank(keeper);
        v.burnViaCurve(100e6, 100e18);
        assertEq(plat.balanceOf(DEAD), 100e18);
        assertEq(usdg.allowance(address(v), address(c)), 0);
    }

    function test_rejectsPairOtherThanEthOrUsdg() public {
        MockToken other = new MockToken("X", "X", 18);
        MockCurve c = new MockCurve(plat, address(other), 1);
        BuyBurnVault v = new BuyBurnVault(address(usdg), owner, keeper);
        vm.prank(owner);
        vm.expectRevert(BuyBurnVault.BadAsset.selector);
        v.setPlatformToken(address(plat), address(c), 1);
    }

    function test_onlyKeeper() public {
        vm.expectRevert(BuyBurnVault.NotKeeper.selector);
        vault.burnViaCurve(1 ether, 0);
    }

    function test_snipeTax_blocks() public {
        curve.setState(false, false, 9_900);
        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.SnipeTaxActive.selector);
        vault.burnViaCurve(1 ether, 0);
    }

    function test_graduated_curveClosed() public {
        curve.setState(true, true, 0);
        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.CurveClosed.selector);
        vault.burnViaCurve(1 ether, 0);
    }

    function test_adapter_timelock_and_burn_usdg() public {
        MockAdapter a = new MockAdapter(plat, 1e12);
        vm.startPrank(owner);
        vault.queueAdapter(a);
        vm.expectRevert(BuyBurnVault.TooEarly.selector);
        vault.applyAdapter();
        vm.warp(block.timestamp + 2 days);
        vault.applyAdapter();
        vm.stopPrank();

        vm.prank(keeper);
        vault.burnViaAdapter(address(usdg), 500e6, 500e18);
        assertEq(plat.balanceOf(DEAD), 500e18);
        assertEq(usdg.balanceOf(address(vault)), 500e6);
    }

    function test_adapter_shortchange_reverts() public {
        MockAdapter a = new MockAdapter(plat, 1); // returns far less than promised
        vm.startPrank(owner);
        vault.queueAdapter(a);
        vm.warp(block.timestamp + 2 days);
        vault.applyAdapter();
        vm.stopPrank();

        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.InsufficientBurn.selector);
        vault.burnViaAdapter(address(0), 1 ether, 1_000 ether);
    }

    function test_noAdapter_reverts() public {
        vm.prank(keeper);
        vm.expectRevert(BuyBurnVault.NoAdapter.selector);
        vault.burnViaAdapter(address(usdg), 1e6, 1);
    }

    /// End to end: escrow fees (ETH and USDG) land in the vault and get burned.
    function test_escrowFees_flowIntoVault() public {
        MockFeed feed = new MockFeed();
        feed.set(3_000e8, block.timestamp);
        OtcEscrow esc = new OtcEscrow(address(usdg), address(feed), address(vault));
        MockToken stock = new MockToken("Stock", "TSLAx", 18);

        address buyer = makeAddr("buyer");
        address seller = makeAddr("seller");
        stock.mint(seller, 1e18);
        vm.deal(buyer, 1 ether);
        vm.prank(seller);
        stock.approve(address(esc), 1e18);

        OtcEscrow.Terms memory t = OtcEscrow.Terms({
            buyer: buyer,
            seller: seller,
            token: address(stock),
            amount: 1e18,
            payToken: address(0),
            price: 1 ether,
            sellerPayout: seller,
            referrer: address(0),
            relayerFee: 0,
            deadline: uint64(block.timestamp + 1 hours),
            salt: 0
        });
        vm.prank(seller);
        esc.depositTokens(t);
        vm.prank(buyer);
        esc.depositPayment{value: 1 ether}(t);

        assertEq(address(vault).balance, 10 ether + 0.025 ether);
        vm.prank(keeper);
        vault.burnViaCurve(0.025 ether, 25 ether);
        assertEq(plat.balanceOf(DEAD), 25 ether);
    }
}
