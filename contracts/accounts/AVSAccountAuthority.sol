// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

import {IAVSAccountAuthority} from "./interfaces/IAVSAccountAuthority.sol";

/**
 * @title AVSAccountAuthority
 * @notice Immutable, ownerless signer authority for Phase 3A accounts.
 *
 * Proxy or Kernel origin is never sufficient authorization. Every signature is
 * verified against the exact digest supplied by the immutable Kernel or
 * EvolutionController.
 */
contract AVSAccountAuthority is IAVSAccountAuthority {
    bytes32 public constant CREATION_TYPEHASH = keccak256(
        "AVSAccountCreation(address account,address authority,address factory,uint256 chainId,bytes32 securityConfigurationHash)"
    );
    bytes32 public constant SECURITY_CONFIGURATION_TYPEHASH = keccak256(
        "AVSSecurityConfiguration(bytes32 transactionKeyHash,bytes32 recoveryKeyHash,bytes32 evolutionKeyHash,bytes32 rpIdHash,bytes32 userSalt,address initialImplementation,bytes32 initialImplementationCodehash,uint64 initialStandardVersion)"
    );
    bytes32 public constant PUBLIC_KEY_TYPEHASH = keccak256(
        "AVSP256PublicKey(bytes32 qx,bytes32 qy)"
    );

    struct AccountAuthority {
        PublicKey transactionKey;
        PublicKey recoveryKey;
        PublicKey evolutionKey;
        bytes32 rpIdHash;
        bool initialized;
    }

    mapping(address account => AccountAuthority) private _authorities;

    event AccountAuthorityInitialized(
        address indexed account,
        bytes32 indexed transactionKeyX,
        bytes32 indexed transactionKeyY,
        bytes32 recoveryKeyX,
        bytes32 recoveryKeyY,
        bytes32 evolutionKeyX,
        bytes32 evolutionKeyY
    );

    error AccountAlreadyInitialized(address account);
    error InvalidInitializationCaller(address caller, address account);
    error InvalidPublicKey();
    error InvalidCreationSignature();

    function initializeAccount(
        address account,
        Initialization calldata initialization,
        bytes calldata creationSignature
    ) external {
        if (msg.sender != account || account.code.length != 0) {
            revert InvalidInitializationCaller(msg.sender, account);
        }

        AccountAuthority storage accountAuthority = _authorities[account];
        if (accountAuthority.initialized) {
            revert AccountAlreadyInitialized(account);
        }

        if (
            !P256.isValidPublicKey(
                initialization.transactionKey.qx,
                initialization.transactionKey.qy
            ) ||
            !P256.isValidPublicKey(
                initialization.recoveryKey.qx,
                initialization.recoveryKey.qy
            ) ||
            !P256.isValidPublicKey(
                initialization.evolutionKey.qx,
                initialization.evolutionKey.qy
            )
        ) {
            revert InvalidPublicKey();
        }

        bytes32 creationDigest = getCreationDigest(account, initialization);
        if (
            !_verifyWebAuthn(
                creationDigest,
                creationSignature,
                initialization.transactionKey,
                initialization.rpIdHash
            )
        ) {
            revert InvalidCreationSignature();
        }

        accountAuthority.transactionKey = initialization.transactionKey;
        accountAuthority.recoveryKey = initialization.recoveryKey;
        accountAuthority.evolutionKey = initialization.evolutionKey;
        accountAuthority.rpIdHash = initialization.rpIdHash;
        accountAuthority.initialized = true;

        emit AccountAuthorityInitialized(
            account,
            initialization.transactionKey.qx,
            initialization.transactionKey.qy,
            initialization.recoveryKey.qx,
            initialization.recoveryKey.qy,
            initialization.evolutionKey.qx,
            initialization.evolutionKey.qy
        );
    }

    function validateTransactionSignature(
        address account,
        bytes32 digest,
        bytes calldata signature
    ) external view returns (bool) {
        AccountAuthority storage accountAuthority = _authorities[account];
        return
            accountAuthority.initialized &&
            _verifyWebAuthn(
                digest,
                signature,
                accountAuthority.transactionKey,
                accountAuthority.rpIdHash
            );
    }

    function validateEvolutionAuthorization(
        address account,
        bytes32 digest,
        bytes calldata transactionSignature,
        bytes calldata evolutionSignature
    ) external view returns (bool) {
        AccountAuthority storage accountAuthority = _authorities[account];
        return
            accountAuthority.initialized &&
            _verifyWebAuthn(
                digest,
                transactionSignature,
                accountAuthority.transactionKey,
                accountAuthority.rpIdHash
            ) &&
            _verifyWebAuthn(
                digest,
                evolutionSignature,
                accountAuthority.evolutionKey,
                accountAuthority.rpIdHash
            );
    }

    function getCreationDigest(
        address account,
        Initialization calldata initialization
    ) public view returns (bytes32) {
        bytes32 securityConfigurationHash = keccak256(
            abi.encode(
                SECURITY_CONFIGURATION_TYPEHASH,
                _publicKeyHash(initialization.transactionKey),
                _publicKeyHash(initialization.recoveryKey),
                _publicKeyHash(initialization.evolutionKey),
                initialization.rpIdHash,
                initialization.userSalt,
                initialization.initialImplementation,
                initialization.initialImplementationCodehash,
                initialization.initialStandardVersion
            )
        );
        return
            keccak256(
                abi.encode(
                    CREATION_TYPEHASH,
                    account,
                    address(this),
                    initialization.factory,
                    block.chainid,
                    securityConfigurationHash
                )
            );
    }

    function transactionKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy) {
        PublicKey storage key = _authorities[account].transactionKey;
        return (key.qx, key.qy);
    }

    function recoveryKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy) {
        PublicKey storage key = _authorities[account].recoveryKey;
        return (key.qx, key.qy);
    }

    function evolutionKey(
        address account
    ) external view returns (bytes32 qx, bytes32 qy) {
        PublicKey storage key = _authorities[account].evolutionKey;
        return (key.qx, key.qy);
    }

    function isInitialized(address account) external view returns (bool) {
        return _authorities[account].initialized;
    }

    function rpIdHash(address account) external view returns (bytes32) {
        return _authorities[account].rpIdHash;
    }

    function _verifyWebAuthn(
        bytes32 digest,
        bytes calldata signature,
        PublicKey storage key,
        bytes32 expectedRpIdHash
    ) private view returns (bool) {
        (bool success, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn
            .tryDecodeAuth(signature);
        return
            success &&
            auth.authenticatorData.length >= 32 &&
            bytes32(auth.authenticatorData[0:32]) == expectedRpIdHash &&
            WebAuthn.verify(
                abi.encodePacked(digest),
                auth,
                key.qx,
                key.qy
            );
    }

    function _verifyWebAuthn(
        bytes32 digest,
        bytes calldata signature,
        PublicKey calldata key,
        bytes32 expectedRpIdHash
    ) private view returns (bool) {
        (bool success, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn
            .tryDecodeAuth(signature);
        return
            success &&
            auth.authenticatorData.length >= 32 &&
            bytes32(auth.authenticatorData[0:32]) == expectedRpIdHash &&
            WebAuthn.verify(
                abi.encodePacked(digest),
                auth,
                key.qx,
                key.qy
            );
    }

    function _publicKeyHash(
        PublicKey calldata key
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(PUBLIC_KEY_TYPEHASH, key.qx, key.qy));
    }
}