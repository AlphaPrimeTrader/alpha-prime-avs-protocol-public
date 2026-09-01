# Phase 4E — NAV Marketplace

## Status

**LOCAL IMPLEMENTATION ONLY — NOT DEPLOYED**

Phase 4E adds a local Marketplace prototype against dedicated interfaces and
test mocks. It does not modify or deploy `AVSToken`, `AVSLedger`, `AVSVault`, or
`Migration`, and it authorizes no Mainnet or Testnet transaction.

## Architecture

`AVSMarketplace` has immutable references to:

- the settlement USDT token;
- the AVS token;
- the AVS Ledger, used as the only execution-price authority; and
- the AVS Vault, used for primary capital and Marketplace fee accounting.

The Marketplace stores four distinct accounting buckets:

- `buyerEscrowUSDT`: USDT reserved for open buy orders;
- `userEscrowAVS`: existing user AVS reserved for open sell orders;
- `protocolLiquidityUSDT`: USDT released by the configured Vault from pending
  market liquidity, or replenished by protocol inventory sales; and
- `protocolInventoryAVS`: existing AVS actually purchased by the protocol.

The contract exposes no owner withdrawal, sweep, rescue, arbitrary call, or
owner-supplied execution price.

## Order model

The supported order types are:

- market buy;
- market sell;
- triggered buy, eligible when `current NAV <= trigger NAV`; and
- triggered sell, eligible when `current NAV >= trigger NAV`.

Every order escrows its complete required asset before entering a queue. Buy
orders reserve principal plus the fixed 2 BPS buyer fee at their trigger limit.
Sell orders reserve the full AVS quantity. Cancellation and completed-buy price
improvement return the remaining escrow directly to the order owner.

Market orders execute immediately up to the caller's bounded match limit and
cancel any unfilled remainder. Triggered orders retain an unfilled remainder in
escrow until later execution or cancellation.

## Pricing and priority

Every fill reads `IAVSMarketplaceLedger.currentAVSValue()` in the execution
transaction. Neither users nor the owner can provide or override the execution
price.

For orders on the same side and the same `triggerNAV`, Phase 4E uses FIFO among
orders currently executable by the selected source. A temporary source-specific
skip does not cancel, mutate, fill, or permanently demote the skipped order.

Across different trigger levels, eligible global FIFO by `orderId` remains only
an explicitly provisional Testnet policy. It is not the final economic design.

Buy and sell queues use linked order IDs rather than copied arrays. Partial
fills retain their queue position. Matching cursors advance when orders close
and allow later calls to resume without iterating through historical orders.

## Settlement paths

For every eligible buy, execution-source priority is fixed:

1. existing protocol inventory;
2. eligible user sell orders; then
3. primary issuance.

Partial fills continue through that order. Primary issuance never occurs while
protocol inventory or eligible secondary sell liquidity can satisfy the
remaining buy.

### Secondary user-to-user trade

- existing AVS moves from seller escrow to the buyer;
- buyer principal moves to the seller;
- 2 BPS is charged to the buyer;
- 2 BPS is withheld from the seller; and
- both fees are sent through `receiveMarketplaceRevenue` as distinct protocol
  revenue records.

No AVS is minted or burned.

### Protocol absorption

The protocol can buy a user's sell order only when:

- real USDT has first been released into `protocolLiquidityUSDT` by the
  configured Vault or replenished by an inventory sale;
- the fixed daily 5% economic-value allowance remains available; and
- the protocol has enough recorded liquidity for the principal.

Purchased AVS is reclassified from user escrow to actual protocol inventory.
The Marketplace records a distinct Vault treasury acquisition at gross value
after that bucket update and before fee revenue.
Protocol absorption has no buyer fee. It spends exactly `grossValue`, pays the
seller `grossValue - sellerFee`, and records only the seller's 2 BPS fee as
Protocol Revenue.
At the first protocol-absorption attempt of each UTC day, the allowance is
`floor(eligible AVS × official NAV / 1e18) × 5%`. A raw allowance below $5 is
zero; otherwise it is capped at $3,000. The Marketplace tracks absorbed value,
then converts remaining value to AVS at the current NAV with floor rounding:
there is no forced minimum purchase or carry-forward. Eligible AVS includes the
wallet balance and open sell escrow, so resting orders renew after rollover but
later acquisitions cannot enlarge an already-started day's allowance.

### Protocol inventory sale

