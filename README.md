# Alpha Prime AVS Protocol

Alpha Prime AVS Protocol is the foundation for an open on-chain protocol that
Alpha Prime and third-party applications can use.

> **EXPERIMENTAL / TESTNET ONLY**
>
> This code is not audited and must not be used to custody production funds.
> There is no production or Mainnet deployment.

## Current status

- Smart Account Phase 1: **PASS**
- ERC-4337 / Passkey Phase 2: **PASS**
- BSC Testnet deployment: **PASS**
- Real browser WebAuthn test: **PASS**
- Mainnet deployment: **NOT STARTED**
- Recovery: **NOT IMPLEMENTED**
- Paymaster: **NOT IMPLEMENTED**
- Pools / Shares / Marketplace: **NOT IMPLEMENTED**
- Security audit: **NOT COMPLETED**

This repository is an independent AVS Protocol project. The current workspace is
the canonical development source for the `v0.2.0-testnet` baseline; it is not
connected to or dependent on any Alpha Prime production server, legacy backend,
or existing user system.

## Development status and roadmap

### Completed

- [Phase 1 — Smart Account Foundation](docs/phases/phase-01-smart-account-foundation.md)
- [Phase 2 — Real Passkey + ERC-4337](docs/phases/phase-02-passkey-erc4337.md)
- [BSC Testnet deployment record](docs/deployments/bsc-testnet-phase-2.md)

### Proposed

- [v0.2.0-testnet release notes](docs/releases/v0.2.0-testnet.md)

Phase 3 has not started. Future protocol work remains subject to separate
design, implementation, testing, security review, and explicit approval.

## Testnet deployment

The validated deployment is on BSC Testnet only.

The complete deployment and verification record is in
[`docs/deployments/bsc-testnet-phase-2.md`](docs/deployments/bsc-testnet-phase-2.md).

| Component | Value |
| --- | --- |
| Network | BSC Testnet |
| Chain ID | `97` |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| AVSAccount Implementation | `0x86499A2a5390bbb40001c021aF6976F11144F9BC` |
| AVSAccountFactory | `0x4EA3e3BEC6DC92e5fFB3275DF377e0792EeD7AdD` |
| TestReceiver | `0x3d0d55295e81aA282688031f604A1B37E70009Ef` |

The canonical EntryPoint v0.8 contract above is reused; it is not modified or
redeployed by this project.

## Real-device validation flow

The successful testnet flow is:

```text
Passkey
  → WebAuthn
  → ERC-4337 UserOperation
  → EntryPoint v0.8
  → AVSAccount
  → TestReceiver
  → TestExecuted
```

The Passkey private key remains inside the platform authenticator. The injected
wallet is used only as the local deployer, account-funding wallet, and
bundler transaction sender; it does not authorize the AVSAccount.

```text
Alpha Prime AVS Protocol
        |
        +-- Smart Account Layer
        +-- Pool Layer
        +-- Share Ownership
        +-- Marketplace
        +-- Liquidity Engine
        +-- Strategy / Publisher Layer
        +-- Partner SDK
```

## Core architectural principles

1. User ownership and user financial execution are on-chain.
2. The Alpha Prime backend never signs user financial transactions.
3. Each user has an independent ERC-4337 Smart Account.
4. User authorization will use Passkeys/WebAuthn.
5. User-facing protocol reads do not depend on an Alpha Prime database.
6. Off-chain infrastructure is reserved for activities blockchain cannot perform
   directly, such as CEX trading execution.
7. Off-chain trading results will later be published into protocol state through
   a dedicated attestation/publisher layer.
8. Third-party applications must interact with the protocol without depending
   on Alpha Prime's frontend or user backend.
9. SDK integrations communicate with blockchain/protocol contracts, not
   `api.alphaprime.*` as the source of financial truth.
10. No mainnet deployment occurs before security review and explicit approval.

## Phase 2 local Passkey prototype

The browser prototype is in `apps/passkey-demo`. It uses a real platform
Passkey through `navigator.credentials.create()` and
`navigator.credentials.get()`. The Passkey private key never leaves the
authenticator.

The prototype does not contain a backend signer. An injected browser wallet is
used only as local infrastructure to deploy the account and submit the signed
UserOperation. Account authorization remains the WebAuthn P-256 signature.

### Local run

1. Start a persistent local EVM:

   ```bash
   pnpm run demo:node
   ```

2. In another shell, install the official EntryPoint v0.8 runtime at
   `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` and deploy the implementation,
   Factory, and event-only `TestReceiver`:

   ```bash
   pnpm run demo:deploy
   ```

3. Copy `apps/passkey-demo/.env.example` to
   `apps/passkey-demo/.env`, replace the Factory and Receiver addresses with
   the deployment output, and restart the app:

   ```bash
   pnpm run demo:app
   ```

4. Point an injected browser wallet at the same local EVM and select one of its
   funded development accounts. The wallet may submit and fund local
   transactions, but it is not stored by the app and cannot authorize the AVS
   account.

The automated suite installs the official v0.8 runtime directly in Hardhat and
tests valid operations for two distinct P-256 keys, tampering, replay, malformed
WebAuthn data, wrong challenges, and bundler-only submission.

## Validation commands

Run these commands before publishing a baseline:

```bash
pnpm run compile
pnpm test
pnpm run typecheck
pnpm --filter @workspace/avs-passkey-demo run build
```

The expected protocol test result for this baseline is **22 passing, 0 failing**.

## Release proposal

- Tag: `v0.2.0-testnet`
- Suggested title: **AVS Smart Account — Real Passkey + ERC-4337 Testnet Baseline**

This is a proposal only. No GitHub push, tag, or release is performed by the
baseline preparation step.