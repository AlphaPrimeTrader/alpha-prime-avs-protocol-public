// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestUSDT
 * @notice Testnet-only USDT-shaped asset for AVS integration testing.
 *
 * This is not production USDT and must never be used for protocol funds.
 * The explicit owner may mint test balances solely to exercise Testnet flows.
 */
contract TestUSDT is ERC20 {
    address public owner;

    event OwnershipRenounced(address indexed previousOwner);

    error Unauthorized(address caller);
    error InvalidOwner();
    error InvalidRecipient();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    constructor(address initialOwner) ERC20("Test USDT", "USDT") {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
    }

    function mint(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        _mint(recipient, amount);
    }
}