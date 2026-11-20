// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IKeeperVault {
    function adapter() external view returns (address);
    function usdg() external view returns (address);
    function burnViaAdapter(address asset, uint256 amountIn, uint256 minOut) external;
}

interface IPoolStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

interface IV3PoolOracle {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory);
}

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}

/// @title BurnKeeper
/// @notice The fee vault's keeper, so burns run on their own: anyone can call `burnEth` or `burnUsdg`
///         and the vault's fees buy the platform token through its current route and burn it.
///         Nobody, the caller included, can make a burn overpay:
///         - every burn is priced from a snapshot of the token pool taken at least `minSnapshotAge`
///           earlier (anyone can take one with `snapshot()`), so a same-block or same-minute price
///           pump can't set the price the vault pays;
///         - the pool's price at burn time must still be inside a band around that snapshot;
///         - the burn must receive at least the snapshot price minus `bandBps` and `feeAllowanceBps`
///           (`minOut`, enforced by the route and again by the vault), or it reverts;
///         - the USDG leg is priced from the WETH/USDG pool only while its spot is near its own TWAP;
///         - each burn is capped in size, and burns are spaced by a cooldown.
///         It only acts while the vault's route is the adapter it was deployed for.
/// @dev    No owner, no settings, holds nothing. The vault owner (a timelock) can replace the keeper.
contract BurnKeeper {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant Q96 = 2 ** 96;

    IKeeperVault public immutable vault;
    /// @notice The route this keeper was built for; it stops if the vault's route changes.
    address public immutable route;
    IPoolStateView public immutable stateView;
    /// @notice The token's v4 pool (currency0 = ETH, currency1 = token): sqrt price of tokens per ETH.
    bytes32 public immutable tokenPoolId;
    /// @notice The WETH/USDG v3 pool (token0 = WETH, token1 = USDG).
    IV3PoolOracle public immutable usdgPool;
    address public immutable usdg;

    uint256 public immutable minSnapshotAge;
    uint256 public immutable maxSnapshotAge;
    /// @notice How far the pool may be from the snapshot (in basis points of price), and how much less
    ///         than the snapshot price a burn may get for it.
    uint256 public immutable bandBps;
    /// @notice Room for pool fees and the burn's own price impact, in basis points.
    uint256 public immutable feeAllowanceBps;
    uint256 public immutable maxEthPerBurn;
    uint256 public immutable maxUsdgPerBurn;
    /// @notice Below these the vault's balance isn't worth a burn.
    uint256 public immutable minEth;
    uint256 public immutable minUsdg;
    uint256 public immutable cooldown;
    uint32 public immutable twapWindow;
    /// @notice Most the WETH/USDG spot may be from its TWAP, in ticks (1 tick ≈ 1 basis point of price).
    int24 public immutable maxTwapTickDeviation;

    uint160 public snapshotSqrtPriceX96;
    uint256 public snapshotAt;
    uint256 public lastBurnAt;

    error BadInput();
    error WrongRoute();
    error NothingToBurn();
    error Cooldown(uint256 readyAt);
    error NoSnapshot();
    error SnapshotTooNew(uint256 usableAt);
    error SnapshotTooOld();
    error SnapshotStillValid();
    error PriceMoved();
    error UsdgPriceOffTwap();

    event Snapshot(uint160 sqrtPriceX96, uint256 at);
    event BurnTriggered(address indexed asset, uint256 amountIn, uint256 minOut, address indexed caller);

    struct Config {
        address route;
        IPoolStateView stateView;
        bytes32 tokenPoolId;
        IV3PoolOracle usdgPool;
        uint256 minSnapshotAge;
        uint256 maxSnapshotAge;
        uint256 bandBps;
        uint256 feeAllowanceBps;
        uint256 maxEthPerBurn;
        uint256 maxUsdgPerBurn;
        uint256 minEth;
        uint256 minUsdg;
        uint256 cooldown;
        uint32 twapWindow;
        int24 maxTwapTickDeviation;
    }

    constructor(IKeeperVault vault_, Config memory c) {
        if (address(vault_) == address(0) || c.route == address(0) || address(c.stateView) == address(0) || address(c.usdgPool) == address(0)) {
            revert BadInput();
        }
        if (c.tokenPoolId == bytes32(0) || c.minSnapshotAge == 0 || c.maxSnapshotAge <= c.minSnapshotAge) revert BadInput();
        if (c.bandBps == 0 || c.bandBps > 1_000 || c.feeAllowanceBps > 1_000) revert BadInput();
        if (c.maxEthPerBurn == 0 || c.maxUsdgPerBurn == 0 || c.minEth == 0 || c.minUsdg == 0) revert BadInput();
        if (c.minEth > c.maxEthPerBurn || c.minUsdg > c.maxUsdgPerBurn) revert BadInput();
        if (c.twapWindow < 60 || c.maxTwapTickDeviation <= 0 || c.maxTwapTickDeviation > 500) revert BadInput();
        address u = vault_.usdg();
        if (c.usdgPool.token1() != u) revert BadInput();
        vault = vault_;
        route = c.route;
        stateView = c.stateView;
        tokenPoolId = c.tokenPoolId;
        usdgPool = c.usdgPool;
        usdg = u;
        minSnapshotAge = c.minSnapshotAge;
        maxSnapshotAge = c.maxSnapshotAge;
        bandBps = c.bandBps;
        feeAllowanceBps = c.feeAllowanceBps;
        maxEthPerBurn = c.maxEthPerBurn;
        maxUsdgPerBurn = c.maxUsdgPerBurn;
        minEth = c.minEth;
        minUsdg = c.minUsdg;
        cooldown = c.cooldown;
        twapWindow = c.twapWindow;
        maxTwapTickDeviation = c.maxTwapTickDeviation;
    }

    // ─────────────────────────── views ───────────────────────────

    function poolSqrtPrice() public view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = stateView.getSlot0(tokenPoolId);
    }

    /// @notice Whether a pool price is inside the band around the snapshot.
    function inBand(uint160 sqrtP) public view returns (bool) {
        if (snapshotAt == 0) return false;
        // price = sqrt², so the sqrt may move half as much as the price
        uint256 lo = (uint256(snapshotSqrtPriceX96) * (BPS - bandBps / 2)) / BPS;
        uint256 hi = (uint256(snapshotSqrtPriceX96) * (BPS + bandBps / 2)) / BPS;
        return sqrtP > lo && sqrtP <= hi;
    }

    /// @notice What the next burns would spend: the vault's balance up to the cap, 0 below the minimum.
    function pending() public view returns (uint256 eth, uint256 usdgAmt) {
        eth = _min(address(vault).balance, maxEthPerBurn);
        usdgAmt = _min(IERC20Balance(usdg).balanceOf(address(vault)), maxUsdgPerBurn);
        if (eth < minEth) eth = 0;
        if (usdgAmt < minUsdg) usdgAmt = 0;
    }

    /// @notice Whether a new snapshot may be taken now (none yet, stale, or the price left the band).
    function canSnapshot() public view returns (bool) {
        return snapshotAt == 0 || block.timestamp > snapshotAt + maxSnapshotAge || !inBand(poolSqrtPrice());
    }

    /// @notice Tokens at the snapshot price for `ethIn` wei, before the band and fee allowance.
    function tokensAtSnapshot(uint256 ethIn) public view returns (uint256) {
        uint256 p = snapshotSqrtPriceX96;
        return ((ethIn * p) / Q96) * p / Q96;
    }

    // ─────────────────────────── actions ───────────────────────────

    /// @notice Record the token pool's price. Anyone can call it; burns can use it once it is
    ///         `minSnapshotAge` old. It can only be replaced once stale or out of band, so nobody can
    ///         keep resetting it for free to stop burns.
    function snapshot() external {
        if (!canSnapshot()) revert SnapshotStillValid();
        uint160 p = poolSqrtPrice();
        if (p == 0) revert NoSnapshot();
        snapshotSqrtPriceX96 = p;
        snapshotAt = block.timestamp;
        emit Snapshot(p, block.timestamp);
    }

    /// @notice Burn the vault's ETH, up to the cap. Anyone can call it.
    function burnEth() external {
        _ready();
        (uint256 amt,) = pending();
        if (amt == 0) revert NothingToBurn();
        uint256 minOut = (tokensAtSnapshot(amt) * (BPS - bandBps - feeAllowanceBps)) / BPS;
        _burn(address(0), amt, minOut);
    }

    /// @notice Burn the vault's USDG, up to the cap. Anyone can call it.
    function burnUsdg() external {
        _ready();
        (, uint256 amt) = pending();
        if (amt == 0) revert NothingToBurn();
        uint256 ethIn = _usdgToEthAtSpot(amt);
        uint256 dev = uint256(uint24(maxTwapTickDeviation));
        uint256 minOut = (tokensAtSnapshot(ethIn) * (BPS - bandBps - feeAllowanceBps - dev)) / BPS;
        _burn(usdg, amt, minOut);
    }

    // ─────────────────────────── internals ───────────────────────────

    function _ready() private view {
        if (vault.adapter() != route) revert WrongRoute();
        if (lastBurnAt != 0 && block.timestamp < lastBurnAt + cooldown) revert Cooldown(lastBurnAt + cooldown);
        if (snapshotAt == 0) revert NoSnapshot();
        if (block.timestamp < snapshotAt + minSnapshotAge) revert SnapshotTooNew(snapshotAt + minSnapshotAge);
        if (block.timestamp > snapshotAt + maxSnapshotAge) revert SnapshotTooOld();
        if (!inBand(poolSqrtPrice())) revert PriceMoved();
    }

    function _burn(address asset, uint256 amt, uint256 minOut) private {
        if (minOut == 0) revert NothingToBurn();
        lastBurnAt = block.timestamp;
        vault.burnViaAdapter(asset, amt, minOut);
        emit BurnTriggered(asset, amt, minOut, msg.sender);
    }

    /// @dev USDG → ETH at the WETH/USDG spot, only while the spot is within `maxTwapTickDeviation` of its TWAP.
    function _usdgToEthAtSpot(uint256 usdgIn) private view returns (uint256) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = twapWindow;
        (int56[] memory cum,) = usdgPool.observe(ago);
        int56 delta = cum[1] - cum[0];
        int24 twapTick = int24(delta / int56(uint56(twapWindow)));
        if (delta < 0 && delta % int56(uint56(twapWindow)) != 0) twapTick--; // round toward negative infinity
        (uint160 sqrtP, int24 tick,,,,,) = usdgPool.slot0();
        int24 off = tick > twapTick ? tick - twapTick : twapTick - tick;
        if (off > maxTwapTickDeviation) revert UsdgPriceOffTwap();
        // sqrtP² / 2^192 = USDG per WETH (base units), so WETH = USDG * 2^192 / sqrtP²
        return ((usdgIn * Q96) / sqrtP) * Q96 / sqrtP;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
