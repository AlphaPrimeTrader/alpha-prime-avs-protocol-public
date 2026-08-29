// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {AVSAccountAuthority} from "./AVSAccountAuthority.sol";
import {AVSAccountSecurityKernel} from "./AVSAccountSecurityKernel.sol";
import {AVSEvolutionController} from "./AVSEvolutionController.sol";
import {IAVSAccountAuthority} from "./interfaces/IAVSAccountAuthority.sol";

/**
 * @title AVSAccountKernelFactory
 * @notice Ownerless deterministic creator for immutable AVS security kernels.
 */
contract AVSAccountKernelFactory {
    address public constant CANONICAL_ENTRYPOINT_V08 =
        0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    address public immutable authority;
    address public immutable evolutionController;
    address public immutable entryPoint;

    mapping(address account => bool) public isAVSAccount;

    address private _pendingAccount;
    bytes private _pendingConfiguration;

    event AccountCreated(
        address indexed account,
        bytes32 indexed transactionKeyX,
        bytes32 indexed transactionKeyY,
        bytes32 userSalt
    );

    error InvalidDependency();
    error CreationInProgress();
    error NoPendingConfiguration();
    error UnauthorizedConfigurationConsumer(address caller);
    error AccountDeploymentFailed();

    constructor() {
        if (CANONICAL_ENTRYPOINT_V08.code.length == 0) {
            revert InvalidDependency();
        }
        AVSAccountAuthority authorityContract = new AVSAccountAuthority();
        AVSEvolutionController controllerContract = new AVSEvolutionController(
            address(authorityContract)
        );
        authority = address(authorityContract);
        evolutionController = address(controllerContract);
        entryPoint = CANONICAL_ENTRYPOINT_V08;
    }

    function getSalt(
        bytes32 transactionKeyX,
        bytes32 transactionKeyY,
        bytes32 userSalt
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(transactionKeyX, transactionKeyY, userSalt)
            );
    }

    function predictAccount(
        bytes32 transactionKeyX,
        bytes32 transactionKeyY,
        bytes32 userSalt
    ) public view returns (address) {
        bytes32 salt = getSalt(
            transactionKeyX,
            transactionKeyY,
            userSalt
        );
        return
            Create2.computeAddress(
                salt,
                keccak256(type(AVSAccountSecurityKernel).creationCode),
                address(this)
            );
    }

    function createAccount(
        IAVSAccountAuthority.Initialization calldata initialization,
        bytes calldata creationSignature
    ) external returns (address account) {
        account = predictAccount(
            initialization.transactionKey.qx,
            initialization.transactionKey.qy,
            initialization.userSalt
        );

        if (account.code.length != 0) {
            return account;
        }
        if (_pendingAccount != address(0)) {
            revert CreationInProgress();
        }

        IAVSAccountAuthority.Initialization
            memory boundInitialization = initialization;
        boundInitialization.factory = address(this);
        _pendingAccount = account;
        _pendingConfiguration = abi.encode(
            boundInitialization,
            creationSignature
        );

        AVSAccountSecurityKernel kernel = new AVSAccountSecurityKernel{
            salt: getSalt(
                initialization.transactionKey.qx,
                initialization.transactionKey.qy,
                initialization.userSalt
            )
        }();

        if (address(kernel) != account) {
            revert AccountDeploymentFailed();
        }
        if (_pendingAccount != address(0) || _pendingConfiguration.length != 0) {
            revert AccountDeploymentFailed();
        }

        isAVSAccount[account] = true;
        emit AccountCreated(
            account,
            initialization.transactionKey.qx,
            initialization.transactionKey.qy,
            initialization.userSalt
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
}