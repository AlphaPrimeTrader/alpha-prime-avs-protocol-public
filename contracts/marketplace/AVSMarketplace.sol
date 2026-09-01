// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {
    IAVSMarketplaceLedger,
    IAVSMarketplaceToken,
    IAVSMarketplaceVault
} from "./interfaces/IAVSMarketplaceDependencies.sol";

/**
 * @title AVSMarketplace
 * @notice Local Phase 4E marketplace using the AVSLedger NAV as its only price.
 *
 * Orders escrow assets when created. Secondary trades exchange existing AVS
 * between users without changing supply. Primary issuance is deliberately
 * routed through the Vault hook so real capital, Ledger accounting, and token
 * minting remain one downstream operation. The deployed Phase 4A-4D contracts
 * are not modified by this local implementation.
 *
 * Across different trigger levels, Phase 4E uses eligible global FIFO as an
 * explicitly provisional Testnet policy. On the same side and trigger NAV,
 * FIFO applies among orders executable by the selected source. A temporarily
 * unexecutable order is skipped without mutation and retains future priority.
 */
contract AVSMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SCALE = 1e18;
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant BUYER_FEE_BPS = 2;
    uint256 public constant SELLER_FEE_BPS = 2;
    uint256 public constant LIQUIDITY_ALLOCATION_BPS = 500;
    uint256 public constant DAILY_PROTOCOL_ABSORPTION_BPS = 500;
    uint256 public constant MIN_DAILY_PROTOCOL_ABSORPTION_VALUE = 5 ether;
    uint256 public constant MAX_DAILY_PROTOCOL_ABSORPTION_VALUE = 3_000 ether;
    uint256 public constant DEFAULT_MAX_MATCHES_PER_CALL = 16;
    uint256 public constant MAX_MATCHES_PER_CALL = 256;
    uint256 public constant DEFAULT_MAX_SCANS_PER_CALL = 64;
    uint256 public constant MAX_SCANS_PER_CALL = 1_024;

    enum OrderSide {
        Buy,
        Sell
    }

    enum OrderType {
        Market,
        Triggered
    }

    enum OrderStatus {
        Open,
        Filled,
        Cancelled
    }

    struct Order {
        address owner;
        OrderSide side;
        OrderType orderType;
        OrderStatus status;
        uint256 triggerNAV;
        uint256 remainingAVS;
        uint256 remainingUSDT;
        uint256 createdAt;
        uint256 previous;
        uint256 next;
    }

    struct DailyProtocolSell {
        uint256 day;
        uint256 eligibleValue;
        uint256 absorbedValue;
    }

    struct FillQuote {
        uint256 quantity;
        uint256 grossValue;
        uint256 buyerFee;
        uint256 sellerFee;
    }

    struct PrimaryFill {
        bytes32 capitalId;
        uint256 quantity;
        uint256 capitalAmount;
        uint256 nav;
        uint256 buyerFee;
    }

    IERC20 public immutable USDT;
    IAVSMarketplaceToken public immutable AVS;
    IAVSMarketplaceLedger public immutable ledger;
    IAVSMarketplaceVault public immutable vault;

    address public owner;
    address public settlementHook;

    uint256 public maxMatchesPerCall = DEFAULT_MAX_MATCHES_PER_CALL;
    uint256 public maxScansPerCall = DEFAULT_MAX_SCANS_PER_CALL;

    uint256 public nextOrderId = 1;
    uint256 public buyHead;
    uint256 public buyTail;
    uint256 public sellHead;
    uint256 public sellTail;
    uint256 public buyMatchCursor;
    uint256 public sellMatchCursor;
    uint256 public secondaryBuyCursor;
    uint256 public secondarySellCursor;

    uint256 public userEscrowAVS;
    uint256 public buyerEscrowUSDT;
    uint256 public protocolLiquidityUSDT;
    uint256 public protocolInventoryAVS;
    uint256 public totalFeesCollected;
    uint256 private _feeNonce;
    uint256 private _capitalNonce;
    uint256 private _treasuryNonce;

    mapping(uint256 orderId => Order) public orders;
    mapping(address account => uint256) public userOpenSellEscrow;
    mapping(address account => DailyProtocolSell)
        public dailyProtocolSell;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        OrderSide indexed side,
        OrderType orderType,
        uint256 quantityAVS,
        uint256 triggerNAV,
        uint256 escrowedAmount
    );
    event OrderPartiallyFilled(
        uint256 indexed orderId,
        uint256 filledAVS,
        uint256 executionNAV,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 remainingAVS
    );
    event OrderFilled(
        uint256 indexed orderId,
        uint256 filledAVS,
        uint256 executionNAV,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 refundedAmount
    );
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed owner,
        uint256 refundedAmount
    );
    event SecondaryTradeExecuted(
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address indexed buyer,
        address seller,
        uint256 quantityAVS,
        uint256 executionNAV,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee
    );
    event ProtocolInventoryPurchased(
        uint256 indexed sellOrderId,
        address indexed seller,
        bytes32 indexed treasuryId,
        uint256 quantityAVS,
        uint256 executionNAV,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee
    );
    event ProtocolInventorySold(
        uint256 indexed buyOrderId,
        address indexed buyer,
        bytes32 indexed treasuryId,
        uint256 quantityAVS,
        uint256 executionNAV,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee
    );
    event PrimaryIssuanceExecuted(
        uint256 indexed buyOrderId,
        address indexed beneficiary,
        bytes32 indexed capitalId,
        uint256 quantityAVS,
        uint256 capitalAmount,
        uint256 executionNAV,
        uint256 buyerFee
    );
    event MarketplaceFeeCollected(
        bytes32 indexed revenueId,
        uint256 indexed orderId,
        uint256 amount
    );
    event ProtocolLiquiditySynced(uint256 amount);
    event ParametersUpdated(
        uint256 maxMatchesPerCall,
        uint256 maxScansPerCall
    );
    event SettlementHookUpdated(
        address indexed previousHook,
        address indexed newHook
    );
    event MatchingProgress(
        uint256 indexed executionBlock,
        uint256 matchesProcessed,
        uint256 buyCursor,
        uint256 sellCursor
    );

    error Unauthorized(address caller);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidTriggerNAV();
    error InvalidParameter();
    error InvalidOrder(uint256 orderId);
    error NotOrderOwner(uint256 orderId, address caller);
    error OrderNotOpen(uint256 orderId);
    error CurrentNAVUnavailable();
    error DustExecution();
    error ExactAmountNotReceived(uint256 expected, uint256 actual);
    error ExactAmountNotSpent(uint256 expected, uint256 actual);
    error InsufficientEscrow(uint256 required, uint256 available);
    error InsufficientProtocolLiquidity(
        uint256 required,
        uint256 available
    );
    error InsufficientProtocolInventory(
        uint256 requested,
        uint256 available
    );
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error InvalidPrimaryIssuance(uint256 shares, uint256 requested);
    error InvalidContract(address candidate);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlySettlementHook() {
        if (msg.sender != settlementHook) revert Unauthorized(msg.sender);
        _;
    }

    constructor(
        address initialOwner,
        address usdt,
        address avsToken,
        address avsLedger,
        address avsVault,
        address initialSettlementHook
    ) {
        if (initialOwner == address(0)) revert InvalidAddress();
        _requireContract(usdt);
        _requireContract(avsToken);
        _requireContract(avsLedger);
        _requireContract(avsVault);
        _requireContract(initialSettlementHook);

        owner = initialOwner;
        USDT = IERC20(usdt);
        AVS = IAVSMarketplaceToken(avsToken);
        ledger = IAVSMarketplaceLedger(avsLedger);
        vault = IAVSMarketplaceVault(avsVault);
        settlementHook = initialSettlementHook;
    }

    function liquidityAllocationBps() external pure returns (uint256) {
        return LIQUIDITY_ALLOCATION_BPS;
    }

    function setParameters(
        uint256 newMaxMatchesPerCall,
        uint256 newMaxScansPerCall
    ) external onlyOwner {
        if (
            newMaxMatchesPerCall == 0 ||
            newMaxMatchesPerCall > MAX_MATCHES_PER_CALL ||
            newMaxScansPerCall == 0 ||
            newMaxScansPerCall > MAX_SCANS_PER_CALL
        ) {
            revert InvalidParameter();
        }

        maxMatchesPerCall = newMaxMatchesPerCall;
        maxScansPerCall = newMaxScansPerCall;
        emit ParametersUpdated(
            newMaxMatchesPerCall,
            newMaxScansPerCall
        );
    }

    function setSettlementHook(address newHook) external onlyOwner {
        _requireContract(newHook);
        address previousHook = settlementHook;
        settlementHook = newHook;
        emit SettlementHookUpdated(previousHook, newHook);
    }

    function currentNAV() public view returns (uint256) {
        uint256 nav = ledger.currentAVSValue();
        if (nav == 0) revert CurrentNAVUnavailable();
        return nav;
    }

    function actualAVSBalance() external view returns (uint256) {
        return AVS.balanceOf(address(this));
    }

    function actualUSDTBalance() external view returns (uint256) {
        return USDT.balanceOf(address(this));
    }

    function accountingSolvent() external view returns (bool) {
        return
            userEscrowAVS + protocolInventoryAVS <=
            AVS.balanceOf(address(this)) &&
            buyerEscrowUSDT + protocolLiquidityUSDT <=
            USDT.balanceOf(address(this));
    }

    /// @notice Pulls only liquidity that the configured Vault has made pending.
    function syncProtocolLiquidity() external nonReentrant returns (uint256 amount) {
        amount = _syncProtocolLiquidity();
    }

    function placeMarketBuy(
        uint256 quantityAVS,
        uint256 requestedMaxMatches
    ) external nonReentrant returns (uint256 orderId) {
        uint256 nav = currentNAV();
        orderId = _createBuy(
            msg.sender,
            OrderType.Market,
            quantityAVS,
            nav
        );
        _processPriority(_boundedMatches(requestedMaxMatches));
        if (orders[orderId].status == OrderStatus.Open) {
            _cancelRemaining(orderId);
        }
    }

    function placeTriggeredBuy(
        uint256 quantityAVS,
        uint256 triggerNAV,
        uint256 requestedMaxMatches
    ) external nonReentrant returns (uint256 orderId) {
        if (triggerNAV == 0) revert InvalidTriggerNAV();
        orderId = _createBuy(
            msg.sender,
            OrderType.Triggered,
            quantityAVS,
            triggerNAV
        );
        _processPriority(_boundedMatches(requestedMaxMatches));
    }

    function placeMarketSell(
        uint256 quantityAVS,
        uint256 requestedMaxMatches
    ) external nonReentrant returns (uint256 orderId) {
        uint256 nav = currentNAV();
        orderId = _createSell(
            msg.sender,
            OrderType.Market,
            quantityAVS,
            nav
        );
        _processPriority(_boundedMatches(requestedMaxMatches));
        if (orders[orderId].status == OrderStatus.Open) {
            _cancelRemaining(orderId);
        }
    }

    function placeTriggeredSell(
        uint256 quantityAVS,
        uint256 triggerNAV,
        uint256 requestedMaxMatches
    ) external nonReentrant returns (uint256 orderId) {
        if (triggerNAV == 0) revert InvalidTriggerNAV();
        orderId = _createSell(
            msg.sender,
            OrderType.Triggered,
            quantityAVS,
            triggerNAV
        );
        _processPriority(_boundedMatches(requestedMaxMatches));
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.owner == address(0)) revert InvalidOrder(orderId);
        if (order.owner != msg.sender) {
            revert NotOrderOwner(orderId, msg.sender);
        }
        if (order.status != OrderStatus.Open) {
            revert OrderNotOpen(orderId);
        }
        _cancelRemaining(orderId);
    }

    /**
     * @notice Restricted settlement hook; it chooses no order IDs.
     * Matching is selected from the on-chain queues and current Ledger NAV.
     */
    function processAfterSettlement(
        uint256 requestedMaxMatches
    ) external onlySettlementHook nonReentrant returns (uint256 processed) {
        uint256 limit = _boundedMatches(requestedMaxMatches);
        processed = _processPriority(limit);
        emit MatchingProgress(
            block.number,
            processed,
            buyMatchCursor,
            sellMatchCursor
        );
    }

    /**
     * @notice TradingSettlement-compatible bounded hook.
     * @dev Settlement metadata is emitted and archived by TradingSettlement;
     * Marketplace only resumes its existing NAV-priced queues.
     */
    function processAfterSettlement(
        bytes32,
        int256,
        uint256
    ) external onlySettlementHook nonReentrant returns (uint256 processed) {
        processed = _processPriority(maxMatchesPerCall);
        emit MatchingProgress(
            block.number,
            processed,
            buyMatchCursor,
            sellMatchCursor
        );
    }

    function _processPriority(
        uint256 limit
    ) private returns (uint256 processed) {
        uint256 stalledAttempts;
        while (
            processed < limit &&
            stalledAttempts < maxScansPerCall
        ) {
            uint256 nav = currentNAV();
            uint256 buyId = _findEligible(
                OrderSide.Buy,
                nav
            );
            uint256 sellId = _findEligible(
                OrderSide.Sell,
                nav
            );
            if (buyId == 0 && sellId == 0) break;

            if (
                buyId != 0 &&
                (protocolInventoryAVS != 0 || sellId != 0)
            ) {
                uint256 sourcePriorityBuyId = _findEligibleSecondaryBuy(nav);
                if (sourcePriorityBuyId != 0) {
                    buyId = sourcePriorityBuyId;
                }
            }

            if (
                buyId != 0 &&
                (protocolInventoryAVS != 0 || sellId != 0)
            ) {
                uint256 beforeAVS = orders[buyId].remainingAVS;
                _matchBuy(buyId, 1);
                if (
                    orders[buyId].status != OrderStatus.Open ||
                    orders[buyId].remainingAVS < beforeAVS
                ) {
                    processed += 1;
                    stalledAttempts = 0;
                } else {
                    _advanceCursor(OrderSide.Buy, buyId);
                    stalledAttempts += 1;
                }
            } else if (
                sellId != 0 &&
                (buyId == 0 || sellId < buyId)
            ) {
                uint256 beforeAVS = orders[sellId].remainingAVS;
                _matchSell(sellId, 1);
                if (
                    orders[sellId].status != OrderStatus.Open ||
                    orders[sellId].remainingAVS < beforeAVS
                ) {
                    processed += 1;
                    stalledAttempts = 0;
                } else {
                    _advanceCursor(OrderSide.Sell, sellId);
                    stalledAttempts += 1;
                }
            } else {
                uint256 beforeAVS = orders[buyId].remainingAVS;
                _matchBuy(buyId, 1);
                if (
                    orders[buyId].status != OrderStatus.Open ||
                    orders[buyId].remainingAVS < beforeAVS
                ) {
                    processed += 1;
                    stalledAttempts = 0;
                } else {
                    _advanceCursor(OrderSide.Buy, buyId);
                    stalledAttempts += 1;
                }
            }
        }
    }

    function _createBuy(
        address buyer,
        OrderType orderType,
        uint256 quantityAVS,
        uint256 triggerNAV
    ) private returns (uint256 orderId) {
        if (quantityAVS == 0 || buyer == address(0)) {
            revert InvalidAmount();
        }

        uint256 grossAtLimit = Math.mulDiv(
            quantityAVS,
            triggerNAV,
            SCALE
        );
        uint256 buyerFeeAtLimit = _fee(
            grossAtLimit,
            BUYER_FEE_BPS
        );
        uint256 requiredUSDT = grossAtLimit + buyerFeeAtLimit;
        if (requiredUSDT == 0) revert DustExecution();
        _pullExact(USDT, buyer, requiredUSDT);

        orderId = nextOrderId++;
        orders[orderId] = Order({
            owner: buyer,
            side: OrderSide.Buy,
            orderType: orderType,
            status: OrderStatus.Open,
            triggerNAV: triggerNAV,
            remainingAVS: quantityAVS,
            remainingUSDT: requiredUSDT,
            createdAt: block.timestamp,
            previous: 0,
            next: 0
        });
        buyerEscrowUSDT += requiredUSDT;
        _append(OrderSide.Buy, orderId);
        emit OrderCreated(
            orderId,
            buyer,
            OrderSide.Buy,
            orderType,
            quantityAVS,
            triggerNAV,
            requiredUSDT
        );
    }

    function _createSell(
        address seller,
        OrderType orderType,
        uint256 quantityAVS,
        uint256 triggerNAV
    ) private returns (uint256 orderId) {
        if (quantityAVS == 0 || seller == address(0)) {
            revert InvalidAmount();
        }

        _pullExact(IERC20(address(AVS)), seller, quantityAVS);

        orderId = nextOrderId++;
        orders[orderId] = Order({
            owner: seller,
            side: OrderSide.Sell,
            orderType: orderType,
            status: OrderStatus.Open,
            triggerNAV: triggerNAV,
            remainingAVS: quantityAVS,
            remainingUSDT: 0,
            createdAt: block.timestamp,
            previous: 0,
            next: 0
        });
        userEscrowAVS += quantityAVS;
        userOpenSellEscrow[seller] += quantityAVS;
        _append(OrderSide.Sell, orderId);
        emit OrderCreated(
            orderId,
            seller,
            OrderSide.Sell,
            orderType,
            quantityAVS,
            triggerNAV,
            quantityAVS
        );
    }

    function _matchBuy(
        uint256 buyOrderId,
        uint256 maxMatches
    ) private {
        uint256 matches;
        while (
            matches < maxMatches &&
            orders[buyOrderId].status == OrderStatus.Open &&
            orders[buyOrderId].remainingAVS != 0
        ) {
            uint256 nav = currentNAV();
            if (!_isNAVEligible(orders[buyOrderId], nav)) break;

            // Approved BUY routing: Inventory -> User SELL -> Primary.
            if (protocolInventoryAVS != 0) {
                _executeInventorySale(buyOrderId, nav);
                matches += 1;
            } else {
                uint256 sellOrderId = _findEligibleSecondarySell(nav);
                if (sellOrderId != 0) {
                    _executeSecondary(
                        buyOrderId,
                        sellOrderId,
                        nav
                    );
                    matches += 1;
                } else if (_executePrimaryIssuance(buyOrderId, nav)) {
                    matches += 1;
                } else {
                    break;
                }
            }
        }
    }

    function _matchSell(
        uint256 sellOrderId,
        uint256 maxMatches
    ) private {
        uint256 matches;
        while (
            matches < maxMatches &&
            orders[sellOrderId].status == OrderStatus.Open &&
            orders[sellOrderId].remainingAVS != 0
        ) {
            uint256 nav = currentNAV();
            if (!_isNAVEligible(orders[sellOrderId], nav)) break;

            uint256 buyOrderId = _findEligibleSecondaryBuy(nav);
            if (buyOrderId != 0) {
                _executeSecondary(
                    buyOrderId,
                    sellOrderId,
                    nav
                );
                matches += 1;
            } else if (_executeProtocolAbsorption(sellOrderId, nav)) {
                matches += 1;
            } else {
                break;
            }
        }
    }

    function _executeSecondary(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 nav
    ) private {
        Order storage buyOrder = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];
        uint256 quantity = Math.min(
            buyOrder.remainingAVS,
            sellOrder.remainingAVS
        );
        uint256 grossValue = _grossValue(quantity, nav);
        uint256 buyerFee = _fee(grossValue, BUYER_FEE_BPS);
        uint256 sellerFee = _fee(grossValue, SELLER_FEE_BPS);
        uint256 buyerCost = grossValue + buyerFee;
        if (buyerCost > buyOrder.remainingUSDT) {
            revert InsufficientEscrow(
                buyerCost,
                buyOrder.remainingUSDT
            );
        }

        uint256 sellerProceeds = grossValue - sellerFee;
        buyOrder.remainingAVS -= quantity;
        buyOrder.remainingUSDT -= buyerCost;
        sellOrder.remainingAVS -= quantity;
        buyerEscrowUSDT -= buyerCost;
        userEscrowAVS -= quantity;
        userOpenSellEscrow[sellOrder.owner] -= quantity;

        _pushExact(USDT, sellOrder.owner, sellerProceeds);
        _collectFee(buyOrderId, buyerFee);
        _collectFee(sellOrderId, sellerFee);
        _pushExact(IERC20(address(AVS)), buyOrder.owner, quantity);

        _recordBuyFill(
            buyOrderId,
            quantity,
            nav,
            grossValue,
            buyerFee,
            sellerFee
        );
        _recordSellFill(
            sellOrderId,
            quantity,
            nav,
            grossValue,
            buyerFee,
            sellerFee
        );
        emit SecondaryTradeExecuted(
            buyOrderId,
            sellOrderId,
            buyOrder.owner,
            sellOrder.owner,
            quantity,
            nav,
            grossValue,
            buyerFee,
            sellerFee
        );
    }

    function _executeInventorySale(
        uint256 buyOrderId,
        uint256 nav
    ) private {
        Order storage buyOrder = orders[buyOrderId];
        uint256 quantity = Math.min(
            buyOrder.remainingAVS,
            protocolInventoryAVS
        );
        uint256 grossValue = _grossValue(quantity, nav);
        uint256 buyerFee = _fee(grossValue, BUYER_FEE_BPS);
        uint256 sellerFee;
        uint256 buyerCost = grossValue + buyerFee;
        if (buyerCost > buyOrder.remainingUSDT) {
            revert InsufficientEscrow(
                buyerCost,
                buyOrder.remainingUSDT
            );
        }

        buyOrder.remainingAVS -= quantity;
        buyOrder.remainingUSDT -= buyerCost;
        buyerEscrowUSDT -= buyerCost;
        protocolInventoryAVS -= quantity;
        protocolLiquidityUSDT += grossValue;

        bytes32 treasuryId = _recordTreasuryRelease(quantity, grossValue);
        _collectFee(buyOrderId, buyerFee);
        _pushExact(IERC20(address(AVS)), buyOrder.owner, quantity);

        _recordBuyFill(
            buyOrderId,
            quantity,
            nav,
            grossValue,
            buyerFee,
            sellerFee
        );
        emit ProtocolInventorySold(
            buyOrderId,
            buyOrder.owner,
            treasuryId,
            quantity,
            nav,
            grossValue,
            buyerFee,
            sellerFee
        );
    }

    function _executePrimaryIssuance(
        uint256 buyOrderId,
        uint256 nav
    ) private returns (bool) {
        Order storage buyOrder = orders[buyOrderId];
        uint256 availableSupply;
        {
            uint256 maxSupply = AVS.MAX_SUPPLY();
            uint256 supply = AVS.totalSupply();
            if (supply >= maxSupply) return false;
            availableSupply = maxSupply - supply;
        }
        (
            uint256 capitalAmount,
            uint256 buyerFee,
            uint256 quotedShares
        ) = _primaryQuote(
            Math.min(buyOrder.remainingAVS, availableSupply),
            buyOrder.remainingUSDT,
            nav
        );
        if (capitalAmount == 0 || quotedShares == 0) return false;

        uint256 totalCost = capitalAmount + buyerFee;
        bytes32 capitalId = keccak256(
            abi.encode(
                "AVS_MARKETPLACE_PRIMARY",
                address(this),
                buyOrderId,
                ++_capitalNonce
            )
        );

        buyOrder.remainingUSDT -= totalCost;
        buyerEscrowUSDT -= totalCost;
        uint256 sharesToMint = _deliverPrimaryCapital(
            capitalId,
            buyOrder.owner,
            capitalAmount
        );
        if (sharesToMint != quotedShares) {
            revert InvalidPrimaryIssuance(
                sharesToMint,
                quotedShares
            );
        }
        if (sharesToMint > availableSupply) {
            revert MaxSupplyExceeded(
                sharesToMint,
                availableSupply
            );
        }

        buyOrder.remainingAVS -= sharesToMint;
        _syncProtocolLiquidity();
        _finalizePrimary(
            buyOrderId,
            PrimaryFill({
                capitalId: capitalId,
                quantity: sharesToMint,
                capitalAmount: capitalAmount,
                nav: nav,
                buyerFee: buyerFee
            })
        );
        return true;
    }

    function _finalizePrimary(
        uint256 buyOrderId,
        PrimaryFill memory fill
    ) private {
        _collectFee(buyOrderId, fill.buyerFee);
        _recordBuyFill(
            buyOrderId,
            fill.quantity,
            fill.nav,
            fill.capitalAmount,
            fill.buyerFee,
            0
        );
        emit PrimaryIssuanceExecuted(
            buyOrderId,
            orders[buyOrderId].owner,
            fill.capitalId,
            fill.quantity,
            fill.capitalAmount,
            fill.nav,
            fill.buyerFee
        );
    }

    function _primaryQuote(
        uint256 remainingAVS,
        uint256 remainingUSDT,
        uint256 nav
    )
        private
        pure
        returns (
            uint256 capitalAmount,
            uint256 buyerFee,
            uint256 quotedShares
        )
    {
        uint256 maxPrincipalByFee = Math.mulDiv(
            remainingUSDT,
            BASIS_POINTS,
            BASIS_POINTS + BUYER_FEE_BPS
        );
        uint256 principalByQuantity = Math.mulDiv(
            remainingAVS,
            nav,
            SCALE
        );
        capitalAmount = Math.min(
            maxPrincipalByFee,
            principalByQuantity
        );
        buyerFee = _fee(capitalAmount, BUYER_FEE_BPS);
        quotedShares = Math.mulDiv(capitalAmount, SCALE, nav);
    }

    function _deliverPrimaryCapital(
        bytes32 capitalId,
        address beneficiary,
        uint256 capitalAmount
    ) private returns (uint256 sharesToMint) {
        uint256 balanceBefore = USDT.balanceOf(address(this));
        USDT.forceApprove(address(vault), capitalAmount);
        sharesToMint = vault.receiveMarketplaceCapital(
            capitalId,
            beneficiary,
            capitalAmount
        );
        USDT.forceApprove(address(vault), 0);
        uint256 balanceAfter = USDT.balanceOf(address(this));
        if (balanceBefore < balanceAfter) {
            revert ExactAmountNotSpent(capitalAmount, 0);
        }
        uint256 actualSpent = balanceBefore - balanceAfter;
        if (actualSpent != capitalAmount) {
            revert ExactAmountNotSpent(
                capitalAmount,
                actualSpent
            );
        }
    }

    function _executeProtocolAbsorption(
        uint256 sellOrderId,
        uint256 nav
    ) private returns (bool) {
        Order storage sellOrder = orders[sellOrderId];
        _refreshDailySnapshot(sellOrder.owner);
        if (!_isProtocolAbsorptionExecutable(sellOrder, nav)) {
            return false;
        }
        DailyProtocolSell storage daily = dailyProtocolSell[
            sellOrder.owner
        ];
        FillQuote memory quote = _protocolAbsorptionQuote(
            sellOrder,
            daily,
            nav
        );
        if (quote.quantity == 0) return false;
        uint256 protocolCost = quote.grossValue + quote.buyerFee;
        if (protocolCost > protocolLiquidityUSDT) {
            revert InsufficientProtocolLiquidity(
                protocolCost,
                protocolLiquidityUSDT
            );
        }

        sellOrder.remainingAVS -= quote.quantity;
        userEscrowAVS -= quote.quantity;
        userOpenSellEscrow[sellOrder.owner] -= quote.quantity;
        protocolInventoryAVS += quote.quantity;
        protocolLiquidityUSDT -= protocolCost;
        daily.absorbedValue += quote.grossValue;

        bytes32 treasuryId = _recordTreasuryAcquisition(
            quote.quantity,
            quote.grossValue
        );
        _pushExact(
            USDT,
            sellOrder.owner,
            quote.grossValue - quote.sellerFee
        );
        _collectFee(sellOrderId, quote.buyerFee);
        _collectFee(sellOrderId, quote.sellerFee);

        _recordSellFill(
            sellOrderId,
            quote.quantity,
            nav,
            quote.grossValue,
            quote.buyerFee,
            quote.sellerFee
        );
        emit ProtocolInventoryPurchased(
            sellOrderId,
            sellOrder.owner,
            treasuryId,
            quote.quantity,
            nav,
            quote.grossValue,
            quote.buyerFee,
            quote.sellerFee
        );
        return true;
    }

    function _protocolAbsorptionQuote(
        Order storage sellOrder,
        DailyProtocolSell storage daily,
        uint256 nav
    ) private view returns (FillQuote memory quote) {
        uint256 allowance = daily.eligibleValue;
        if (allowance <= daily.absorbedValue) return quote;
        uint256 remainingAllowance = allowance - daily.absorbedValue;

        uint256 maxGrossByLiquidity = protocolLiquidityUSDT;
        uint256 maxQuantityByLiquidity = Math.mulDiv(
            maxGrossByLiquidity,
            SCALE,
            nav
        );
        quote.quantity = Math.min(
            sellOrder.remainingAVS,
            Math.min(
                Math.mulDiv(remainingAllowance, SCALE, nav),
                maxQuantityByLiquidity
            )
        );
        if (quote.quantity == 0) return quote;
        quote.grossValue = _grossValue(quote.quantity, nav);
        quote.buyerFee = 0;
        quote.sellerFee = _fee(quote.grossValue, SELLER_FEE_BPS);
    }

    function _recordBuyFill(
        uint256 orderId,
        uint256 quantity,
        uint256 nav,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee
    ) private {
        Order storage order = orders[orderId];
        if (order.remainingAVS == 0) {
            uint256 refund = order.remainingUSDT;
            if (refund != 0) {
                order.remainingUSDT = 0;
                buyerEscrowUSDT -= refund;
                _pushExact(USDT, order.owner, refund);
            }
            _remove(OrderSide.Buy, orderId);
            order.status = OrderStatus.Filled;
            emit OrderFilled(
                orderId,
                quantity,
                nav,
                grossValue,
                buyerFee,
                sellerFee,
                refund
            );
        } else {
            emit OrderPartiallyFilled(
                orderId,
                quantity,
                nav,
                grossValue,
                buyerFee,
                sellerFee,
                order.remainingAVS
            );
        }
    }

    function _recordSellFill(
        uint256 orderId,
        uint256 quantity,
        uint256 nav,
        uint256 grossValue,
        uint256 buyerFee,
        uint256 sellerFee
    ) private {
        Order storage order = orders[orderId];
        if (order.remainingAVS == 0) {
            _remove(OrderSide.Sell, orderId);
            order.status = OrderStatus.Filled;
            emit OrderFilled(
                orderId,
                quantity,
                nav,
                grossValue,
                buyerFee,
                sellerFee,
                0
            );
        } else {
            emit OrderPartiallyFilled(
                orderId,
                quantity,
                nav,
                grossValue,
                buyerFee,
                sellerFee,
                order.remainingAVS
            );
        }
    }

    function _cancelRemaining(uint256 orderId) private {
        Order storage order = orders[orderId];
        uint256 refund;
        if (order.side == OrderSide.Buy) {
            refund = order.remainingUSDT;
            order.remainingUSDT = 0;
            buyerEscrowUSDT -= refund;
            _remove(OrderSide.Buy, orderId);
            order.status = OrderStatus.Cancelled;
            if (refund != 0) {
                _pushExact(USDT, order.owner, refund);
            }
        } else {
            refund = order.remainingAVS;
            order.remainingAVS = 0;
            userEscrowAVS -= refund;
            userOpenSellEscrow[order.owner] -= refund;
            _remove(OrderSide.Sell, orderId);
            order.status = OrderStatus.Cancelled;
            if (refund != 0) {
                _pushExact(IERC20(address(AVS)), order.owner, refund);
            }
        }
        emit OrderCancelled(orderId, order.owner, refund);
    }

    function _append(OrderSide side, uint256 orderId) private {
        Order storage order = orders[orderId];
        if (side == OrderSide.Buy) {
            order.previous = buyTail;
            if (buyTail == 0) buyHead = orderId;
            else orders[buyTail].next = orderId;
            buyTail = orderId;
            if (buyMatchCursor == 0) buyMatchCursor = buyHead;
            if (secondaryBuyCursor == 0) secondaryBuyCursor = buyHead;
        } else {
            order.previous = sellTail;
            if (sellTail == 0) sellHead = orderId;
            else orders[sellTail].next = orderId;
            sellTail = orderId;
            if (sellMatchCursor == 0) sellMatchCursor = sellHead;
            if (secondarySellCursor == 0) secondarySellCursor = sellHead;
        }
    }

    function _remove(OrderSide side, uint256 orderId) private {
        Order storage order = orders[orderId];
        uint256 previous = order.previous;
        uint256 next = order.next;
        if (side == OrderSide.Buy) {
            if (previous == 0) buyHead = next;
            else orders[previous].next = next;
            if (next == 0) buyTail = previous;
            else orders[next].previous = previous;
            if (buyMatchCursor == orderId) {
                buyMatchCursor = next == 0 ? buyHead : next;
            }
            if (secondaryBuyCursor == orderId) {
                secondaryBuyCursor = next == 0 ? buyHead : next;
            }
        } else {
            if (previous == 0) sellHead = next;
            else orders[previous].next = next;
            if (next == 0) sellTail = previous;
            else orders[next].previous = previous;
            if (sellMatchCursor == orderId) {
                sellMatchCursor = next == 0 ? sellHead : next;
            }
            if (secondarySellCursor == orderId) {
                secondarySellCursor = next == 0 ? sellHead : next;
            }
        }
        order.previous = 0;
        order.next = 0;
    }

    function _findEligible(
        OrderSide side,
        uint256 nav
    ) private returns (uint256 eligibleOrderId) {
        uint256 head = side == OrderSide.Buy ? buyHead : sellHead;
        if (head == 0) return 0;
        uint256 cursor = side == OrderSide.Buy
            ? buyMatchCursor
            : sellMatchCursor;
        if (
            cursor == 0 ||
            orders[cursor].status != OrderStatus.Open
        ) {
            cursor = head;
        }

        uint256 current = cursor;
        uint256 nextCursor = cursor;
        uint256 scanned;
        while (current != 0 && scanned < maxScansPerCall) {
            Order storage order = orders[current];
            if (
                order.status == OrderStatus.Open &&
                _isNAVEligible(order, nav)
            ) {
                if (side == OrderSide.Buy) buyMatchCursor = current;
                else sellMatchCursor = current;
                return current;
            }

            uint256 next = order.next;
            if (next == 0) next = head;
            nextCursor = next;
            scanned += 1;
            if (next == cursor) break;
            current = next;
        }

        if (side == OrderSide.Buy) buyMatchCursor = nextCursor;
        else sellMatchCursor = nextCursor;
        return 0;
    }

    function _advanceCursor(
        OrderSide side,
        uint256 orderId
    ) private {
        uint256 next = orders[orderId].next;
        if (side == OrderSide.Buy) {
            buyMatchCursor = next == 0 ? buyHead : next;
        } else {
            sellMatchCursor = next == 0 ? sellHead : next;
        }
    }

    function _findEligibleSecondarySell(
        uint256 nav
    ) private returns (uint256) {
        return _findEligibleSecondary(OrderSide.Sell, nav);
    }

    function _findEligibleSecondaryBuy(
        uint256 nav
    ) private returns (uint256) {
        return _findEligibleSecondary(OrderSide.Buy, nav);
    }

    function _findEligibleSecondary(
        OrderSide side,
        uint256 nav
    ) private returns (uint256 eligibleOrderId) {
        uint256 head = side == OrderSide.Buy ? buyHead : sellHead;
        if (head == 0) return 0;
        uint256 cursor = side == OrderSide.Buy
            ? secondaryBuyCursor
            : secondarySellCursor;
        if (
            cursor == 0 ||
            orders[cursor].status != OrderStatus.Open
        ) {
            cursor = head;
        }

        uint256 current = cursor;
        uint256 nextCursor = cursor;
        uint256 scanned;
        while (current != 0 && scanned < maxScansPerCall) {
            Order storage order = orders[current];
            if (
                order.status == OrderStatus.Open &&
                _isNAVEligible(order, nav)
            ) {
                if (side == OrderSide.Buy) {
                    secondaryBuyCursor = current;
                } else {
                    secondarySellCursor = current;
                }
                return current;
            }

            uint256 next = order.next;
            if (next == 0) next = head;
            nextCursor = next;
            scanned += 1;
            if (next == cursor) break;
            current = next;
        }

        if (side == OrderSide.Buy) {
            secondaryBuyCursor = nextCursor;
        } else {
            secondarySellCursor = nextCursor;
        }
        return 0;
    }

    function _isNAVEligible(
        Order storage order,
        uint256 nav
    ) private view returns (bool) {
        if (order.orderType == OrderType.Market) return true;
        if (order.side == OrderSide.Buy) {
            return nav <= order.triggerNAV;
        }
        return nav >= order.triggerNAV;
    }

    function _isProtocolAbsorptionExecutable(
        Order storage sellOrder,
        uint256 nav
    ) private view returns (bool) {
        DailyProtocolSell storage daily = dailyProtocolSell[
            sellOrder.owner
        ];
        uint256 allowance = daily.eligibleValue;
        if (allowance <= daily.absorbedValue) return false;

        uint256 maxGrossByLiquidity = protocolLiquidityUSDT;
        uint256 maxQuantityByLiquidity = Math.mulDiv(
            maxGrossByLiquidity,
            SCALE,
            nav
        );
        return
            Math.min(
                sellOrder.remainingAVS,
                Math.min(
                    Math.mulDiv(
                        allowance - daily.absorbedValue,
                        SCALE,
                        nav
                    ),
                    maxQuantityByLiquidity
                )
            ) != 0;
    }

    function _refreshDailySnapshot(address account) private {
        DailyProtocolSell storage daily = dailyProtocolSell[account];
        uint256 day = block.timestamp / 1 days;
        if (daily.day != day) {
            daily.day = day;
            uint256 eligibleAVS =
                AVS.balanceOf(account) + userOpenSellEscrow[account];
            uint256 rawAllowance = Math.mulDiv(
                Math.mulDiv(eligibleAVS, currentNAV(), SCALE),
                DAILY_PROTOCOL_ABSORPTION_BPS,
                BASIS_POINTS
            );
            daily.eligibleValue = rawAllowance <
                MIN_DAILY_PROTOCOL_ABSORPTION_VALUE
                ? 0
                : Math.min(
                    rawAllowance,
                    MAX_DAILY_PROTOCOL_ABSORPTION_VALUE
                );
            daily.absorbedValue = 0;
        }
    }

    function _collectFee(uint256 orderId, uint256 amount) private {
        if (amount == 0) return;
        bytes32 revenueId = keccak256(
            abi.encode(
                "AVS_MARKETPLACE_FEE",
                address(this),
                orderId,
                ++_feeNonce
            )
        );
        USDT.forceApprove(address(vault), amount);
        vault.receiveMarketplaceRevenue(revenueId, amount);
        USDT.forceApprove(address(vault), 0);
        totalFeesCollected += amount;
        _syncProtocolLiquidity();
        emit MarketplaceFeeCollected(revenueId, orderId, amount);
    }

    function _syncProtocolLiquidity() private returns (uint256 amount) {
        amount = vault.availableMarketLiquidity();
        if (amount == 0) return 0;
        uint256 balanceBefore = USDT.balanceOf(address(this));
        vault.provideMarketLiquidity(amount);
        uint256 balanceAfter = USDT.balanceOf(address(this));
        if (balanceAfter < balanceBefore) {
            revert ExactAmountNotReceived(amount, 0);
        }
        uint256 actualReceived = balanceAfter - balanceBefore;
        if (actualReceived != amount) {
            revert ExactAmountNotReceived(amount, actualReceived);
        }
        protocolLiquidityUSDT += amount;
        emit ProtocolLiquiditySynced(amount);
    }

    function _recordTreasuryAcquisition(
        uint256 quantity,
        uint256 grossValue
    ) private returns (bytes32 treasuryId) {
        treasuryId = keccak256(
            abi.encode(
                "AVS_MARKETPLACE_TREASURY_ACQUISITION",
                address(this),
                ++_treasuryNonce
            )
        );
        vault.recordTreasuryAcquisition(
            treasuryId,
            quantity,
            grossValue
        );
    }

    function _recordTreasuryRelease(
        uint256 quantity,
        uint256 grossValue
    ) private returns (bytes32 treasuryId) {
        treasuryId = keccak256(
            abi.encode(
                "AVS_MARKETPLACE_TREASURY_RELEASE",
                address(this),
                ++_treasuryNonce
            )
        );
        vault.recordTreasuryRelease(
            treasuryId,
            quantity,
            grossValue
        );
    }

    function _pushExact(
        IERC20 token,
        address recipient,
        uint256 amount
    ) private {
        if (amount == 0) return;
        uint256 senderBalanceBefore = token.balanceOf(address(this));
        uint256 recipientBalanceBefore = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        uint256 senderBalanceAfter = token.balanceOf(address(this));
        uint256 recipientBalanceAfter = token.balanceOf(recipient);
        if (
            senderBalanceAfter > senderBalanceBefore ||
            recipientBalanceAfter < recipientBalanceBefore
        ) {
            revert ExactAmountNotReceived(amount, 0);
        }
        uint256 actualSent = senderBalanceBefore - senderBalanceAfter;
        uint256 actualReceived = recipientBalanceAfter - recipientBalanceBefore;
        if (actualSent != amount || actualReceived != amount) {
            revert ExactAmountNotReceived(
                amount,
                actualReceived == amount ? actualSent : actualReceived
            );
        }
    }

    function _pullExact(
        IERC20 token,
        address source,
        uint256 amount
    ) private {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(source, address(this), amount);
        uint256 afterBalance = token.balanceOf(address(this));
        if (afterBalance < beforeBalance) {
            revert ExactAmountNotReceived(
                amount,
                0
            );
        }
        uint256 actualReceived = afterBalance - beforeBalance;
        if (actualReceived != amount) {
            revert ExactAmountNotReceived(
                amount,
                actualReceived
            );
        }
    }

    function _grossValue(
        uint256 quantity,
        uint256 nav
    ) private pure returns (uint256) {
        uint256 grossValue = Math.mulDiv(quantity, nav, SCALE);
        if (grossValue == 0) revert DustExecution();
        return grossValue;
    }

    function _fee(
        uint256 amount,
        uint256 feeBps
    ) private pure returns (uint256) {
        return Math.mulDiv(amount, feeBps, BASIS_POINTS);
    }

    function _boundedMatches(
        uint256 requested
    ) private view returns (uint256) {
        uint256 result = requested == 0 ? maxMatchesPerCall : requested;
        if (result == 0 || result > maxMatchesPerCall) {
            revert InvalidParameter();
        }
        return result;
    }

    function _requireContract(address candidate) private view {
        if (candidate == address(0) || candidate.code.length == 0) {
            revert InvalidContract(candidate);
        }
    }
}