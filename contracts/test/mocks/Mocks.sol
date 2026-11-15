// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Minimal ERC20 + EIP-2612 permit + freeze switch (stock tokens often have a freeze authority).
contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public frozen;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(n)),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
        totalSupply += amt;
    }

    function setFrozen(address who, bool f) external {
        frozen[who] = f;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) public virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        require(block.timestamp <= deadline, "permit expired");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "bad permit");
        allowance[owner][spender] = value;
    }

    function _move(address from, address to, uint256 amt) internal virtual {
        require(!frozen[from] && !frozen[to], "frozen");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
    }
}

/// Burns 1% on every transfer.
contract FeeOnTransferToken is MockToken {
    constructor() MockToken("Taxed", "TAX", 18) {}

    function _move(address from, address to, uint256 amt) internal override {
        uint256 burn = amt / 100;
        balanceOf[from] -= amt;
        balanceOf[to] += amt - burn;
        totalSupply -= burn;
    }
}

contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function set(int256 a, uint256 t) external {
        answer = a;
        updatedAt = t;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract EthRejecter {
    receive() external payable {
        revert("no eth");
    }
}
