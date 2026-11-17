// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BuyBurnVault, ISwapAdapter} from "../src/BuyBurnVault.sol";
import {V4BurnAdapter, IPoolManager, IUniswapV3Pool, PoolKey} from "../src/V4BurnAdapter.sol";

interface IERC20T {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice The v4 burn route against the live Robinhood Chain contracts: the real PoolManager,
///         the real OBSYN/ETH and ETH/USDG pools (with their hooks), and the deployed fee vault.
///         Skipped unless LIVE_RPC is set:
///         LIVE_RPC=https://robinhood-rpc.publicnode.com forge test --match-contract V4BurnAdapter -vv
contract V4BurnAdapterLiveTest is Test {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    BuyBurnVault constant VAULT = BuyBurnVault(payable(0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221));
    address constant OBSYN = 0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    V4BurnAdapter adapter;
    bool live;

    function tokenPool() internal pure returns (PoolKey memory) {
        return PoolKey(address(0), OBSYN, 0, 200, 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044);
    }

    // Uniswap v3 WETH/USDG 0.01% (official factory); the v4 ETH/USDG pools' hooks refuse direct callers
    IUniswapV3Pool constant USDG_POOL = IUniswapV3Pool(0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca);
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        adapter = new V4BurnAdapter(PM, address(VAULT), OBSYN, USDG, tokenPool(), USDG_POOL, WETH);
    }

    function test_ethBuysTokenStraightToDead() public {
        if (!live) return;
        vm.deal(address(VAULT), 1 ether);
        uint256 before = IERC20T(OBSYN).balanceOf(DEAD);
        vm.prank(address(VAULT));
        adapter.swap{value: 0.01 ether}(address(0), 0.01 ether, OBSYN, 1, DEAD);
        uint256 burned = IERC20T(OBSYN).balanceOf(DEAD) - before;
        emit log_named_decimal_uint("OBSYN bought with 0.01 ETH", burned, 18);
        assertGt(burned, 0);
        assertEq(address(adapter).balance, 0, "adapter keeps no ETH");
        assertEq(IERC20T(OBSYN).balanceOf(address(adapter)), 0, "adapter keeps no token");
    }

    function test_usdgGoesThroughEthToToken() public {
        if (!live) return;
        deal(USDG, address(VAULT), 100e6);
        uint256 before = IERC20T(OBSYN).balanceOf(DEAD);
        vm.startPrank(address(VAULT));
        IERC20T(USDG).approve(address(adapter), 20e6);
        adapter.swap(USDG, 20e6, OBSYN, 1, DEAD);
        vm.stopPrank();
        uint256 burned = IERC20T(OBSYN).balanceOf(DEAD) - before;
        emit log_named_decimal_uint("OBSYN bought with 20 USDG", burned, 18);
        assertGt(burned, 0);
        assertEq(IERC20T(USDG).balanceOf(address(VAULT)), 80e6, "exactly 20 USDG spent");
        assertEq(IERC20T(USDG).balanceOf(address(adapter)), 0);
        assertEq(address(adapter).balance, 0);
    }

    function test_fullVaultFlow_queueWaitApplyBurn() public {
        if (!live) return;
        address owner = VAULT.owner();
        address keeper = VAULT.keeper();
        vm.prank(owner);
        VAULT.queueAdapter(ISwapAdapter(address(adapter)));
        // can't apply before the 2-day wait
        vm.prank(owner);
        vm.expectRevert();
        VAULT.applyAdapter();
        vm.warp(block.timestamp + 2 days);
        vm.prank(owner);
        VAULT.applyAdapter();
        assertEq(address(VAULT.adapter()), address(adapter));

        vm.deal(address(VAULT), 0.05 ether);
        deal(USDG, address(VAULT), 50e6);
        uint256 burnedBefore = VAULT.totalBurned();

        vm.prank(keeper);
        VAULT.burnViaAdapter(address(0), 0.05 ether, 1);
        vm.prank(keeper);
        VAULT.burnViaAdapter(USDG, 50e6, 1);

        assertGt(VAULT.totalBurned(), burnedBefore);
        assertEq(address(VAULT).balance, 0, "all ETH fees spent");
        assertEq(IERC20T(USDG).balanceOf(address(VAULT)), 0, "all USDG fees spent");
        emit log_named_decimal_uint("vault totalBurned", VAULT.totalBurned(), 18);
    }

