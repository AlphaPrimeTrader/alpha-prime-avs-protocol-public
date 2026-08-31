// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSMigrationToken {
    function vault() external view returns (address);

    function isWhitelisted(address account) external view returns (bool);

    function totalSupply() external view returns (uint256);

    function MAX_SUPPLY() external view returns (uint256);
}