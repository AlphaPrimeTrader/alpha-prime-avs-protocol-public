// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILegacyVault {
    function withdraw(
        address oldUser,
        address recipient,
        uint256 amount
    ) external;
}