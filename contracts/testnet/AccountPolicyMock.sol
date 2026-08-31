// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTokenAccountAuthorization {
    function authorizeAccount(address account) external;
}

/**
 * @notice Testnet-only Account Policy adapter for the real AVSToken.
 *
 * This contract intentionally exposes only the one authorization operation
 * needed by the Phase 4D Testnet rehearsal.
 */
contract AccountPolicyMock {
    address public immutable owner;
    IAVSTokenAccountAuthorization public immutable avsToken;

    error InvalidOwner();
    error InvalidContract(address candidate);
    error InvalidAccount();
    error Unauthorized(address caller);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    constructor(address initialOwner, address tokenAddress) {
        if (initialOwner == address(0)) revert InvalidOwner();
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) {
            revert InvalidContract(tokenAddress);
        }

        owner = initialOwner;
        avsToken = IAVSTokenAccountAuthorization(tokenAddress);
    }

    function authorizeAccount(address account) external onlyOwner {
        if (account == address(0)) revert InvalidAccount();
        avsToken.authorizeAccount(account);
    }
}