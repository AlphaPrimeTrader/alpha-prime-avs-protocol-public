// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILegacyVault {
    function USDT() external view returns (address);

    function oldLedger() external view returns (address);

    function withdraw(
        address oldUser,
        address recipient,
        uint256 amount
    ) external;
}