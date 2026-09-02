// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccessTypes} from "./IAVSAccessTypes.sol";

interface IAVSMarketplaceAccess is IAVSAccessTypes {
    function DEPLOYMENT_GENERATION() external view returns (uint256);
    function AVS() external view returns (address);
    function USDT() external view returns (address);
    function ledger() external view returns (address);
    function vault() external view returns (address);
    function settlementHook() external view returns (address);
    function orderCount() external view returns (uint256);
    function nextOrderId() external view returns (uint256);
    function userEscrowAVS() external view returns (uint256);
    function buyerEscrowUSDT() external view returns (uint256);
    function protocolLiquidityUSDT() external view returns (uint256);
    function protocolInventoryAVS() external view returns (uint256);
    function totalFeesCollected() external view returns (uint256);
    function buyHead() external view returns (uint256);
    function buyTail() external view returns (uint256);
    function sellHead() external view returns (uint256);
    function sellTail() external view returns (uint256);
    function maxMatchesPerCall() external view returns (uint256);
    function maxScansPerCall() external view returns (uint256);
    function userOpenSellEscrow(address) external view returns (uint256);
    function userOrderCount(address) external view returns (uint256);
    function orders(uint256) external view returns (Order memory);
    function accountingSolvent() external view returns (bool);
    function getOrderIds(uint256, uint256, bool) external view returns (uint256[] memory);
    function getUserOrderIds(address, uint256, uint256, bool) external view returns (uint256[] memory);
    function syncProtocolLiquidity() external returns (uint256);
    function placeMarketBuyWithSignature(MarketBuyIntent calldata, bytes calldata) external returns (uint256);
    function placeTriggeredBuyWithSignature(TriggeredBuyIntent calldata, bytes calldata) external returns (uint256);
    function placeMarketSellWithSignature(MarketSellIntent calldata, bytes calldata) external returns (uint256);
    function placeTriggeredSellWithSignature(TriggeredSellIntent calldata, bytes calldata) external returns (uint256);
    function cancelOrderWithSignature(CancelIntent calldata, bytes calldata) external;
}

interface IAVSSettlementAccess is IAVSAccessTypes {
    function USDT() external view returns (address);
    function avsLedger() external view returns (address);
    function vault() external view returns (address);
    function marketplace() external view returns (address);
    function settlementCount() external view returns (uint256);
    function settlementIdAt(uint256) external view returns (bytes32);
    function getSettlement(bytes32) external view returns (SettlementRecord memory);
    function getSettlementAccounting(bytes32) external view returns (SettlementAccounting memory);
    function getSettlementTiming(bytes32) external view returns (SettlementTiming memory);
    function getSettlementAuthentication(bytes32) external view returns (SettlementAuthentication memory);
    function getSettlementDisplay(bytes32) external view returns (SettlementDisplay memory);
    function getSettlementFeeBreakdown(bytes32) external view returns (SettlementFeeBreakdown memory);
    function getExecutionLegs(bytes32) external view returns (ExecutionLeg[] memory);
    function getExtraFields(bytes32) external view returns (ExtraField[] memory);
}