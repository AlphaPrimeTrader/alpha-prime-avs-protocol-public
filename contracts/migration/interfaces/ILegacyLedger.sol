// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILegacyLedger {
    struct UserInfo {
        uint256 depositAmount;
        uint256 accumulatedProfit;
        uint256 totalProfitEver;
        uint256 lastUpdate;
        uint256 totalBalance;
    }

    function getUserInfo(
        address user
    ) external view returns (UserInfo memory);

    function vault() external view returns (address);

    function debit(address user, uint256 amount) external;
}