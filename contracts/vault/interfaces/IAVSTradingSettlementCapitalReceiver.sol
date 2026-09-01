// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTradingSettlementCapitalReceiver {
    function receiveProductiveCapital(uint256 amount) external;
}