    function test_minOutIsEnforced() public {
        if (!live) return;
        vm.deal(address(VAULT), 1 ether);
        vm.prank(address(VAULT));
        vm.expectRevert();
        adapter.swap{value: 0.01 ether}(address(0), 0.01 ether, OBSYN, type(uint128).max, DEAD);
    }

    function test_onlyTheVaultCanSwap() public {
        if (!live) return;
        vm.deal(address(this), 1 ether);
        vm.expectRevert(V4BurnAdapter.NotVault.selector);
        adapter.swap{value: 0.01 ether}(address(0), 0.01 ether, OBSYN, 1, DEAD);
    }

    function test_onlyThePoolManagerCanCallBack() public {
        if (!live) return;
        vm.expectRevert(V4BurnAdapter.NotPoolManager.selector);
        adapter.unlockCallback(abi.encode(address(0), uint256(1), DEAD));
    }

    function test_onlyOurV3SwapCanCallBack() public {
        if (!live) return;
        vm.expectRevert(V4BurnAdapter.NotPool.selector);
        adapter.uniswapV3SwapCallback(0, 1, "");
        vm.prank(address(USDG_POOL)); // even the pool, outside our own swap
        vm.expectRevert(V4BurnAdapter.NotPool.selector);
        adapter.uniswapV3SwapCallback(0, 1, "");
    }

    function test_rejectsWrongInputs() public {
        if (!live) return;
        vm.deal(address(VAULT), 1 ether);
        vm.startPrank(address(VAULT));
        vm.expectRevert(V4BurnAdapter.BadInput.selector);
        adapter.swap{value: 0.01 ether}(address(0), 0.02 ether, OBSYN, 1, DEAD); // value mismatch
        vm.expectRevert(V4BurnAdapter.BadInput.selector);
        adapter.swap{value: 0.01 ether}(address(0), 0.01 ether, USDG, 1, DEAD); // wrong output token
        vm.expectRevert(V4BurnAdapter.BadInput.selector);
        adapter.swap(address(0xBEEF), 1, OBSYN, 1, DEAD); // unknown input token
        vm.stopPrank();
    }
}

contract MockV3Pool {
    address public token0;
    address public token1;

    constructor(address t0, address t1) {
        token0 = t0;
        token1 = t1;
    }
}

/// @notice Constructor checks, no fork needed.
contract V4BurnAdapterUnitTest is Test {
    function test_rejectsPoolsThatDontMatchTheTokens() public {
        address token = address(0x1111);
        address usdg = address(0x2222);
        address weth = address(0x4444);
        PoolKey memory good = PoolKey(address(0), token, 0, 200, address(0));
        PoolKey memory wrong = PoolKey(address(0), address(0x3333), 0, 200, address(0));
        IUniswapV3Pool goodV3 = IUniswapV3Pool(address(new MockV3Pool(weth, usdg)));
        IUniswapV3Pool wrongV3 = IUniswapV3Pool(address(new MockV3Pool(usdg, weth)));
        vm.expectRevert(V4BurnAdapter.BadInput.selector);
        new V4BurnAdapter(IPoolManager(address(1)), address(2), token, usdg, wrong, goodV3, weth);
        vm.expectRevert(V4BurnAdapter.BadInput.selector);
        new V4BurnAdapter(IPoolManager(address(1)), address(2), token, usdg, good, wrongV3, weth);
        V4BurnAdapter a = new V4BurnAdapter(IPoolManager(address(1)), address(2), token, usdg, good, goodV3, weth);
        assertEq(a.tokenPoolKey().currency1, token);
        assertEq(address(a.usdgPool()), address(goodV3));
    }
}
