// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {SignerWebAuthn} from
    "@openzeppelin/contracts/utils/cryptography/signers/SignerWebAuthn.sol";
import {SignerP256} from
    "@openzeppelin/contracts/utils/cryptography/signers/SignerP256.sol";
import {AbstractSigner} from
    "@openzeppelin/contracts/utils/cryptography/signers/AbstractSigner.sol";

import {ERC721Holder} from
    "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import {ERC1155Holder} from
    "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/**
 * @title AVSAccount
 * @notice ERC-4337 Smart Account for Alpha Prime AVS users.
 *
 * Core principles:
 * - Each user has an independent smart-contract account.
 * - No Alpha Prime backend key can execute user transactions.
 * - User authorization is based on a WebAuthn / Passkey public key.
 * - Assets such as USDT can be held directly by this account.
 * - AVS pool ownership can later be registered to this account address.
 *
 * IMPORTANT:
 * This is the first prototype layer only.
 * Recovery, security policies, withdrawal whitelist and Paymaster
 * will be added in later versions.
 */
contract AVSAccount is
    Initializable,
    Account,
    SignerWebAuthn,
    ERC7821,
    ERC721Holder,
    ERC1155Holder
{
    // A valid P-256 generator point used only to satisfy the implementation
    // contract's constructor. Every clone replaces it atomically in initialize().
    bytes32 private constant _IMPLEMENTATION_QX =
        0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296;
    bytes32 private constant _IMPLEMENTATION_QY =
        0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5;
    address private immutable _implementationAddress = address(this);

    event AVSAccountInitialized(
        address indexed account,
        bytes32 indexed publicKeyX,
        bytes32 indexed publicKeyY
    );

    /**
     * @dev Locks the implementation contract against initialization.
     *
     * The constructor key is never used by clones. Clone storage starts empty,
     * and the Factory initializes each clone with the user's real public key in
     * the same transaction that creates it.
     */
    constructor() SignerP256(_IMPLEMENTATION_QX, _IMPLEMENTATION_QY) {
        _disableInitializers();
    }

    /**
     * @notice Initializes a newly cloned account.
     *
     * qx/qy are the P-256 public-key coordinates generated
     * during Passkey registration.
     *
     * The private key NEVER goes on-chain.
     */
    function initialize(
        bytes32 qx,
        bytes32 qy
    ) external initializer {
        _setSigner(qx, qy);

        emit AVSAccountInitialized(
            address(this),
            qx,
            qy
        );
    }

    /**
     * @dev ERC-7821 execution authorization.
     *
     * Allows:
     * - ERC-4337 EntryPoint
     * - the account itself
     *
     * Nobody else may directly execute arbitrary calls.
     */
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    )
        internal
        view
        override
        returns (bool)
    {
        if (address(this) == _implementationAddress) {
            return false;
        }

        return
            caller == address(entryPoint()) ||
            super._erc7821AuthorizedExecutor(
                caller,
                mode,
                executionData
            );
    }

    /**
     * @dev The implementation's constructor signer is a deployment placeholder,
     * never an authorization key. Only initialized clones validate signatures.
     */
    function _rawSignatureValidation(
        bytes32 hash,
        bytes calldata signature
    )
        internal
        view
        override(AbstractSigner, SignerWebAuthn)
        returns (bool)
    {
        return
            address(this) != _implementationAddress &&
            super._rawSignatureValidation(hash, signature);
    }

    /**
     * @dev Prevent the implementation from transferring native funds as an
     * ERC-4337 prefund. Initialized clones retain the standard Account behavior.
     */
    function _payPrefund(uint256 missingAccountFunds) internal override {
        if (address(this) != _implementationAddress) {
            super._payPrefund(missingAccountFunds);
        }
    }

    // Native BNB/ETH reception is inherited from OpenZeppelin Account.
}