// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MarketplaceLedgerMock {
    uint256 public currentAVSValue = 1 ether;

    function setCurrentAVSValue(uint256 newValue) external {
        currentAVSValue = newValue;
    }
}

contract MarketplaceTokenMock is ERC20 {
    uint256 public immutable MAX_SUPPLY;

    error MaxSupplyExceeded(uint256 requested, uint256 available);

    constructor(
        uint256 maxSupply
    ) ERC20("Marketplace AVS", "mAVS") {
        MAX_SUPPLY = maxSupply;
    }

    function mint(address recipient, uint256 amount) external {
        uint256 supply = totalSupply();
        if (supply > MAX_SUPPLY || amount > MAX_SUPPLY - supply) {
            revert MaxSupplyExceeded(amount, MAX_SUPPLY - supply);
        }
        _mint(recipient, amount);
    }
}

contract MarketplaceVaultMock {
    using SafeERC20 for IERC20;

    uint256 private constant SCALE = 1e18;

    IERC20 public immutable USDT;
    MarketplaceTokenMock public immutable AVS;
    MarketplaceLedgerMock public immutable ledger;

    uint256 public capitalReceived;
    uint256 public revenueReceived;
    uint256 public capitalCount;
    uint256 public revenueCount;
    uint256 public pendingMarketplaceLiquidity;
    uint256 public treasuryAcquisitions;
    uint256 public treasuryReleases;
    uint256 public treasuryAcquiredAVS;
    uint256 public treasuryReleasedAVS;
    uint256 public treasuryAcquiredValue;
    uint256 public treasuryReleasedValue;
    bool public reenterOnRevenue;
    bool public reentrySucceeded;
    address public reentryTarget;
    mapping(bytes32 id => bool) public consumedIds;

    error Replay(bytes32 id);
    error ZeroShares();

    constructor(
        address usdt,
        address avs,
        address avsLedger
    ) {
        USDT = IERC20(usdt);
        AVS = MarketplaceTokenMock(avs);
        ledger = MarketplaceLedgerMock(avsLedger);
    }

    function configureReentry(
        address target,
        bool enabled
    ) external {
        reentryTarget = target;
        reenterOnRevenue = enabled;
        reentrySucceeded = false;
    }

    function receiveMarketplaceCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 amount
    ) external returns (uint256 sharesToMint) {
        if (consumedIds[capitalId]) revert Replay(capitalId);
        consumedIds[capitalId] = true;
        USDT.safeTransferFrom(msg.sender, address(this), amount);
        sharesToMint = Math.mulDiv(
            amount,
            SCALE,
            ledger.currentAVSValue()
        );
        if (sharesToMint == 0) revert ZeroShares();
        AVS.mint(beneficiary, sharesToMint);
        capitalReceived += amount;
        capitalCount += 1;
        pendingMarketplaceLiquidity += amount / 20;
    }

    function receiveMarketplaceRevenue(
        bytes32 revenueId,
        uint256 amount
    ) external {
        if (consumedIds[revenueId]) revert Replay(revenueId);
        consumedIds[revenueId] = true;
        USDT.safeTransferFrom(msg.sender, address(this), amount);
        revenueReceived += amount;
        revenueCount += 1;
        pendingMarketplaceLiquidity += amount;

        if (reenterOnRevenue) {
            (reentrySucceeded, ) = reentryTarget.call(
                abi.encodeWithSignature(
                    "processAfterSettlement(uint256)",
                    1
                )
            );
        }
    }

    function availableMarketLiquidity() external view returns (uint256) {
        return pendingMarketplaceLiquidity;
    }

    function provideMarketLiquidity(uint256 amount) external {
        if (amount > pendingMarketplaceLiquidity) revert ZeroShares();
        pendingMarketplaceLiquidity -= amount;
        USDT.safeTransfer(msg.sender, amount);
    }

    function recordTreasuryAcquisition(
        bytes32 treasuryId,
        uint256 amount,
        uint256 value
    ) external {
        if (consumedIds[treasuryId]) revert Replay(treasuryId);
        consumedIds[treasuryId] = true;
        treasuryAcquisitions += 1;
        treasuryAcquiredAVS += amount;
        treasuryAcquiredValue += value;
    }

    function recordTreasuryRelease(
        bytes32 treasuryId,
        uint256 amount,
        uint256 value
    ) external {
        if (consumedIds[treasuryId]) revert Replay(treasuryId);
        consumedIds[treasuryId] = true;
        treasuryReleases += 1;
        treasuryReleasedAVS += amount;
        treasuryReleasedValue += value;
    }
}

contract MarketplaceSettlementHookMock {
    function process(
        address marketplace,
        uint256 maxMatches
    ) external returns (uint256 processed) {
        (bool success, bytes memory data) = marketplace.call(
            abi.encodeWithSignature(
                "processAfterSettlement(uint256)",
                maxMatches
            )
        );
        if (!success) {
            assembly {
                revert(add(data, 32), mload(data))
            }
        }
        return abi.decode(data, (uint256));
    }
}