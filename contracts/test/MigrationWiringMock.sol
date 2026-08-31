// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @notice Test-only address registry used to exercise Migration constructor
 * wiring checks without changing production contracts.
 */
contract MigrationWiringMock {
    address public USDT;
    address public ledger;
    address public vault;
    address public avsLedger;
    address public avsToken;

    function configure(
        address usdt_,
        address ledger_,
        address vault_,
        address avsLedger_,
        address avsToken_
    ) external {
        USDT = usdt_;
        ledger = ledger_;
        vault = vault_;
        avsLedger = avsLedger_;
        avsToken = avsToken_;
    }
}