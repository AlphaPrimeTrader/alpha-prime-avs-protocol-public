// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

import {IAVSAccountRecoveryAuthority} from "./interfaces/IAVSAccountRecoveryAuthority.sol";

/**
 * @title AVSAccountRecoveryAuthority
 * @notice Phase 3B ownerless authority with bounded offline recovery.
 *
 * The Recovery key is a raw P-256 signing key stored only in the encrypted
 * Offline Recovery Kit. It is deliberately not accepted by UserOperation or
 * Evolution verification paths.
 */
contract AVSAccountRecoveryAuthority is IAVSAccountRecoveryAuthority {
    bytes32 public constant CREATION_TYPEHASH = keccak256(
        "AVSAccountCreation(address account,address authority,address factory,uint256 chainId,bytes32 securityConfigurationHash)"
    );
    bytes32 public constant SECURITY_CONFIGURATION_TYPEHASH = keccak256(
        "AVSSecurityConfiguration(bytes32 transactionKeyHash,bytes32 recoveryKeyHash,bytes32 evolutionKeyHash,bytes32 rpIdHash,bytes32 userSalt,address initialImplementation,bytes32 initialImplementationCodehash,uint64 initialStandardVersion)"
    );
    bytes32 public constant RECOVERY_DOMAIN =
        keccak256(
            "AVS_ACCOUNT_RECOVERY_PHASE_3B_ATOMIC_ROOT_ROTATION_V1"
        );
    bytes32
        public constant RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS =
        keccak256(
            "AVS_RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS"
        );
    bytes32 public constant RECOVERY_TYPEHASH = keccak256(
        "AVSAccountRecovery(bytes32 domain,address account,address authority,uint256 chainId,bytes32 currentTransactionKeyHash,uint64 currentTransactionKeyVersion,bytes32 currentRecoveryKeyHash,uint64 currentRecoveryKeyVersion,bytes32 newTransactionKeyHash,bytes32 newRecoveryKeyHash,bytes32 actionType,uint256 recoveryNonce,bytes32 requestId)"
    );
    bytes32 public constant PUBLIC_KEY_TYPEHASH = keccak256(
        "AVSP256PublicKey(bytes32 qx,bytes32 qy)"
    );

    struct AccountAuthority {
        PublicKey transactionKey;
        PublicKey recoveryKey;
        PublicKey evolutionKey;
        bytes32 rpIdHash;
        uint64 transactionKeyVersion;
        uint64 recoveryKeyVersion;
        uint256 recoveryNonce;
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
    event RecoveryExecuted(
        address indexed account,
        bytes32 indexed requestId,
        bytes32 newTransactionKeyHash,
        bytes32 newRecoveryKeyHash,
        uint64 transactionKeyVersion,
        uint64 recoveryKeyVersion,
        uint256 consumedRecoveryNonce
    );

    error AccountAlreadyInitialized(address account);
    error InvalidInitializationCaller(address caller, address account);
    error InvalidPublicKey();
    error InvalidCreationSignature();
    error AccountNotInitialized(address account);
    error UnauthorizedAccountCaller(address caller, address account);
    error InvalidRecoveryNonce(uint256 expected, uint256 received);
    error InvalidRecoveryRequestId();
    error TransactionKeyUnchanged();
    error RecoveryKeyUnchanged();
    error InvalidRecoverySignature();

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
            !_isValidPublicKey(initialization.transactionKey) ||
            !_isValidPublicKey(initialization.recoveryKey) ||
            !_isValidPublicKey(initialization.evolutionKey)
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
        accountAuthority.transactionKeyVersion = 1;
        accountAuthority.recoveryKeyVersion = 1;
        accountAuthority.recoveryNonce = 0;
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

    function requestRecovery(
        address account,
        RecoveryRequest calldata request,
        bytes calldata recoverySignature
    ) external {
        _requireAccountCaller(account);
        AccountAuthority storage accountAuthority = _initialized(account);
        if (request.requestId == bytes32(0)) {
            revert InvalidRecoveryRequestId();
        }
        if (request.recoveryNonce != accountAuthority.recoveryNonce) {
            revert InvalidRecoveryNonce(
                accountAuthority.recoveryNonce,
                request.recoveryNonce
            );
        }

        if (
            !_isValidPublicKey(request.newTransactionKey) ||
            !_isValidPublicKey(request.newRecoveryKey)
        ) {
            revert InvalidPublicKey();
        }

        bytes32 currentTransactionKeyHash = _publicKeyHash(
            accountAuthority.transactionKey
        );
        bytes32 newTransactionKeyHash = _publicKeyHash(
            request.newTransactionKey
        );
        if (currentTransactionKeyHash == newTransactionKeyHash) {
            revert TransactionKeyUnchanged();
        }

        bytes32 currentRecoveryKeyHash = _publicKeyHash(
            accountAuthority.recoveryKey
        );
        bytes32 newRecoveryKeyHash = _publicKeyHash(request.newRecoveryKey);
        if (currentRecoveryKeyHash == newRecoveryKeyHash) {
            revert RecoveryKeyUnchanged();
        }

        bytes32 digest = _recoveryDigest(
            account,
            request,
            accountAuthority
        );
        if (
            !_verifyP256(
                digest,
                recoverySignature,
                accountAuthority.recoveryKey
            )
        ) {
            revert InvalidRecoverySignature();
        }

        accountAuthority.transactionKey = request.newTransactionKey;
        accountAuthority.recoveryKey = request.newRecoveryKey;
        unchecked {
            ++accountAuthority.transactionKeyVersion;
            ++accountAuthority.recoveryKeyVersion;
            ++accountAuthority.recoveryNonce;
        }

        emit RecoveryExecuted(
            account,
            request.requestId,
            newTransactionKeyHash,
            newRecoveryKeyHash,
            accountAuthority.transactionKeyVersion,
            accountAuthority.recoveryKeyVersion,
            request.recoveryNonce
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

    function getRecoveryDigest(
        address account,
        RecoveryRequest calldata request
    ) external view returns (bytes32) {
        AccountAuthority storage accountAuthority = _initialized(account);
        return _recoveryDigest(account, request, accountAuthority);
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

    function rpIdHash(address account) external view returns (bytes32) {
        return _authorities[account].rpIdHash;
    }

    function transactionKeyVersion(
        address account
    ) external view returns (uint64) {
        return _authorities[account].transactionKeyVersion;
    }

    function recoveryKeyVersion(
        address account
    ) external view returns (uint64) {
        return _authorities[account].recoveryKeyVersion;
    }

    function recoveryNonce(address account) external view returns (uint256) {
        return _authorities[account].recoveryNonce;
    }

    function isInitialized(address account) external view returns (bool) {
        return _authorities[account].initialized;
    }

    function _recoveryDigest(
        address account,
        RecoveryRequest calldata request,
        AccountAuthority storage accountAuthority
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    RECOVERY_TYPEHASH,
                    RECOVERY_DOMAIN,
                    account,
                    address(this),
                    block.chainid,
                    _publicKeyHash(accountAuthority.transactionKey),
                    accountAuthority.transactionKeyVersion,
                    _publicKeyHash(accountAuthority.recoveryKey),
                    accountAuthority.recoveryKeyVersion,
                    _publicKeyHash(request.newTransactionKey),
                    _publicKeyHash(request.newRecoveryKey),
                    RECOVERY_ACTION_ROTATE_TRANSACTION_AND_RECOVERY_KEYS,
                    request.recoveryNonce,
                    request.requestId
                )
            );
    }

    function _verifyP256(
        bytes32 digest,
        bytes calldata signature,
        PublicKey storage key
    ) private view returns (bool) {
        if (signature.length != 64) {
            return false;
        }
        (bytes32 r, bytes32 s) = abi.decode(signature, (bytes32, bytes32));
        return P256.verify(digest, r, s, key.qx, key.qy);
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

    function _isValidPublicKey(
        PublicKey calldata key
    ) private view returns (bool) {
        return P256.isValidPublicKey(key.qx, key.qy);
    }

    function _publicKeyHash(
        PublicKey calldata key
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(PUBLIC_KEY_TYPEHASH, key.qx, key.qy));
    }

    function _publicKeyHash(
        PublicKey storage key
    ) private view returns (bytes32) {
        return keccak256(abi.encode(PUBLIC_KEY_TYPEHASH, key.qx, key.qy));
    }

    function _initialized(
        address account
    ) private view returns (AccountAuthority storage accountAuthority) {
        accountAuthority = _authorities[account];
        if (!accountAuthority.initialized) {
            revert AccountNotInitialized(account);
        }
    }

    function _requireAccountCaller(address account) private view {
        if (msg.sender != account) {
            revert UnauthorizedAccountCaller(msg.sender, account);
        }
    }
}