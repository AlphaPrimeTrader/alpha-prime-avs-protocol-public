// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMigrationReentryTarget {
    function migrate(address oldUser, address beneficiary) external;
}

/**
 * @notice Test-only reader used to prove capital-id collision checks happen
 * before the legacy withdrawal.
 */
contract MigrationLedgerReaderMock {
    uint256 public quote;
    bool public processed;

    constructor(uint256 quote_, bool processed_) {
        quote = quote_;
        processed = processed_;
    }

    function quoteCapitalInflow(
        uint256
    ) external view returns (uint256 sharesToMint) {
        return quote;
    }

    function processedCapitalInflow(
        bytes32
    ) external view returns (bool) {
        return processed;
    }
}

/**
 * @notice Test-only legacy Vault that attempts a nested migration call.
 */
contract ReentrantOldVaultMock {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDT;
    address public target;
    address public reentryBeneficiary;

    constructor(address usdt) {
        USDT = IERC20(usdt);
    }

    function setReentry(
        address target_,
        address beneficiary_
    ) external {
        target = target_;
        reentryBeneficiary = beneficiary_;
    }

    function startMigration(address oldUser, address beneficiary) external {
        IMigrationReentryTarget(target).migrate(oldUser, beneficiary);
    }

    function withdraw(
        address oldUser,
        address recipient,
        uint256 amount
    ) external {
        IMigrationReentryTarget(target).migrate(
            oldUser,
            reentryBeneficiary
        );
        USDT.safeTransfer(recipient, amount);
    }
}