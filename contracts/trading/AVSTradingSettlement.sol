// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    IAVSTradingSettlementLedger
} from "./interfaces/IAVSTradingSettlementLedger.sol";
import {
    IAVSTradingSettlementMarketplace
} from "./interfaces/IAVSTradingSettlementMarketplace.sol";

/**
 * @title AVSTradingSettlement
 * @notice Local, finalized-trade archive and accounting boundary for AVS.
 *
 * This contract does not execute trading strategies. A valid submission is the
 * canonical on-chain statement that a trade is finalized. Its economic effect
 * is limited to the net realized PnL sent to the existing AVS Ledger.
 */
contract AVSTradingSettlement is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant DOMAIN_NAME =
        "Alpha Prime AVS Trading Settlement";
    string public constant DOMAIN_VERSION = "1";
    uint256 public constant MAX_EXECUTION_LEGS = 16;
    uint256 public constant MAX_EXTRA_FIELDS = 16;
    uint256 public constant MAX_CORE_STRING_BYTES = 128;
    uint256 public constant MAX_VENUES_STRING_BYTES = 256;
    uint256 public constant MAX_EXTRA_KEY_BYTES = 64;
    uint256 public constant MAX_EXTRA_VALUE_BYTES = 256;
    uint256 public constant MAX_FUTURE_TIMESTAMP = 1 days;
    uint256 public constant MAX_PAGE_SIZE = 100;

    bytes32 private constant SETTLEMENT_HASH_TYPEHASH =
        keccak256(
            "TradeSettlement(bytes32 identityHash,bytes32 metadataHash,bytes32 capitalHash,bytes32 economicsHash,bytes32 timingHash,bytes32 legsHash,bytes32 extraFieldsHash)"
        );
    bytes32 private constant IDENTITY_HASH_TYPEHASH =
        keccak256(
            "SettlementIdentity(bytes32 settlementId,bytes32 positionId,uint64 sequence,bytes32 executionHash)"
        );
    bytes32 private constant METADATA_HASH_TYPEHASH =
        keccak256(
            "SettlementMetadata(bytes32 strategyHash,bytes32 executionTypeHash,bytes32 symbolHash,bytes32 baseAssetHash,bytes32 quoteAssetHash,bytes32 venuesHash)"
        );
    bytes32 private constant CAPITAL_HASH_TYPEHASH =
        keccak256(
            "SettlementCapital(uint256 protocolCapitalUsd,uint256 borrowedCapitalUsd,uint256 grossNotionalUsd,uint256 quantity,uint256 entryPrice,uint256 exitPrice,uint256 averageEntryPrice)"
        );
    bytes32 private constant ECONOMICS_HASH_TYPEHASH =
        keccak256(
            "SettlementEconomics(int256 grossPnlUsd,uint256 tradingFeesUsd,uint256 networkFeesUsd,uint256 financingFeesUsd,uint256 otherFeesUsd)"
        );
    bytes32 private constant TIMING_HASH_TYPEHASH =
        keccak256(
            "SettlementTiming(uint64 openedAt,uint64 closedAt,uint64 executionMs)"
        );
    bytes32 private constant AUTHORIZATION_TYPEHASH =
        keccak256("SettlementAuthorization(bytes32 settlementHash)");
    bytes32 private constant EXECUTION_LEG_TYPEHASH =
        keccak256(
            "ExecutionLeg(uint16 legIndex,bytes32 venueHash,bytes32 actionHash,bytes32 assetInHash,bytes32 assetOutHash,uint256 amountIn,uint256 amountOut,uint256 executionPrice,bytes32 externalReference)"
        );
    bytes32 private constant EXTRA_FIELD_TYPEHASH =
        keccak256(
            "ExtraField(bytes32 keyHash,bytes32 valueHash)"
        );

    IERC20 public immutable USDT;
    address public owner;
    address public avsLedger;
    address public vault;
    address public marketplace;
    address public tradingDestination;

    mapping(address => bool) public authorizedRelayers;
    mapping(address => bool) public authorizedTradeSigners;
    mapping(address => bool) public authorizedServerSigners;

    struct TradeIdentity {
        bytes32 settlementId;
        bytes32 positionId;
        uint64 sequence;
        bytes32 executionHash;
    }

    struct TradeMetadata {
        string strategy;
        string executionType;
        string symbol;
        string baseAsset;
        string quoteAsset;
        string venues;
    }

    struct TradeCapital {
        uint256 protocolCapitalUsd;
        uint256 borrowedCapitalUsd;
        uint256 grossNotionalUsd;
        uint256 quantity;
        uint256 entryPrice;
        uint256 exitPrice;
        uint256 averageEntryPrice;
    }

    struct TradeEconomics {
        int256 grossPnlUsd;
        uint256 tradingFeesUsd;
        uint256 networkFeesUsd;
        uint256 financingFeesUsd;
        uint256 otherFeesUsd;
    }

    struct TradeTiming {
        uint64 openedAt;
        uint64 closedAt;
        uint64 executionMs;
    }

    struct TradeCore {
        TradeIdentity identity;
        TradeMetadata metadata;
        TradeCapital capital;
        TradeEconomics economics;
        TradeTiming timing;
    }

    struct ExecutionLeg {
        uint16 legIndex;
        string venue;
        string action;
        string assetIn;
        string assetOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 executionPrice;
        bytes32 externalReference;
    }

    struct ExtraField {
        string key;
        string value;
    }

    struct SettlementAuthorization {
        bytes32 settlementHash;
        bytes tradeSignature;
        bytes serverSignature;
    }

    struct SettlementComputation {
        bytes32 settlementId;
        bytes32 settlementHash;
        bytes32 legsHash;
        bytes32 extraFieldsHash;
        uint256 totalFeesUsd;
        int256 netRealizedPnlUsd;
        uint256 navBefore;
        uint256 navAfter;
        uint64 recordedAt;
        address tradeSigner;
        address serverSigner;
    }

    struct SettlementRecord {
        bytes32 settlementId;
        bytes32 positionId;
        bytes32 executionHash;
        bytes32 settlementHash;
        bytes32 legsHash;
        bytes32 extraFieldsHash;
        uint64 sequence;
        bool finalized;
    }

    struct SettlementAccounting {
        uint256 protocolCapitalUsd;
        uint256 borrowedCapitalUsd;
        uint256 grossNotionalUsd;
        int256 grossPnlUsd;
        uint256 totalFeesUsd;
        int256 netRealizedPnlUsd;
        uint256 navBefore;
        uint256 navAfter;
    }

    struct SettlementTimingRecord {
        uint64 openedAt;
        uint64 closedAt;
        uint64 recordedAt;
    }

    struct SettlementAuthentication {
        address tradeSigner;
        address serverSigner;
        address relayer;
    }

    struct SettlementDisplay {
        string strategy;
        string executionType;
        string symbol;
        string baseAsset;
        string quoteAsset;
        string venues;
        uint256 quantity;
        uint256 entryPrice;
        uint256 exitPrice;
        uint256 averageEntryPrice;
        uint64 executionMs;
    }

    struct SettlementFeeBreakdown {
        uint256 tradingFeesUsd;
        uint256 networkFeesUsd;
        uint256 financingFeesUsd;
        uint256 otherFeesUsd;
    }

    mapping(bytes32 => bool) public processedSettlements;
    mapping(bytes32 => bool) public processedExecutionHashes;
    mapping(uint64 => bool) public processedSequences;
    mapping(bytes32 => SettlementRecord) private _settlements;
    mapping(bytes32 => SettlementAccounting) private _settlementAccounting;
    mapping(bytes32 => SettlementTimingRecord) private _settlementTimings;
    mapping(bytes32 => SettlementAuthentication)
        private _settlementAuthentication;
    mapping(bytes32 => SettlementDisplay) private _settlementDisplays;
    mapping(bytes32 => SettlementFeeBreakdown) private _settlementFees;
    mapping(bytes32 => ExecutionLeg[]) private _executionLegs;
    mapping(bytes32 => ExtraField[]) private _extraFields;
    bytes32[] private _settlementIds;

    uint256 public settlementCount;

    event ConfigurationAddressUpdated(
        bytes32 indexed configuration,
        address indexed previousAddress,
        address indexed newAddress
    );
    event RelayerAuthorizationUpdated(
        address indexed account,
        bool authorized
    );
    event TradeSignerAuthorizationUpdated(
        address indexed account,
        bool authorized
    );
    event ServerSignerAuthorizationUpdated(
        address indexed account,
        bool authorized
    );
    event ProductiveCapitalForwarded(
        address indexed vault,
        address indexed tradingDestination,
        uint256 amount
    );
    event SettlementFinalized(
        bytes32 indexed settlementId,
        bytes32 indexed positionId,
        uint64 sequence,
        string strategy,
        string symbol,
        int256 netRealizedPnlUsd,
        uint256 navBefore,
        uint256 navAfter,
        uint64 recordedAt,
        bytes32 executionHash,
        bytes32 settlementHash,
        address indexed relayer
    );
    event SettlementMetadataRecorded(
        bytes32 indexed settlementId,
        string executionType,
        string venues,
        uint64 openedAt,
        uint64 closedAt,
        uint64 executionMs
    );
    event SettlementEconomicsRecorded(
        bytes32 indexed settlementId,
        uint256 protocolCapitalUsd,
        uint256 borrowedCapitalUsd,
        uint256 grossNotionalUsd,
        uint256 quantity,
        int256 grossPnlUsd,
        uint256 tradingFeesUsd,
        uint256 networkFeesUsd,
        uint256 financingFeesUsd,
        uint256 otherFeesUsd,
        uint256 totalFeesUsd
    );
    event SettlementPricesRecorded(
        bytes32 indexed settlementId,
        uint256 entryPrice,
        uint256 exitPrice,
        uint256 averageEntryPrice
    );
    event SettlementAuthenticationRecorded(
        bytes32 indexed settlementId,
        address tradeSigner,
        address serverSigner,
        address relayer
    );
    event SettlementAssetsRecorded(
        bytes32 indexed settlementId,
        string baseAsset,
        string quoteAsset
    );
    event ExecutionLegRecorded(
        bytes32 indexed settlementId,
        uint16 indexed legIndex,
        string venue,
        string action,
        bytes32 externalReference
    );
    event ExecutionLegAmountsRecorded(
        bytes32 indexed settlementId,
        uint16 indexed legIndex,
        string assetIn,
        string assetOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 executionPrice
    );
    event ExtraFieldRecorded(
        bytes32 indexed settlementId,
        uint16 indexed fieldIndex,
        string key,
        string value
    );
    event MarketplaceProcessingSucceeded(
        bytes32 indexed settlementId,
        uint256 navAfter
    );
    event MarketplaceProcessingDeferred(
        bytes32 indexed settlementId,
        bytes32 reasonHash
    );

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidContract(address candidate);
    error InvalidAddress();
    error RoleCollision(address candidate);
    error LedgerNotConfigured();
    error TradingDestinationNotConfigured();
    error InvalidIdentifier();
    error InvalidSequence();
    error InvalidAmount();
    error InvalidString(bytes32 field);
    error StringTooLong(bytes32 field, uint256 actual, uint256 maximum);
    error TooManyExecutionLegs(uint256 actual, uint256 maximum);
    error TooManyExtraFields(uint256 actual, uint256 maximum);
    error InvalidLegIndex(uint16 expected, uint16 actual);
    error InvalidTimestamp();
    error TimestampTooFarInFuture(uint64 timestamp, uint256 latestAllowed);
    error SettlementIdMismatch(
        bytes32 submittedSettlementId,
        bytes32 expectedSettlementId
    );
    error SettlementHashMismatch(
        bytes32 submittedSettlementHash,
        bytes32 expectedSettlementHash
    );
    error DuplicateSettlement(bytes32 settlementId);
    error DuplicateExecutionHash(bytes32 executionHash);
    error DuplicateSequence(uint64 sequence);
    error InvalidTradeSignature();
    error InvalidServerSignature();
    error SignersMustDiffer();
    error FeeOverflow();
    error PnlOverflow();
    error InvalidBalanceChange(uint256 balanceBefore, uint256 balanceAfter);
    error ExactAmountNotReceived(uint256 expected, uint256 actual);
    error ExactAmountNotSent(uint256 expected, uint256 actual);
    error InvalidPageSize(uint256 requested, uint256 maximum);
    error InvalidPageOffset(uint256 offset, uint256 count);
    error SettlementNotFound(bytes32 settlementId);
    error ArrayLengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender]) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyVault() {
        if (vault == address(0) || msg.sender != vault) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address initialOwner, address usdt)
        EIP712(DOMAIN_NAME, DOMAIN_VERSION)
    {
        if (initialOwner == address(0)) revert InvalidOwner();
        _requireContract(usdt);
        owner = initialOwner;
        USDT = IERC20(usdt);
    }

    function setLedger(address newAddress) external onlyOwner {
        avsLedger = _setConfiguration(
            keccak256("AVS_LEDGER"),
            avsLedger,
            newAddress
        );
    }

    function setVault(address newAddress) external onlyOwner {
        vault = _setConfiguration(keccak256("VAULT"), vault, newAddress);
    }

    function setMarketplace(address newAddress) external onlyOwner {
        marketplace = _setOptionalConfiguration(
            keccak256("MARKETPLACE"),
            marketplace,
            newAddress
        );
    }

    function setTradingDestination(address newAddress) external onlyOwner {
        if (newAddress == address(0)) revert InvalidAddress();
        _requireConfigurationAddress(newAddress, tradingDestination);
        emit ConfigurationAddressUpdated(
            keccak256("TRADING_DESTINATION"),
            tradingDestination,
            newAddress
        );
        tradingDestination = newAddress;
    }

    function setRelayer(address account, bool authorized) external onlyOwner {
        _setAuthorization(
            authorizedRelayers,
            account,
            authorized,
            keccak256("RELAYER")
        );
    }

    function setTradeSigner(
        address account,
        bool authorized
    ) external onlyOwner {
        _setAuthorization(
            authorizedTradeSigners,
            account,
            authorized,
            keccak256("TRADE_SIGNER")
        );
    }

    function setServerSigner(
        address account,
        bool authorized
    ) external onlyOwner {
        _setAuthorization(
            authorizedServerSigners,
            account,
            authorized,
            keccak256("SERVER_SIGNER")
        );
    }

    function computeSettlementId(
        uint64 sequence,
        bytes32 positionId,
        bytes32 executionHash
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    sequence,
                    positionId,
                    executionHash
                )
            );
    }

    function computeSettlementHash(
        TradeCore calldata core,
        ExecutionLeg[] calldata legs,
        ExtraField[] calldata extraFields
    ) external pure returns (bytes32) {
        return
            _hashSettlement(
                core,
                _hashLegs(legs),
                _hashExtraFields(extraFields)
            );
    }

    function settlementDigest(
        bytes32 settlementHash
    ) external view returns (bytes32) {
        return _settlementDigest(settlementHash);
    }

    function calculateLegsHash(
        ExecutionLeg[] calldata legs
    ) external pure returns (bytes32) {
        return _hashLegs(legs);
    }

    function calculateExtraFieldsHash(
        ExtraField[] calldata extraFields
    ) external pure returns (bytes32) {
        return _hashExtraFields(extraFields);
    }

    function submitSettlement(
        TradeCore calldata core,
        ExecutionLeg[] calldata legs,
        ExtraField[] calldata extraFields,
        SettlementAuthorization calldata authorization
    ) external onlyRelayer nonReentrant returns (bytes32 settlementId) {
        _validateCore(core);
        SettlementComputation memory computed;
        computed.settlementId = computeSettlementId(
            core.identity.sequence,
            core.identity.positionId,
            core.identity.executionHash
        );
        settlementId = computed.settlementId;
        if (core.identity.settlementId != computed.settlementId) {
            revert SettlementIdMismatch(
                core.identity.settlementId,
                computed.settlementId
            );
        }
        if (processedSettlements[computed.settlementId]) {
            revert DuplicateSettlement(computed.settlementId);
        }
        if (processedExecutionHashes[core.identity.executionHash]) {
            revert DuplicateExecutionHash(core.identity.executionHash);
        }
        if (processedSequences[core.identity.sequence]) {
            revert DuplicateSequence(core.identity.sequence);
        }

        computed.legsHash = _hashLegs(legs);
        computed.extraFieldsHash = _hashExtraFields(extraFields);
        computed.settlementHash = _hashSettlement(
            core,
            computed.legsHash,
            computed.extraFieldsHash
        );
        if (authorization.settlementHash != computed.settlementHash) {
            revert SettlementHashMismatch(
                authorization.settlementHash,
                computed.settlementHash
            );
        }

        bytes32 digest = _settlementDigest(computed.settlementHash);
        computed.tradeSigner = _recoverSigner(
            digest,
            authorization.tradeSignature,
            true
        );
        if (!authorizedTradeSigners[computed.tradeSigner]) {
            revert InvalidTradeSignature();
        }
        computed.serverSigner = _recoverSigner(
            digest,
            authorization.serverSignature,
            false
        );
        if (!authorizedServerSigners[computed.serverSigner]) {
            revert InvalidServerSignature();
        }
        if (computed.tradeSigner == computed.serverSigner) {
            revert SignersMustDiffer();
        }

        computed.totalFeesUsd = _totalFees(core);
        computed.netRealizedPnlUsd = _calculateNetPnl(
            core.economics.grossPnlUsd,
            computed.totalFeesUsd
        );
        if (avsLedger == address(0)) revert LedgerNotConfigured();

        computed.navBefore = IAVSTradingSettlementLedger(avsLedger)
            .currentAVSValue();
        IAVSTradingSettlementLedger(avsLedger).recordTradingSettlement(
            computed.settlementId,
            computed.netRealizedPnlUsd
        );
        computed.navAfter = IAVSTradingSettlementLedger(avsLedger)
            .currentAVSValue();
        computed.recordedAt = uint64(block.timestamp);

        _archiveSettlement(core, legs, extraFields, computed);
        _processMarketplace(
            computed.settlementId,
            computed.netRealizedPnlUsd,
            computed.navAfter
        );
    }

    function receiveProductiveCapital(
        uint256 amount
    ) external onlyVault nonReentrant {
        if (tradingDestination == address(0)) {
            revert TradingDestinationNotConfigured();
        }
        uint256 actualReceived = _pullExactAmount(msg.sender, amount);
        _transferExact(tradingDestination, actualReceived);
        emit ProductiveCapitalForwarded(
            msg.sender,
            tradingDestination,
            actualReceived
        );
    }

    function settlementIdAt(uint256 index) external view returns (bytes32) {
        if (index >= settlementCount) {
            revert InvalidPageOffset(index, settlementCount);
        }
        return _settlementIds[index];
    }

    function getSettlementIds(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory ids) {
        if (limit == 0 || limit > MAX_PAGE_SIZE) {
            revert InvalidPageSize(limit, MAX_PAGE_SIZE);
        }
        if (offset > settlementCount) {
            revert InvalidPageOffset(offset, settlementCount);
        }

        uint256 end = offset + limit;
        if (end > settlementCount) end = settlementCount;
        ids = new bytes32[](end - offset);
        for (uint256 index = offset; index < end; index++) {
            ids[index - offset] = _settlementIds[index];
        }
    }

    function getSettlement(
        bytes32 settlementId
    ) external view returns (SettlementRecord memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlements[settlementId];
    }

    function getExecutionLegs(
        bytes32 settlementId
    ) external view returns (ExecutionLeg[] memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _executionLegs[settlementId];
    }

    function getSettlementDisplay(
        bytes32 settlementId
    ) external view returns (SettlementDisplay memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlementDisplays[settlementId];
    }

    function getSettlementAccounting(
        bytes32 settlementId
    ) external view returns (SettlementAccounting memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlementAccounting[settlementId];
    }

    function getSettlementTiming(
        bytes32 settlementId
    ) external view returns (SettlementTimingRecord memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlementTimings[settlementId];
    }

    function getSettlementAuthentication(
        bytes32 settlementId
    ) external view returns (SettlementAuthentication memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlementAuthentication[settlementId];
    }

    function getSettlementFeeBreakdown(
        bytes32 settlementId
    ) external view returns (SettlementFeeBreakdown memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _settlementFees[settlementId];
    }

    function getExtraFields(
        bytes32 settlementId
    ) external view returns (ExtraField[] memory) {
        if (!_settlements[settlementId].finalized) {
            revert SettlementNotFound(settlementId);
        }
        return _extraFields[settlementId];
    }

    function _archiveSettlement(
        TradeCore calldata core,
        ExecutionLeg[] calldata legs,
        ExtraField[] calldata extraFields,
        SettlementComputation memory computed
    ) private {
        bytes32 settlementId = core.identity.settlementId;
        SettlementRecord storage record = _settlements[settlementId];
        record.settlementId = settlementId;
        record.positionId = core.identity.positionId;
        record.executionHash = core.identity.executionHash;
        record.settlementHash = computed.settlementHash;
        record.legsHash = computed.legsHash;
        record.extraFieldsHash = computed.extraFieldsHash;
        record.sequence = core.identity.sequence;
        record.finalized = true;

        _settlementAccounting[settlementId] = SettlementAccounting({
            protocolCapitalUsd: core.capital.protocolCapitalUsd,
            borrowedCapitalUsd: core.capital.borrowedCapitalUsd,
            grossNotionalUsd: core.capital.grossNotionalUsd,
            grossPnlUsd: core.economics.grossPnlUsd,
            totalFeesUsd: computed.totalFeesUsd,
            netRealizedPnlUsd: computed.netRealizedPnlUsd,
            navBefore: computed.navBefore,
            navAfter: computed.navAfter
        });
        _settlementTimings[settlementId] = SettlementTimingRecord({
            openedAt: core.timing.openedAt,
            closedAt: core.timing.closedAt,
            recordedAt: computed.recordedAt
        });
        _settlementAuthentication[
            settlementId
        ] = SettlementAuthentication({
            tradeSigner: computed.tradeSigner,
            serverSigner: computed.serverSigner,
            relayer: msg.sender
        });
        _settlementDisplays[settlementId] = SettlementDisplay({
            strategy: core.metadata.strategy,
            executionType: core.metadata.executionType,
            symbol: core.metadata.symbol,
            baseAsset: core.metadata.baseAsset,
            quoteAsset: core.metadata.quoteAsset,
            venues: core.metadata.venues,
            quantity: core.capital.quantity,
            entryPrice: core.capital.entryPrice,
            exitPrice: core.capital.exitPrice,
            averageEntryPrice: core.capital.averageEntryPrice,
            executionMs: core.timing.executionMs
        });
        _settlementFees[settlementId] = SettlementFeeBreakdown({
            tradingFeesUsd: core.economics.tradingFeesUsd,
            networkFeesUsd: core.economics.networkFeesUsd,
            financingFeesUsd: core.economics.financingFeesUsd,
            otherFeesUsd: core.economics.otherFeesUsd
        });

        processedSettlements[settlementId] = true;
        processedExecutionHashes[core.identity.executionHash] = true;
        processedSequences[core.identity.sequence] = true;
        _settlementIds.push(settlementId);
        settlementCount += 1;

        for (uint256 index = 0; index < legs.length; index++) {
            _archiveExecutionLeg(settlementId, legs[index]);
        }
        for (uint256 index = 0; index < extraFields.length; index++) {
            _archiveExtraField(
                settlementId,
                uint16(index),
                extraFields[index]
            );
        }

        _emitSettlementEvents(core, computed);
    }

    function _emitSettlementEvents(
        TradeCore calldata core,
        SettlementComputation memory computed
    ) private {
        emit SettlementFinalized(
            core.identity.settlementId,
            core.identity.positionId,
            core.identity.sequence,
            core.metadata.strategy,
            core.metadata.symbol,
            computed.netRealizedPnlUsd,
            computed.navBefore,
            computed.navAfter,
            computed.recordedAt,
            core.identity.executionHash,
            computed.settlementHash,
            msg.sender
        );
        emit SettlementMetadataRecorded(
            core.identity.settlementId,
            core.metadata.executionType,
            core.metadata.venues,
            core.timing.openedAt,
            core.timing.closedAt,
            core.timing.executionMs
        );
        emit SettlementEconomicsRecorded(
            core.identity.settlementId,
            core.capital.protocolCapitalUsd,
            core.capital.borrowedCapitalUsd,
            core.capital.grossNotionalUsd,
            core.capital.quantity,
            core.economics.grossPnlUsd,
            core.economics.tradingFeesUsd,
            core.economics.networkFeesUsd,
            core.economics.financingFeesUsd,
            core.economics.otherFeesUsd,
            computed.totalFeesUsd
        );
        emit SettlementPricesRecorded(
            core.identity.settlementId,
            core.capital.entryPrice,
            core.capital.exitPrice,
            core.capital.averageEntryPrice
        );
        emit SettlementAuthenticationRecorded(
            core.identity.settlementId,
            computed.tradeSigner,
            computed.serverSigner,
            msg.sender
        );
        emit SettlementAssetsRecorded(
            core.identity.settlementId,
            core.metadata.baseAsset,
            core.metadata.quoteAsset
        );
    }

    function _archiveExecutionLeg(
        bytes32 settlementId,
        ExecutionLeg calldata leg
    ) private {
        _executionLegs[settlementId].push(leg);
        emit ExecutionLegRecorded(
            settlementId,
            leg.legIndex,
            leg.venue,
            leg.action,
            leg.externalReference
        );
        emit ExecutionLegAmountsRecorded(
            settlementId,
            leg.legIndex,
            leg.assetIn,
            leg.assetOut,
            leg.amountIn,
            leg.amountOut,
            leg.executionPrice
        );
    }

    function _archiveExtraField(
        bytes32 settlementId,
        uint16 fieldIndex,
        ExtraField calldata field
    ) private {
        _extraFields[settlementId].push(field);
        emit ExtraFieldRecorded(
            settlementId,
            fieldIndex,
            field.key,
            field.value
        );
    }

    function _processMarketplace(
        bytes32 settlementId,
        int256 netRealizedPnlUsd,
        uint256 navAfter
    ) private {
        if (marketplace == address(0)) {
            emit MarketplaceProcessingDeferred(settlementId, bytes32(0));
            return;
        }
        try
            IAVSTradingSettlementMarketplace(marketplace)
                .processAfterSettlement(
                    settlementId,
                    netRealizedPnlUsd,
                    navAfter
                )
        {
            emit MarketplaceProcessingSucceeded(settlementId, navAfter);
        } catch (bytes memory reason) {
            bytes32 reasonHash = reason.length == 0
                ? bytes32(0)
                : keccak256(reason);
            emit MarketplaceProcessingDeferred(settlementId, reasonHash);
        }
    }

    function _validateCore(TradeCore calldata core) private view {
        if (core.identity.positionId == bytes32(0)) {
            revert InvalidIdentifier();
        }
        if (core.identity.sequence == 0) revert InvalidSequence();
        if (core.identity.executionHash == bytes32(0)) {
            revert InvalidIdentifier();
        }
        if (core.capital.protocolCapitalUsd == 0) revert InvalidAmount();
        _validateString(
            "strategy",
            core.metadata.strategy,
            MAX_CORE_STRING_BYTES
        );
        _validateString(
            "executionType",
            core.metadata.executionType,
            MAX_CORE_STRING_BYTES
        );
        _validateString(
            "symbol",
            core.metadata.symbol,
            MAX_CORE_STRING_BYTES
        );
        _validateString(
            "baseAsset",
            core.metadata.baseAsset,
            MAX_CORE_STRING_BYTES
        );
        _validateString(
            "quoteAsset",
            core.metadata.quoteAsset,
            MAX_CORE_STRING_BYTES
        );
        _validateString(
            "venues",
            core.metadata.venues,
            MAX_VENUES_STRING_BYTES
        );

        if (
            core.timing.openedAt == 0 ||
            core.timing.closedAt < core.timing.openedAt
        ) {
            revert InvalidTimestamp();
        }
        uint256 latestAllowed = block.timestamp + MAX_FUTURE_TIMESTAMP;
        if (core.timing.openedAt > latestAllowed) {
            revert TimestampTooFarInFuture(
                core.timing.openedAt,
                latestAllowed
            );
        }
        if (core.timing.closedAt > latestAllowed) {
            revert TimestampTooFarInFuture(
                core.timing.closedAt,
                latestAllowed
            );
        }
    }

    function _validateString(
        string memory fieldName,
        string memory value,
        uint256 maximum
    ) private pure {
        bytes32 field = keccak256(bytes(fieldName));
        uint256 length = bytes(value).length;
        if (length == 0) revert InvalidString(field);
        if (length > maximum) revert StringTooLong(field, length, maximum);
    }

    function _hashSettlement(
        TradeCore calldata core,
        bytes32 legsHash,
        bytes32 extraFieldsHash
    ) private pure returns (bytes32) {
        bytes32 identityHash = keccak256(
            abi.encode(
                IDENTITY_HASH_TYPEHASH,
                core.identity.settlementId,
                core.identity.positionId,
                core.identity.sequence,
                core.identity.executionHash
            )
        );
        bytes32 metadataHash = keccak256(
            abi.encode(
                METADATA_HASH_TYPEHASH,
                keccak256(bytes(core.metadata.strategy)),
                keccak256(bytes(core.metadata.executionType)),
                keccak256(bytes(core.metadata.symbol)),
                keccak256(bytes(core.metadata.baseAsset)),
                keccak256(bytes(core.metadata.quoteAsset)),
                keccak256(bytes(core.metadata.venues))
            )
        );
        bytes32 capitalHash = keccak256(
            abi.encode(
                CAPITAL_HASH_TYPEHASH,
                core.capital.protocolCapitalUsd,
                core.capital.borrowedCapitalUsd,
                core.capital.grossNotionalUsd,
                core.capital.quantity,
                core.capital.entryPrice,
                core.capital.exitPrice,
                core.capital.averageEntryPrice
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                ECONOMICS_HASH_TYPEHASH,
                core.economics.grossPnlUsd,
                core.economics.tradingFeesUsd,
                core.economics.networkFeesUsd,
                core.economics.financingFeesUsd,
                core.economics.otherFeesUsd
            )
        );
        bytes32 timingHash = keccak256(
            abi.encode(
                TIMING_HASH_TYPEHASH,
                core.timing.openedAt,
                core.timing.closedAt,
                core.timing.executionMs
            )
        );
        return
            keccak256(
                abi.encode(
                    SETTLEMENT_HASH_TYPEHASH,
                    identityHash,
                    metadataHash,
                    capitalHash,
                    economicsHash,
                    timingHash,
                    legsHash,
                    extraFieldsHash
                )
            );
    }

    function _hashLegs(
        ExecutionLeg[] calldata legs
    ) private pure returns (bytes32) {
        if (legs.length > MAX_EXECUTION_LEGS) {
            revert TooManyExecutionLegs(legs.length, MAX_EXECUTION_LEGS);
        }
        bytes32[] memory hashes = new bytes32[](legs.length);
        for (uint256 index = 0; index < legs.length; index++) {
            ExecutionLeg calldata leg = legs[index];
            if (leg.legIndex != index) {
                revert InvalidLegIndex(uint16(index), leg.legIndex);
            }
            _validateString("legVenue", leg.venue, MAX_CORE_STRING_BYTES);
            _validateString("legAction", leg.action, MAX_CORE_STRING_BYTES);
            _validateString("legAssetIn", leg.assetIn, MAX_CORE_STRING_BYTES);
            _validateString(
                "legAssetOut",
                leg.assetOut,
                MAX_CORE_STRING_BYTES
            );
            hashes[index] = keccak256(
                abi.encode(
                    EXECUTION_LEG_TYPEHASH,
                    leg.legIndex,
                    keccak256(bytes(leg.venue)),
                    keccak256(bytes(leg.action)),
                    keccak256(bytes(leg.assetIn)),
                    keccak256(bytes(leg.assetOut)),
                    leg.amountIn,
                    leg.amountOut,
                    leg.executionPrice,
                    leg.externalReference
                )
            );
        }
        return keccak256(abi.encode(hashes));
    }

    function _hashExtraFields(
        ExtraField[] calldata extraFields
    ) private pure returns (bytes32) {
        if (extraFields.length > MAX_EXTRA_FIELDS) {
            revert TooManyExtraFields(extraFields.length, MAX_EXTRA_FIELDS);
        }
        bytes32[] memory hashes = new bytes32[](extraFields.length);
        for (uint256 index = 0; index < extraFields.length; index++) {
            ExtraField calldata field = extraFields[index];
            _validateString(
                "extraKey",
                field.key,
                MAX_EXTRA_KEY_BYTES
            );
            _validateString(
                "extraValue",
                field.value,
                MAX_EXTRA_VALUE_BYTES
            );
            hashes[index] = keccak256(
                abi.encode(
                    EXTRA_FIELD_TYPEHASH,
                    keccak256(bytes(field.key)),
                    keccak256(bytes(field.value))
                )
            );
        }
        return keccak256(abi.encode(hashes));
    }

    function _totalFees(
        TradeCore calldata core
    ) private pure returns (uint256 totalFees) {
        totalFees = _addFee(totalFees, core.economics.tradingFeesUsd);
        totalFees = _addFee(totalFees, core.economics.networkFeesUsd);
        totalFees = _addFee(totalFees, core.economics.financingFeesUsd);
        totalFees = _addFee(totalFees, core.economics.otherFeesUsd);
    }

    function _addFee(
        uint256 current,
        uint256 fee
    ) private pure returns (uint256) {
        uint256 signedMaximum = uint256(type(int256).max);
        if (fee > signedMaximum || current > signedMaximum - fee) {
            revert FeeOverflow();
        }
        return current + fee;
    }

    function _calculateNetPnl(
        int256 grossPnlUsd,
        uint256 totalFees
    ) private pure returns (int256) {
        int256 fees = int256(totalFees);
        if (
            grossPnlUsd < 0 &&
            grossPnlUsd < type(int256).min + fees
        ) {
            revert PnlOverflow();
        }
        return grossPnlUsd - fees;
    }

    function _settlementDigest(
        bytes32 settlementHash
    ) private view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(AUTHORIZATION_TYPEHASH, settlementHash)
                )
            );
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature,
        bool isTradeSigner
    ) private pure returns (address signer) {
        address recovered;
        ECDSA.RecoverError error;
        bytes32 errorArg;
        (recovered, error, errorArg) = ECDSA.tryRecoverCalldata(
            digest,
            signature
        );
        errorArg;
        if (error != ECDSA.RecoverError.NoError) {
            if (isTradeSigner) revert InvalidTradeSignature();
            revert InvalidServerSignature();
        }
        signer = recovered;
    }

    function _pullExactAmount(
        address source,
        uint256 amount
    ) private returns (uint256 actualReceived) {
        if (amount == 0) revert InvalidAmount();
        uint256 balanceBefore = USDT.balanceOf(address(this));
        USDT.safeTransferFrom(source, address(this), amount);
        uint256 balanceAfter = USDT.balanceOf(address(this));
        if (balanceAfter < balanceBefore) {
            revert InvalidBalanceChange(balanceBefore, balanceAfter);
        }
        actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) {
            revert ExactAmountNotReceived(amount, actualReceived);
        }
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 recipientBefore = USDT.balanceOf(recipient);
        uint256 settlementBefore = USDT.balanceOf(address(this));
        USDT.safeTransfer(recipient, amount);
        uint256 recipientAfter = USDT.balanceOf(recipient);
        uint256 settlementAfter = USDT.balanceOf(address(this));
        if (
            recipientAfter < recipientBefore ||
            recipientAfter - recipientBefore != amount ||
            settlementBefore < settlementAfter ||
            settlementBefore - settlementAfter != amount
        ) {
            revert ExactAmountNotSent(
                amount,
                recipientAfter < recipientBefore
                    ? 0
                    : recipientAfter - recipientBefore
            );
        }
    }

    function _setConfiguration(
        bytes32 configuration,
        address previousAddress,
        address newAddress
    ) private returns (address) {
        _requireContract(newAddress);
        _requireConfigurationAddress(newAddress, previousAddress);
        emit ConfigurationAddressUpdated(
            configuration,
            previousAddress,
            newAddress
        );
        return newAddress;
    }

    function _setOptionalConfiguration(
        bytes32 configuration,
        address previousAddress,
        address newAddress
    ) private returns (address) {
        if (newAddress != address(0)) {
            _requireContract(newAddress);
            _requireConfigurationAddress(newAddress, previousAddress);
        }
        emit ConfigurationAddressUpdated(
            configuration,
            previousAddress,
            newAddress
        );
        return newAddress;
    }

    function _requireConfigurationAddress(
        address candidate,
        address previousAddress
    ) private view {
        if (
            candidate == owner ||
            candidate == address(this) ||
            (candidate == avsLedger && previousAddress != avsLedger) ||
            (candidate == vault && previousAddress != vault) ||
            (candidate == marketplace && previousAddress != marketplace) ||
            (candidate == tradingDestination &&
                previousAddress != tradingDestination)
        ) {
            revert RoleCollision(candidate);
        }
    }

    function _setAuthorization(
        mapping(address => bool) storage role,
        address account,
        bool authorized,
        bytes32 roleName
    ) private {
        if (authorized) {
            if (account == address(0) || account == owner || account == address(this)) {
                revert InvalidAddress();
            }
            if (
                (roleName != keccak256("RELAYER") &&
                    authorizedRelayers[account]) ||
                (roleName != keccak256("TRADE_SIGNER") &&
                    authorizedTradeSigners[account]) ||
                (roleName != keccak256("SERVER_SIGNER") &&
                    authorizedServerSigners[account])
            ) {
                revert RoleCollision(account);
            }
        }
        role[account] = authorized;
        if (roleName == keccak256("RELAYER")) {
            emit RelayerAuthorizationUpdated(account, authorized);
        } else if (roleName == keccak256("TRADE_SIGNER")) {
            emit TradeSignerAuthorizationUpdated(account, authorized);
        } else {
            emit ServerSignerAuthorizationUpdated(account, authorized);
        }
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }
}