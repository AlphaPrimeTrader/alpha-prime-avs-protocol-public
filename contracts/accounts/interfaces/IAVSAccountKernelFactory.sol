// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSAccountKernelFactory {
    function authority() external view returns (address);

    function evolutionController() external view returns (address);

    function entryPoint() external view returns (address);

    function consumePendingConfiguration() external returns (bytes memory);
}