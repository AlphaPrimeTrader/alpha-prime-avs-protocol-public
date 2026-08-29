# AVS Account Security Kernel Architecture

## Status

Phase 3A establishes the immutable security foundation for future AVS Smart
Accounts. It does not modify the experimental Phase 2 ERC-1167 accounts and
does not deploy contracts to BSC Testnet or Mainnet.

The governing priority is:

```text
Permanent core security > maximum implementation flexibility
```

## Components

### AVSAccountSecurityKernel

The Kernel is the stable account address and permanent asset owner. Its
bytecode is immutable.

It owns:

- canonical EntryPoint v0.8 caller validation;
- ERC-4337 `validateUserOp`;
- WebAuthn transaction-signature delegation to the Authority;
- generic ERC-7821 batch execution;
- EntryPoint-only generic execution;
- bounded upgrade request and cancellation entrypoints.

It has no owner, administrator, backend signer, Factory override, unrestricted
fallback, or generic `delegatecall`.

### AVSAccountAuthority

The Authority is an immutable, ownerless singleton with account-keyed state.
It stores separate P-256 public keys for:

- normal transaction authorization;
- future Recovery authorization;
- implementation evolution authorization.

Proxy or Kernel origin is never sufficient authorization. The Authority
verifies the exact WebAuthn challenge against the key required for the action.

Phase 3A stores the Recovery credential but does not implement Recovery request,
cancellation, or finalization.

### AVSEvolutionController

The Controller is an immutable, ownerless singleton with account-keyed
evolution state. It stores:

- the current bounded-logic implementation and codehash;
- the current AVS Account Standard version;
- the account-approved codehash set;
- the upgrade nonce;
- one pending upgrade;
- its request, execution, expiry, and cancellation state.

An upgrade request requires independent WebAuthn authorization from the
transaction credential and Evolution credential over the same exact digest.
The minimum delay is 48 hours. Finalization is permissionless after the delay.

The implementation pointer is not stored in Kernel storage and no unrestricted
delegation to that implementation exists in Phase 3A.

### AVSAccountKernelFactory

The Factory is immutable, ownerless, and creation-only. It predicts and deploys
Kernel accounts with `CREATE2`, but cannot change a deployed account.

The Factory constructor deploys the exact ownerless Authority and
EvolutionController implementations used by its accounts. It does not accept
user-selected security-component addresses. The canonical EntryPoint v0.8
address is fixed in Factory and Kernel bytecode and must contain deployed code.

## Deterministic identity policy

The permanent account identity is derived from:

```text
Factory address
+ immutable Kernel creation bytecode
+ primary Transaction Passkey
+ userSalt
```

Recovery keys, Evolution keys, and version metadata are not identity inputs.
Their future rotation therefore does not change the account address.

All initial security configuration is nevertheless committed by the primary
Transaction Passkey through an exact creation digest.

## Atomic creation and front-run protection

The Factory temporarily records the signed creation configuration and deploys
the Kernel with constant creation bytecode.

During construction:

1. The Kernel reads the Factory's immutable Authority, Controller, and
   EntryPoint references.
2. The Kernel consumes the pending configuration from the Factory.
3. The Factory accepts consumption only from the exact predicted account while
   it has no deployed runtime code.
4. The Kernel asks the Authority to verify the primary Transaction Passkey's
   WebAuthn signature over the account address and complete configuration.
5. The Authority initializes the three credential roles.
6. The Controller validates and records the initial bounded implementation.
7. The Kernel constructor completes.

Any failure reverts the entire transaction. No partially initialized account or
pending Factory configuration remains.

A third party may relay the exact signed creation request. It cannot replace
Recovery, Evolution, implementation, codehash, version, Factory, chain, or
account fields without invalidating the signature.

## WebAuthn rules

Phase 3A preserves the Phase 2 verification behavior:

- the challenge is the raw 32-byte digest;
- the six `WebAuthnAuth` fields are encoded directly;
- User Presence and User Verification are required by OpenZeppelin;
- P-256 malleability checks remain enforced;
- browser and test clients normalize signatures to low-S;
- any change to the signed operation invalidates authorization.

The expected RP-ID hash is committed by the signed account creation
configuration, stored in Authority state, and compared with the first 32 bytes
of every assertion's authenticator data.

OpenZeppelin's on-chain WebAuthn verifier does not independently parse and
validate the client origin. Client registration policy and future AVS Account
Standard versions must document that remaining assumption explicitly.

## Generic execution boundary

Normal generic execution is available only when:

```text
msg.sender == canonical EntryPoint v0.8
```

`msg.sender == address(this)` is not accepted as general authorization.

A future self-action must use a specific bounded function with its own exact
authorization. An arbitrary self-call to `execute` is rejected.

Generic execution uses `CALL`, not unrestricted `delegatecall`.

## Evolution authorization

The upgrade digest binds:

- account and Controller;
- chain ID;
- current implementation, codehash, and standard version;
- proposed implementation, codehash, and standard version;
- request ID;
- upgrade nonce;
- authorization validity window.

The proposed contract must:

- have deployed bytecode;
- match the signed codehash;
- report the approved Kernel compatibility identifier;
- report the signed AVS Account Standard version;
- increase the current version monotonically.

The request deadline must leave enough time for the mandatory 48-hour delay.

## Trust and authority

Alpha Prime, Factory, deployer, backend, operator, governance, RPC provider, and
bundler have zero unilateral authority over account execution or evolution.

Authority belongs only to the account's cryptographic credentials under the
on-chain rules.

## Phase boundary

Phase 3A intentionally excludes:

- Recovery request, cancellation, and finalization;
- Recovery-driven signer replacement;
- unrestricted implementation execution;
- Paymaster;
- Pools, Shares, Marketplace, and NAV;
- BSC Testnet or Mainnet deployment;
- migration of Phase 2 accounts.