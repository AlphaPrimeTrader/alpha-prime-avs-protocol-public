// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AVSAccount} from "./AVSAccount.sol";

/**
 * @title AVSAccountFactory
 * @notice Creates deterministic AVS Smart Accounts.
 *
 * The Factory:
 * - creates accounts
 * - predicts account addresses
 * - records accounts created through this Factory
 *
 * The Factory DOES NOT:
 * - own user accounts
 * - execute user transactions
 * - withdraw user funds
 * - change the user's signer
 */
contract AVSAccountFactory {
    using Clones for address;

    address public immutable accountImplementation;

    mapping(address => bool) public isAVSAccount;

    event AccountCreated(
        address indexed account,
        bytes32 indexed publicKeyX,
        bytes32 indexed publicKeyY,
        bytes32 salt
    );

    error InvalidImplementation();

    constructor(address implementation_) {
        if (implementation_.code.length == 0) {
            revert InvalidImplementation();
        }

        accountImplementation = implementation_;
    }

    /**
     * @dev Generates a deterministic salt.
     *
     * Including qx/qy ensures that the account address
     * is cryptographically tied to the initial Passkey.
     *
     * userSalt allows the same Passkey to create additional
     * AVS accounts later if we ever allow that.
     */
    function getSalt(
        bytes32 qx,
        bytes32 qy,
        bytes32 userSalt
    )
        public
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                qx,
                qy,
                userSalt
            )
        );
    }

    /**
     * @notice Predict the Smart Account address before deployment.
     */
    function predictAccount(
        bytes32 qx,
        bytes32 qy,
        bytes32 userSalt
    )
        public
        view
        returns (address)
    {
        bytes32 salt = getSalt(
            qx,
            qy,
            userSalt
        );

        return Clones.predictDeterministicAddress(
            accountImplementation,
            salt,
            address(this)
        );
    }

    /**
     * @notice Create an AVS Smart Account.
     *
     * If it already exists, return the existing account.
     */
    function createAccount(
        bytes32 qx,
        bytes32 qy,
        bytes32 userSalt
    )
        external
        returns (address account)
    {
        bytes32 salt = getSalt(
            qx,
            qy,
            userSalt
        );

        account = predictAccount(
            qx,
            qy,
            userSalt
        );

        // Idempotent behavior:
        // if account already exists, simply return it.
        if (account.code.length != 0) {
            return account;
        }

        account = Clones.cloneDeterministic(
            accountImplementation,
            salt
        );

        AVSAccount(payable(account)).initialize(
            qx,
            qy
        );

        isAVSAccount[account] = true;

        emit AccountCreated(
            account,
            qx,
            qy,
            salt
        );
    }
}