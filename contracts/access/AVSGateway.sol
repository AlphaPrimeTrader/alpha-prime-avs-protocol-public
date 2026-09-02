// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccessTypes} from "./interfaces/IAVSAccessTypes.sol";
import {IAVSMarketplaceAccess} from "./interfaces/IAVSAccessModules.sol";
import {IAVSProtocolLens} from "./interfaces/IAVSProtocolLens.sol";

interface IAVSGatewayToken {
    function vault() external view returns (address);
    function accountPolicy() external view returns (address);
}

interface IAVSGatewayLedger {
    function avsToken() external view returns (address);
    function vault() external view returns (address);
    function tradeSettlement() external view returns (address);
}

interface IAVSGatewayVault {
    function USDT() external view returns (address);
    function avsToken() external view returns (address);
    function avsLedger() external view returns (address);
    function migration() external view returns (address);
    function marketplace() external view returns (address);
    function tradingContract() external view returns (address);
}

interface IAVSGatewaySettlement {
    function USDT() external view returns (address);
    function avsLedger() external view returns (address);
    function vault() external view returns (address);
    function marketplace() external view returns (address);
}

/// @notice Deliberately narrow, non-custodial generation gateway. It can only
/// relay Marketplace's signed intents and its permissionless liquidity sync.
contract AVSGateway is IAVSAccessTypes {
    bytes32 public constant AVS_TOKEN_MODULE_ID = keccak256("AVS_TOKEN");
    bytes32 public constant LEDGER_MODULE_ID = keccak256("LEDGER");
    bytes32 public constant VAULT_MODULE_ID = keccak256("VAULT");
    bytes32 public constant MARKETPLACE_MODULE_ID = keccak256("MARKETPLACE");
    bytes32 public constant TRADING_SETTLEMENT_MODULE_ID = keccak256("TRADING_SETTLEMENT");
    bytes32 public constant ACCOUNT_POLICY_MODULE_ID = keccak256("ACCOUNT_POLICY");
    bytes32 public constant MIGRATION_MODULE_ID = keccak256("MIGRATION");
    bytes32 public constant PROTOCOL_LENS_MODULE_ID = keccak256("PROTOCOL_LENS");
    address public immutable avsToken;
    address public immutable ledger;
    address public immutable vault;
    address public immutable marketplace;
    address public immutable tradingSettlement;
    address public immutable accountPolicy;
    address public immutable migration;
    address public immutable protocolLens;
    uint256 public immutable chainId;
    uint256 public immutable deploymentGeneration;

    error InvalidContract(address candidate);
    error InvalidChainId(uint256 expected, uint256 actual);
    error InvalidGeneration();
    error InvalidLensWiring();
    error UnknownModule(bytes32 moduleId_);

    constructor(
        address avsToken_, address ledger_, address vault_, address marketplace_,
        address tradingSettlement_, address accountPolicy_, address migration_,
        address protocolLens_, uint256 deploymentGeneration_
    ) {
        if (deploymentGeneration_ == 0) revert InvalidGeneration();
        _requireContract(avsToken_); _requireContract(ledger_); _requireContract(vault_);
        _requireContract(marketplace_); _requireContract(tradingSettlement_); _requireContract(accountPolicy_);
        _requireContract(protocolLens_);
        if (migration_ != address(0)) _requireContract(migration_);
        IAVSProtocolLens lens = IAVSProtocolLens(protocolLens_);
        if (lens.avsToken() != avsToken_ || lens.ledger() != ledger_ || lens.vault() != vault_
            || lens.marketplace() != marketplace_ || lens.tradingSettlement() != tradingSettlement_
            || lens.accountPolicy() != accountPolicy_ || lens.migration() != migration_
            || lens.deploymentGeneration() != deploymentGeneration_) revert InvalidLensWiring();
        if (
            IAVSMarketplaceAccess(marketplace_).DEPLOYMENT_GENERATION() !=
            deploymentGeneration_
        ) revert InvalidGeneration();
        if (
            lens.testUSDT() != IAVSMarketplaceAccess(marketplace_).USDT() ||
            !_canonicalWiring(
                avsToken_,
                ledger_,
                vault_,
                marketplace_,
                tradingSettlement_,
                accountPolicy_,
                migration_,
                lens.testUSDT()
            )
        ) revert InvalidLensWiring();
        avsToken = avsToken_; ledger = ledger_; vault = vault_; marketplace = marketplace_;
        tradingSettlement = tradingSettlement_; accountPolicy = accountPolicy_; migration = migration_;
        protocolLens = protocolLens_; chainId = block.chainid; deploymentGeneration = deploymentGeneration_;
    }

    function token() external view returns (address) {
        return avsToken;
    }

    function protocolVersion()
        external
        pure
        returns (uint32 major, uint32 minor, uint32 patch)
    {
        return (1, 1, 0);
    }

    function moduleAddress(bytes32 moduleId_) public view returns (address) {
        if (moduleId_ == AVS_TOKEN_MODULE_ID) return avsToken;
        if (moduleId_ == LEDGER_MODULE_ID) return ledger;
        if (moduleId_ == VAULT_MODULE_ID) return vault;
        if (moduleId_ == MARKETPLACE_MODULE_ID) return marketplace;
        if (moduleId_ == TRADING_SETTLEMENT_MODULE_ID) return tradingSettlement;
        if (moduleId_ == ACCOUNT_POLICY_MODULE_ID) return accountPolicy;
        if (moduleId_ == MIGRATION_MODULE_ID) return migration;
        if (moduleId_ == PROTOCOL_LENS_MODULE_ID) return protocolLens;
        revert UnknownModule(moduleId_);
    }
    function moduleCodehash(bytes32 moduleId_) external view returns (bytes32) {
        return moduleAddress(moduleId_).codehash;
    }
    function syncProtocolLiquidity() external returns (uint256) {
        return IAVSMarketplaceAccess(marketplace).syncProtocolLiquidity();
    }
    function placeMarketBuyWithSignature(MarketBuyIntent calldata intent, bytes calldata signature) external returns (uint256) {
        return IAVSMarketplaceAccess(marketplace).placeMarketBuyWithSignature(intent, signature);
    }
    function placeTriggeredBuyWithSignature(TriggeredBuyIntent calldata intent, bytes calldata signature) external returns (uint256) {
        return IAVSMarketplaceAccess(marketplace).placeTriggeredBuyWithSignature(intent, signature);
    }
    function placeMarketSellWithSignature(MarketSellIntent calldata intent, bytes calldata signature) external returns (uint256) {
        return IAVSMarketplaceAccess(marketplace).placeMarketSellWithSignature(intent, signature);
    }
    function placeTriggeredSellWithSignature(TriggeredSellIntent calldata intent, bytes calldata signature) external returns (uint256) {
        return IAVSMarketplaceAccess(marketplace).placeTriggeredSellWithSignature(intent, signature);
    }
    function cancelOrderWithSignature(CancelIntent calldata intent, bytes calldata signature) external {
        IAVSMarketplaceAccess(marketplace).cancelOrderWithSignature(intent, signature);
    }

    function getProtocolSnapshot() external view returns (IAVSProtocolLens.ProtocolSnapshot memory) {
        return IAVSProtocolLens(protocolLens).getProtocolSnapshot();
    }
    function getUserSnapshot(address account) external view returns (IAVSProtocolLens.UserSnapshot memory) {
        return IAVSProtocolLens(protocolLens).getUserSnapshot(account);
    }
    function getMarketplaceSnapshot() external view returns (IAVSProtocolLens.MarketplaceSnapshot memory) {
        return IAVSProtocolLens(protocolLens).getMarketplaceSnapshot();
    }
    function getWiringHealth() external view returns (IAVSProtocolLens.WiringHealth memory) {
        return IAVSProtocolLens(protocolLens).getWiringHealth();
    }
    function getOrder(uint256 orderId) external view returns (IAVSAccessTypes.Order memory) {
        return IAVSProtocolLens(protocolLens).getOrder(orderId);
    }
    function getOrderIds(uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory) {
        return IAVSProtocolLens(protocolLens).getOrderIds(offset, limit, newestFirst);
    }
    function getUserOrderIds(address account, uint256 offset, uint256 limit, bool newestFirst) external view returns (uint256[] memory) {
        return IAVSProtocolLens(protocolLens).getUserOrderIds(account, offset, limit, newestFirst);
    }
    function getSettlementSummaries(uint256 offset, uint256 limit) external view returns (IAVSProtocolLens.SettlementSummary[] memory) {
        return IAVSProtocolLens(protocolLens).getSettlementSummaries(offset, limit);
    }
    function getSettlement(bytes32 settlementId) external view returns (IAVSAccessTypes.SettlementRecord memory) {
        return IAVSProtocolLens(protocolLens).getSettlement(settlementId);
    }
    function getSettlementDetails(bytes32 settlementId) external view returns (IAVSProtocolLens.SettlementDetails memory) {
        return IAVSProtocolLens(protocolLens).getSettlementDetails(settlementId);
    }
    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) revert InvalidContract(candidate);
    }

    function _canonicalWiring(
        address avsToken_,
        address ledger_,
        address vault_,
        address marketplace_,
        address tradingSettlement_,
        address accountPolicy_,
        address migration_,
        address testUSDT_
    ) private view returns (bool) {
        IAVSGatewayToken t = IAVSGatewayToken(avsToken_);
        IAVSGatewayLedger l = IAVSGatewayLedger(ledger_);
        IAVSGatewayVault v = IAVSGatewayVault(vault_);
        IAVSMarketplaceAccess m = IAVSMarketplaceAccess(marketplace_);
        IAVSGatewaySettlement s = IAVSGatewaySettlement(tradingSettlement_);
        return
            t.vault() == vault_ &&
            t.accountPolicy() == accountPolicy_ &&
            l.avsToken() == avsToken_ &&
            l.vault() == vault_ &&
            l.tradeSettlement() == tradingSettlement_ &&
            v.USDT() == testUSDT_ &&
            v.avsToken() == avsToken_ &&
            v.avsLedger() == ledger_ &&
            v.migration() == migration_ &&
            v.marketplace() == marketplace_ &&
            v.tradingContract() == tradingSettlement_ &&
            m.USDT() == testUSDT_ &&
            m.AVS() == avsToken_ &&
            m.ledger() == ledger_ &&
            m.vault() == vault_ &&
            m.settlementHook() == tradingSettlement_ &&
            s.USDT() == testUSDT_ &&
            s.avsLedger() == ledger_ &&
            s.vault() == vault_ &&
            s.marketplace() == marketplace_;
    }
}