// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTradingSettlementLedger {
    function currentAVSValue() external view returns (uint256);

    function recordTradingSettlement(
        bytes32 settlementId,
        int256 realizedPnL
    ) external;
}