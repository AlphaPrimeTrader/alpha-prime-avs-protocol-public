// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSMigrationLedger {
    function quoteCapitalInflow(
        uint256 capitalAmount
    ) external view returns (uint256 sharesToMint);

    function processedCapitalInflow(
        bytes32 capitalId
    ) external view returns (bool);
}