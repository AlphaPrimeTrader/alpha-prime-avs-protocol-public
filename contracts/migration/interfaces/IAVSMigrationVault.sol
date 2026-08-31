// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSMigrationVault {
    function USDT() external view returns (address);

    function avsLedger() external view returns (address);

    function avsToken() external view returns (address);

    function receiveMigrationCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external returns (uint256 sharesToMint);
}