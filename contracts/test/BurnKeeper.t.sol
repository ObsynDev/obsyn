// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BuyBurnVault} from "../src/BuyBurnVault.sol";
import {IPoolManager, IUniswapV3Pool, PoolKey, SwapParams} from "../src/V4BurnAdapter.sol";
import {BurnKeeper, IKeeperVault, IPoolStateView, IV3PoolOracle} from "../src/BurnKeeper.sol";

interface IERC20K {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

/// @dev Someone buying the token on the v4 pool right before a burn (pushes its price up).
contract Pumper {
    IPoolManager immutable pm;
    PoolKey key;

    constructor(IPoolManager pm_, PoolKey memory key_) {
        pm = pm_;
        key = key_;
    }

    function pump() external payable {
        pm.unlock(abi.encode(msg.value));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        uint256 amt = abi.decode(data, (uint256));
        int256 d = pm.swap(key, SwapParams(true, -int256(amt), 4295128740), "");
        pm.settle{value: uint256(uint128(-int128(d >> 128)))}();
        pm.take(key.currency1, address(this), uint256(uint128(int128(d))));
        return "";
    }

    receive() external payable {}
}

/// @dev Someone dumping USDG into the WETH/USDG v3 pool to skew the USDG leg.
contract Skewer {
    IUniswapV3Pool immutable pool;
    address immutable usdg;

    constructor(IUniswapV3Pool p, address u) {
        pool = p;
        usdg = u;
    }

    function skew(uint256 usdgIn) external {
        pool.swap(address(this), false, int256(usdgIn), 1461446703485210103287273052203988822378723970341, "");
    }

    function uniswapV3SwapCallback(int256, int256 amount1Delta, bytes calldata) external {
        IERC20K(usdg).transfer(msg.sender, uint256(amount1Delta));
    }
}

/// @notice BurnKeeper against the live Robinhood Chain contracts on a fork: the live vault, its live
///         V4BurnAdapter route and the real pools, with the keeper installed the way the timelock will.
///         Skipped unless LIVE_RPC is set:
///         LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract BurnKeeperLive -vv
contract BurnKeeperLiveTest is Test {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    IPoolStateView constant SV = IPoolStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);
    BuyBurnVault constant VAULT = BuyBurnVault(payable(0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221));
    address constant ROUTE = 0xF20C97AeDfaD8dE050E7e3eE797Fa0434A16AB67; // V4BurnAdapter, live since 2026-11-20
    address constant OBSYN = 0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    IV3PoolOracle constant USDG_POOL = IV3PoolOracle(0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 constant POOL_ID = 0x9fe79f5726a87aa2758f14ba929e6fe4277a7718d6862aa039d61974c0542355;

    BurnKeeper keeper;
    bool live;
    address anyone = address(0xA11CE);

    function tokenPool() internal pure returns (PoolKey memory) {
        return PoolKey(address(0), OBSYN, 0, 200, 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044);
    }

    function config() internal pure returns (BurnKeeper.Config memory) {
        return BurnKeeper.Config({
            route: ROUTE,
            stateView: SV,
            tokenPoolId: POOL_ID,
            usdgPool: USDG_POOL,
            minSnapshotAge: 600,
            maxSnapshotAge: 7200,
            bandBps: 300,
            feeAllowanceBps: 500,
            maxEthPerBurn: 0.01 ether,
            maxUsdgPerBurn: 20e6,
            minEth: 0.0001 ether,
            minUsdg: 0.5e6,
            cooldown: 1800,
            twapWindow: 600,
            maxTwapTickDeviation: 50
        });
    }

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        keeper = new BurnKeeper(IKeeperVault(address(VAULT)), config());
        // what the timelock will do: make the keeper the vault's keeper
        vm.prank(VAULT.owner());
        VAULT.setKeeper(address(keeper));
        vm.deal(address(VAULT), 1 ether);
    }

    function ready() internal {
        keeper.snapshot();
        vm.warp(block.timestamp + 601);
    }

    function test_installedOnTheLiveVault() public {
        if (!live) return;
        assertEq(VAULT.keeper(), address(keeper));
        assertEq(address(VAULT.adapter()), ROUTE);
        assertGt(keeper.poolSqrtPrice(), 0);
        assertEq(keeper.usdg(), USDG);
    }

