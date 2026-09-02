// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAVSProtocolLens} from "./interfaces/IAVSProtocolLens.sol";
import {IAVSMarketplaceAccess, IAVSSettlementAccess} from "./interfaces/IAVSAccessModules.sol";

interface IAccessToken is IERC20 {
    function isWhitelisted(address account) external view returns (bool);
    function vault() external view returns (address);
    function accountPolicy() external view returns (address);
}
interface IAccessLedger {
    function avsToken() external view returns (address);
    function vault() external view returns (address);
    function tradeSettlement() external view returns (address);
    function currentAVSValue() external view returns (uint256);
    function totalNetAssets() external view returns (uint256);
    function totalGrossProfit() external view returns (uint256);
    function totalLoss() external view returns (uint256);
    function totalBuybackAllocated() external view returns (uint256);
    function buybackReserve() external view returns (uint256);
    function treasuryAVS() external view returns (uint256);
    function economicSupply() external view returns (uint256);
}
interface IAccessVault {
    function USDT() external view returns (address);
    function avsToken() external view returns (address);
    function avsLedger() external view returns (address);
    function migration() external view returns (address);
    function marketplace() external view returns (address);
    function tradingContract() external view returns (address);
    function pendingMarketplaceLiquidity() external view returns (uint256);
    function pendingTradingCapital() external view returns (uint256);
    function returnedTradingCapital() external view returns (uint256);
}

