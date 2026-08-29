// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSAccountAuthority {
    struct PublicKey {
        bytes32 qx;
        bytes32 qy;
    }

    struct Initialization {
        PublicKey transactionKey;
        PublicKey recoveryKey;
        PublicKey evolutionKey;
        bytes32 rpIdHash;
        address factory;
        bytes32 userSalt;
        address initialImplementation;
        bytes32 initialImplementationCodehash;
        uint64 initialStandardVersion;
    }

    function initializeAccount(
        address account,
        Initialization calldata initialization,
        bytes calldata creationSignature
    ) external;

    function validateTransactionSignature(
        address account,
        bytes32 digest,
        bytes calldata signature
    ) external view returns (bool);

    function validateEvolutionAuthorization(
        address account,
        bytes32 digest,
        bytes calldata transactionSignature,
        bytes calldata evolutionSignature
    ) external view returns (bool);

    function getCreationDigest(
        address account,
        Initialization calldata initialization
    ) external view returns (bytes32);

    function transactionKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy);

    function recoveryKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy);

    function evolutionKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy);

    function rpIdHash(address account) external view returns (bytes32);

    function isInitialized(address account) external view returns (bool);
}