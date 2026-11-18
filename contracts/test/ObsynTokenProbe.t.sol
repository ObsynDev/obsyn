// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

interface IERC20P {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
}

/// @notice Probes the live $OBSYN token on a fork: does a transfer arrive whole (no tax), can it go to
///         the burn address, does transferFrom behave, and is the supply fixed. Skipped without LIVE_RPC.
contract ObsynTokenProbeTest is Test {
    IERC20P constant OBSYN = IERC20P(0x5D992fa5B7Da8EFde5FD36d24e81097Ed6aD4351);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
    }

    function test_transfersArriveWholeAndBurnWorks() public {
        if (!live) return;
        assertEq(OBSYN.decimals(), 18);
        address a = makeAddr("a");
        address b = makeAddr("b");
        address spender = makeAddr("spender");
        deal(address(OBSYN), a, 1_000_000e18);
        uint256 supply = OBSYN.totalSupply();

        vm.prank(a);
        OBSYN.transfer(b, 123_456e18);
        assertEq(OBSYN.balanceOf(b), 123_456e18, "transfer arrives whole: no tax");
        assertEq(OBSYN.balanceOf(a), 1_000_000e18 - 123_456e18, "sender loses exactly the amount");

        vm.prank(a);
        OBSYN.approve(spender, 50_000e18);
        vm.prank(spender);
        OBSYN.transferFrom(a, b, 50_000e18);
        assertEq(OBSYN.balanceOf(b), 173_456e18, "transferFrom arrives whole");

        uint256 deadBefore = OBSYN.balanceOf(DEAD);
        vm.prank(b);
        OBSYN.transfer(DEAD, 1_000e18);
        assertEq(OBSYN.balanceOf(DEAD) - deadBefore, 1_000e18, "the burn address accepts transfers");
        assertEq(OBSYN.totalSupply(), supply, "plain transfers don't change the supply");
        emit log_named_decimal_uint("total supply", supply, 18);
    }
}
