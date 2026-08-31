// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMigrationReentryTarget {
    function migrate(address oldUser, address beneficiary) external;
}

/**
 * @notice Test-only legacy Vault that attempts a nested migration call.
 */
contract ReentrantOldVaultMock {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDT;
    address public oldLedger;
    address public target;
    address public reentryBeneficiary;

    constructor(address usdt) {
        USDT = IERC20(usdt);
    }

    function setWiring(address oldLedger_) external {
        oldLedger = oldLedger_;
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