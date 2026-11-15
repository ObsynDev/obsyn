// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @dev Pons V2 bonding curve, per docs.ponsfamily.com/v2. NOT verified against on-chain
///      source yet (explorers returned 403). Verify before mainnet deploy.
interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function pairToken() external view returns (address);
    function isNativeQuote() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function graduated() external view returns (bool);
    function currentSnipeTaxBps(address recipient) external view returns (uint256);
}

/// @notice Swaps `amountIn` of `tokenIn` (address(0) = ETH) into the platform token and
///         sends it to `recipient`. Used for the non-pair fee currency and for buying from
///         the Uniswap v4 pool after graduation.
interface ISwapAdapter {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minOut, address recipient)
        external
        payable;
}

/// @title BuyBurnVault
/// @notice Receives OTC fees (ETH and USDG) and can only spend them one way: buying the
///         platform token and sending it to the dead address.
/// @dev    Nobody can withdraw ETH or USDG. Every spend path checks that the dead address
///         received at least `minOut` tokens. The owner (use a multisig) can only rotate the
///         keeper and, behind a 2-day timelock, the swap adapter. The OTC escrow itself stays
///         adminless; this vault only ever holds protocol fees, never user deposits.
contract BuyBurnVault {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant ADAPTER_DELAY = 2 days;

    address public immutable usdg;

    /// @notice Platform token. Unset (address(0)) until launch; set once via setPlatformToken.
    address public token;
    /// @notice Its Pons bonding curve, or address(0) if bought only through the adapter.
    IPonsCurve public curve;
    /// @notice Holding at least this much of `token` lowers OTC fees (read by the escrow).
    uint256 public discountMinBalance;

    address public owner;
    address public pendingOwner;
    address public keeper;
    ISwapAdapter public adapter;
    ISwapAdapter public pendingAdapter;
    uint256 public pendingAdapterEta;

    uint256 public totalBurned;
    uint256 private _lock = 1;

    event Burned(address indexed via, address indexed spent, uint256 amountIn, uint256 tokensBurned);
    event KeeperSet(address keeper);
    event OwnerSet(address owner);
    event AdapterQueued(address adapter, uint256 eta);
    event AdapterSet(address adapter);
    event PlatformTokenSet(address token, address curve, uint256 discountMinBalance);

    error NotOwner();
    error NotKeeper();
    error Reentrancy();
    error BadAsset();
    error CurveClosed();
    error SnipeTaxActive();
    error NoAdapter();
    error TooEarly();
    error InsufficientBurn();
    error ApproveFailed();
    error TokenNotSet();
    error TokenAlreadySet();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner) revert NotKeeper();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @dev Deploy before the platform token exists. Fees accumulate here (and can't be
    ///      withdrawn) until the owner calls setPlatformToken once.
    constructor(address usdg_, address owner_, address keeper_) {
        usdg = usdg_;
        owner = owner_;
        keeper = keeper_;
    }

    receive() external payable {}

    /// @notice One-time hookup after the token launches. Irreversible.
    /// @param curve_ The token's Pons bonding curve, or address(0) if there is none.
    /// @param discountMinBalance_ Holding this much gives the OTC fee discount; 0 disables it.
    function setPlatformToken(address token_, address curve_, uint256 discountMinBalance_) external onlyOwner {
        if (token != address(0)) revert TokenAlreadySet();
        if (token_ == address(0) || token_ == usdg) revert BadAsset();
        if (curve_ != address(0)) {
            // The token must be paired with ETH or USDG on Pons.
            address pair = IPonsCurve(curve_).pairToken();
            if (pair != address(0) && pair != usdg) revert BadAsset();
        }
        token = token_;
        curve = IPonsCurve(curve_);
        discountMinBalance = discountMinBalance_;
        emit PlatformTokenSet(token_, curve_, discountMinBalance_);
    }

    // ─────────────────────────── views ───────────────────────────

    /// @notice What the escrow reads to apply the holder discount. (address(0), 0) until the token is set.
    function discountConfig() external view returns (address, uint256) {
        return (discountMinBalance == 0 ? address(0) : token, discountMinBalance);
    }

    /// @notice The fee asset the curve takes (address(0) = ETH).
    function pairAsset() public view returns (address) {
        return curve.isNativeQuote() ? address(0) : curve.pairToken();
    }

    function curveOpen() public view returns (bool) {
        return address(curve) != address(0) && !curve.graduated() && !curve.readyToGraduate();
    }

    function balances() external view returns (uint256 eth, uint256 usdgBal) {
        return (address(this).balance, IERC20Min(usdg).balanceOf(address(this)));
    }

    // ─────────────────────────── burns ───────────────────────────

    /// @notice Before graduation: buy on the Pons curve with the pair asset, tokens go straight to DEAD.
    /// @param minOut Computed off-chain from curve reserves; protects against sandwiching.
    function burnViaCurve(uint256 quoteIn, uint256 minOut) external onlyKeeper nonReentrant {
        if (!curveOpen()) revert CurveClosed();
        if (curve.currentSnipeTaxBps(DEAD) != 0) revert SnipeTaxActive();

        uint256 before = IERC20Min(token).balanceOf(DEAD);
        address pair = pairAsset();
        if (pair == address(0)) {
            curve.buy{value: quoteIn}(quoteIn, minOut, DEAD);
        } else {
            _approve(pair, address(curve), quoteIn);
            curve.buy(quoteIn, minOut, DEAD);
            _approve(pair, address(curve), 0);
        }
        _checkBurn(before, minOut, address(curve), pair, quoteIn);
    }

    /// @notice Any phase: swap ETH or USDG through the adapter (e.g. the non-pair currency,
    ///         or the Uniswap v4 pool after graduation). Tokens go straight to DEAD.
    function burnViaAdapter(address asset, uint256 amountIn, uint256 minOut) external onlyKeeper nonReentrant {
        if (token == address(0)) revert TokenNotSet();
        if (asset != address(0) && asset != usdg) revert BadAsset();
        ISwapAdapter a = adapter;
        if (address(a) == address(0)) revert NoAdapter();

        uint256 before = IERC20Min(token).balanceOf(DEAD);
        if (asset == address(0)) {
            a.swap{value: amountIn}(address(0), amountIn, token, minOut, DEAD);
        } else {
            _approve(asset, address(a), amountIn);
            a.swap(asset, amountIn, token, minOut, DEAD);
            _approve(asset, address(a), 0);
        }
        _checkBurn(before, minOut, address(a), asset, amountIn);
    }

    // ─────────────────────────── admin ───────────────────────────

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Two-step handover: a typo'd address can never take ownership.
    function transferOwnership(address o) external onlyOwner {
        pendingOwner = o;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnerSet(msg.sender);
    }

    function queueAdapter(ISwapAdapter a) external onlyOwner {
        pendingAdapter = a;
        pendingAdapterEta = block.timestamp + ADAPTER_DELAY;
        emit AdapterQueued(address(a), pendingAdapterEta);
    }

    function applyAdapter() external onlyOwner {
        if (pendingAdapterEta == 0 || block.timestamp < pendingAdapterEta) revert TooEarly();
        adapter = pendingAdapter;
        pendingAdapterEta = 0;
        emit AdapterSet(address(adapter));
    }

    // ───────────────────────── internals ─────────────────────────

    function _checkBurn(uint256 before, uint256 minOut, address via, address spent, uint256 amountIn) private {
        uint256 burned = IERC20Min(token).balanceOf(DEAD) - before;
        if (burned < minOut || burned == 0) revert InsufficientBurn();
        totalBurned += burned;
        emit Burned(via, spent, amountIn, burned);
    }

    function _approve(address t, address spender, uint256 amt) private {
        (bool ok, bytes memory ret) = t.call(abi.encodeWithSelector(IERC20Min.approve.selector, spender, amt));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert ApproveFailed();
    }
}
