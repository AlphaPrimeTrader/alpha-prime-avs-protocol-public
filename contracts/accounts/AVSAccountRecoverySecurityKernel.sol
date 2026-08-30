// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {
    IAccount,
    IEntryPoint,
    PackedUserOperation
} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import {IAVSAccountAuthority} from "./interfaces/IAVSAccountAuthority.sol";
import {IAVSAccountKernelFactory} from "./interfaces/IAVSAccountKernelFactory.sol";
import {IAVSAccountRecoveryAuthority} from "./interfaces/IAVSAccountRecoveryAuthority.sol";
import {IAVSAccountRecoverySecurityKernel} from "./interfaces/IAVSAccountRecoverySecurityKernel.sol";
import {IAVSEvolutionController} from "./interfaces/IAVSEvolutionController.sol";

/**
 * @title AVSAccountRecoverySecurityKernel
 * @notice Phase 3B immutable ERC-4337 kernel with bounded recovery.
 */
contract AVSAccountRecoverySecurityKernel is
    IAccount,
    IAVSAccountRecoverySecurityKernel,
    ERC7821,
    ERC721Holder,
    ERC1155Holder
{
    address public constant CANONICAL_ENTRYPOINT_V08 =
        0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    IAVSAccountRecoveryAuthority public immutable authority;
    IAVSEvolutionController public immutable evolutionController;
    IEntryPoint public immutable entryPoint;
    address public immutable creationFactory;

    event AVSAccountRecoverySecurityKernelCreated(
        address indexed account,
        address indexed authority,
        address indexed evolutionController,
        address entryPoint
    );

    error AccountUnauthorized(address sender);
    error InvalidFactory();
    error InvalidConfiguration();
    error PrefundPaymentFailed();

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) {
            revert AccountUnauthorized(msg.sender);
        }
        _;
    }

    constructor() {
        if (msg.sender.code.length == 0) {
            revert InvalidFactory();
        }

        IAVSAccountKernelFactory factory = IAVSAccountKernelFactory(msg.sender);
        address authorityAddress = factory.authority();
        address controllerAddress = factory.evolutionController();
        address entryPointAddress = factory.entryPoint();
        if (
            authorityAddress.code.length == 0 ||
            controllerAddress.code.length == 0 ||
            entryPointAddress != CANONICAL_ENTRYPOINT_V08 ||
            entryPointAddress.code.length == 0
        ) {
            revert InvalidFactory();
        }

        creationFactory = msg.sender;
        authority = IAVSAccountRecoveryAuthority(authorityAddress);
        evolutionController = IAVSEvolutionController(controllerAddress);
        entryPoint = IEntryPoint(entryPointAddress);

        bytes memory encodedConfiguration = factory
            .consumePendingConfiguration();
        (
            IAVSAccountAuthority.Initialization memory initialization,
            bytes memory creationSignature
        ) = abi.decode(
                encodedConfiguration,
                (IAVSAccountAuthority.Initialization, bytes)
            );
        if (initialization.factory != msg.sender) {
            revert InvalidConfiguration();
        }

        authority.initializeAccount(
            address(this),
            initialization,
            creationSignature
        );
        evolutionController.initializeAccount(
            address(this),
            initialization.initialImplementation,
            initialization.initialImplementationCodehash,
            initialization.initialStandardVersion
        );

        emit AVSAccountRecoverySecurityKernelCreated(
            address(this),
            authorityAddress,
            controllerAddress,
            entryPointAddress
        );
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        validationData =
            userOp.sender == address(this) &&
            authority.validateTransactionSignature(
                address(this),
                userOpHash,
                userOp.signature
            )
                ? 0
                : 1;

        if (missingAccountFunds > 0) {
            (bool success, ) = payable(msg.sender).call{
                value: missingAccountFunds
            }("");
            if (!success) {
                revert PrefundPaymentFailed();
            }
        }
    }

    function getNonce() external view returns (uint256) {
        return entryPoint.getNonce(address(this), 0);
    }

    function getNonce(uint192 key) external view returns (uint256) {
        return entryPoint.getNonce(address(this), key);
    }

    function requestUpgrade(
        IAVSEvolutionController.UpgradeRequest calldata request,
        bytes calldata transactionSignature,
        bytes calldata evolutionSignature
    ) external onlyEntryPoint {
        evolutionController.requestUpgrade(
            address(this),
            request,
            transactionSignature,
            evolutionSignature
        );
    }

    function cancelUpgrade(
        bytes32 requestId,
        bytes calldata transactionSignature
    ) external onlyEntryPoint {
        evolutionController.cancelUpgrade(
            address(this),
            requestId,
            transactionSignature
        );
    }

    /// @notice Relays an offline-authorized recovery request.
    /// @dev Permissionless relaying is intentional: the Authority authenticates
    ///      every request with the account-bound Recovery-key signature.
    function requestRecovery(
        IAVSAccountRecoveryAuthority.RecoveryRequest calldata request,
        bytes calldata recoverySignature
    ) external {
        authority.requestRecovery(
            address(this),
            request,
            recoverySignature
        );
    }

    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32,
        bytes calldata
    ) internal view override returns (bool) {
        return caller == address(entryPoint);
    }

    receive() external payable {}
}