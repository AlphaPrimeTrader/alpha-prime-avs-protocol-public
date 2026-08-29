// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

contract WebAuthnHarness {
    function verifyP256(
        bytes32 hash,
        bytes32 r,
        bytes32 s,
        bytes32 qx,
        bytes32 qy
    ) external view returns (bool) {
        return P256.verify(hash, r, s, qx, qy);
    }

    function verifyWebAuthn(
        bytes calldata challenge,
        WebAuthn.WebAuthnAuth calldata auth,
        bytes32 qx,
        bytes32 qy
    ) external view returns (bool) {
        return WebAuthn.verify(challenge, auth, qx, qy);
    }
}