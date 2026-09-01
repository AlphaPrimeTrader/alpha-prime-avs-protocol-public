// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAVSMarketplaceToken is IERC20 {
    function MAX_SUPPLY() external view returns (uint256);
}

interface IAVSMarketplaceLedger {
    function currentAVSValue() external view returns (uint256);
}

interface IAVSMarketplaceVault {
    function receiveMarketplaceCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external returns (uint256 sharesToMint);

    function receiveMarketplaceRevenue(
        bytes32 revenueId,
        uint256 amount
    ) external;

    function recordTreasuryAcquisition(
        bytes32 treasuryId,
        uint256 amount,
        uint256 value
    ) external;

    function recordTreasuryRelease(
        bytes32 treasuryId,
        uint256 amount,
        uint256 value
    ) external;

    function availableMarketLiquidity() external view returns (uint256);

    function provideMarketLiquidity(uint256 amount) external;
}