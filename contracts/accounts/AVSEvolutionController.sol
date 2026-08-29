// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAVSAccountAuthority} from "./interfaces/IAVSAccountAuthority.sol";
import {IAVSAccountBoundedLogic} from "./interfaces/IAVSAccountBoundedLogic.sol";
import {IAVSEvolutionController} from "./interfaces/IAVSEvolutionController.sol";

/**
 * @title AVSEvolutionController
 * @notice Ownerless, user-authorized bounded-logic version controller.
 */
contract AVSEvolutionController is IAVSEvolutionController {
    uint48 public constant MINIMUM_UPGRADE_DELAY = 48 hours;
    bytes32 public constant SECURITY_KERNEL_INTERFACE_ID =
        keccak256("AVS_ACCOUNT_SECURITY_KERNEL_PHASE_3A");
    bytes32 public constant UPGRADE_TYPEHASH = keccak256(
        "AVSAccountUpgrade(address account,address controller,uint256 chainId,bytes32 currentStateHash,bytes32 proposalHash,uint256 nonce)"
    );
    bytes32 public constant CURRENT_STATE_TYPEHASH = keccak256(
        "AVSCurrentImplementation(address implementation,bytes32 codehash,uint64 standardVersion)"
    );
    bytes32 public constant PROPOSAL_TYPEHASH = keccak256(
        "AVSUpgradeProposal(address implementation,bytes32 codehash,uint64 standardVersion,bytes32 requestId,uint48 validAfter,uint48 deadline)"
    );
    bytes32 public constant CANCEL_TYPEHASH = keccak256(
        "AVSAccountUpgradeCancellation(address account,address controller,uint256 chainId,bytes32 requestId,uint256 nonce)"
    );

    IAVSAccountAuthority public immutable authority;

    struct AccountEvolution {
        address implementation;
        bytes32 implementationCodehash;
        uint64 standardVersion;
        uint256 nonce;
        bool initialized;
        PendingUpgrade pending;
        mapping(bytes32 codehash => bool approved) approvedCodehashes;
    }

    mapping(address account => AccountEvolution) private _evolution;

    event AccountEvolutionInitialized(
        address indexed account,
        address indexed implementation,
        bytes32 indexed codehash,
        uint64 standardVersion
    );
    event UpgradeRequested(
        address indexed account,
        address indexed implementation,
        bytes32 indexed requestId,
        bytes32 codehash,
        uint64 standardVersion,
        uint48 executableAt,
        uint256 nonce
    );
    event UpgradeCancelled(
        address indexed account,
        bytes32 indexed requestId,
        uint256 nonce
    );
    event UpgradeFinalized(
        address indexed account,
        address indexed implementation,
        bytes32 indexed codehash,
        uint64 standardVersion,
        uint256 nonce
    );

    error AccountAlreadyInitialized(address account);
    error AccountNotInitialized(address account);
    error UnauthorizedAccountCaller(address caller, address account);
    error InvalidImplementation();
    error InvalidImplementationCodehash();
    error InvalidImplementationCompatibility();
    error InvalidStandardVersion();
    error InvalidAuthorizationWindow();
    error InvalidRequestId();
    error InvalidEvolutionAuthorization();
    error InvalidCancellationAuthorization();
    error UpgradeAlreadyPending();
    error NoUpgradePending();
    error WrongRequestId();
    error UpgradeNotReady(uint48 executableAt);
    error UpgradeExpired(uint48 deadline);

    constructor(address authority_) {
        if (authority_.code.length == 0) {
            revert InvalidImplementation();
        }
        authority = IAVSAccountAuthority(authority_);
    }

    function initializeAccount(
        address account,
        address initialImplementation,
        bytes32 initialCodehash,
        uint64 initialStandardVersion
    ) external {
        _requireConstructionCaller(account);
        AccountEvolution storage accountEvolution = _evolution[account];
        if (accountEvolution.initialized) {
            revert AccountAlreadyInitialized(account);
        }

        _validateImplementation(
            initialImplementation,
            initialCodehash,
            initialStandardVersion
        );

        accountEvolution.implementation = initialImplementation;
        accountEvolution.implementationCodehash = initialCodehash;
        accountEvolution.standardVersion = initialStandardVersion;
        accountEvolution.approvedCodehashes[initialCodehash] = true;
        accountEvolution.initialized = true;

        emit AccountEvolutionInitialized(
            account,
            initialImplementation,
            initialCodehash,
            initialStandardVersion
        );
    }

    function requestUpgrade(
        address account,
        UpgradeRequest calldata request,
        bytes calldata transactionSignature,
        bytes calldata evolutionSignature
    ) external {
        _requireAccountCaller(account);
        AccountEvolution storage accountEvolution = _initialized(account);
        if (accountEvolution.pending.requestId != bytes32(0)) {
            revert UpgradeAlreadyPending();
        }
        if (request.requestId == bytes32(0)) {
            revert InvalidRequestId();
        }
        if (
            request.deadline <
            block.timestamp + MINIMUM_UPGRADE_DELAY ||
            request.validAfter > block.timestamp ||
            request.validAfter > request.deadline
        ) {
            revert InvalidAuthorizationWindow();
        }
        if (request.standardVersion <= accountEvolution.standardVersion) {
            revert InvalidStandardVersion();
        }

        _validateImplementation(
            request.implementation,
            request.codehash,
            request.standardVersion
        );

        bytes32 digest = _upgradeDigest(account, request, accountEvolution);
        if (
            !authority.validateEvolutionAuthorization(
                account,
                digest,
                transactionSignature,
                evolutionSignature
            )
        ) {
            revert InvalidEvolutionAuthorization();
        }

        uint48 executableAt = uint48(block.timestamp) + MINIMUM_UPGRADE_DELAY;
        accountEvolution.approvedCodehashes[request.codehash] = true;
        accountEvolution.pending = PendingUpgrade({
            implementation: request.implementation,
            codehash: request.codehash,
            standardVersion: request.standardVersion,
            requestedAt: uint48(block.timestamp),
            executableAt: executableAt,
            deadline: request.deadline,
            requestId: request.requestId,
            nonce: accountEvolution.nonce
        });

        emit UpgradeRequested(
            account,
            request.implementation,
            request.requestId,
            request.codehash,
            request.standardVersion,
            executableAt,
            accountEvolution.nonce
        );
    }

    function cancelUpgrade(
        address account,
        bytes32 requestId,
        bytes calldata transactionSignature
    ) external {
        _requireAccountCaller(account);
        AccountEvolution storage accountEvolution = _initialized(account);
        PendingUpgrade memory pending = accountEvolution.pending;
        if (pending.requestId == bytes32(0)) {
            revert NoUpgradePending();
        }
        if (pending.requestId != requestId) {
            revert WrongRequestId();
        }

        bytes32 digest = _cancellationDigest(
            account,
            requestId,
            accountEvolution.nonce
        );
        if (
            !authority.validateTransactionSignature(
                account,
                digest,
                transactionSignature
            )
        ) {
            revert InvalidCancellationAuthorization();
        }

        delete accountEvolution.pending;
        unchecked {
            ++accountEvolution.nonce;
        }

        emit UpgradeCancelled(account, requestId, accountEvolution.nonce);
    }

    function finalizeUpgrade(address account) external {
        AccountEvolution storage accountEvolution = _initialized(account);
        PendingUpgrade memory pending = accountEvolution.pending;
        if (pending.requestId == bytes32(0)) {
            revert NoUpgradePending();
        }
        if (block.timestamp < pending.executableAt) {
            revert UpgradeNotReady(pending.executableAt);
        }
        if (block.timestamp > pending.deadline) {
            revert UpgradeExpired(pending.deadline);
        }

        _validateImplementation(
            pending.implementation,
            pending.codehash,
            pending.standardVersion
        );

        accountEvolution.implementation = pending.implementation;
        accountEvolution.implementationCodehash = pending.codehash;
        accountEvolution.standardVersion = pending.standardVersion;
        delete accountEvolution.pending;
        unchecked {
            ++accountEvolution.nonce;
        }

        emit UpgradeFinalized(
            account,
            pending.implementation,
            pending.codehash,
            pending.standardVersion,
            accountEvolution.nonce
        );
    }

    function currentImplementation(
        address account
    ) external view returns (address) {
        return _evolution[account].implementation;
    }

    function currentImplementationCodehash(
        address account
    ) external view returns (bytes32) {
        return _evolution[account].implementationCodehash;
    }

    function currentStandardVersion(
        address account
    ) external view returns (uint64) {
        return _evolution[account].standardVersion;
    }

    function upgradeNonce(address account) external view returns (uint256) {
        return _evolution[account].nonce;
    }

    function pendingUpgrade(
        address account
    ) external view returns (PendingUpgrade memory) {
        return _evolution[account].pending;
    }

    function isImplementationApproved(
        address account,
        bytes32 codehash
    ) external view returns (bool) {
        return _evolution[account].approvedCodehashes[codehash];
    }

    function getUpgradeDigest(
        address account,
        UpgradeRequest calldata request
    ) external view returns (bytes32) {
        return _upgradeDigest(account, request, _evolution[account]);
    }

    function getCancellationDigest(
        address account,
        bytes32 requestId
    ) external view returns (bytes32) {
        return
            _cancellationDigest(
                account,
                requestId,
                _evolution[account].nonce
            );
    }

    function _upgradeDigest(
        address account,
        UpgradeRequest calldata request,
        AccountEvolution storage accountEvolution
    ) private view returns (bytes32) {
        bytes32 currentStateHash = keccak256(
            abi.encode(
                CURRENT_STATE_TYPEHASH,
                accountEvolution.implementation,
                accountEvolution.implementationCodehash,
                accountEvolution.standardVersion
            )
        );
        bytes32 proposalHash = keccak256(
            abi.encode(
                PROPOSAL_TYPEHASH,
                request.implementation,
                request.codehash,
                request.standardVersion,
                request.requestId,
                request.validAfter,
                request.deadline
            )
        );
        return
            keccak256(
                abi.encode(
                    UPGRADE_TYPEHASH,
                    account,
                    address(this),
                    block.chainid,
                    currentStateHash,
                    proposalHash,
                    accountEvolution.nonce
                )
            );
    }

    function _cancellationDigest(
        address account,
        bytes32 requestId,
        uint256 nonce
    ) private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    CANCEL_TYPEHASH,
                    account,
                    address(this),
                    block.chainid,
                    requestId,
                    nonce
                )
            );
    }

    function _validateImplementation(
        address implementation,
        bytes32 expectedCodehash,
        uint64 expectedVersion
    ) private view {
        if (implementation.code.length == 0) {
            revert InvalidImplementation();
        }
        if (implementation.codehash != expectedCodehash) {
            revert InvalidImplementationCodehash();
        }

        try
            IAVSAccountBoundedLogic(implementation)
                .securityKernelInterfaceId()
        returns (bytes32 interfaceId) {
            if (interfaceId != SECURITY_KERNEL_INTERFACE_ID) {
                revert InvalidImplementationCompatibility();
            }
        } catch {
            revert InvalidImplementationCompatibility();
        }

        try
            IAVSAccountBoundedLogic(implementation).avsAccountStandardVersion()
        returns (uint64 version) {
            if (version != expectedVersion) {
                revert InvalidStandardVersion();
            }
        } catch {
            revert InvalidStandardVersion();
        }
    }

    function _initialized(
        address account
    ) private view returns (AccountEvolution storage accountEvolution) {
        accountEvolution = _evolution[account];
        if (!accountEvolution.initialized) {
            revert AccountNotInitialized(account);
        }
    }

    function _requireConstructionCaller(address account) private view {
        if (msg.sender != account || account.code.length != 0) {
            revert UnauthorizedAccountCaller(msg.sender, account);
        }
    }

    function _requireAccountCaller(address account) private view {
        if (msg.sender != account) {
            revert UnauthorizedAccountCaller(msg.sender, account);
        }
    }
}