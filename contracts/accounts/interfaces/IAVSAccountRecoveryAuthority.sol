// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccountAuthority} from "./IAVSAccountAuthority.sol";

interface IAVSAccountRecoveryAuthority is IAVSAccountAuthority {
    struct RecoveryRequest {
        PublicKey newTransactionKey;
        PublicKey newRecoveryKey;
        uint256 recoveryNonce;
        bytes32 requestId;
    }

    function requestRecovery(
        address account,
        RecoveryRequest calldata request,
        bytes calldata recoverySignature
    ) external;

    function getRecoveryDigest(
        address account,
        RecoveryRequest calldata request
    ) external view returns (bytes32);

    function transactionKeyVersion(
        address account
    ) external view returns (uint64);

    function recoveryKeyVersion(
        address account
    ) external view returns (uint64);

    function recoveryNonce(address account) external view returns (uint256);
}