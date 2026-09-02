// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal test-only module used to exercise Lens wiring failures.
contract MarketplaceWiringMock {
    address public immutable AVS;
    address public immutable USDT;
    address public immutable ledger;
    address public immutable vault;
    address public immutable settlementHook;

    constructor(
        address avs_,
        address usdt_,
        address ledger_,
        address vault_,
        address settlementHook_
    ) {
        AVS = avs_;
        USDT = usdt_;
        ledger = ledger_;
        vault = vault_;
        settlementHook = settlementHook_;
    }
}