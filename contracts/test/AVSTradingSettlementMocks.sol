// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISettlementCapitalReceiver {
    function receiveProductiveCapital(uint256 amount) external;
}

contract TradingSettlementLedgerMock {
    uint256 public nav;
    bytes32 public lastSettlementId;
    int256 public lastRealizedPnl;
    uint256 public callCount;
    bool public shouldRevert;

    constructor(uint256 initialNav) {
        nav = initialNav;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function currentAVSValue() external view returns (uint256) {
        return nav;
    }

    function recordTradingSettlement(
        bytes32 settlementId,
        int256 realizedPnl
    ) external {
        if (shouldRevert) revert("LEDGER_REVERT");
        lastSettlementId = settlementId;
        lastRealizedPnl = realizedPnl;
        callCount += 1;
        if (realizedPnl >= 0) {
            nav += uint256(realizedPnl);
        } else {
            nav -= uint256(-realizedPnl);
        }
    }
}

contract TradingSettlementMarketplaceMock {
    bool public shouldRevert;
    bytes32 public lastSettlementId;
    int256 public lastNetPnl;
    uint256 public lastNav;
    uint256 public callCount;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function processAfterSettlement(
        bytes32 settlementId,
        int256 netRealizedPnlUsd,
        uint256 navAfter
    ) external {
        if (shouldRevert) revert("MARKETPLACE_REVERT");
        lastSettlementId = settlementId;
        lastNetPnl = netRealizedPnlUsd;
        lastNav = navAfter;
        callCount += 1;
    }
}

contract PlainTradingDestination {}

contract TradingSettlementVaultMock {
    function forwardCapital(
        address token,
        address settlement,
        uint256 amount
    ) external {
        IERC20(token).approve(settlement, amount);
        ISettlementCapitalReceiver(settlement).receiveProductiveCapital(
            amount
        );
    }
}