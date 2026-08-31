// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILegacyLedger} from "../migration/interfaces/ILegacyLedger.sol";

/**
 * @notice Minimal testing-only legacy Ledger with live daily-profit reads.
 */
contract OldLedgerMock is ILegacyLedger {
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant SECONDS_PER_DAY = 1 days;

    address public owner;
    address public vault;
    uint256 public dailyAPYBps;

    mapping(address user => UserInfo) private _users;

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidAddress();
    error InvalidTimestamp();
    error InvalidAPY();
    error InvalidAmount();
    error InsufficientBalance(uint256 available, uint256 requested);

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

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert InvalidAddress();
        vault = newVault;
    }

    function setDailyAPYBps(uint256 newDailyAPYBps) external onlyOwner {
        if (newDailyAPYBps > BASIS_POINTS) revert InvalidAPY();
        dailyAPYBps = newDailyAPYBps;
    }

    function seedUser(
        address user,
        uint256 depositAmount,
        uint256 accumulatedProfit,
        uint256 totalProfitEver,
        uint256 lastUpdate
    ) external onlyOwner {
        if (user == address(0)) revert InvalidAddress();
        if (lastUpdate > block.timestamp) revert InvalidTimestamp();

        _users[user] = UserInfo({
            depositAmount: depositAmount,
            accumulatedProfit: accumulatedProfit,
            totalProfitEver: totalProfitEver,
            lastUpdate: lastUpdate,
            totalBalance: 0
        });
    }

    function getUserInfo(
        address user
    ) external view override returns (UserInfo memory info) {
        UserInfo storage stored = _users[user];
        uint256 liveProfit = _liveProfit(stored);
        info = stored;
        info.accumulatedProfit += liveProfit;
        info.totalProfitEver += liveProfit;
        info.totalBalance =
            info.depositAmount +
            info.accumulatedProfit;
    }

    function debit(address user, uint256 amount) external onlyVault {
        if (amount == 0) revert InvalidAmount();

        UserInfo storage stored = _users[user];
        uint256 liveProfit = _liveProfit(stored);
        stored.accumulatedProfit += liveProfit;
        stored.totalProfitEver += liveProfit;
        stored.lastUpdate = block.timestamp;

        uint256 available =
            stored.depositAmount +
            stored.accumulatedProfit;
        if (amount > available) {
            revert InsufficientBalance(available, amount);
        }

        if (amount <= stored.accumulatedProfit) {
            stored.accumulatedProfit -= amount;
        } else {
            uint256 depositDebit = amount - stored.accumulatedProfit;
            stored.accumulatedProfit = 0;
            stored.depositAmount -= depositDebit;
        }
    }

    function _liveProfit(
        UserInfo storage stored
    ) private view returns (uint256) {
        if (stored.lastUpdate == 0 || dailyAPYBps == 0) return 0;
        uint256 elapsed = block.timestamp - stored.lastUpdate;
        return
            (stored.depositAmount * dailyAPYBps * elapsed) /
            (BASIS_POINTS * SECONDS_PER_DAY);
    }
}