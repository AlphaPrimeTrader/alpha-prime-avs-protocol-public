// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSMinimalToken {
    function name() external view returns (string memory);

    function totalSupply() external view returns (uint256);

    function decimals() external view returns (uint8);
}

interface IAVSLedger {
    struct CapitalRecord {
        bytes32 capitalId;
        address beneficiary;
        uint256 capitalAmount;
        uint256 sharesQuoted;
        uint256 totalSupplyBefore;
        uint256 avsValueBefore;
        uint256 timestamp;
    }

    struct SettlementRecord {
        bytes32 settlementId;
        int256 realizedPnL;
        uint256 buybackAllocation;
        int256 netEconomicImpact;
        uint256 totalSupplyAtSettlement;
        uint256 avsValueBefore;
        uint256 avsValueAfter;
        uint256 timestamp;
    }

    struct ProtocolRevenueRecord {
        bytes32 revenueId;
        uint256 amount;
        uint256 totalSupplyAtRecord;
        uint256 avsValueBefore;
        uint256 avsValueAfter;
        uint256 timestamp;
    }

    struct TreasuryAcquisitionRecord {
        bytes32 acquisitionId;
        uint256 avsAmount;
        uint256 grossAmount;
        uint256 totalSupplyBefore;
        uint256 economicSupplyBefore;
        uint256 avsValueBefore;
        uint256 avsValueAfter;
        uint256 timestamp;
    }

    struct TreasuryReleaseRecord {
        bytes32 releaseId;
        uint256 avsAmount;
        uint256 grossAmount;
        uint256 totalSupplyBefore;
        uint256 economicSupplyBefore;
        uint256 avsValueBefore;
        uint256 avsValueAfter;
        uint256 timestamp;
    }

    function ACCOUNTING_SCALE() external view returns (uint256);

    function owner() external view returns (address);

    function avsToken() external view returns (address);

    function vault() external view returns (address);

    function tradeSettlement() external view returns (address);

    function processedProtocolRevenue(bytes32 revenueId) external view returns (bool);

    function totalNetAssets() external view returns (uint256);

    function totalGrossProfit() external view returns (uint256);

    function totalLoss() external view returns (uint256);

    function totalBuybackAllocated() external view returns (uint256);

    function buybackReserve() external view returns (uint256);

    function treasuryAVS() external view returns (uint256);

    function economicSupply() external view returns (uint256);

    function processedTreasuryAcquisition(
        bytes32 acquisitionId
    ) external view returns (bool);

    function processedTreasuryRelease(
        bytes32 releaseId
    ) external view returns (bool);

    function currentAVSValue() external view returns (uint256);

    function quoteCapitalInflow(
        uint256 capitalAmount
    ) external view returns (uint256 sharesToMint);

    function bindAVSToken(address token) external;

    function configureVault(address vaultSource) external;

    function configureTradeSettlement(address tradeSettlementSource) external;

    function renounceOwnership() external;

    function recordCapitalInflow(
        bytes32 capitalId,
        address beneficiary,
        uint256 capitalAmount
    ) external returns (uint256 sharesToMint);

    function recordProtocolRevenue(bytes32 revenueId, uint256 amount) external;

    function recordTreasuryAcquisition(
        bytes32 acquisitionId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external;

    function recordTreasuryRelease(
        bytes32 releaseId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external;

    function recordTradingSettlement(
        bytes32 settlementId,
        int256 realizedPnL
    ) external;

    function settlementRecord(
        bytes32 settlementId
    ) external view returns (SettlementRecord memory);

    function capitalRecord(
        bytes32 capitalId
    ) external view returns (CapitalRecord memory);

    function protocolRevenueRecord(
        bytes32 revenueId
    ) external view returns (ProtocolRevenueRecord memory);

    function treasuryAcquisitionRecord(
        bytes32 acquisitionId
    ) external view returns (TreasuryAcquisitionRecord memory);

    function treasuryReleaseRecord(
        bytes32 releaseId
    ) external view returns (TreasuryReleaseRecord memory);
}