    function test_anyoneBurnsEthAtTheCap() public {
        if (!live) return;
        ready();
        uint256 deadBefore = IERC20K(OBSYN).balanceOf(DEAD);
        uint256 vaultEth = address(VAULT).balance;
        uint256 atSnapshot = keeper.tokensAtSnapshot(0.01 ether);
        vm.prank(anyone);
        keeper.burnEth();
        uint256 burned = IERC20K(OBSYN).balanceOf(DEAD) - deadBefore;
        emit log_named_decimal_uint("OBSYN burned for 0.01 ETH", burned, 18);
        emit log_named_decimal_uint("at the snapshot price", atSnapshot, 18);
        emit log_named_uint("received vs snapshot price (bps)", (burned * 10_000) / atSnapshot);
        assertEq(vaultEth - address(VAULT).balance, 0.01 ether, "spent exactly the cap");
        assertGe(burned, (atSnapshot * 9_200) / 10_000, "never under the snapshot price minus band and allowance");
        assertEq(keeper.lastBurnAt(), block.timestamp);
    }

    function test_snapshotRules() public {
        if (!live) return;
        vm.expectRevert(BurnKeeper.NoSnapshot.selector);
        keeper.burnEth();

        keeper.snapshot();
        vm.expectRevert(BurnKeeper.SnapshotStillValid.selector); // nobody can reset it for free
        keeper.snapshot();

        vm.warp(block.timestamp + 300);
        vm.expectRevert(abi.encodeWithSelector(BurnKeeper.SnapshotTooNew.selector, keeper.snapshotAt() + 600));
        keeper.burnEth();

        vm.warp(block.timestamp + 7201);
        vm.expectRevert(BurnKeeper.SnapshotTooOld.selector);
        keeper.burnEth();
        assertTrue(keeper.canSnapshot(), "a stale snapshot can be replaced");
        keeper.snapshot();
    }

    function test_cooldownBetweenBurns() public {
        if (!live) return;
        ready();
        keeper.burnEth();
        vm.expectRevert(abi.encodeWithSelector(BurnKeeper.Cooldown.selector, block.timestamp + 1800));
        keeper.burnEth();
        vm.warp(block.timestamp + 1801);
        keeper.burnEth(); // same snapshot, still fresh and in band
    }

    /// The attack from the review: pump the price right before the burn so the vault buys high.
    function test_pumpBeforeTheBurnIsRefused() public {
        if (!live) return;
        ready();
        Pumper attacker = new Pumper(PM, tokenPool());
        vm.deal(address(attacker), 5 ether);
        attacker.pump{value: 1 ether}();
        assertFalse(keeper.inBand(keeper.poolSqrtPrice()));
        vm.expectRevert(BurnKeeper.PriceMoved.selector);
        keeper.burnEth();
        // and the snapshot can now be retaken, but only becomes usable after it ages
        keeper.snapshot();
        vm.expectRevert(abi.encodeWithSelector(BurnKeeper.SnapshotTooNew.selector, block.timestamp + 600));
        keeper.burnEth();
    }

    /// A smaller pump that stays inside the band: the burn still can't get less than the snapshot-based floor.
    function test_pumpInsideTheBandStillHitsTheFloor() public {
        if (!live) return;
        ready();
        Pumper attacker = new Pumper(PM, tokenPool());
        vm.deal(address(attacker), 1 ether);
        attacker.pump{value: 0.05 ether}();
        if (!keeper.inBand(keeper.poolSqrtPrice())) return; // the pool was too thin for this size: covered above
        uint256 floor = (keeper.tokensAtSnapshot(0.01 ether) * 9_200) / 10_000;
        uint256 deadBefore = IERC20K(OBSYN).balanceOf(DEAD);
        try keeper.burnEth() {
            assertGe(IERC20K(OBSYN).balanceOf(DEAD) - deadBefore, floor);
        } catch {
            // refused (InsufficientOutput/InsufficientBurn): the vault kept its ETH
            assertEq(address(VAULT).balance, 1 ether);
        }
    }

    function test_burnsUsdgThroughTheTwapCheckedLeg() public {
        if (!live) return;
        ready();
        deal(USDG, address(VAULT), 100e6);
        uint256 deadBefore = IERC20K(OBSYN).balanceOf(DEAD);
        vm.prank(anyone);
        keeper.burnUsdg();
        uint256 burned = IERC20K(OBSYN).balanceOf(DEAD) - deadBefore;
        emit log_named_decimal_uint("OBSYN burned for 20 USDG", burned, 18);
        assertGt(burned, 0);
        assertEq(IERC20K(USDG).balanceOf(address(VAULT)), 80e6, "spent exactly the cap");
    }

