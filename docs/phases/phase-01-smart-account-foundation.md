# Phase 1 — Smart Account Foundation

## Status

**COMPLETE**

This document records only the state proven at the end of Phase 1. Passkey,
WebAuthn, ERC-4337 end-to-end execution, and BSC Testnet deployment were not
part of this phase.

## Objective

Establish the foundational AVS Smart Account architecture with independently
owned accounts, deterministic creation, isolated authorization boundaries, and
basic native-token and ERC-20 receiving behavior.

## AVSAccount architecture

`AVSAccount` is an independently deployed Smart Account implementation based on
OpenZeppelin account components. Each account clone has its own signer state
and is intended to hold assets directly.

Phase 1 established the following properties:

- The implementation is deployed once and used as the clone template.
- Each clone is initialized with its own signer coordinates.
- The implementation initializer is disabled.
- The implementation remains inert even if it holds native funds.
- Unauthorized callers cannot invoke arbitrary account execution.
- One account cannot control another account.
- The account can receive native BNB/ETH.
- The account can receive ERC-20 tokens.

## AVSAccountFactory architecture

`AVSAccountFactory` is responsible for creating and identifying AVS Smart
Accounts. It stores an immutable implementation address and records accounts
created through the Factory.

The Factory can:

- Predict an account address before creation.
- Create a deterministic clone.
- Initialize the clone atomically during the creation transaction.
- Return the existing account for repeated creation parameters.
- Record the created account in its registry.

The Factory cannot:

- Own user accounts.
- Execute user transactions.
- Withdraw user funds.
- Change an account's signer.

## Deterministic clone creation

The account address is derived from the implementation, Factory address, and a
salt derived from the account's initialization coordinates and user salt.
`predictAccount` returns the address before deployment, and
`createAccount` deploys the clone at that deterministic address.

Repeated creation with the same parameters is idempotent and returns the
existing account without replacing its code or signer state.

## Atomic clone initialization

When a new clone is created, the Factory initializes it in the same
transaction. The initialization sets the clone's signer coordinates before
the account is recorded and the creation event is emitted.

This prevents a newly created clone from existing in an uninitialized
authorization state between separate creation and initialization transactions.

## Implementation initializer disabled

The implementation contract disables its initializer in the constructor.
Calling `initialize` on the implementation after deployment is rejected.
Initialization is available only to a newly created clone.

## Implementation inertness

Phase 1 verified that the implementation remains inert even when funded with
native BNB/ETH. It rejects execution authorization and does not spend its
funds when called through the EntryPoint-shaped account validation path.

## Factory authority boundaries

The Factory is a creation and registry component, not a user authority. Phase
1 verified that the Factory cannot execute arbitrary calls through a user's
account or transfer assets from that account.

An external unauthorized account is also rejected when attempting arbitrary
execution.

## Account A / Account B isolation

Two accounts created with different initialization keys and salts receive
different deterministic addresses and retain different signer coordinates.
Account B cannot execute arbitrary calls through Account A.

This establishes account-level isolation for the Phase 1 Smart Account
foundation.

## Asset receiving tests

### Native BNB/ETH

Phase 1 sent native value to a Factory-created account and verified that the
account balance increased by the expected amount.

### ERC-20

Phase 1 minted a test ERC-20 token to a Factory-created account and verified
that the account received the expected token balance.

## Automated test results

The Phase 1 test suite completed:

```text
12 passing
0 failing
```

The result covered deterministic creation, repeated creation, initialization
locking, implementation inertness, authorization boundaries, Account A /
Account B isolation, native BNB/ETH receiving, and ERC-20 receiving.

## Explicitly not proven in Phase 1

The following were **NOT PROVEN** at the end of Phase 1:

- Real browser Passkey.
- WebAuthn assertion.
- ERC-4337 end-to-end UserOperation.
- BSC Testnet deployment.
- Recovery.
- Paymaster.
- Pools.
- Marketplace.
- NAV.

## Security notice

Phase 1 was foundational and experimental. It was not a production security
review and did not establish production readiness, Mainnet readiness, or
production-funds safety.

## Historical boundary

Phase 2 later added real Passkey/WebAuthn authorization and ERC-4337
UserOperation validation. Those later capabilities are intentionally not
attributed to this Phase 1 record.