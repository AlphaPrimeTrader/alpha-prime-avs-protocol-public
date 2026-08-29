// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title TestReceiver
 * @notice Event-only receiver used by the Phase 2 UserOperation proof.
 */
contract TestReceiver {
    event TestExecuted(
        address indexed account,
        uint256 value,
        bytes data
    );

    function emitTest(bytes calldata data) external payable {
        emit TestExecuted(msg.sender, msg.value, data);
    }
}