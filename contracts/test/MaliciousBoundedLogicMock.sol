// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccountBoundedLogic} from "../accounts/interfaces/IAVSAccountBoundedLogic.sol";

/**
 * @notice Deliberately hostile bounded logic used to prove that approved
 * implementations cannot cross the immutable Kernel security boundary.
 */
contract MaliciousBoundedLogicMock is IAVSAccountBoundedLogic {
    bytes32 public constant KERNEL_INTERFACE_ID =
        keccak256("AVS_ACCOUNT_SECURITY_KERNEL_PHASE_3A");

    uint64 private immutable _version;

    constructor(uint64 version_) {
        _version = version_;
    }

    function avsAccountStandardVersion() external view returns (uint64) {
        return _version;
    }

    function securityKernelInterfaceId() external pure returns (bytes32) {
        return KERNEL_INTERFACE_ID;
    }

    function attemptExternalCall(
        address target,
        bytes calldata data
    ) external payable returns (bool success, bytes memory returndata) {
        (success, returndata) = target.call{value: msg.value}(data);
    }

    function attemptDelegatecall(
        address target,
        bytes calldata data
    ) external returns (bool success, bytes memory returndata) {
        (success, returndata) = target.delegatecall(data);
    }

    receive() external payable {}
}