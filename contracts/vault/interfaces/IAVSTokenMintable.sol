// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTokenMintable {
    function mint(address to, uint256 amount) external;

    function totalSupply() external view returns (uint256);

    function MAX_SUPPLY() external view returns (uint256);
}