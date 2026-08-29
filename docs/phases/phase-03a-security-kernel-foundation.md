# Phase 3A — AVS Account Security Kernel Foundation

## Status

- **IMPLEMENTED:** Immutable Kernel, ownerless Authority, ownerless
  EvolutionController, and deterministic Kernel Factory.
- **TESTED:** 36 automated tests, including hostile bounded implementations and
  adversarial initialization.
- **DEPLOYED:** BSC Testnet core contracts and bounded validation
  implementations.
- **VERIFIED:** Real browser creation with separate Transaction, Recovery, and
  Evolution Passkeys; valid UserOperation; tampering rejection; dual-authorized
  Evolution request and authorized cancellation.
- **NOT AUTHORIZED:** Mainnet, production funds, or Phase 3B Recovery.

## Scope

Phase 3A introduces a separate, additive Smart Account foundation without
modifying the Phase 1 or Phase 2 contracts, tests, deployment records, or
historical documentation.

The phase contains:

- `AVSAccountSecurityKernel`;
- `AVSAccountAuthority`;
- `AVSEvolutionController`;
- `AVSAccountKernelFactory`;
- their narrow interfaces;
- Phase 3A security tests;
- architecture documentation.

## Security model

The deployed Kernel is the stable account and asset address. Its core
UserOperation validation and generic execution boundary are immutable.

Normal execution is accepted only from canonical EntryPoint v0.8 after a valid
WebAuthn/P-256 transaction signature.

Signer and evolution state live in external, ownerless contracts so future
bounded logic cannot overwrite them through account storage.

The current bounded implementation is recorded by the external Controller but
is not given unrestricted fallback, UserOperation validation, execution,
Authority mutation, or Controller mutation privileges.

## Creation identity

The deterministic account address commits to the primary Transaction Passkey
and `userSalt`.

The remaining initial configuration is initialized atomically and is signed by
the primary Transaction Passkey. This keeps Recovery and Evolution credential
rotation independent from the permanent account address while preventing
front-running with altered security configuration.

The Phase 3A Factory deploys its exact ownerless Authority and
EvolutionController contracts itself and hard-binds the canonical EntryPoint
v0.8 address. It cannot be configured with an EntryPoint EOA or arbitrary
security-component implementation.

## Phase 2 compatibility

The existing Phase 2 contracts remain unchanged:

```text
contracts/accounts/AVSAccount.sol
contracts/accounts/AVSAccountFactory.sol
```

The existing Phase 1 and Phase 2 tests remain the historical baseline.

Phase 3A reuses the established cryptographic rules:

- canonical EntryPoint v0.8 UserOperation hash;
- real WebAuthn assertion format;
- P-256 verification;
- direct six-field assertion encoding;
- low-S signature normalization;
- account-bound RP-ID hash verification;
- replay and tampering rejection.

## Account evolution

Phase 3A establishes the evolution authorization boundary:

```text
valid EntryPoint UserOperation
+ Transaction Passkey authorization
+ Evolution Passkey authorization
+ exact implementation and codehash
+ monotonically increasing standard version
+ 48-hour on-chain timelock
```

Any address may finalize the exact pending upgrade after the delay. Permission
to submit finalization does not permit changing the approved implementation or
version.

## BSC Testnet deployment

The final addresses, transaction receipts, browser account, UserOperation,
Evolution events, privilege audit, and security recommendation are recorded in
[`docs/deployments/bsc-testnet-phase-3a.md`](../deployments/bsc-testnet-phase-3a.md).

The Phase 3A deployment is separate from the legacy Phase 2 Factory and account
implementation. Only the Phase 2 `TestReceiver` is reused as an event-only
validation target.

## Explicit exclusions

Phase 3A does not implement:

- Recovery request;
- Recovery cancellation;
- Recovery finalization;
- Recovery-based credential replacement;
- Paymaster;
- Pools;
- Shares;
- Marketplace;
- NAV;
- Mainnet deployment;
- Phase 2 account migration;
- unrestricted delegated account logic.

Recovery remains Phase 3B and must not begin until the Phase 3A foundation and
security tests are separately accepted.