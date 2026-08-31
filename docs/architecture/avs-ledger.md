# AVS Ledger Architecture

## Status

The Phase 4C integration revision is deployed and source-verified on BSC
Testnet only. The original Phase 4A deployment is superseded. Both remain
unaudited and must not be used for production accounting or funds.

`AVSLedger` is the global economic accounting book for the future AVS protocol.
It does not maintain user balances, custody assets, move tokens, mint AVS
shares, verify trades, or execute trading.

## Accounting units

- `ACCOUNTING_SCALE = 1e18`.
- Capital and realized PnL inputs are USDT-equivalent accounting units with 18
  decimals. A future Vault or settlement adapter is responsible for converting
  the settlement asset's native decimals into this unit.
- AVS supply is read directly from `totalSupply()` and is interpreted as
  18-decimal AVS share units.
- `currentAVSValue()` returns 18-decimal USDT-equivalent units per one whole
  AVS.
- Solidity integer arithmetic is used throughout. Floating point is not used.

The Phase 4A token interface reads `name()`, `totalSupply()`, and `decimals()`.
All three reads must succeed during the irreversible binding, and `decimals()`
must equal exactly 18.

## Global state

| State                   | Meaning                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `totalNetAssets`        | Capital plus AVS-attributable trading performance, excluding the buyback reserve |
| `totalGrossProfit`      | Lifetime gross positive realized PnL before buyback allocation                   |
| `totalLoss`             | Cumulative absolute negative realized PnL                                        |
| `totalBuybackAllocated` | Lifetime amount allocated to the buyback reserve                                 |
| `buybackReserve`        | Current accounting reserve available for future Marketplace use                  |

All values begin at zero. If AVS supply is zero, the accounting value is
the genesis value of `1e18`, representing 1 USDT per AVS.

For non-zero supply:

```text
avsValue = floor(totalNetAssets * 1e18 / totalSupply)
```

## Binding policy

The constructor receives an explicit non-zero `initialOwner`. The deployer is
not implicitly granted ownership or configuration authority. The configured
owner is held in publicly readable storage and has configuration authority
only; it cannot mutate economic values.

| Binding          | Policy                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| AVS Token        | Owner-only, deployed-contract and readable metadata/supply validation, exactly 18 decimals, one-time, permanently locked |
| Vault            | Owner-only, deployed-contract validation, one-time, permanently locked                                                   |
| Trade Settlement | Owner-only, deployed-contract validation, one-time, permanently locked                                                   |

No migration setter, generic writer role, arbitrary accounting setter, or
economic emergency override exists.

Deployment must use:

```solidity
constructor(address initialOwner)
```

There is no fallback to `msg.sender`.

### Ownership renunciation

The current owner may call `renounceOwnership()` only after the AVS Token,
Vault, and Trade Settlement links are all configured. Readiness is derived
solely from those three non-zero bindings; there is no owner-controlled
readiness flag.

Successful renunciation emits `OwnershipRenounced(previousOwner)` and sets
`owner` to `address(0)`. This is irreversible: there is no ownership transfer,
nomination, acceptance, recovery, governance recovery, or other path from the
zero owner to a non-zero owner.

Renunciation removes only the remaining configuration authority. It does not
pause the Ledger, erase bindings, modify accounting, or disable the configured
Vault and Trade Settlement entrypoints. It is optional during development and
testing and is intended only after the complete production protocol has been
deployed, tested, operated, and validated for a sufficient period. Ledger
renunciation alone does not establish decentralization of the complete AVS
protocol or its external dependencies.

## Capital inflow

Only the configured Vault may call:

```text
recordCapitalInflow(capitalId, beneficiary, capitalAmount) -> sharesToMint
```

The Ledger never transfers funds, creates a user balance, or mints shares. The
non-zero beneficiary is immutable accounting evidence for the future atomic
Vault → Ledger → Issuer → AVS Token mint flow.

Actual capital recording requires the AVS Token binding to be complete and
reverts with `AVSTokenNotBound` while the protocol is unconfigured. Read-only
quotes remain available before binding. After binding, zero supply is the
legitimate Genesis state: the first inflow remains valid and quotes
`sharesToMint = capitalAmount`.

The quote uses pre-inflow state:

```text
if totalSupply == 0:
    sharesToMint = capitalAmount
else:
    sharesToMint = floor(capitalAmount * totalSupply / totalNetAssets)

totalNetAssetsAfter = totalNetAssetsBefore + capitalAmount
```

