// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAVSMigrationLedger} from "./interfaces/IAVSMigrationLedger.sol";
import {IAVSMigrationToken} from "./interfaces/IAVSMigrationToken.sol";
import {IAVSMigrationVault} from "./interfaces/IAVSMigrationVault.sol";
import {ILegacyLedger} from "./interfaces/ILegacyLedger.sol";
import {ILegacyVault} from "./interfaces/ILegacyVault.sol";

/**
 * @title Migration
 * @notice Owner-executed, one-time bridge for full legacy user balances.
 *
 * The bridge does not custody a user-selected amount. It reads the complete
 * live balance from the legacy Ledger, withdraws that exact amount from the
 * legacy Vault, and hands the received USDT to the configured AVS Vault.
 * Every external state-changing step is inside one non-reentrant transaction.
 */
contract Migration is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MIGRATION_DOMAIN =
        keccak256("AVS_MIGRATION_V1");

    IERC20 public immutable USDT;
    ILegacyLedger public immutable oldLedger;
    ILegacyVault public immutable oldVault;
    IAVSMigrationVault public immutable avsVault;
    IAVSMigrationLedger public immutable avsLedger;
    IAVSMigrationToken public immutable avsToken;
    address public immutable owner;

    bool public migrationClosed;
    mapping(address oldUser => bool) public migrated;

    event UserMigrated(
        address indexed oldUser,
        address indexed beneficiary,
        bytes32 indexed capitalId,
        uint256 migratedAmount,
        uint256 sharesMinted
    );
    event MigrationClosed();

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidContract(address candidate);
    error InvalidOldUser();
    error InvalidBeneficiary();
    error MigrationClosedError();
    error AlreadyMigrated(address oldUser);
    error NoMigratableBalance(address oldUser);
    error BeneficiaryNotWhitelisted(address beneficiary);
    error InvalidSupply(uint256 supply, uint256 maxSupply);
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error SharesToMintIsZero();
    error CapitalAlreadyProcessed(bytes32 capitalId);
    error InvalidBalanceChange(uint256 balanceBefore, uint256 balanceAfter);
    error ExactAmountNotReceived(uint256 expected, uint256 actual);
    error UnexpectedShares(uint256 quoted, uint256 minted);
    error MigrationAlreadyClosed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    constructor(
        address initialOwner,
        address oldLedgerAddress,
        address oldVaultAddress,
        address usdt,
        address avsVaultAddress,
        address avsLedgerAddress,
        address avsTokenAddress
    ) {
        if (initialOwner == address(0)) revert InvalidOwner();
        _requireContract(oldLedgerAddress);
        _requireContract(oldVaultAddress);
        _requireContract(usdt);
        _requireContract(avsVaultAddress);
        _requireContract(avsLedgerAddress);
        _requireContract(avsTokenAddress);

        owner = initialOwner;
        oldLedger = ILegacyLedger(oldLedgerAddress);
        oldVault = ILegacyVault(oldVaultAddress);
        USDT = IERC20(usdt);
        avsVault = IAVSMigrationVault(avsVaultAddress);
        avsLedger = IAVSMigrationLedger(avsLedgerAddress);
        avsToken = IAVSMigrationToken(avsTokenAddress);
    }

    function capitalId(address oldUser) public pure returns (bytes32) {
        return keccak256(abi.encode(MIGRATION_DOMAIN, oldUser));
    }

    function migrate(
        address oldUser,
        address beneficiary
    ) external onlyOwner nonReentrant returns (uint256 sharesMinted) {
        if (migrationClosed) revert MigrationClosedError();
        if (oldUser == address(0)) revert InvalidOldUser();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (migrated[oldUser]) revert AlreadyMigrated(oldUser);
        if (!avsToken.isWhitelisted(beneficiary)) {
            revert BeneficiaryNotWhitelisted(beneficiary);
        }

        ILegacyLedger.UserInfo memory userInfo =
            oldLedger.getUserInfo(oldUser);
        uint256 amount = userInfo.totalBalance;
        if (amount == 0) revert NoMigratableBalance(oldUser);

        uint256 supply = avsToken.totalSupply();
        uint256 maxSupply = avsToken.MAX_SUPPLY();
        if (supply > maxSupply) revert InvalidSupply(supply, maxSupply);

        uint256 quotedShares = avsLedger.quoteCapitalInflow(amount);
        if (quotedShares == 0) revert SharesToMintIsZero();
        uint256 available = maxSupply - supply;
        if (quotedShares > available) {
            revert MaxSupplyExceeded(quotedShares, available);
        }

        bytes32 id = capitalId(oldUser);
        if (avsLedger.processedCapitalInflow(id)) {
            revert CapitalAlreadyProcessed(id);
        }

        uint256 balanceBefore = USDT.balanceOf(address(this));
        oldVault.withdraw(oldUser, address(this), amount);
        uint256 balanceAfter = USDT.balanceOf(address(this));
        if (balanceAfter < balanceBefore) {
            revert InvalidBalanceChange(balanceBefore, balanceAfter);
        }
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) {
            revert ExactAmountNotReceived(amount, actualReceived);
        }

        USDT.forceApprove(address(avsVault), actualReceived);
        sharesMinted = avsVault.receiveMigrationCapital(
            id,
            beneficiary,
            actualReceived
        );
        if (sharesMinted != quotedShares) {
            revert UnexpectedShares(quotedShares, sharesMinted);
        }
        USDT.forceApprove(address(avsVault), 0);

        migrated[oldUser] = true;
        emit UserMigrated(
            oldUser,
            beneficiary,
            id,
            actualReceived,
            sharesMinted
        );
    }

    function closeMigration() external onlyOwner {
        if (migrationClosed) revert MigrationAlreadyClosed();
        migrationClosed = true;
        emit MigrationClosed();
    }

    receive() external payable {
        revert();
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }
}