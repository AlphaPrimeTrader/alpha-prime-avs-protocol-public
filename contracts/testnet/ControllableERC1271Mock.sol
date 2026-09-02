// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Test-only configurable ERC-1271 signer used to exercise callers'
/// SignatureChecker handling without giving the caller any protocol authority.
contract ControllableERC1271Mock is IERC1271 {
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    enum Mode { Valid, Invalid, Revert, Malformed }

    bytes32 public acceptedDigest;
    Mode public mode;

    function setAcceptedDigest(bytes32 digest) external {
        acceptedDigest = digest;
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function isValidSignature(
        bytes32 hash,
        bytes memory
    ) external view returns (bytes4) {
        if (mode == Mode.Revert) revert("1271 rejected");
        if (mode == Mode.Malformed) {
            assembly ("memory-safe") {
                mstore(0, 0x16)
                return(31, 1)
            }
        }
        return mode == Mode.Valid && hash == acceptedDigest
            ? MAGICVALUE
            : bytes4(0xffffffff);
    }
}