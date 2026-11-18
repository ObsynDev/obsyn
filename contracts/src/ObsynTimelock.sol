// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "./vendor/openzeppelin/contracts/governance/TimelockController.sol";

/// @title ObsynTimelock
/// @notice Owner of the BuyBurnVault. Every owner action (swap route, keeper, ownership) is proposed by the
///         team Safe, waits `getMinDelay()` in public, and only then can be executed, by anyone.
/// @dev    OpenZeppelin TimelockController v5.1.0, unchanged. No admin: the delay and roles can only change
///         through the timelock itself, behind the same delay. Burns are not delayed: the vault's keeper
///         stays the Safe.
///
///         Deployed with minDelay 0 so the Safe can, in one batch: hand the vault to this contract,
///         accept ownership through it, and raise the delay. After that batch the delay is in force.
contract ObsynTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {}
}