Capital never changes `totalGrossProfit`, `totalLoss`,
`totalBuybackAllocated`, or `buybackReserve`. Floor rounding prevents
over-minting and dilution. Until a future Issuer completes the corresponding
mint, the displayed AVS value may temporarily rise because Phase 4A records
accounting but does not mint.

Capital identifiers are one-use. Zero identifiers, zero beneficiaries, and
zero amounts revert. Every accepted inflow stores its ID, beneficiary, capital
amount, quoted shares, pre-inflow supply, pre-inflow AVS value, and timestamp.
This is global history, not per-user accounting.

If supply is positive while `totalNetAssets` is zero, `currentAVSValue()`
returns zero. Both capital quote and capital recording revert with
`ZeroNAVWithExistingSupply`; recapitalization is not implemented in Phase 4A.

## Protocol revenue

Only the configured Vault may call:

```text
recordProtocolRevenue(revenueId, amount)
```

This path is for real Marketplace or future protocol revenue. It is distinct
from capital inflow and trading settlement:

- `totalNetAssets` increases by exactly `amount`;
- no AVS shares are quoted or minted;
- `totalGrossProfit`, `totalLoss`, `totalBuybackAllocated`, and
  `buybackReserve` do not change;
- the trading 10% buyback allocation is not applied.

The AVS Token must be bound and its supply must be positive before protocol
revenue can be recorded. This prevents pre-supply revenue from being inherited
by the first later capital depositor. Revenue IDs are non-zero and one-use, and
amounts must be positive.

Each record stores the revenue ID, amount, AVS supply at the record, AVS value
before and after, and timestamp. The replay marker, accounting update, record,
and event are one atomic Ledger operation.

## Trading settlement

Only the configured Trade Settlement source may call:

```text
recordTradingSettlement(settlementId, realizedPnL)
```

Settlement first requires a bound AVS Token, positive token supply, and
positive `totalNetAssets`. An unbound token reverts with `AVSTokenNotBound`;
zero supply or zero net assets reverts with `NoActiveEconomicSupply`. This
prevents realized PnL from creating synthetic protocol assets before active
economic capital exists.

For positive PnL:

```text
buybackAllocation = floor(realizedPnL * 1,000 / 10,000)
netEconomicImpact = realizedPnL - buybackAllocation
totalGrossProfit += realizedPnL
totalBuybackAllocated += buybackAllocation
buybackReserve += buybackAllocation
totalNetAssets += netEconomicImpact
```

The reserve is rounded down to the nearest accounting unit. Any indivisible
remainder stays in the AVS economic allocation, so the two allocations always
sum exactly to realized PnL.

For negative PnL:

```text
loss = abs(realizedPnL)
buybackAllocation = 0
netEconomicImpact = -loss
totalLoss += loss
totalNetAssets -= loss
```

A loss does not change `totalGrossProfit`, `totalBuybackAllocated`, or
`buybackReserve`. A loss larger than `totalNetAssets` reverts instead of
underflowing. Settlement IDs are one-use and zero IDs or zero PnL revert.

## Historical records

Every accepted capital inflow stores:

- capital ID;
- beneficiary;
- capital amount;
- shares quoted from pre-inflow state;
- AVS supply before inflow;
- AVS value before inflow;
- block timestamp.

Every accepted trading settlement stores:

- settlement ID;
- signed realized PnL;
- buyback allocation;
- signed net economic impact;
- AVS supply at settlement;
- AVS value before and after;
- block timestamp.

The record cannot be replaced because duplicate settlement IDs revert.
Explorer-ready events mirror these accounting fields.

Every accepted protocol-revenue record stores:

- revenue ID;
- revenue amount;
- AVS supply at the record;
- AVS value before and after;
- block timestamp.

## Authorization matrix

| Caller                      | Allowed writes                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Current non-zero owner      | Bind AVS Token, Vault, and Trade Settlement once; renounce only after all three bindings |
| Configured Vault            | Record capital inflow and protocol revenue only                                          |
| Configured Trade Settlement | Record realized trading PnL only                                                         |
| Everyone                    | Public reads only                                                                        |

No caller can set AVS value, net assets, profit, loss, or buyback reserve
directly.

## Phase boundary

The Ledger does not implement the AVS Token, Vault custody, Issuer, Marketplace,
trade execution, exchange verification, oracle, paymaster, withdrawals,
redemption, Smart Account changes, or Mainnet behavior. The current Testnet
Ledger candidate is recorded in `deployments/bsc-testnet/avs-ledger.json`.
