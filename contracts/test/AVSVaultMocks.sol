// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AVSVault} from "../vault/AVSVault.sol";

contract VaultTokenMock {
    uint256 public constant MAX_SUPPLY = 1_000 ether;

    uint256 public totalSupply;
    address public lastRecipient;
    uint256 public lastMintAmount;
    uint256 public mintCount;

    function mint(address recipient, uint256 amount) external {
        totalSupply += amount;
        lastRecipient = recipient;
        lastMintAmount = amount;
        mintCount += 1;
    }
}

contract VaultLedgerMock {
    uint256 public sharesToReturn;
    uint256 public recordCount;
    bytes32 public lastCapitalId;
    address public lastBeneficiary;
    uint256 public lastCapitalAmount;
    bool public shouldRevert;
    uint256 public protocolRevenueRecordCount;
    bytes32 public lastRevenueId;
    uint256 public lastProtocolRevenueAmount;
    bool public shouldRevertProtocolRevenue;

    error LedgerMockReverted();

    function configureReturn(uint256 shares, bool revertCall) external {
        sharesToReturn = shares;
        shouldRevert = revertCall;
    }

    function configureProtocolRevenueRevert(bool revertCall) external {
        shouldRevertProtocolRevenue = revertCall;
    }

    function recordCapitalInflow(
        bytes32 capitalId,
        address beneficiary,
        uint256 capitalAmount
    ) external returns (uint256) {
        if (shouldRevert) revert LedgerMockReverted();

        recordCount += 1;
        lastCapitalId = capitalId;
        lastBeneficiary = beneficiary;
        lastCapitalAmount = capitalAmount;
        return sharesToReturn;
    }

    function recordProtocolRevenue(bytes32 revenueId, uint256 amount) external {
        if (shouldRevertProtocolRevenue) revert LedgerMockReverted();

        protocolRevenueRecordCount += 1;
        lastRevenueId = revenueId;
        lastProtocolRevenueAmount = amount;
    }
}

contract VaultActorMock {
    function approveToken(
        address token,
        address spender,
        uint256 amount
    ) external {
        IERC20(token).approve(spender, amount);
    }

    function receiveMarketplaceCapital(
        address vault,
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external returns (uint256) {
        return
            AVSVault(vault).receiveMarketplaceCapital(
                capitalId,
                beneficiary,
                amount
            );
    }

    function receiveMigrationCapital(
        address vault,
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external returns (uint256) {
        return
            AVSVault(vault).receiveMigrationCapital(
                capitalId,
                beneficiary,
                amount
            );
    }

    function receiveMarketplaceRevenue(
        address vault,
        bytes32 revenueId,
        uint256 amount
    ) external {
        AVSVault(vault).receiveMarketplaceRevenue(revenueId, amount);
    }

    function receiveTradingReturn(address vault, uint256 amount) external {
        AVSVault(vault).receiveTradingReturn(amount);
    }

    function provideMarketLiquidity(
        address vault,
        uint256 amount
    ) external {
        AVSVault(vault).provideMarketLiquidity(amount);
    }
}

contract VaultAccountPolicyMock {
    function authorize(address token, address account) external {
        (bool success, bytes memory returndata) = token.call(
            abi.encodeWithSignature("authorizeAccount(address)", account)
        );
        if (!success) {
            assembly {
                revert(add(returndata, 32), mload(returndata))
            }
        }
    }
}

contract FeeOnTransferMock is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("Fee USDT", "fUSDT") {
        feeBps = feeBps_;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0) && feeBps != 0) {
            uint256 fee = (amount * feeBps) / 10_000;
            super._update(from, address(this), fee);
            super._update(from, to, amount - fee);
            return;
        }

        super._update(from, to, amount);
    }
}