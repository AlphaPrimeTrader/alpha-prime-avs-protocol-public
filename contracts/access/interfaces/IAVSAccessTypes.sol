// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSAccessTypes {
    enum OrderSide { Buy, Sell }
    enum OrderType { Market, Triggered }
    enum OrderStatus { Open, Filled, Cancelled }

    struct Order {
        address owner;
        OrderSide side;
        OrderType orderType;
        OrderStatus status;
        uint256 triggerNAV;
        uint256 remainingAVS;
        uint256 remainingUSDT;
        uint256 createdAt;
        uint256 previous;
        uint256 next;
        address beneficiary;
    }

    struct MarketBuyIntent {
        address owner; address beneficiary; uint256 quantityAVS; uint256 requestedMaxMatches;
        uint256 nonce; uint256 deadline; uint256 deploymentGeneration;
    }
    struct TriggeredBuyIntent {
        address owner; address beneficiary; uint256 quantityAVS; uint256 triggerNAV;
        uint256 requestedMaxMatches; uint256 nonce; uint256 deadline; uint256 deploymentGeneration;
    }
    struct MarketSellIntent {
        address owner; address beneficiary; uint256 quantityAVS; uint256 requestedMaxMatches;
        uint256 nonce; uint256 deadline; uint256 deploymentGeneration;
    }
    struct TriggeredSellIntent {
        address owner; address beneficiary; uint256 quantityAVS; uint256 triggerNAV;
        uint256 requestedMaxMatches; uint256 nonce; uint256 deadline; uint256 deploymentGeneration;
    }
    struct CancelIntent {
        address owner; address beneficiary; uint256 orderId; uint256 nonce; uint256 deadline;
        uint256 deploymentGeneration;
    }

    struct SettlementRecord {
        bytes32 settlementId; bytes32 positionId; bytes32 executionHash; bytes32 settlementHash;
        bytes32 legsHash; bytes32 extraFieldsHash; uint64 sequence; bool finalized;
    }
    struct SettlementAccounting {
        uint256 protocolCapitalUsd; uint256 borrowedCapitalUsd; uint256 grossNotionalUsd;
        int256 grossPnlUsd; uint256 totalFeesUsd; int256 netRealizedPnlUsd;
        uint256 navBefore; uint256 navAfter;
    }
    struct SettlementTiming { uint64 openedAt; uint64 closedAt; uint64 recordedAt; }
    struct SettlementAuthentication { address tradeSigner; address serverSigner; address relayer; }
    struct SettlementDisplay {
        string strategy; string executionType; string symbol; string baseAsset; string quoteAsset;
        string venues; uint256 quantity; uint256 entryPrice; uint256 exitPrice;
        uint256 averageEntryPrice; uint64 executionMs;
    }
    struct SettlementFeeBreakdown {
        uint256 tradingFeesUsd; uint256 networkFeesUsd; uint256 financingFeesUsd; uint256 otherFeesUsd;
    }
    struct ExecutionLeg {
        uint16 legIndex; string venue; string action; string assetIn; string assetOut;
        uint256 amountIn; uint256 amountOut; uint256 executionPrice; bytes32 externalReference;
    }
    struct ExtraField { string key; string value; }
}