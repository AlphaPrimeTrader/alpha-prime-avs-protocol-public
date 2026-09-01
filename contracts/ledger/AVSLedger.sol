// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {
    IAVSLedger,
    IAVSMinimalToken
} from "./interfaces/IAVSLedger.sol";

/**
 * @title AVSLedger
 * @notice Global, accounting-only economic ledger for the AVS protocol.
 *
 * This contract does not custody assets, maintain user balances, or mint
 * shares. A future Vault or Issuer must perform those separate operations.
 * Its configured sources can write only their explicitly scoped accounting
 * entrypoint.
 */
contract AVSLedger is IAVSLedger {
    uint256 public constant ACCOUNTING_SCALE = 1e18;
    uint256 public constant POSITIVE_PNL_BUYBACK_BPS = 1_000;
    uint256 public constant BASIS_POINTS = 10_000;

    address public override owner;
    address public override avsToken;
    address public override vault;
    address public override tradeSettlement;

    uint256 public override totalNetAssets;
    uint256 public override totalGrossProfit;
    uint256 public override totalLoss;
    uint256 public override totalBuybackAllocated;
    uint256 public override buybackReserve;
    uint256 public override treasuryAVS;

    mapping(bytes32 capitalId => bool) public processedCapitalInflow;
    mapping(bytes32 settlementId => bool) public processedSettlement;
    mapping(bytes32 revenueId => bool)
        public override processedProtocolRevenue;
    mapping(bytes32 acquisitionId => bool)
        public override processedTreasuryAcquisition;
    mapping(bytes32 releaseId => bool) public override processedTreasuryRelease;

    mapping(bytes32 capitalId => CapitalRecord) private _capitalRecords;
    mapping(bytes32 settlementId => SettlementRecord) private _settlementRecords;
    mapping(bytes32 revenueId => ProtocolRevenueRecord)
        private _protocolRevenueRecords;
    mapping(bytes32 acquisitionId => TreasuryAcquisitionRecord)
        private _treasuryAcquisitionRecords;
    mapping(bytes32 releaseId => TreasuryReleaseRecord)
        private _treasuryReleaseRecords;
    uint256 public settlementCount;

    event AVSTokenBound(
        address indexed token,
        string tokenName
    );
    event OwnershipRenounced(address indexed previousOwner);
    event VaultConfigured(address indexed vaultSource);
    event TradeSettlementConfigured(address indexed tradeSettlementSource);
    event CapitalInflowRecorded(
        bytes32 indexed capitalId,
        address indexed beneficiary,
        uint256 capitalAmount,
        uint256 sharesQuoted,
        uint256 totalSupplyBefore,
        uint256 avsValueBefore
    );
    event TradingSettlementRecorded(
        bytes32 indexed settlementId,
        int256 realizedPnL,
        uint256 buybackAllocation,
        int256 netEconomicImpact,
        uint256 totalSupplyAtSettlement,
        uint256 avsValueBefore,
        uint256 avsValueAfter,
        uint256 timestamp
    );
    event ProtocolRevenueRecorded(
        bytes32 indexed revenueId,
        uint256 amount,
        uint256 totalSupplyAtRecord,
        uint256 avsValueBefore,
        uint256 avsValueAfter,
        uint256 timestamp
    );
    event TreasuryAcquisitionRecorded(
        bytes32 indexed acquisitionId,
        uint256 avsAmount,
        uint256 grossAmount,
        uint256 totalSupplyBefore,
        uint256 economicSupplyBefore,
        uint256 avsValueBefore,
        uint256 avsValueAfter,
        uint256 timestamp
    );
    event TreasuryReleaseRecorded(
        bytes32 indexed releaseId,
        uint256 avsAmount,
        uint256 grossAmount,
        uint256 totalSupplyBefore,
        uint256 economicSupplyBefore,
        uint256 avsValueBefore,
        uint256 avsValueAfter,
        uint256 timestamp
    );

    error Unauthorized(address caller);
    error InvalidOwner();
    error OwnershipRenunciationNotReady();
    error InvalidContract(address candidate);
    error AlreadyConfigured(address current);
    error InvalidIdentifier();
    error InvalidBeneficiary();
    error InvalidAmount();
    error AlreadyProcessed(bytes32 identifier);
    error InvalidTokenDecimals(uint8 actualDecimals);
    error ZeroNAVWithExistingSupply();
    error AVSTokenNotBound();
    error NoActiveEconomicSupply();
    error TreasuryAcquisitionExceedsEconomicSupply(
        uint256 availableEconomicSupply,
        uint256 requestedAVS
    );
    error TreasuryReleaseExceedsBalance(
        uint256 availableTreasuryAVS,
        uint256 requestedAVS
    );
    error InvalidTreasuryGrossAmount(uint256 expectedGross, uint256 actualGross);
    error LossExceedsEconomicAssets(
        uint256 availableAssets,
        uint256 requestedLoss
    );
    error ArithmeticOverflow();
    error ArithmeticUnderflow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault || vault == address(0)) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    modifier onlyTradeSettlement() {
        if (
            msg.sender != tradeSettlement ||
            tradeSettlement == address(0)
        ) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
    }

    function renounceOwnership() external onlyOwner {
        if (
            avsToken == address(0) ||
            vault == address(0) ||
            tradeSettlement == address(0)
        ) {
            revert OwnershipRenunciationNotReady();
        }

        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function bindAVSToken(address token) external onlyOwner {
        if (avsToken != address(0)) revert AlreadyConfigured(avsToken);
        _requireContract(token);

        string memory tokenName = IAVSMinimalToken(token).name();
        IAVSMinimalToken(token).totalSupply();
        uint8 tokenDecimals = IAVSMinimalToken(token).decimals();
        if (tokenDecimals != 18) {
            revert InvalidTokenDecimals(tokenDecimals);
        }
        avsToken = token;
        emit AVSTokenBound(token, tokenName);
    }

    function configureVault(address vaultSource) external onlyOwner {
        if (vault != address(0)) revert AlreadyConfigured(vault);
        _requireContract(vaultSource);

        vault = vaultSource;
        emit VaultConfigured(vaultSource);
    }

    function configureTradeSettlement(
        address tradeSettlementSource
    ) external onlyOwner {
        if (tradeSettlement != address(0)) {
            revert AlreadyConfigured(tradeSettlement);
        }
        _requireContract(tradeSettlementSource);

        tradeSettlement = tradeSettlementSource;
        emit TradeSettlementConfigured(tradeSettlementSource);
    }

    function currentAVSValue() public view override returns (uint256) {
        return _avsValueForSupply(economicSupply());
    }

    function economicSupply() public view override returns (uint256) {
        return _sub(_avsTotalSupply(), treasuryAVS);
    }

    function _avsValueForSupply(
        uint256 supply
    ) internal view returns (uint256) {
        if (supply == 0) return ACCOUNTING_SCALE;
        return Math.mulDiv(totalNetAssets, ACCOUNTING_SCALE, supply);
    }

    function getCurrentAVSValue() external view returns (uint256) {
        return currentAVSValue();
    }

    function avsTokenName() external view returns (string memory) {
        if (avsToken == address(0)) return "";
        return IAVSMinimalToken(avsToken).name();
    }

    function quoteCapitalInflow(
        uint256 capitalAmount
    ) public view override returns (uint256 sharesToMint) {
        if (capitalAmount == 0) revert InvalidAmount();

        return _quoteCapitalInflow(capitalAmount, economicSupply());
    }

    function _quoteCapitalInflow(
        uint256 capitalAmount,
        uint256 supply
    ) internal view returns (uint256 sharesToMint) {
        if (supply == 0) {
            return capitalAmount;
        }
        if (totalNetAssets == 0) revert ZeroNAVWithExistingSupply();

        // Floor rounding protects existing holders from dilution.
        return Math.mulDiv(capitalAmount, supply, totalNetAssets);
    }

    function calculateSharesForCapital(
        uint256 capitalAmount
    ) external view returns (uint256 sharesToMint) {
        return quoteCapitalInflow(capitalAmount);
    }

    function recordCapitalInflow(
        bytes32 capitalId,
        address beneficiary,
        uint256 capitalAmount
    ) external onlyVault returns (uint256 sharesToMint) {
        if (avsToken == address(0)) revert AVSTokenNotBound();
        if (capitalId == bytes32(0)) revert InvalidIdentifier();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (capitalAmount == 0) revert InvalidAmount();
        if (processedCapitalInflow[capitalId]) {
            revert AlreadyProcessed(capitalId);
        }

        uint256 supplyBefore = _avsTotalSupply();
        uint256 economicSupplyBefore = _sub(supplyBefore, treasuryAVS);
        uint256 valueBefore = _avsValueForSupply(economicSupplyBefore);
        sharesToMint = _quoteCapitalInflow(
            capitalAmount,
            economicSupplyBefore
        );
        processedCapitalInflow[capitalId] = true;
        _capitalRecords[capitalId] = CapitalRecord({
            capitalId: capitalId,
            beneficiary: beneficiary,
            capitalAmount: capitalAmount,
            sharesQuoted: sharesToMint,
            totalSupplyBefore: supplyBefore,
            avsValueBefore: valueBefore,
            timestamp: block.timestamp
        });
        totalNetAssets = _add(totalNetAssets, capitalAmount);

        emit CapitalInflowRecorded(
            capitalId,
            beneficiary,
            capitalAmount,
            sharesToMint,
            supplyBefore,
            valueBefore
        );
    }

    function recordProtocolRevenue(
        bytes32 revenueId,
        uint256 amount
    ) external onlyVault {
        if (avsToken == address(0)) revert AVSTokenNotBound();
        if (revenueId == bytes32(0)) revert InvalidIdentifier();
        if (amount == 0) revert InvalidAmount();
        if (processedProtocolRevenue[revenueId]) {
            revert AlreadyProcessed(revenueId);
        }

        uint256 supply = _avsTotalSupply();
        uint256 economicSupplyBefore = _sub(supply, treasuryAVS);
        if (economicSupplyBefore == 0) revert NoActiveEconomicSupply();
        uint256 valueBefore = _avsValueForSupply(economicSupplyBefore);
        processedProtocolRevenue[revenueId] = true;
        totalNetAssets = _add(totalNetAssets, amount);
        uint256 valueAfter = _avsValueForSupply(economicSupplyBefore);

        _protocolRevenueRecords[revenueId] = ProtocolRevenueRecord({
            revenueId: revenueId,
            amount: amount,
            totalSupplyAtRecord: supply,
            avsValueBefore: valueBefore,
            avsValueAfter: valueAfter,
            timestamp: block.timestamp
        });

        emit ProtocolRevenueRecorded(
            revenueId,
            amount,
            supply,
            valueBefore,
            valueAfter,
            block.timestamp
        );
    }

    function recordTreasuryAcquisition(
        bytes32 acquisitionId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external onlyVault {
        if (avsToken == address(0)) revert AVSTokenNotBound();
        if (acquisitionId == bytes32(0)) revert InvalidIdentifier();
        if (avsAmount == 0) revert InvalidAmount();
        if (processedTreasuryAcquisition[acquisitionId]) {
            revert AlreadyProcessed(acquisitionId);
        }

        uint256 supplyBefore = _avsTotalSupply();
        uint256 economicSupplyBefore = _sub(supplyBefore, treasuryAVS);
        if (economicSupplyBefore == 0) revert NoActiveEconomicSupply();
        if (avsAmount >= economicSupplyBefore) {
            revert TreasuryAcquisitionExceedsEconomicSupply(
                economicSupplyBefore,
                avsAmount
            );
        }
        uint256 valueBefore = _avsValueForSupply(economicSupplyBefore);
        uint256 expectedGross = _grossAtAVSValue(avsAmount, valueBefore);
        if (grossAmount != expectedGross) {
            revert InvalidTreasuryGrossAmount(expectedGross, grossAmount);
        }

        processedTreasuryAcquisition[acquisitionId] = true;
        treasuryAVS = _add(treasuryAVS, avsAmount);
        totalNetAssets = _sub(totalNetAssets, grossAmount);
        uint256 valueAfter = _avsValueForSupply(
            economicSupplyBefore - avsAmount
        );
        _treasuryAcquisitionRecords[acquisitionId] = TreasuryAcquisitionRecord({
            acquisitionId: acquisitionId,
            avsAmount: avsAmount,
            grossAmount: grossAmount,
            totalSupplyBefore: supplyBefore,
            economicSupplyBefore: economicSupplyBefore,
            avsValueBefore: valueBefore,
            avsValueAfter: valueAfter,
            timestamp: block.timestamp
        });

        emit TreasuryAcquisitionRecorded(
            acquisitionId,
            avsAmount,
            grossAmount,
            supplyBefore,
            economicSupplyBefore,
            valueBefore,
            valueAfter,
            block.timestamp
        );
    }

    function recordTreasuryRelease(
        bytes32 releaseId,
        uint256 avsAmount,
        uint256 grossAmount
    ) external onlyVault {
        if (avsToken == address(0)) revert AVSTokenNotBound();
        if (releaseId == bytes32(0)) revert InvalidIdentifier();
        if (avsAmount == 0) revert InvalidAmount();
        if (processedTreasuryRelease[releaseId]) {
            revert AlreadyProcessed(releaseId);
        }
        if (avsAmount > treasuryAVS) {
            revert TreasuryReleaseExceedsBalance(treasuryAVS, avsAmount);
        }

        uint256 supplyBefore = _avsTotalSupply();
        uint256 economicSupplyBefore = _sub(supplyBefore, treasuryAVS);
        if (economicSupplyBefore == 0) revert NoActiveEconomicSupply();
        uint256 valueBefore = _avsValueForSupply(economicSupplyBefore);
        uint256 expectedGross = _grossAtAVSValue(avsAmount, valueBefore);
        if (grossAmount != expectedGross) {
            revert InvalidTreasuryGrossAmount(expectedGross, grossAmount);
        }

        processedTreasuryRelease[releaseId] = true;
        treasuryAVS = _sub(treasuryAVS, avsAmount);
        totalNetAssets = _add(totalNetAssets, grossAmount);
        uint256 valueAfter = _avsValueForSupply(
            economicSupplyBefore + avsAmount
        );
        _treasuryReleaseRecords[releaseId] = TreasuryReleaseRecord({
            releaseId: releaseId,
            avsAmount: avsAmount,
            grossAmount: grossAmount,
            totalSupplyBefore: supplyBefore,
            economicSupplyBefore: economicSupplyBefore,
            avsValueBefore: valueBefore,
            avsValueAfter: valueAfter,
            timestamp: block.timestamp
        });

        emit TreasuryReleaseRecorded(
            releaseId,
            avsAmount,
            grossAmount,
            supplyBefore,
            economicSupplyBefore,
            valueBefore,
            valueAfter,
            block.timestamp
        );
    }

    function recordTradingSettlement(
        bytes32 settlementId,
        int256 realizedPnL
    ) external onlyTradeSettlement {
        if (avsToken == address(0)) revert AVSTokenNotBound();
        uint256 supply = _avsTotalSupply();
        uint256 economicSupplyBefore = _sub(supply, treasuryAVS);
        if (economicSupplyBefore == 0 || totalNetAssets == 0) {
            revert NoActiveEconomicSupply();
        }
        if (settlementId == bytes32(0)) revert InvalidIdentifier();
        if (processedSettlement[settlementId]) {
            revert AlreadyProcessed(settlementId);
        }

        uint256 valueBefore = _avsValueForSupply(economicSupplyBefore);
        uint256 buybackAllocation;
        int256 netEconomicImpact;

        if (realizedPnL > 0) {
            uint256 profit = uint256(realizedPnL);
            buybackAllocation = Math.mulDiv(
                profit,
                POSITIVE_PNL_BUYBACK_BPS,
                BASIS_POINTS
            );
            uint256 economicProfit = profit - buybackAllocation;
            totalGrossProfit = _add(totalGrossProfit, profit);
            totalBuybackAllocated = _add(
                totalBuybackAllocated,
                buybackAllocation
            );
            totalNetAssets = _add(totalNetAssets, economicProfit);
            netEconomicImpact = int256(economicProfit);
            buybackReserve = _add(buybackReserve, buybackAllocation);
        } else if (realizedPnL < 0) {
            uint256 loss = _negativeMagnitude(realizedPnL);
            if (loss > totalNetAssets) {
                revert LossExceedsEconomicAssets(totalNetAssets, loss);
            }
            totalLoss = _add(totalLoss, loss);
            totalNetAssets = _sub(totalNetAssets, loss);
            netEconomicImpact = realizedPnL;
        }

        uint256 valueAfter = _avsValueForSupply(economicSupplyBefore);
        processedSettlement[settlementId] = true;
        settlementCount = _add(settlementCount, 1);
        _settlementRecords[settlementId] = SettlementRecord({
            settlementId: settlementId,
            realizedPnL: realizedPnL,
            buybackAllocation: buybackAllocation,
            netEconomicImpact: netEconomicImpact,
            totalSupplyAtSettlement: supply,
            avsValueBefore: valueBefore,
            avsValueAfter: valueAfter,
            timestamp: block.timestamp
        });

        emit TradingSettlementRecorded(
            settlementId,
            realizedPnL,
            buybackAllocation,
            netEconomicImpact,
            supply,
            valueBefore,
            valueAfter,
            block.timestamp
        );
    }

    function settlementRecord(
        bytes32 settlementId
    ) external view override returns (SettlementRecord memory) {
        return _settlementRecords[settlementId];
    }

    function capitalRecord(
        bytes32 capitalId
    ) external view override returns (CapitalRecord memory) {
        return _capitalRecords[capitalId];
    }

    function protocolRevenueRecord(
        bytes32 revenueId
    ) external view override returns (ProtocolRevenueRecord memory) {
        return _protocolRevenueRecords[revenueId];
    }

    function treasuryAcquisitionRecord(
        bytes32 acquisitionId
    ) external view override returns (TreasuryAcquisitionRecord memory) {
        return _treasuryAcquisitionRecords[acquisitionId];
    }

    function treasuryReleaseRecord(
        bytes32 releaseId
    ) external view override returns (TreasuryReleaseRecord memory) {
        return _treasuryReleaseRecords[releaseId];
    }

    function _avsTotalSupply() internal view returns (uint256) {
        if (avsToken == address(0)) return 0;
        return IAVSMinimalToken(avsToken).totalSupply();
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }

    function _add(
        uint256 left,
        uint256 right
    ) private pure returns (uint256 result) {
        if (type(uint256).max - left < right) revert ArithmeticOverflow();
        return left + right;
    }

    function _sub(
        uint256 left,
        uint256 right
    ) private pure returns (uint256 result) {
        if (right > left) revert ArithmeticUnderflow();
        return left - right;
    }

    function _grossAtAVSValue(
        uint256 avsAmount,
        uint256 avsValue
    ) private pure returns (uint256) {
        return Math.mulDiv(avsAmount, avsValue, ACCOUNTING_SCALE);
    }

    function _negativeMagnitude(
        int256 value
    ) private pure returns (uint256) {
        return uint256(-(value + 1)) + 1;
    }
}