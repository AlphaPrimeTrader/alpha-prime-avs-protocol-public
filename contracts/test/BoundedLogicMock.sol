// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccountBoundedLogic} from "../accounts/interfaces/IAVSAccountBoundedLogic.sol";

contract BoundedLogicMock is IAVSAccountBoundedLogic {
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
}