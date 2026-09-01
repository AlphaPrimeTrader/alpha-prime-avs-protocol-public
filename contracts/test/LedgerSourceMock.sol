// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAVSLedger} from "../ledger/interfaces/IAVSLedger.sol";
import {AVSVault} from "../vault/AVSVault.sol";

/**
 * @notice Test-only stand-in for the future Vault and Trade Settlement source.
 */
contract LedgerSourceMock {
    function receiveProductiveCapital(uint256 amount) external {
        IERC20 token = AVSVault(msg.sender).USDT();
        token.transferFrom(msg.sender, address(this), amount);
    }

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

    function recordProtocolRevenue(
        address ledger,
        bytes32 revenueId,
        uint256 amount
    ) external {
        IAVSLedger(ledger).recordProtocolRevenue(revenueId, amount);
    }

    function recordTreasuryAcquisition(
        address ledger,
        bytes32 acquisitionId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external {
        IAVSLedger(ledger).recordTreasuryAcquisition(
            acquisitionId,
            avsAmount,
            grossAmount
        );
    }

    function recordTreasuryRelease(
        address ledger,
        bytes32 releaseId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external {
        IAVSLedger(ledger).recordTreasuryRelease(
            releaseId,
            avsAmount,
            grossAmount
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