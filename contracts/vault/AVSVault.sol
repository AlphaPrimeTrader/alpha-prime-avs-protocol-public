// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAVSLedger} from "../ledger/interfaces/IAVSLedger.sol";
import {IAVSTokenMintable} from "./interfaces/IAVSTokenMintable.sol";

/**
 * @title AVSVault
 * @notice Treasury and deterministic USDT router for the AVS protocol.
 *
 * The Vault never exposes an owner-controlled funds-out operation. Protocol
 * money only leaves through the fixed Marketplace liquidity and Trading excess
 * routes, while capital accounting and AVS minting are atomic.
 */
contract AVSVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 private constant AVS_TOKEN_CONFIGURATION = keccak256("AVS_TOKEN");
    bytes32 private constant AVS_LEDGER_CONFIGURATION =
        keccak256("AVS_LEDGER");
    bytes32 private constant MIGRATION_CONFIGURATION =
        keccak256("MIGRATION");
    bytes32 private constant MARKETPLACE_CONFIGURATION =
        keccak256("MARKETPLACE");
    bytes32 private constant TRADING_CONFIGURATION = keccak256("TRADING");

    IERC20 public immutable USDT;
    address public owner;
    address public avsToken;
    address public avsLedger;
    address public migration;
    address public marketplace;
    address public tradingContract;
    bool public configurationLocked;
    uint256 public reserveTarget;

    event ConfigurationAddressUpdated(
        bytes32 indexed configuration,
        address indexed previousAddress,
        address indexed newAddress
    );
    event ConfigurationLocked();
    event ReserveTargetUpdated(uint256 previousTarget, uint256 newTarget);
    event MarketplaceCapitalReceived(
        bytes32 indexed capitalId,
        address indexed beneficiary,
        uint256 amount,
        uint256 sharesToMint
    );
    event MigrationCapitalReceived(
        bytes32 indexed capitalId,
        address indexed beneficiary,
        uint256 amount,
        uint256 sharesToMint
    );
    event ProtocolRevenueReceived(
        bytes32 indexed revenueId,
        address indexed source,
        uint256 amount
    );
    event TradingFundsReturned(address indexed source, uint256 amount);
    event MarketLiquidityProvided(uint256 amount);
    event ExcessRoutedToTrading(uint256 amount);
    event ExcessRetainedBecauseTradingNotConfigured(uint256 amount);

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidContract(address candidate);
    error AuthorityCollision(address candidate);
    error ConfigurationLockedError();
    error ConfigurationNotReady(bytes32 configuration);
    error InvalidIdentifier();
    error InvalidBeneficiary();
    error InvalidAmount();
    error InvalidBalanceChange(uint256 balanceBefore, uint256 balanceAfter);
    error ExactAmountNotReceived(uint256 expected, uint256 actual);
    error LedgerNotConfigured();
    error TokenNotConfigured();
    error SharesToMintIsZero();
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error InsufficientMarketLiquidity(uint256 requested, uint256 available);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyMarketplace() {
        if (marketplace == address(0) || msg.sender != marketplace) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    modifier onlyMigration() {
        if (migration == address(0) || msg.sender != migration) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    modifier onlyTradingContract() {
        if (
            tradingContract == address(0) ||
            msg.sender != tradingContract
        ) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address initialOwner, address usdt) {
        if (initialOwner == address(0)) revert InvalidOwner();
        _requireContract(usdt);

        owner = initialOwner;
        USDT = IERC20(usdt);
    }

    function setAVSToken(address newAddress) external onlyOwner {
        avsToken = _setConfiguration(
            AVS_TOKEN_CONFIGURATION,
            avsToken,
            newAddress
        );
    }

    function setAVSLedger(address newAddress) external onlyOwner {
        avsLedger = _setConfiguration(
            AVS_LEDGER_CONFIGURATION,
            avsLedger,
            newAddress
        );
    }

    function setMigration(address newAddress) external onlyOwner {
        migration = _setConfiguration(
            MIGRATION_CONFIGURATION,
            migration,
            newAddress
        );
    }

    function setMarketplace(address newAddress) external onlyOwner {
        marketplace = _setConfiguration(
            MARKETPLACE_CONFIGURATION,
            marketplace,
            newAddress
        );
    }

    function setTradingContract(address newAddress) external onlyOwner {
        tradingContract = _setConfiguration(
            TRADING_CONFIGURATION,
            tradingContract,
            newAddress
        );
    }

    function lockConfiguration() external onlyOwner {
        if (configurationLocked) revert ConfigurationLockedError();
        _requireConfigurationReady(
            AVS_TOKEN_CONFIGURATION,
            avsToken
        );
        _requireConfigurationReady(
            AVS_LEDGER_CONFIGURATION,
            avsLedger
        );
        _requireConfigurationReady(
            MIGRATION_CONFIGURATION,
            migration
        );
        _requireConfigurationReady(
            MARKETPLACE_CONFIGURATION,
            marketplace
        );
        _requireConfigurationReady(
            TRADING_CONFIGURATION,
            tradingContract
        );

        configurationLocked = true;
        emit ConfigurationLocked();
    }

    function setReserveTarget(uint256 newTarget) external onlyOwner {
        uint256 previousTarget = reserveTarget;
        reserveTarget = newTarget;
        emit ReserveTargetUpdated(previousTarget, newTarget);
    }

    function availableMarketLiquidity() public view returns (uint256) {
        uint256 balance = USDT.balanceOf(address(this));
        return balance < reserveTarget ? balance : reserveTarget;
    }

    function provideMarketLiquidity(
        uint256 amount
    ) external onlyMarketplace nonReentrant {
        if (amount == 0) revert InvalidAmount();

        uint256 available = availableMarketLiquidity();
        if (amount > available) {
            revert InsufficientMarketLiquidity(amount, available);
        }

        USDT.safeTransfer(marketplace, amount);
        emit MarketLiquidityProvided(amount);
    }

    function receiveMarketplaceCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external onlyMarketplace nonReentrant returns (uint256 sharesToMint) {
        sharesToMint = _receiveCapital(
            capitalId,
            beneficiary,
            amount
        );
        emit MarketplaceCapitalReceived(
            capitalId,
            beneficiary,
            amount,
            sharesToMint
        );
    }

    function receiveMigrationCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external onlyMigration nonReentrant returns (uint256 sharesToMint) {
        sharesToMint = _receiveCapital(
            capitalId,
            beneficiary,
            amount
        );
        emit MigrationCapitalReceived(
            capitalId,
            beneficiary,
            amount,
            sharesToMint
        );
    }

    function receiveMarketplaceRevenue(
        bytes32 revenueId,
        uint256 amount
    ) external onlyMarketplace nonReentrant {
        _receiveMarketplaceRevenue(revenueId, amount);
    }

    function receiveTradingReturn(
        uint256 amount
    ) external onlyTradingContract nonReentrant {
        _receiveTradingReturn(amount);
    }

    function _receiveCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) private returns (uint256 sharesToMint) {
        _validateCapital(capitalId, beneficiary, amount);
        if (avsLedger == address(0)) revert LedgerNotConfigured();
        if (avsToken == address(0)) revert TokenNotConfigured();

        uint256 actualReceived = _pullExactAmount(msg.sender, amount);
        sharesToMint = IAVSLedger(avsLedger).recordCapitalInflow(
            capitalId,
            beneficiary,
            actualReceived
        );
        if (sharesToMint == 0) revert SharesToMintIsZero();

        IAVSTokenMintable token = IAVSTokenMintable(avsToken);
        uint256 supply = token.totalSupply();
        uint256 maxSupply = token.MAX_SUPPLY();
        if (supply > maxSupply || sharesToMint > maxSupply - supply) {
            uint256 available = supply > maxSupply ? 0 : maxSupply - supply;
            revert MaxSupplyExceeded(sharesToMint, available);
        }

        token.mint(beneficiary, sharesToMint);
        _routeExcessToTrading();
    }

    function _receiveMarketplaceRevenue(
        bytes32 revenueId,
        uint256 amount
    ) private {
        if (revenueId == bytes32(0)) revert InvalidIdentifier();
        if (avsLedger == address(0)) revert LedgerNotConfigured();

        uint256 actualReceived = _pullExactAmount(msg.sender, amount);
        IAVSLedger(avsLedger).recordProtocolRevenue(
            revenueId,
            actualReceived
        );
        emit ProtocolRevenueReceived(
            revenueId,
            msg.sender,
            actualReceived
        );
        _routeExcessToTrading();
    }

    function _receiveTradingReturn(uint256 amount) private {
        uint256 actualReceived = _pullExactAmount(msg.sender, amount);
        emit TradingFundsReturned(msg.sender, actualReceived);
        _routeExcessToTrading();
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

    function _routeExcessToTrading() internal {
        uint256 balance = USDT.balanceOf(address(this));
        if (balance <= reserveTarget) return;

        uint256 excess = balance - reserveTarget;
        if (tradingContract == address(0)) {
            emit ExcessRetainedBecauseTradingNotConfigured(excess);
            return;
        }

        USDT.safeTransfer(tradingContract, excess);
        emit ExcessRoutedToTrading(excess);
    }

    function _setConfiguration(
        bytes32 configuration,
        address previousAddress,
        address newAddress
    ) private returns (address) {
        if (configurationLocked) revert ConfigurationLockedError();
        _requireContract(newAddress);
        _requireDistinctAuthority(newAddress, previousAddress);

        emit ConfigurationAddressUpdated(
            configuration,
            previousAddress,
            newAddress
        );
        return newAddress;
    }

    function _validateCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) private pure {
        if (capitalId == bytes32(0)) revert InvalidIdentifier();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (amount == 0) revert InvalidAmount();
    }

    function _requireDistinctAuthority(
        address candidate,
        address previousAddress
    ) private view {
        if (candidate == owner || candidate == address(this)) {
            revert AuthorityCollision(candidate);
        }
        if (
            (candidate == avsToken && previousAddress != avsToken) ||
            (candidate == avsLedger && previousAddress != avsLedger) ||
            (candidate == migration && previousAddress != migration) ||
            (candidate == marketplace && previousAddress != marketplace) ||
            (candidate == tradingContract &&
                previousAddress != tradingContract)
        ) {
            revert AuthorityCollision(candidate);
        }
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }

    function _requireConfigurationReady(
        bytes32 configuration,
        address configuredAddress
    ) private pure {
        if (configuredAddress == address(0)) {
            revert ConfigurationNotReady(configuration);
        }
    }
}