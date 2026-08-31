// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSTokenActorTarget {
    function authorizeAccount(address account) external;

    function mint(address to, uint256 amount) external;
}

/**
 * @notice Test-only contract actors for the separated Token authorities.
 */
contract AVSTokenPolicyMock {
    function authorize(address token, address account) external {
        IAVSTokenActorTarget(token).authorizeAccount(account);
    }
}

contract AVSTokenVaultMock {
    function mint(address token, address account, uint256 amount) external {
        IAVSTokenActorTarget(token).mint(account, amount);
    }
}

contract AVSTokenCombinedAuthorityMock {
    function authorize(address token, address account) external {
        IAVSTokenActorTarget(token).authorizeAccount(account);
    }

    function mint(address token, address account, uint256 amount) external {
        IAVSTokenActorTarget(token).mint(account, amount);
    }
}