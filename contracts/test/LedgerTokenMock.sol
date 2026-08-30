// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice Test-only AVS Token reader/mint stand-in with configurable decimals.
 */
contract LedgerTokenMock is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(
        uint8 tokenDecimals
    ) ERC20("Ledger Token Mock", "LTM") {
        _tokenDecimals = tokenDecimals;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

/**
 * @notice Test-only token that fails one required binding read.
 */
contract LedgerTokenReadFailureMock {
    uint8 private immutable _failurePoint;

    error TokenReadFailed(uint8 failurePoint);

    constructor(uint8 failurePoint) {
        _failurePoint = failurePoint;
    }

    function name() external view returns (string memory) {
        if (_failurePoint == 1) revert TokenReadFailed(_failurePoint);
        return "Readable Token";
    }

    function totalSupply() external view returns (uint256) {
        if (_failurePoint == 2) revert TokenReadFailed(_failurePoint);
        return 0;
    }

    function decimals() external view returns (uint8) {
        if (_failurePoint == 3) revert TokenReadFailed(_failurePoint);
        return 18;
    }
}