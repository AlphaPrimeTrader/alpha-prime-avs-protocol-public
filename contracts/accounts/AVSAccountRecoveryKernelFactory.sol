// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {AVSAccountRecoveryAuthority} from "./AVSAccountRecoveryAuthority.sol";
import {AVSAccountRecoverySecurityKernel} from "./AVSAccountRecoverySecurityKernel.sol";
import {AVSEvolutionController} from "./AVSEvolutionController.sol";
import {IAVSAccountAuthority} from "./interfaces/IAVSAccountAuthority.sol";
import {IAVSAccountKernelFactory} from "./interfaces/IAVSAccountKernelFactory.sol";

/**
 * @title AVSAccountRecoveryKernelFactory
 * @notice Ownerless deterministic factory for Phase 3B recovery accounts.
 */
contract AVSAccountRecoveryKernelFactory is IAVSAccountKernelFactory {
    address public constant CANONICAL_ENTRYPOINT_V08 =
        0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    address public immutable authority;
    address public immutable evolutionController;
    address public immutable entryPoint;

    mapping(address account => bool) public isAVSAccount;
    address private _pendingAccount;
    bytes private _pendingConfiguration;

    event AVSAccountRecoveryKernelCreated(
        address indexed account,
        bytes32 indexed salt,
        bytes32 indexed configurationHash
    );

    error InvalidEntryPoint();
    error CreationInProgress();
    error NoPendingConfiguration();
    error UnauthorizedConfigurationConsumer(address caller);
    error AccountCreationFailed();

    constructor() {
        if (
            CANONICAL_ENTRYPOINT_V08.code.length == 0
        ) {
            revert InvalidEntryPoint();
        }

        entryPoint = CANONICAL_ENTRYPOINT_V08;
        authority = address(new AVSAccountRecoveryAuthority());
        evolutionController = address(
            new AVSEvolutionController(authority)
        );
    }

    function getSalt(
        IAVSAccountAuthority.Initialization calldata initialization
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    initialization.transactionKey.qx,
                    initialization.transactionKey.qy,
                    initialization.recoveryKey.qx,
                    initialization.recoveryKey.qy,
                    initialization.evolutionKey.qx,
                    initialization.evolutionKey.qy,
                    initialization.rpIdHash,
                    initialization.userSalt,
                    initialization.initialImplementation,
                    initialization.initialImplementationCodehash,
                    initialization.initialStandardVersion
                )
            );
    }

    function predictAccount(
        IAVSAccountAuthority.Initialization calldata initialization
    ) external view returns (address) {
        return _predictAccount(getSalt(initialization));
    }

    function createAccount(
        IAVSAccountAuthority.Initialization calldata initialization,
        bytes calldata creationSignature
    ) external returns (address account) {
        bytes32 salt = getSalt(initialization);
        account = _predictAccount(salt);
        if (account.code.length != 0) {
            return account;
        }
        if (_pendingAccount != address(0)) {
            revert CreationInProgress();
        }

        IAVSAccountAuthority.Initialization
            memory boundInitialization = initialization;
        boundInitialization.factory = address(this);
        bytes memory encodedConfiguration = abi.encode(
            boundInitialization,
            creationSignature
        );
        _pendingAccount = account;
        _pendingConfiguration = encodedConfiguration;

        AVSAccountRecoverySecurityKernel kernel =
            new AVSAccountRecoverySecurityKernel{salt: salt}();
        account = address(kernel);
        if (account != _predictAccount(salt) || account.code.length == 0) {
            revert AccountCreationFailed();
        }
        if (_pendingAccount != address(0) || _pendingConfiguration.length != 0) {
            revert AccountCreationFailed();
        }

        isAVSAccount[account] = true;
        emit AVSAccountRecoveryKernelCreated(
            account,
            salt,
            keccak256(encodedConfiguration)
        );
    }

    function consumePendingConfiguration()
        external
        returns (bytes memory configuration)
    {
        if (_pendingAccount == address(0)) {
            revert NoPendingConfiguration();
        }
        if (msg.sender != _pendingAccount || msg.sender.code.length != 0) {
            revert UnauthorizedConfigurationConsumer(msg.sender);
        }

        configuration = _pendingConfiguration;
        delete _pendingConfiguration;
        _pendingAccount = address(0);
    }

    function _predictAccount(bytes32 salt) private view returns (address) {
        return
            Create2.computeAddress(
                salt,
                keccak256(
                    type(AVSAccountRecoverySecurityKernel).creationCode
                ),
                address(this)
            );
    }

}