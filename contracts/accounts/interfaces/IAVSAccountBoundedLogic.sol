// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSAccountBoundedLogic {
    function avsAccountStandardVersion() external view returns (uint64);

    function securityKernelInterfaceId() external view returns (bytes32);
}