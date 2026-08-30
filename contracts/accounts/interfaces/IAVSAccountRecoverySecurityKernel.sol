// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccountRecoveryAuthority} from "./IAVSAccountRecoveryAuthority.sol";

interface IAVSAccountRecoverySecurityKernel {
    function requestRecovery(
        IAVSAccountRecoveryAuthority.RecoveryRequest calldata request,
        bytes calldata recoverySignature
    ) external;
}