Eligible buy orders consume actual protocol inventory before primary issuance.
The buyer pays `grossValue + buyerFee`; `grossValue` returns to
`protocolLiquidityUSDT`; and only the buyer's 2 BPS fee is recorded as Protocol
Revenue. The Marketplace records a Vault treasury release at gross value before
that buyer fee revenue. There is no protocol seller fee.

### Primary issuance

If no eligible secondary seller or protocol inventory is available, a buy order
can route real escrowed USDT through `receiveMarketplaceCapital`. The Vault hook
must pull the exact principal and return the shares minted to the beneficiary.
The Marketplace checks remaining `MAX_SUPPLY` before the external call and
precomputes the exact floor-rounded shares expected from the capital amount
before the external call. It rejects any different Vault return. A market-order
remainder too small to mint one unit is cancelled; triggered-order dust remains
cancellable by its owner. The buyer fee is recorded separately as Marketplace
protocol revenue.

After successful primary capital allocation, and after every Marketplace fee
receipt, anyone may synchronize liquidity through `availableMarketLiquidity`
and `provideMarketLiquidity`. The Marketplace verifies the exact USDT balance
increase before adding it to its liquidity bucket.

## Bounded matching

User order entry and the settlement hook accept a requested match bound. The
request cannot exceed the owner-configured limit, which itself is capped at 256.
Queue eligibility scans are separately capped at 1,024 per call.
An eligible order that cannot currently progress through a particular source is
skipped within that bound, so it cannot permanently block later independently
executable orders. It keeps its order ID, trigger, remainder, and queue position
for future calls.

Executability is source-specific. Exhausting a seller's daily protocol
absorption allowance blocks only protocol absorption. The sell remains NAV
eligible for a normal user-to-user secondary fill and retains FIFO priority over
newer same-trigger sells for that source.

Only the configured settlement hook may call `processAfterSettlement`. It
cannot choose an order ID or price; it can only request a bounded continuation
from the contract's own queues and current Ledger NAV.

## Configurable parameters

Initial local values:

| Parameter                             | Initial value |            Hard bound |
| ------------------------------------- | ------------: | --------------------: |
| Buyer fee                             |         2 BPS |                 fixed |
| Seller fee                            |         2 BPS |                 fixed |
| Liquidity reserve allocation metadata |            5% |                 fixed |
| Daily protocol absorption allowance   |            5% | fixed $5–$3,000 value |
| Matches per call                      |            16 |                 1–256 |
| Eligibility scans per search          |            64 |               1–1,024 |

The 5% allocation value is fixed metadata, not Marketplace owner policy.
`depositProtocolLiquidity` and `recordProtocolLiquidity` do not exist. Anyone
may call `syncProtocolLiquidity`, but it only obtains the amount the configured
Vault reports as legitimately pending.

## Local verification coverage

The Phase 4E tests cover:

- fixed 5% liquidity metadata and owner-only execution-bound updates;
- the absence of owner fund-withdrawal paths;
- primary issuance at Ledger NAV with real capital;
- `MAX_SUPPLY` partial issuance and refund;
- buy and sell escrow cancellation;
- triggered-order NAV eligibility;
- FIFO and partial fills;
- prevention of queue-jumping by newly submitted orders;
- buy routing through Inventory, user sell liquidity, then Primary;
- source-specific same-trigger FIFO and unchanged temporary skips;
- 2 BPS fees on both secondary sides;
- fractional-NAV primary rounding and dust cancellation;
- Vault-backed liquidity synchronization after capital and fee receipts;
- daily protocol absorption threshold, exact-$5, $3,000 cap, NAV conversion,
  and no-carry-forward behavior;
- protocol/user fee payer identity and exact gross-value liquidity movement;
- daily-cap renewal for resting orders and liveness past capped orders;
- protocol inventory and liquidity recycling without supply change;
- repeated inventory cycles cannot create Protocol Revenue from protocol-owned
  funds;
- resumable one-match bounded execution;
- reentrancy rejection during Vault callbacks;
- fee-on-transfer under-collateralization rejection; and
- aggregate Marketplace solvency after mixed flows.

## Deliberate scope boundary

Phase 4E does not:

- deploy any contract;
- send any blockchain transaction;
- define final trigger-level economic priority;
- authorize production custody; or
- publish a Git commit.

The local integration revision does wire Marketplace, Vault, Ledger, Token, and
Migration implementations together in tests and performs the approved 5/95
split. It does not alter any already-deployed Testnet bytecode.
