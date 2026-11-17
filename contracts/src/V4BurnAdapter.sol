// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISwapAdapter} from "./BuyBurnVault.sol";

// ───────────────────── minimal Uniswap v4 interfaces ─────────────────────
// Field-for-field with v4-core (PoolKey, SwapParams, BalanceDelta packing), so the ABI matches
// the deployed PoolManager without pulling the whole library in.

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified; // negative = exact input
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    /// @return delta packed BalanceDelta for the caller (hook deltas already applied):
    ///         amount0 in the upper 128 bits, amount1 in the lower 128 bits; negative = owed by the caller
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

interface IWETH {
    function withdraw(uint256) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title V4BurnAdapter
/// @notice The fee vault's route to buy the platform token after it graduated from its Pons
///         curve to a Uniswap v4 pool. ETH fees: ETH → token on that v4 pool. USDG fees: USDG →
///         WETH on a Uniswap v3 pool (the v4 ETH/USDG pools' hooks don't take direct callers),
///         unwrapped to ETH, then ETH → token. Bought tokens go straight to `recipient` (the vault
///         passes the dead address).
/// @dev    Holds nothing between calls: whatever input a swap doesn't use goes back to the vault
///         in the same transaction. Only the vault can call `swap`. No owner, no settings:
///         every address and pool is fixed at deploy. The vault re-checks the burn
///         (`minOut` at the dead address), so a wrong route can only revert, never lose fees.
contract V4BurnAdapter is ISwapAdapter, IUnlockCallback {
    uint160 internal constant MIN_SQRT_PRICE_PLUS_ONE = 4295128740;
    uint160 internal constant V3_MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    IPoolManager public immutable poolManager;
    address public immutable vault;
    address public immutable token; // the platform token
    address public immutable usdg;

    // ETH/token pool (ETH is currency0, so buying the token is zeroForOne)
    address public immutable tokenPoolHooks;
    uint24 public immutable tokenPoolFee;
    int24 public immutable tokenPoolTickSpacing;

    // Uniswap v3 WETH/USDG pool (WETH is token0, so USDG → WETH is oneForZero)
    IUniswapV3Pool public immutable usdgPool;
    address public immutable weth;

    uint256 private _lock = 1;
    bool private _v3Expected;

    error NotVault();
    error NotPoolManager();
    error NotPool();
    error BadInput();
    error Reentrancy();
    error TransferFailed();
    error InsufficientOutput(uint256 out, uint256 minOut);

    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 tokensOut, address indexed recipient);

    constructor(
        IPoolManager poolManager_,
        address vault_,
        address token_,
        address usdg_,
        PoolKey memory tokenPool,
        IUniswapV3Pool usdgPool_,
        address weth_
    ) {
        if (address(poolManager_) == address(0) || vault_ == address(0) || token_ == address(0) || usdg_ == address(0) || weth_ == address(0)) {
            revert BadInput();
        }
        if (tokenPool.currency0 != address(0) || tokenPool.currency1 != token_) revert BadInput();
        if (usdgPool_.token0() != weth_ || usdgPool_.token1() != usdg_) revert BadInput();
        poolManager = poolManager_;
        vault = vault_;
        token = token_;
        usdg = usdg_;
        tokenPoolHooks = tokenPool.hooks;
        tokenPoolFee = tokenPool.fee;
        tokenPoolTickSpacing = tokenPool.tickSpacing;
        usdgPool = usdgPool_;
        weth = weth_;
    }

    /// @notice The vault sends ETH in, and WETH unwraps to us.
    receive() external payable {}

    function tokenPoolKey() public view returns (PoolKey memory) {
        return PoolKey(address(0), token, tokenPoolFee, tokenPoolTickSpacing, tokenPoolHooks);
    }


    /// @inheritdoc ISwapAdapter
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minOut, address recipient) external payable {
        if (msg.sender != vault) revert NotVault();
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        if (tokenOut != token || amountIn == 0 || amountIn > uint256(type(int256).max) || recipient == address(0)) revert BadInput();
        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert BadInput();
        } else {
            if (tokenIn != usdg || msg.value != 0) revert BadInput();
            _pull(usdg, msg.sender, amountIn);
        }

        uint256 ethIn = amountIn;
        if (tokenIn == usdg) ethIn = _usdgToEth(amountIn);

        uint256 before = IERC20Like(token).balanceOf(recipient);
        poolManager.unlock(abi.encode(ethIn, recipient));
        uint256 out = IERC20Like(token).balanceOf(recipient) - before;
        if (out < minOut || out == 0) revert InsufficientOutput(out, minOut);

        // Return anything a swap didn't use (e.g. it hit the price limit). Nothing stays here.
        uint256 ethLeft = address(this).balance;
        if (ethLeft != 0) {
            (bool ok,) = msg.sender.call{value: ethLeft}("");
            if (!ok) revert TransferFailed();
        }
        uint256 usdgLeft = IERC20Like(usdg).balanceOf(address(this));
        if (usdgLeft != 0) _push(usdg, msg.sender, usdgLeft);

        _lock = 1;
        emit Swapped(tokenIn, amountIn, out, recipient);
    }

    /// @notice Runs inside PoolManager.unlock: ETH → token, pay the ETH we owe, take the token.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint256 ethIn, address recipient) = abi.decode(data, (uint256, address));
        int256 d = poolManager.swap(tokenPoolKey(), SwapParams(true, -int256(ethIn), MIN_SQRT_PRICE_PLUS_ONE), "");
        (int128 ethDelta, int128 tokDelta) = _split(d);
        if (ethDelta > 0 || tokDelta <= 0) revert BadInput();
        poolManager.settle{value: uint256(uint128(-ethDelta))}();
        poolManager.take(token, recipient, uint256(uint128(tokDelta)));
        return "";
    }

    /// @dev USDG → WETH on the v3 pool (exact input), then unwrap. Returns the ETH received.
    function _usdgToEth(uint256 amountIn) private returns (uint256 ethOut) {
        _v3Expected = true;
        (int256 a0,) = usdgPool.swap(address(this), false, int256(amountIn), V3_MAX_SQRT_RATIO_MINUS_ONE, "");
        _v3Expected = false;
        if (a0 >= 0) revert BadInput();
        ethOut = uint256(-a0);
        IWETH(weth).withdraw(ethOut);
    }

    /// @notice v3 pays WETH first, then asks for the USDG here. Only during our own swap.
    function uniswapV3SwapCallback(int256, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != address(usdgPool) || !_v3Expected || amount1Delta <= 0) revert NotPool();
        _push(usdg, msg.sender, uint256(amount1Delta));
    }

    function _split(int256 d) private pure returns (int128 amount0, int128 amount1) {
        amount0 = int128(d >> 128);
        amount1 = int128(d);
    }

    function _pull(address t, address from, uint256 amt) private {
        (bool ok, bytes memory ret) = t.call(abi.encodeWithSelector(IERC20Like.transferFrom.selector, from, address(this), amt));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _push(address t, address to, uint256 amt) private {
        (bool ok, bytes memory ret) = t.call(abi.encodeWithSelector(IERC20Like.transfer.selector, to, amt));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
