// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BuyBurnVault, ISwapAdapter} from "../src/BuyBurnVault.sol";
import {ObsynTimelock} from "../src/ObsynTimelock.sol";

/// @notice Moving the live fee vault's ownership from the team Safe to a timelock, on a fork of the live
///         chain: the real vault, the real Safe and the queued V4 burn route.
///         Skipped unless LIVE_RPC is set:
///         LIVE_RPC=https://4663.rpc.thirdweb.com forge test --match-contract ObsynTimelock -vv
contract ObsynTimelockLiveTest is Test {
    BuyBurnVault constant VAULT = BuyBurnVault(payable(0x2afdacda8B3D45F82c42e43Ae9D9651f218b4221));
    address constant SAFE = 0x48d8970b6498dFA99CA47F117c4d0AA5A445833E;
    uint256 constant DELAY = 3 days;

    ObsynTimelock tl;
    bool live;

    function setUp() public {
        string memory rpc = vm.envOr("LIVE_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        assertEq(VAULT.owner(), SAFE, "the Safe owns the vault today");

        // tomorrow: the queued V4 route is switched on by the Safe, before the timelock goes in
        if (address(VAULT.adapter()) == address(0) && address(VAULT.pendingAdapter()) != address(0)) {
            vm.warp(VAULT.pendingAdapterEta() + 1);
            vm.prank(SAFE);
            VAULT.applyAdapter();
        }

        address[] memory proposers = new address[](1);
        proposers[0] = SAFE;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone may execute an operation once its delay has passed
        tl = new ObsynTimelock(0, proposers, executors);
    }

    /// The Safe's one batch: hand over the vault, accept it through the timelock, raise the delay.
    function migrate() internal {
        vm.startPrank(SAFE);
        VAULT.transferOwnership(address(tl));
        (address[] memory t, uint256[] memory v, bytes[] memory d) = acceptBatch();
        tl.scheduleBatch(t, v, d, bytes32(0), bytes32(0), 0);
        tl.executeBatch(t, v, d, bytes32(0), bytes32(0));
        vm.stopPrank();
    }

    function acceptBatch() internal view returns (address[] memory t, uint256[] memory v, bytes[] memory d) {
        t = new address[](2);
        v = new uint256[](2);
        d = new bytes[](2);
        t[0] = address(VAULT);
        d[0] = abi.encodeCall(BuyBurnVault.acceptOwnership, ());
        t[1] = address(tl);
        d[1] = abi.encodeCall(tl.updateDelay, (DELAY));
    }

    function test_migrationInOneBatch() public {
        if (!live) return;
        migrate();
        assertEq(VAULT.owner(), address(tl), "the timelock owns the vault");
        assertEq(VAULT.pendingOwner(), address(0));
        assertEq(VAULT.keeper(), SAFE, "burns stay with the Safe");
        assertEq(tl.getMinDelay(), DELAY, "the delay is in force right after the batch");
    }

    function test_theSafeCanNoLongerActDirectly() public {
        if (!live) return;
        migrate();
        vm.startPrank(SAFE);
        vm.expectRevert();
        VAULT.setKeeper(address(0xBEEF));
        vm.expectRevert();
        VAULT.queueAdapter(ISwapAdapter(address(0xBEEF)));
        vm.expectRevert();
        VAULT.transferOwnership(SAFE);
        vm.stopPrank();
    }

    function test_everyChangeWaitsInPublic() public {
        if (!live) return;
        migrate();
        bytes memory call = abi.encodeCall(BuyBurnVault.setKeeper, (address(0xBEEF)));
        vm.startPrank(SAFE);
        vm.expectRevert(); // shorter than the delay
        tl.schedule(address(VAULT), 0, call, bytes32(0), bytes32("k"), DELAY - 1);
        tl.schedule(address(VAULT), 0, call, bytes32(0), bytes32("k"), DELAY);
        vm.stopPrank();

        vm.expectRevert(); // not ready yet
        tl.execute(address(VAULT), 0, call, bytes32(0), bytes32("k"));
        vm.warp(block.timestamp + DELAY);
        vm.prank(address(0xCAFE)); // anyone can execute once ready
        tl.execute(address(VAULT), 0, call, bytes32(0), bytes32("k"));
        assertEq(VAULT.keeper(), address(0xBEEF));
    }

    function test_aRouteChangeTakesTheTimelockPlusTheVaultsOwnWait() public {
        if (!live) return;
        migrate();
        address next = address(0xADA);
        bytes memory q = abi.encodeCall(BuyBurnVault.queueAdapter, (ISwapAdapter(next)));
        bytes memory a = abi.encodeCall(BuyBurnVault.applyAdapter, ());
        vm.prank(SAFE);
        tl.schedule(address(VAULT), 0, q, bytes32(0), bytes32("q"), DELAY);
        vm.warp(block.timestamp + DELAY);
        tl.execute(address(VAULT), 0, q, bytes32(0), bytes32("q"));
        assertEq(address(VAULT.pendingAdapter()), next);

        vm.prank(SAFE);
        tl.schedule(address(VAULT), 0, a, bytes32(0), bytes32("a"), DELAY);
        vm.warp(block.timestamp + DELAY);
        tl.execute(address(VAULT), 0, a, bytes32(0), bytes32("a"));
        assertEq(address(VAULT.adapter()), next, "3 days in the timelock, then the vault's own 2-day wait already passed");
    }

    function test_burnsStayInstant() public {
        if (!live) return;
        migrate();
        if (address(VAULT.adapter()) == address(0)) return; // no route on this fork
        vm.deal(address(VAULT), 0.02 ether);
        uint256 before = VAULT.totalBurned();
        vm.prank(SAFE);
        VAULT.burnViaAdapter(address(0), 0.02 ether, 1);
        assertGt(VAULT.totalBurned(), before, "the Safe still burns without waiting");
    }

    function test_onlyTheSafeProposesAndItCanCancel() public {
        if (!live) return;
        migrate();
        bytes memory call = abi.encodeCall(BuyBurnVault.setKeeper, (address(0xBEEF)));
        vm.prank(address(0xBAD));
        vm.expectRevert();
        tl.schedule(address(VAULT), 0, call, bytes32(0), bytes32("x"), DELAY);

        vm.prank(SAFE);
        tl.schedule(address(VAULT), 0, call, bytes32(0), bytes32("x"), DELAY);
        bytes32 id = tl.hashOperation(address(VAULT), 0, call, bytes32(0), bytes32("x"));
        vm.prank(address(0xBAD));
        vm.expectRevert();
        tl.cancel(id);
        vm.prank(SAFE);
        tl.cancel(id);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert();
        tl.execute(address(VAULT), 0, call, bytes32(0), bytes32("x"));
        assertEq(VAULT.keeper(), SAFE);
    }

    function test_noAdminAndTheDelayItselfIsTimelocked() public {
        if (!live) return;
        migrate();
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), SAFE), "the Safe is not an admin");
        assertTrue(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), address(tl)), "only the timelock administers itself");
        vm.prank(SAFE);
        vm.expectRevert();
        tl.updateDelay(0); // only through a delayed operation
        bytes32 proposer = tl.PROPOSER_ROLE(); // read before prank/expectRevert, which apply to the next call
        vm.prank(SAFE);
        vm.expectRevert();
        tl.grantRole(proposer, address(0xBAD));
    }
}
