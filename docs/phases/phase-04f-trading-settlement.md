# Phase 4F — Finalized Trading Settlement

## Scope

Phase 4F introduces `AVSTradingSettlement` as an independent finalized-trade
archive, Ledger accounting boundary, and productive-capital forwarding
boundary. It does not execute strategies or move legacy balances. The Final
Protocol Integration Revision connects Vault, Ledger, Marketplace, and
TradingSettlement without changing Token or Migration economics.

## Authorization

Every settlement requires three independent actors:

1. an authorized relayer submits the transaction;
2. an authorized trade signer signs the settlement;
3. an authorized server signer signs the same settlement.

Role collisions are rejected. Signatures use EIP-712 with domain name
`Alpha Prime AVS Trading Settlement`, version `1`, the live chain ID, and the
settlement contract address.

## Deterministic identity and signed hash

`settlementId` is:

`keccak256(abi.encode(chainId, settlementContract, sequence, positionId, executionHash))`

The signed `settlementHash` is hierarchical to avoid Solidity stack limits
while committing to every submitted field:

- `identityHash`: settlement ID, position ID, sequence, execution hash;
- `metadataHash`: strategy, execution type, symbol, base/quote assets, venues;
- `capitalHash`: protocol capital, borrowed capital, notional, quantity, prices;
- `economicsHash`: gross PnL and all four fee categories;
- `timingHash`: open/close timestamps and execution duration;
- `legsHash`: ordered typed hashes of every execution leg;
- `extraFieldsHash`: ordered typed hashes of every key/value pair.

The final authorization signs
`SettlementAuthorization(bytes32 settlementHash)` through EIP-712.

## Accounting

The contract calculates:

`totalFees = tradingFees + networkFees + financingFees + otherFees`

`netRealizedPnl = grossPnl - totalFees`

Only `netRealizedPnl` is passed to `AVSLedger.recordTradingSettlement`.
Phase 4F does not apply another 10% deduction; Ledger remains the sole owner of
its existing positive-profit rule. Zero-net finalized trades remain valid
economic history and are archived with no NAV change. The local Ledger mock
and production `AVSLedger` both accept this boundary. A zero-PnL settlement is
marked processed and appended to Ledger history, while profit, loss, buyback,
economic assets, and NAV remain unchanged. The Ledger's AVS unit value is read
immediately before and after the Ledger call and archived on-chain. The archive
fields retain the names `navBefore` and `navAfter`, but their values represent
`AVSLedger.currentAVSValue()`, not `AVSLedger.totalNetAssets()`.

For timing semantics, `openedAt` is the economic position start time,
`closedAt` is the economic finalization time, `executionMs` is the signed
execution/engine latency metric, and `recordedAt` is the blockchain
`block.timestamp` at finalization. `executionMs` is not required to equal the
difference between the two timestamps.

## Replay and archive guarantees

Settlement ID, execution hash, and sequence are each one-time values. Sequences
need not be contiguous. There is no administrative method to edit, delete, or
fabricate archived economic history.

Core records, display data, fee breakdown, timestamps, authentication actors,
execution legs, and extra fields are available through bounded getters.
Settlement-ID pagination is capped at 100 entries per call.

## Marketplace boundary

The Marketplace post-settlement hook is optional and isolated with
`try/catch`. Its failure emits a deferred-processing event and does not reverse
the Ledger settlement.

Marketplace implements a TradingSettlement-compatible overload in addition to
its existing bounded hook. It ignores signed settlement metadata because that
history belongs to TradingSettlement, then resumes the same bounded,
queue-selected NAV matching. No order, price, fee, or liquidity economics are
changed.

## Physical capital flow

Fresh productive capital follows one atomic path:

`AVSVault -> AVSTradingSettlement -> tradingDestination`

Vault sets an exact allowance and calls `receiveProductiveCapital`; it does not
transfer directly to the final destination. TradingSettlement only accepts the
configured Vault, pulls the exact amount, forwards the exact amount, and must
finish with no retained USDT for that call.

`tradingDestination` may be a normal EOA on Testnet or a receiving/multisig
contract in production. It is not required to implement an AVS callback or a
Capital Manager ABI. Zero, self, owner, and existing prohibited configuration
collisions are rejected. The removed Capital Manager interface is not part of
the final protocol.

Physical capital is deliberately independent of economic settlement:

- capital forwarding does not create profit, loss, revenue, or NAV changes;
- signed trade settlement moves no USDT and reports only net PnL to Ledger;
- `protocolCapitalUsd` is signed trade context, not a proof of the
  TradingSettlement or Vault token balance;
- protocol capital may be deployed externally or combined with borrowed
  capital, so no equality between reported capital and an on-chain balance is
  imposed.

## Economic reporting flow

`Trading Server -> dual-signed settlement -> TradingSettlement -> AVSLedger`

TradingSettlement computes net PnL once. Ledger remains the sole authority for
the positive-profit 10/90 allocation. Marketplace revenue remains Protocol
Revenue and never becomes Trading PnL. NAV is Ledger accounting over economic
supply and must not be inferred from the Vault's post-forwarding token balance.

Returned capital remains isolated in Vault's `returnedTradingCapital` bucket.
The Final Protocol Integration Revision does not reactivate automatic
redeployment or a settlement-time capital return loop.