// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IAVSEvolutionController {
    struct UpgradeRequest {
        address implementation;
        bytes32 codehash;
        uint64 standardVersion;
        uint48 validAfter;
        uint48 deadline;
        bytes32 requestId;
    }

    struct PendingUpgrade {
        address implementation;
        bytes32 codehash;
        uint64 standardVersion;
        uint48 requestedAt;
        uint48 executableAt;
        uint48 deadline;
        bytes32 requestId;
        uint256 nonce;
        uint64 transactionKeyVersion;
    }

    function initializeAccount(
        address account,
        address initialImplementation,
        bytes32 initialCodehash,
        uint64 initialStandardVersion
    ) external;

    function requestUpgrade(
        address account,
        UpgradeRequest calldata request,
        bytes calldata transactionSignature,
        bytes calldata evolutionSignature
    ) external;

    function cancelUpgrade(
        address account,
        bytes32 requestId,
        bytes calldata transactionSignature
    ) external;

    function finalizeUpgrade(address account) external;

    function currentImplementation(
        address account
    ) external view returns (address);

    function currentImplementationCodehash(
        address account
    ) external view returns (bytes32);

    function currentStandardVersion(
        address account
    ) external view returns (uint64);

    function upgradeNonce(address account) external view returns (uint256);

    function pendingUpgrade(
        address account
    ) external view returns (PendingUpgrade memory);

    function getUpgradeDigest(
        address account,
        UpgradeRequest calldata request
    ) external view returns (bytes32);

    function getCancellationDigest(
        address account,
        bytes32 requestId
    ) external view returns (bytes32);
}