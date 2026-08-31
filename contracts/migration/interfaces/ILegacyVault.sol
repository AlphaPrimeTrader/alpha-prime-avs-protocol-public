// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILegacyVault {
    function USDT() external view returns (address);

    function ledger() external view returns (address);

    function executors(address executor) external view returns (bool);

    function withdraw(
        address oldUser,
        address recipient,
        uint256 amount
    ) external;
}