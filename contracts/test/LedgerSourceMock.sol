// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSLedger} from "../ledger/interfaces/IAVSLedger.sol";

/**
 * @notice Test-only stand-in for the future Vault and Trade Settlement source.
 */
contract LedgerSourceMock {
    function recordCapitalInflow(
        address ledger,
        bytes32 capitalId,
        address beneficiary,
        uint256 capitalAmount
    ) external returns (uint256 sharesToMint) {
        return
            IAVSLedger(ledger).recordCapitalInflow(
                capitalId,
                beneficiary,
                capitalAmount
            );
    }

    function recordTradingSettlement(
        address ledger,
        bytes32 settlementId,
        int256 realizedPnL
    ) external {
        IAVSLedger(ledger).recordTradingSettlement(
            settlementId,
            realizedPnL
        );
    }
}