/// @notice Read-only, generation-bound aggregation layer. Health output means
/// required protocol wiring/configuration checks currently pass; it is not an
/// assertion of protocol security, external infrastructure health, or future
/// transaction success.
contract AVSProtocolLens is IAVSProtocolLens {
    uint256 public constant MAX_PAGE_SIZE = 100;

    address public immutable avsToken;
    address public immutable testUSDT;
    address public immutable ledger;
    address public immutable vault;
    address public immutable marketplace;
    address public immutable tradingSettlement;
    address public immutable accountPolicy;
    address public immutable migration;
    uint256 public immutable deploymentGeneration;

    error InvalidContract(address candidate);
    error InvalidGeneration();
    error InvalidWiring();
    error InvalidPageSize(uint256 requested, uint256 maximum);

    constructor(
        address avsToken_, address testUSDT_, address ledger_, address vault_,
        address marketplace_, address tradingSettlement_, address accountPolicy_,
        address migration_, uint256 deploymentGeneration_
    ) {
        if (deploymentGeneration_ == 0) revert InvalidGeneration();
        _requireContract(avsToken_); _requireContract(testUSDT_); _requireContract(ledger_);
        _requireContract(vault_); _requireContract(marketplace_); _requireContract(tradingSettlement_);
        _requireContract(accountPolicy_);
        if (migration_ != address(0)) _requireContract(migration_);
        avsToken = avsToken_; testUSDT = testUSDT_; ledger = ledger_; vault = vault_;
        marketplace = marketplace_; tradingSettlement = tradingSettlement_;
        accountPolicy = accountPolicy_; migration = migration_; deploymentGeneration = deploymentGeneration_;
    }

    function getProtocolSnapshot() external view returns (ProtocolSnapshot memory s) {
        IAccessLedger l = IAccessLedger(ledger);
        IAccessVault v = IAccessVault(vault);
        IAVSMarketplaceAccess m = IAVSMarketplaceAccess(marketplace);
        s = ProtocolSnapshot(
            block.number,
            block.timestamp,
            block.chainid,
            deploymentGeneration,
            l.currentAVSValue(),
            l.totalNetAssets(),
            IERC20(avsToken).totalSupply(),
            l.economicSupply(),
            l.totalGrossProfit(),
            l.totalLoss(),
            l.totalBuybackAllocated(),
            l.buybackReserve(),
            l.treasuryAVS(),
            IAVSSettlementAccess(tradingSettlement).settlementCount(),
            m.protocolLiquidityUSDT(),
            m.protocolInventoryAVS(),
            v.pendingMarketplaceLiquidity(),
            v.pendingTradingCapital(),
            v.returnedTradingCapital()
        );
    }

    function getUserSnapshot(address account) external view returns (UserSnapshot memory s) {
        uint256 nav = IAccessLedger(ledger).currentAVSValue();
        uint256 avsBalance = IERC20(avsToken).balanceOf(account);
        s = UserSnapshot(block.number, block.timestamp, block.chainid, deploymentGeneration,
            IAccessToken(avsToken).isWhitelisted(account), IAccessToken(avsToken).accountPolicy() == accountPolicy,
            avsBalance, IERC20(testUSDT).balanceOf(account), Math.mulDiv(avsBalance, nav, 1e18),
            IERC20(avsToken).allowance(account, marketplace), IERC20(testUSDT).allowance(account, marketplace),
            IAVSMarketplaceAccess(marketplace).userOrderCount(account),
            IAVSMarketplaceAccess(marketplace).userOpenSellEscrow(account));
    }

    function getMarketplaceSnapshot() external view returns (MarketplaceSnapshot memory s) {
        IAVSMarketplaceAccess m = IAVSMarketplaceAccess(marketplace);
        s = MarketplaceSnapshot(
            block.number,
            block.timestamp,
            block.chainid,
            deploymentGeneration,
            m.orderCount(),
            m.nextOrderId(),
            m.userEscrowAVS(),
            m.buyerEscrowUSDT(),
            m.protocolLiquidityUSDT(),
            m.protocolInventoryAVS(),
            m.totalFeesCollected(),
            IERC20(avsToken).balanceOf(marketplace),
            IERC20(testUSDT).balanceOf(marketplace),
            m.buyHead(),
            m.buyTail(),
            m.sellHead(),
            m.sellTail(),
            m.maxMatchesPerCall(),
            m.maxScansPerCall(),
            m.accountingSolvent()
        );
    }

    function getWiringHealth() external view returns (WiringHealth memory h) {
        return _wiringHealth();
    }

    function _wiringHealth() private view returns (WiringHealth memory h) {
        IAccessToken t = IAccessToken(avsToken); IAccessLedger l = IAccessLedger(ledger);
        IAccessVault v = IAccessVault(vault); IAVSMarketplaceAccess m = IAVSMarketplaceAccess(marketplace);
        IAVSSettlementAccess s = IAVSSettlementAccess(tradingSettlement);
        h = WiringHealth(t.vault() == vault, t.accountPolicy() == accountPolicy, l.avsToken() == avsToken,
            l.vault() == vault, l.tradeSettlement() == tradingSettlement, v.avsToken() == avsToken,
            v.avsLedger() == ledger, v.marketplace() == marketplace, v.tradingContract() == tradingSettlement,
            m.AVS() == avsToken, m.ledger() == ledger, m.vault() == vault, m.settlementHook() == tradingSettlement,
            s.avsLedger() == ledger, s.vault() == vault, s.marketplace() == marketplace,
            v.USDT() == testUSDT, m.USDT() == testUSDT, s.USDT() == testUSDT,
            v.migration() == migration, false, t.isWhitelisted(marketplace));
        h.allHealthy =
            h.tokenVault &&
            h.tokenAccountPolicy &&
            h.ledgerToken &&
            h.ledgerVault &&
            h.ledgerSettlement &&
            h.vaultToken &&
            h.vaultLedger &&
            h.vaultMarketplace &&
            h.vaultSettlement &&
            h.marketplaceToken &&
            h.marketplaceLedger &&
            h.marketplaceVault &&
            h.marketplaceSettlement &&
            h.settlementLedger &&
            h.settlementVault &&
            h.settlementMarketplace &&
            h.vaultUSDT &&
            h.marketplaceUSDT &&
            h.settlementUSDT &&
            h.vaultMigration &&
            h.marketplaceAuthorized;
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return IAVSMarketplaceAccess(marketplace).orders(orderId);
    }
    function getOrderIds(uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory) {
        return IAVSMarketplaceAccess(marketplace).getOrderIds(offset, limit, newestFirst);
    }
    function getUserOrderIds(address account, uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory) {
        return IAVSMarketplaceAccess(marketplace).getUserOrderIds(account, offset, limit, newestFirst);
    }
    function getSettlement(bytes32 settlementId) external view returns (SettlementRecord memory) {
        return IAVSSettlementAccess(tradingSettlement).getSettlement(settlementId);
    }
    function getSettlementDetails(bytes32 id) external view returns (SettlementDetails memory d) {
        IAVSSettlementAccess s = IAVSSettlementAccess(tradingSettlement);
        d.record = s.getSettlement(id); d.accounting = s.getSettlementAccounting(id); d.timing = s.getSettlementTiming(id);
        d.authentication = s.getSettlementAuthentication(id); d.display = s.getSettlementDisplay(id);
        d.fees = s.getSettlementFeeBreakdown(id); d.legs = s.getExecutionLegs(id); d.extraFields = s.getExtraFields(id);
    }
    function getSettlementSummaries(uint256 offset, uint256 limit) external view returns (SettlementSummary[] memory page) {
        if (limit == 0 || limit > MAX_PAGE_SIZE) revert InvalidPageSize(limit, MAX_PAGE_SIZE);
        IAVSSettlementAccess s = IAVSSettlementAccess(tradingSettlement);
        uint256 count = s.settlementCount();
        if (offset >= count) return new SettlementSummary[](0);
        uint256 length = Math.min(limit, count - offset);
        page = new SettlementSummary[](length);
        for (uint256 i; i < length; ++i) {
            bytes32 id = s.settlementIdAt(count - 1 - offset - i);
            SettlementRecord memory r = s.getSettlement(id);
            SettlementAccounting memory a = s.getSettlementAccounting(id);
            SettlementTiming memory t = s.getSettlementTiming(id);
            page[i] = SettlementSummary(id, r.positionId, r.sequence, a.netRealizedPnlUsd, a.navAfter, t.recordedAt, r.finalized);
        }
    }
    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) revert InvalidContract(candidate);
    }
}