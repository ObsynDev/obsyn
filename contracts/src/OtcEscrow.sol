// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title OtcEscrow
/// @notice Non-custodial escrow for private OTC block trades.
///         Buyer deposits payment (ETH or USDG), seller deposits tokens. The second
///         deposit settles both sides atomically. If the deadline passes first,
///         anyone can trigger refunds of whatever was deposited.
/// @dev    No owner, no admin key, no pause, no upgrade. All configuration is immutable.
///         Deal terms are not stored: every call passes the full terms and the deal id
///         is their hash, so a deal can't be changed once someone has deposited into it.
contract OtcEscrow {
    // ───────────────────────────── types ─────────────────────────────

    struct Terms {
        address buyer; // deposits payment, receives tokens
        address seller; // deposits tokens (may be a one-time "ghost" wallet)
        address token; // token being sold
        uint256 amount; // token amount
        address payToken; // address(0) = native ETH, otherwise must be USDG
        uint256 price; // total payment in payToken units
        address sellerPayout; // where proceeds go (a fresh address in ghost mode)
        address referrer; // earns half the protocol fee; address(0) = none
        uint256 relayerFee; // paid out of seller proceeds to the relayer that deposited for the seller
        uint64 deadline; // unix seconds; deposits must land before this
        bytes32 salt; // makes otherwise identical deals distinct
    }

    struct Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    enum Status {
        None,
        Open,
        Settled,
        Refunded
    }

    struct Deal {
        Status status;
        bool buyerFunded;
        bool sellerFunded;
        address relayer; // set when the seller side was deposited by a relayer
    }

    // ──────────────────────────── constants ──────────────────────────

    uint256 public constant MAX_FEE_BPS = 250; // hard cap: 2.5%
    uint256 public constant FEE_BPS_SMALL = 250; // < $10k
    uint256 public constant FEE_BPS_MID = 200; // >= $10k
    uint256 public constant FEE_BPS_LARGE = 150; // >= $100k
    uint256 public constant TIER_MID_USD = 10_000;
    uint256 public constant TIER_LARGE_USD = 100_000;
    uint256 public constant HOLDER_DISCOUNT_BPS = 50; // fee - 0.5% when a party holds the platform token
    uint256 public constant MAX_PRICE_AGE = 1 hours;
    uint256 private constant BPS = 10_000;
    uint256 private constant SECP256K1N_HALF = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 private constant DEPOSIT_TYPEHASH = keccak256("Deposit(bytes32 dealId,address relayer)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // ──────────────────────────── immutables ─────────────────────────

    address public immutable usdg;
    uint8 public immutable usdgDecimals;
    IPriceFeed public immutable ethUsdFeed; // may be address(0): ETH deals then pay the top fee tier
    uint8 public immutable ethUsdDecimals;
    /// @notice Receives protocol fees, normally the BuyBurnVault. If it is a contract exposing
    ///         `discountConfig() returns (address token, uint256 minBalance)`, holders of that token
    ///         get the fee discount. This lets the platform token be plugged in after the escrow
    ///         is deployed, without giving the escrow an admin.
    address public immutable feeRecipient;

    uint256 private immutable _initialChainId;
    bytes32 private immutable _initialDomainSeparator;

    // ───────────────────────────── storage ───────────────────────────

    mapping(bytes32 => Deal) public deals;
    /// @notice ETH that couldn't be pushed (recipient reverted). Claim with withdraw().
    mapping(address => uint256) public owedEth;

    uint256 private _lock = 1;

    // ───────────────────────────── events ────────────────────────────

    event Deposited(bytes32 indexed dealId, address indexed from, bool indexed sellerSide);
    event Settled(
        bytes32 indexed dealId, uint256 protocolFee, uint256 referrerFee, uint256 relayerFee, uint256 sellerProceeds
    );
    event Refunded(bytes32 indexed dealId);
    event EthOwed(address indexed to, uint256 amount);

    // ───────────────────────────── errors ────────────────────────────

    error Reentrancy();
    error BadTerms();
    error Expired();
    error NotExpired();
    error NotBuyer();
    error NotSeller();
    error AlreadyFunded();
    error NotOpen();
    error BadValue();
    error BadSignature();
    error FeeOnTransfer();
    error TransferFailed();
    error NothingOwed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address usdg_, address ethUsdFeed_, address feeRecipient_) {
        if (usdg_ == address(0) || feeRecipient_ == address(0)) revert BadTerms();
        usdg = usdg_;
        usdgDecimals = IERC20(usdg_).decimals();
        ethUsdFeed = IPriceFeed(ethUsdFeed_);
        uint8 feedDecimals = ethUsdFeed_ == address(0) ? 0 : IPriceFeed(ethUsdFeed_).decimals();
        if (feedDecimals > 36) revert BadTerms();
        ethUsdDecimals = feedDecimals;
        feeRecipient = feeRecipient_;
        _initialChainId = block.chainid;
        _initialDomainSeparator = _buildDomainSeparator();
    }

    // ───────────────────────────── views ─────────────────────────────

    function dealId(Terms calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode(t));
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _initialChainId ? _initialDomainSeparator : _buildDomainSeparator();
    }

    /// @notice Protocol fee in bps for a payment of `price` in `payToken`.
    function feeBps(address payToken, uint256 price) public view returns (uint256) {
        uint256 usd = _usdValue(payToken, price);
        if (usd >= TIER_LARGE_USD) return FEE_BPS_LARGE;
        if (usd >= TIER_MID_USD) return FEE_BPS_MID;
        return FEE_BPS_SMALL;
    }

    /// @notice Breakdown of what settlement would pay out.
    function quoteSettlement(Terms calldata t)
        public
        view
        returns (uint256 protocolFee, uint256 referrerFee, uint256 sellerProceeds)
    {
        uint256 bps = feeBps(t.payToken, t.price);
        (address dToken, uint256 dMin) = discountConfig();
        if (dToken != address(0) && (_holds(dToken, t.buyer, dMin) || _holds(dToken, t.seller, dMin))) {
            bps -= HOLDER_DISCOUNT_BPS;
        }
        uint256 fee = (t.price * bps) / BPS;
        referrerFee = t.referrer == address(0) ? 0 : fee / 2;
        protocolFee = fee - referrerFee;
        sellerProceeds = t.price - fee - t.relayerFee;
    }

    // ──────────────────────────── deposits ───────────────────────────

    /// @notice Buyer deposits the payment. Send ETH with the call for ETH deals.
    function depositPayment(Terms calldata t) external payable nonReentrant {
        if (msg.sender != t.buyer) revert NotBuyer();
        (bytes32 id, Deal storage d) = _open(t);
        if (d.buyerFunded) revert AlreadyFunded();
        d.buyerFunded = true;

        if (t.payToken == address(0)) {
            if (msg.value != t.price) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            _pullExact(t.payToken, msg.sender, t.price);
        }
        emit Deposited(id, msg.sender, false);
        if (d.sellerFunded) _settle(id, d, t);
    }

    /// @notice Seller deposits the tokens directly (seller pays gas).
    function depositTokens(Terms calldata t) external nonReentrant {
        if (msg.sender != t.seller) revert NotSeller();
        (bytes32 id, Deal storage d) = _open(t);
        if (d.sellerFunded) revert AlreadyFunded();
        d.sellerFunded = true;

        _pullExact(t.token, t.seller, t.amount);
        emit Deposited(id, t.seller, true);
        if (d.buyerFunded) _settle(id, d, t);
    }

    /// @notice Gasless "ghost" deposit: a relayer submits the seller's signed authorization
    ///         (plus an optional EIP-2612 permit). The relayer earns `t.relayerFee` at settlement.
    /// @param permit Pass deadline = 0 to skip the permit (seller already approved this contract).
    function depositTokensFor(Terms calldata t, Permit calldata permit, bytes calldata sellerSig)
        external
        nonReentrant
    {
        (bytes32 id, Deal storage d) = _open(t);
        if (d.sellerFunded) revert AlreadyFunded();

        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), keccak256(abi.encode(DEPOSIT_TYPEHASH, id, msg.sender))));
        if (_recover(digest, sellerSig) != t.seller) revert BadSignature();

        d.sellerFunded = true;
        d.relayer = msg.sender;

        if (permit.deadline != 0) {
            // A front-run permit would make this call revert; the allowance check in
            // transferFrom is what actually matters, so a failure here is ignored.
            try IERC20Permit(t.token).permit(
                t.seller, address(this), t.amount, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {}
        }
        _pullExact(t.token, t.seller, t.amount);
        emit Deposited(id, t.seller, true);
        if (d.buyerFunded) _settle(id, d, t);
    }

    // ───────────────────────────── refunds ───────────────────────────

    /// @notice After the deadline, return whatever was deposited. Callable by anyone.
    /// @dev    Each side is refunded independently: if one token transfer fails (e.g. a
    ///         frozen stock token), the other side still gets its money back and the
    ///         failed side can be retried later.
    function refund(Terms calldata t) external nonReentrant {
        if (block.timestamp < t.deadline) revert NotExpired();
        bytes32 id = dealId(t);
        Deal storage d = deals[id];
        if (d.status != Status.Open) revert NotOpen();

        if (d.buyerFunded) {
            d.buyerFunded = false;
            if (t.payToken == address(0)) _pay(address(0), t.buyer, t.price);
            else if (!_tryPush(t.payToken, t.buyer, t.price)) d.buyerFunded = true;
        }
        if (d.sellerFunded) {
            d.sellerFunded = false;
            if (!_tryPush(t.token, t.seller, t.amount)) d.sellerFunded = true;
        }
        // Partial refund: the deal stays Open (deposits are impossible past the deadline)
        // so the stuck side can call refund() again once its transfer works.
        if (d.buyerFunded || d.sellerFunded) return;
        d.status = Status.Refunded;
        emit Refunded(id);
    }

    /// @notice Claim ETH that couldn't be pushed to you.
    function withdraw() external nonReentrant {
        uint256 amt = owedEth[msg.sender];
        if (amt == 0) revert NothingOwed();
        owedEth[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────────────────────── internals ─────────────────────────

    function _open(Terms calldata t) private returns (bytes32 id, Deal storage d) {
        if (block.timestamp >= t.deadline) revert Expired();
        id = dealId(t);
        d = deals[id];
        if (d.status == Status.None) {
            _validate(t);
            d.status = Status.Open;
        } else if (d.status != Status.Open) {
            revert NotOpen();
        }
    }

    function _validate(Terms calldata t) private view {
        if (
            t.buyer == address(0) || t.seller == address(0) || t.sellerPayout == address(0) || t.token == address(0)
                || t.amount == 0 || t.price == 0 || t.token == t.payToken || t.token == usdg
                || (t.payToken != address(0) && t.payToken != usdg)
        ) revert BadTerms();
        // relayer fee must leave something for the seller even at the max protocol fee
        if (t.relayerFee + (t.price * MAX_FEE_BPS) / BPS >= t.price) revert BadTerms();
    }

    function _settle(bytes32 id, Deal storage d, Terms calldata t) private {
        d.status = Status.Settled;
        (uint256 protocolFee, uint256 referrerFee, uint256 sellerProceeds) = quoteSettlement(t);

        // relayer fee only applies when a relayer actually did the seller deposit
        uint256 relayerFee = d.relayer == address(0) ? 0 : t.relayerFee;
        sellerProceeds += t.relayerFee - relayerFee;

        emit Settled(id, protocolFee, referrerFee, relayerFee, sellerProceeds);

        _push(t.token, t.buyer, t.amount);
        _pay(t.payToken, t.sellerPayout, sellerProceeds);
        if (protocolFee != 0) _pay(t.payToken, feeRecipient, protocolFee);
        if (referrerFee != 0) _pay(t.payToken, t.referrer, referrerFee);
        if (relayerFee != 0) _pay(t.payToken, d.relayer, relayerFee);
    }

    /// @notice Holder-discount token and threshold, read from the fee recipient.
    ///         (address(0), 0) when the recipient is an EOA, doesn't implement it, or hasn't set a token.
    function discountConfig() public view returns (address token, uint256 minBalance) {
        if (feeRecipient.code.length == 0) return (address(0), 0);
        (bool ok, bytes memory ret) =
            feeRecipient.staticcall{gas: 30_000}(abi.encodeWithSignature("discountConfig()"));
        if (!ok || ret.length != 64) return (address(0), 0);
        (token, minBalance) = abi.decode(ret, (address, uint256));
        if (minBalance == 0 || token.code.length == 0) return (address(0), 0);
    }

    function _holds(address token, address who, uint256 minBalance) private view returns (bool) {
        (bool ok, bytes memory ret) =
            token.staticcall{gas: 50_000}(abi.encodeWithSelector(IERC20.balanceOf.selector, who));
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) >= minBalance;
    }

    function _usdValue(address payToken, uint256 price) private view returns (uint256) {
        if (payToken == usdg) return price / (10 ** usdgDecimals);
        if (address(ethUsdFeed) == address(0)) return 0;
        try ethUsdFeed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            // Any odd reading (non-positive, future-dated, stale, absurd) falls back to the top tier
            // instead of reverting: a broken feed must never block settlement of an immutable escrow.
            if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_PRICE_AGE) return 0;
            if (uint256(answer) > 1e30 || price > 1e40) return 0;
            return (price * uint256(answer)) / (10 ** (18 + uint256(ethUsdDecimals)));
        } catch {
            return 0; // no usable price: top fee tier
        }
    }

    /// @dev Pay out in the payment currency. ETH that can't be delivered is credited instead
    ///      of reverting, so one bad recipient can't block settlement for everyone else.
    function _pay(address payToken, address to, uint256 amt) private {
        if (payToken != address(0)) return _push(payToken, to, amt);
        (bool ok,) = to.call{value: amt, gas: 50_000}("");
        if (!ok) {
            owedEth[to] += amt;
            emit EthOwed(to, amt);
        }
    }

    function _pullExact(address token, address from, uint256 amt) private {
        uint256 before = IERC20(token).balanceOf(address(this));
        _call(token, abi.encodeWithSelector(0x23b872dd, from, address(this), amt)); // transferFrom
        if (IERC20(token).balanceOf(address(this)) - before != amt) revert FeeOnTransfer();
    }

    function _push(address token, address to, uint256 amt) private {
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amt)); // transfer
    }

    function _tryPush(address token, address to, uint256 amt) private returns (bool) {
        if (token.code.length == 0) return false;
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amt));
        return ok && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (bool))));
    }

    function _call(address token, bytes memory data) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > SECP256K1N_HALF || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Obsyn"), keccak256("1"), block.chainid, address(this))
        );
    }
}
