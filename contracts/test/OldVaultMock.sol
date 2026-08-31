// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILegacyLedger} from "../migration/interfaces/ILegacyLedger.sol";

/**
 * @notice Minimal testing-only legacy Vault with executor-gated withdrawals.
 */
contract OldVaultMock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDT;
    ILegacyLedger public immutable ledger;
    address public owner;
    mapping(address executor => bool) public executors;

    event ExecutorUpdated(
        address indexed executor,
        bool indexed authorized
    );
    event Withdrawn(
        address indexed oldUser,
        address indexed recipient,
        uint256 amount
    );

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidContract(address candidate);
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyExecutor() {
        if (!executors[msg.sender]) revert Unauthorized(msg.sender);
        _;
    }

    constructor(
        address initialOwner,
        address usdt,
        address ledgerAddress
    ) {
        if (initialOwner == address(0)) revert InvalidOwner();
        _requireContract(usdt);
        _requireContract(ledgerAddress);
        owner = initialOwner;
        USDT = IERC20(usdt);
        ledger = ILegacyLedger(ledgerAddress);
    }

    function setExecutor(
        address executor,
        bool authorized
    ) external onlyOwner {
        if (executor == address(0)) revert InvalidAddress();
        executors[executor] = authorized;
        emit ExecutorUpdated(executor, authorized);
    }

    function withdraw(
        address oldUser,
        address recipient,
        uint256 amount
    ) external onlyExecutor nonReentrant {
        if (oldUser == address(0) || recipient == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) revert InvalidAmount();

        uint256 available = USDT.balanceOf(address(this));
        if (amount > available) {
            revert InsufficientBalance(available, amount);
        }

        ledger.debit(oldUser, amount);
        USDT.safeTransfer(recipient, amount);
        emit Withdrawn(oldUser, recipient, amount);
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }
}