    function test_skewedUsdgLegIsRefused() public {
        if (!live) return;
        ready();
        Skewer skewer = new Skewer(IUniswapV3Pool(address(USDG_POOL)), USDG);
        // USDG keeps balances in the mapping at slot 1: write it directly (cheaper on a slow fork than deal())
        vm.store(USDG, keccak256(abi.encode(address(skewer), uint256(1))), bytes32(uint256(300_000e6)));
        skewer.skew(300_000e6);
        deal(USDG, address(VAULT), 100e6);
        vm.expectRevert(BurnKeeper.UsdgPriceOffTwap.selector);
        keeper.burnUsdg();
    }

    function test_stopsIfTheRouteChanges() public {
        if (!live) return;
        ready();
        vm.mockCall(address(VAULT), abi.encodeWithSignature("adapter()"), abi.encode(address(0xBAD)));
        vm.expectRevert(BurnKeeper.WrongRoute.selector);
        keeper.burnEth();
    }

    function test_nothingToBurnBelowTheMinimum() public {
        if (!live) return;
        ready();
        vm.deal(address(VAULT), 0.00005 ether);
        vm.expectRevert(BurnKeeper.NothingToBurn.selector);
        keeper.burnEth();
        vm.expectRevert(BurnKeeper.NothingToBurn.selector);
        keeper.burnUsdg();
        // a vault holding less than the cap burns all of it
        vm.deal(address(VAULT), 0.004 ether);
        keeper.burnEth();
        assertEq(address(VAULT).balance, 0);
    }

    function test_onlyTheKeeperCanBurnOnTheVault() public {
        if (!live) return;
        vm.prank(anyone);
        vm.expectRevert();
        VAULT.burnViaAdapter(address(0), 0.01 ether, 1);
    }
}

/// @dev A vault stand-in for constructor checks.
contract FakeVault {
    function usdg() external pure returns (address) {
        return address(0x5555);
    }
}

contract FakeV3 {
    function token1() external pure returns (address) {
        return address(0x5555);
    }
}

/// @notice Constructor checks, no fork needed.
contract BurnKeeperUnitTest is Test {
    function good() internal returns (BurnKeeper.Config memory c) {
        c = BurnKeeper.Config({
            route: address(0x1),
            stateView: IPoolStateView(address(0x2)),
            tokenPoolId: bytes32(uint256(3)),
            usdgPool: IV3PoolOracle(address(new FakeV3())),
            minSnapshotAge: 600,
            maxSnapshotAge: 7200,
            bandBps: 300,
            feeAllowanceBps: 500,
            maxEthPerBurn: 0.01 ether,
            maxUsdgPerBurn: 20e6,
            minEth: 0.0001 ether,
            minUsdg: 0.5e6,
            cooldown: 1800,
            twapWindow: 600,
            maxTwapTickDeviation: 50
        });
    }

    function test_acceptsSaneLimits() public {
        BurnKeeper k = new BurnKeeper(IKeeperVault(address(new FakeVault())), good());
        assertEq(k.usdg(), address(0x5555));
        assertEq(k.bandBps(), 300);
    }

    function test_rejectsBadLimits() public {
        IKeeperVault v = IKeeperVault(address(new FakeVault()));
        BurnKeeper.Config memory c = good();
        c.maxSnapshotAge = 600;
        vm.expectRevert(BurnKeeper.BadInput.selector);
        new BurnKeeper(v, c);
        c = good();
        c.bandBps = 1_001;
        vm.expectRevert(BurnKeeper.BadInput.selector);
        new BurnKeeper(v, c);
        c = good();
        c.minEth = 1 ether; // above the cap
        vm.expectRevert(BurnKeeper.BadInput.selector);
        new BurnKeeper(v, c);
        c = good();
        c.route = address(0);
        vm.expectRevert(BurnKeeper.BadInput.selector);
        new BurnKeeper(v, c);
        c = good();
        c.usdgPool = IV3PoolOracle(address(new FakeVault())); // no token1()
        vm.expectRevert();
        new BurnKeeper(v, c);
    }
}
