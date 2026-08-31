# Phase 4A — AVS Ledger Foundation

## Objective

Build and validate the protocol-wide economic accounting foundation, then
deploy and source-verify only the canonical Ledger on BSC Testnet.

## Implemented

- zero-genesis global Ledger state;
- 1 USDT zero-supply accounting value;
- one-time AVS Token, Vault, and Trade Settlement bindings;
- exact 18-decimal AVS Token validation before irreversible binding;
- explicit rejection of economic writes before AVS Token binding;
- trading settlement only after positive AVS supply and positive net assets;
- pre-inflow capital share quotes without minting;
- beneficiary-bound, immutable capital inflow history without user balances;
- capital accounting that does not create profit;
- positive realized PnL allocation to 10% buyback reserve and 90% AVS economic
  assets, subject to integer rounding;
- negative realized PnL accounting with a hard economic-assets boundary;
- replay-protected capital and settlement identifiers;
- immutable settlement history and explorer-ready events;
- explicit custom errors and public read access.

## Binding decisions

The constructor receives an explicit non-zero `initialOwner`; the temporary
deployer does not become owner implicitly. The owner is publicly readable
storage, all three bindings are one-time and permanently locked after
successful configuration, and the owner configures addresses only. It cannot
set economic values and cannot grant a generic writer role.

This conservative policy prevents a later owner transaction from replacing an
authorized economic source. Any future migration requires a separately
reviewed protocol design rather than a hidden setter in Phase 4A.

The constructor is:

```solidity
constructor(address initialOwner)
```

It has no fallback to `msg.sender`.

The current owner may irreversibly call `renounceOwnership()` only after the
AVS Token, Vault, and Trade Settlement bindings are all complete. Renunciation
emits `OwnershipRenounced(previousOwner)` and sets `owner` to zero. No transfer,
replacement, recovery, or governance path can assign a non-zero owner again.

Renunciation is optional during development and testing and is intended only
after the complete production protocol has been deployed, tested, operated,
and validated for a sufficient period. It removes configuration authority
only: it does not pause the Ledger, alter accounting or bindings, or disable
the configured Vault and Trade Settlement. Ledger renunciation alone is not a
claim that the complete AVS protocol is decentralized.

## Precision and rounding

Capital and PnL use 18-decimal USDT-equivalent accounting units. AVS supply is
interpreted as 18-decimal share units. AVS value is returned in 18-decimal
USDT-equivalent units per whole AVS.

The Phase 4A token interface reads `name()`, `totalSupply()`, and `decimals()`
during binding. Binding reverts unless all reads succeed and `decimals()` is
exactly 18. After a successful bind the token address is permanently locked.

- Accounting value division rounds down.
- Capital share quotes round down.
- Positive-PnL buyback allocation rounds down.
- The remaining positive PnL is assigned to AVS economic assets so no
  accounting unit disappears.
- Full-precision `mulDiv` arithmetic is used where products may exceed 256
  bits; state additions use explicit overflow checks.

## APIs

Capital:

```text
quoteCapitalInflow(capitalAmount) -> sharesToMint
recordCapitalInflow(capitalId, beneficiary, capitalAmount) -> sharesToMint
capitalRecord(capitalId) -> CapitalRecord
```

Trading:

```text
recordTradingSettlement(settlementId, realizedPnL)
settlementRecord(settlementId) -> SettlementRecord
```

Configuration:

```text
bindAVSToken(token)
configureVault(vaultSource)
configureTradeSettlement(tradeSettlementSource)
```

## Events

- `AVSTokenBound`
- `VaultConfigured`
- `TradeSettlementConfigured`
- `CapitalInflowRecorded`
- `TradingSettlementRecorded`

## Accounting counters

- `totalNetAssets`: current capital plus AVS-attributable realized performance.
- `totalGrossProfit`: lifetime positive realized PnL before buyback allocation.
- `totalLoss`: lifetime absolute realized loss.
- `totalBuybackAllocated`: lifetime buyback allocation.
- `buybackReserve`: current reserve available for future Marketplace use.

Losses do not reduce either buyback counter. Phase 4A has no reserve-consumption
entrypoint, so the lifetime allocation and current reserve remain equal until a
future, separately reviewed Marketplace integration exists.

## Zero-NAV state

When supply is positive and net assets are zero, AVS value is zero. Capital
quote and record calls revert with `ZeroNAVWithExistingSupply`; Phase 4A does
not implement recapitalization.

Trading settlement also reverts with `NoActiveEconomicSupply` whenever supply
or net assets are zero. Capital inflow remains valid at Genesis after AVS Token
binding when supply is zero, with `sharesQuoted == capitalAmount`.

## Security boundary

The Ledger is accounting-only. It has no token mint, burn, transfer, pause,
seizure, custody, withdrawal, trade verification, price setter, or arbitrary
economic setter.

## BSC Testnet checkpoint

The original Phase 4A Testnet `AVSLedger` was deployed at
`0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04` on chain ID `97`. It is preserved
as a source-verified historical deployment but is now **SUPERSEDED** by the
Phase 4C integration revision, which adds the narrowly scoped protocol-revenue
accounting path. The historical record remains in
`docs/deployments/bsc-testnet-phase-4a.md`.

The deployed AVS Token, Vault, and Trade Settlement bindings remain
`address(0)`, and `renounceOwnership()` has not been called.

## Stop point

Phase 4A is deployed and verified on BSC Testnet but remains unaudited. No
release, AVS Token, Vault, Marketplace, later protocol phase, or Mainnet work
is part of this checkpoint.
