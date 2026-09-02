// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccessTypes} from "./IAVSAccessTypes.sol";

interface IAVSProtocolLens is IAVSAccessTypes {
    struct ProtocolSnapshot {
        uint256 blockNumber; uint256 blockTimestamp; uint256 chainId; uint256 deploymentGeneration;
        uint256 currentNAV; uint256 totalNetAssets; uint256 totalSupply; uint256 economicSupply;
        uint256 totalGrossProfit; uint256 totalLoss; uint256 totalBuybackAllocated;
        uint256 buybackReserve; uint256 treasuryAVS; uint256 settlementCount;
        uint256 marketplaceLiquidity; uint256 marketplaceInventory;
        uint256 pendingMarketplaceLiquidity; uint256 pendingTradingCapital;
        uint256 returnedTradingCapital;
    }
    struct UserSnapshot {
        uint256 blockNumber; uint256 blockTimestamp; uint256 chainId; uint256 deploymentGeneration;
        bool isWhitelisted; bool accountPolicyConfigured; uint256 avsBalance; uint256 testUSDTBalance;
        uint256 holdingsValue; uint256 avsAllowanceToMarketplace; uint256 usdtAllowanceToMarketplace;
        uint256 userOrderCount; uint256 openSellEscrow;
    }
    struct MarketplaceSnapshot {
        uint256 blockNumber; uint256 blockTimestamp; uint256 chainId; uint256 deploymentGeneration;
        uint256 orderCount; uint256 nextOrderId; uint256 userEscrowAVS; uint256 buyerEscrowUSDT;
        uint256 protocolLiquidityUSDT; uint256 protocolInventoryAVS; uint256 totalFeesCollected;
        uint256 actualAVSBalance; uint256 actualUSDTBalance;
        uint256 buyHead; uint256 buyTail; uint256 sellHead; uint256 sellTail;
        uint256 maxMatchesPerCall; uint256 maxScansPerCall;
        bool accountingSolvent;
    }
    struct WiringHealth {
        bool tokenVault; bool tokenAccountPolicy; bool ledgerToken; bool ledgerVault;
        bool ledgerSettlement; bool vaultToken; bool vaultLedger; bool vaultMarketplace;
        bool vaultSettlement; bool marketplaceToken; bool marketplaceLedger; bool marketplaceVault;
        bool marketplaceSettlement; bool settlementLedger; bool settlementVault; bool settlementMarketplace;
        bool vaultUSDT; bool marketplaceUSDT; bool settlementUSDT; bool vaultMigration;
        bool allHealthy;
        bool marketplaceAuthorized;
    }
    struct SettlementSummary {
        bytes32 settlementId; bytes32 positionId; uint64 sequence; int256 netRealizedPnlUsd;
        uint256 navAfter; uint64 recordedAt; bool finalized;
    }
    struct SettlementDetails {
        SettlementRecord record; SettlementAccounting accounting; SettlementTiming timing;
        SettlementAuthentication authentication; SettlementDisplay display; SettlementFeeBreakdown fees;
        ExecutionLeg[] legs; ExtraField[] extraFields;
    }

    function avsToken() external view returns (address);
    function testUSDT() external view returns (address);
    function ledger() external view returns (address);
    function vault() external view returns (address);
    function marketplace() external view returns (address);
    function tradingSettlement() external view returns (address);
    function accountPolicy() external view returns (address);
    function migration() external view returns (address);
    function deploymentGeneration() external view returns (uint256);
    function getProtocolSnapshot() external view returns (ProtocolSnapshot memory);
    function getUserSnapshot(address account) external view returns (UserSnapshot memory);
    function getMarketplaceSnapshot() external view returns (MarketplaceSnapshot memory);
    function getWiringHealth() external view returns (WiringHealth memory);
    function getOrder(uint256 orderId) external view returns (Order memory);
    function getOrderIds(uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory);
    function getUserOrderIds(address account, uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory);
    function getSettlement(bytes32 settlementId) external view returns (SettlementRecord memory);
    function getSettlementDetails(bytes32 settlementId) external view returns (SettlementDetails memory);
    function getSettlementSummaries(uint256 offset, uint256 limit) external view returns (SettlementSummary[] memory);
}