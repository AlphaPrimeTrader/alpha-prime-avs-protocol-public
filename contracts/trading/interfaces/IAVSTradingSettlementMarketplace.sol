// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTradingSettlementMarketplace {
    function processAfterSettlement(
        bytes32 settlementId,
        int256 netRealizedPnlUsd,
        uint256 navAfter
    ) external;
}