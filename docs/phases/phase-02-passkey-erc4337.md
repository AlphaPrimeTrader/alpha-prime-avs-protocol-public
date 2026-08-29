# Phase 2 — Real Passkey + ERC-4337

## Status

- **IMPLEMENTED:** Smart Account authorization with WebAuthn / Passkey P-256 signatures.
- **TESTED:** Automated Phase 2 suite with valid, tampered, replayed, and malformed operations.
- **DEPLOYED:** `AVSAccount`, `AVSAccountFactory`, and `TestReceiver` on BSC Testnet.
- **VERIFIED:** Canonical EntryPoint v0.8 runtime, factory reference, account invariants, and real browser Passkey flow.
- **PLANNED:** Future protocol phases, subject to separate design and approval.

This phase is **EXPERIMENTAL / TESTNET / UNAUDITED / NOT FOR PRODUCTION FUNDS**.

## Objective

Provide an independently owned ERC-4337 Smart Account whose authorization is
performed by a real browser platform Passkey, while keeping private Passkey
material inside the platform authenticator.

## Architecture implemented

The Phase 2 authorization and execution path is:

```text
Passkey
  → WebAuthn assertion
  → P-256 signature encoding
  → ERC-4337 UserOperation
  → canonical EntryPoint v0.8
  → AVSAccount.validateUserOp
  → AVSAccount.execute
  → TestReceiver.emitTest
  → TestExecuted
```

Each account is a deterministic Factory clone initialized with the Passkey's
P-256 public-key coordinates. The browser wallet is used as deployment,
testnet-funding, and bundler infrastructure; it is not the account's
authorization key.

## Contracts and components

### IMPLEMENTED

- `AVSAccount`: ERC-4337 account using OpenZeppelin WebAuthn and P-256 signer
  components, with ERC-7821 execution authorization.
- `AVSAccountFactory`: deterministic account creation with idempotent
  `createAccount`.
- `TestReceiver`: event-only receiver used to prove successful account
  execution.
- `WebAuthnHarness`: test helper for P-256 and WebAuthn verification coverage.
- Browser Passkey demo: creates a credential, derives the account, signs the
  exact UserOperation hash, and submits it through EntryPoint.

### NOT MODIFIED IN THIS PHASE

- Canonical EntryPoint v0.8 deployment.
- Mainnet or production infrastructure.

## Security model

- The Passkey private key never enters the application or blockchain.
- The account stores and verifies the Passkey public-key coordinates.
- UserOperation authorization is bound to the exact EntryPoint UserOperation
  hash, including sender, nonce, call data, gas limits, fees, and target.
- P-256 signatures are normalized to the low-S form before verification.
- Direct unauthorized account execution is rejected.
- The temporary deployment/bundler wallet does not become the account signer.
- Replay protection is provided by the EntryPoint nonce.

## Important design decisions

1. Reuse the canonical EntryPoint v0.8 at its existing address instead of
   modifying or redeploying EntryPoint.
2. Use chain-specific immutable linking when verifying EntryPoint runtime code.
3. Keep the deployer as temporary testnet infrastructure with no permanent
   account privileges.
4. Keep account authorization in WebAuthn rather than in a backend signer.
5. Fund the Smart Account before submission so it can pay ERC-4337 prefund.

## Automated test results

The validation suite completed:

```text
22 passing
0 failing
```

Coverage includes:

- Deterministic account creation and repeated creation behavior.
- Distinct accounts for distinct Passkey public keys.
- Initialization locking and inert implementation behavior.
- Unauthorized execution and cross-account authorization rejection.
- Native and ERC-20 asset custody.
- Valid WebAuthn UserOperations for two P-256 keys.
- Tampered target, calldata, value, and nonce rejection.
- Replay rejection after nonce consumption.
- Random signatures, malformed WebAuthn data, and wrong challenges.
- Bundler-only submission without making the bundler the account signer.

## Real-device and browser test results

The real browser flow was validated with a platform Passkey:

1. Register a browser Passkey.
2. Create or resolve the deterministic AVS Smart Account.
3. Fund the account for ERC-4337 prefund.
4. Sign the UserOperation with `navigator.credentials.get()`.
5. Submit through EntryPoint v0.8.
6. Confirm the `TestExecuted` event from `TestReceiver`.

Result: **TESTED / VERIFIED — PASS**.

## Testnet deployment

The deployment record, addresses, and verification evidence are maintained in
[`docs/deployments/bsc-testnet-phase-2.md`](../deployments/bsc-testnet-phase-2.md).

## Verification evidence

- EntryPoint runtime code is present at the canonical v0.8 address.
- Runtime verification uses the BSC Testnet chain-specific expected hash and
  linked immutable values.
- The Factory points to the deployed `AVSAccount` implementation.
- Factory-created accounts use the canonical EntryPoint.
- Direct deployer execution is rejected.
- Re-initialization is rejected.
- The complete automated suite reports 22 passing tests.
- The real browser flow reaches the receiver event.

## Known limitations

- This phase is unaudited and testnet-only.
- The demo requires an injected EVM wallet and a funded Smart Account.
- Recovery, key rotation, and account security policies are not available.
- No Paymaster or sponsored gas flow is implemented.
- No production deployment or Mainnet deployment exists.
- Testnet assets and deployed contracts may be lost or changed.

## Explicitly not implemented

- **NOT IMPLEMENTED:** Mainnet deployment.
- **NOT IMPLEMENTED:** Independent security audit.
- **NOT IMPLEMENTED:** Recovery or social recovery.
- **NOT IMPLEMENTED:** Paymaster.
- **NOT IMPLEMENTED:** Pools, shares, marketplace, or liquidity engine.
- **NOT IMPLEMENTED:** Strategy publisher and partner SDK production surfaces.

## Security notice

> **EXPERIMENTAL / TESTNET / UNAUDITED**
>
> This code must not be used to custody production funds. Never commit private
> keys, seed phrases, API keys, environment secrets, or private Passkey
> material.

## Next planned phase

Phase 3 has **not started**. Any future protocol expansion requires a separate
scope, implementation, test plan, security review, and explicit approval.