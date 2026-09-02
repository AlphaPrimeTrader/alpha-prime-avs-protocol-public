# Alpha Prime AVS Protocol

Alpha Prime AVS Protocol is an open-source foundation for experimental
on-chain Smart Accounts and Passkey authorization.

> **EXPERIMENTAL / BSC TESTNET ONLY**
>
> The current Smart Account and Recovery architecture is not final, is not
> audited, is not Mainnet ready, and must not be used to custody production
> funds. The account model may be revised before any Mainnet work.

## Frozen checkpoint status

- Smart Account foundation: **PASS**
- ERC-4337 / Passkey authorization: **PASS**
- Phase 3A security-kernel foundation: **PASS — EXPERIMENTAL**
- Phase 3B atomic Recovery root rotation: **PASS — EXPERIMENTAL**
- Phase 3B.2 immutable Access API v1.1.0: **PASS — BSC TESTNET VERIFIED**
- Phase 3C first Trading Settlement: **PASS — BSC TESTNET VERIFIED**
- Phase 4A AVS Ledger foundation: **PASS — BSC TESTNET VERIFIED**
- Phase 4B AVS Token foundation: **PASS — BSC TESTNET VERIFIED**
- Phase 4C AVS Vault foundation: **PASS — BSC TESTNET CORE BINDINGS**
- Phase 4D atomic legacy migration: **PASS — BSC TESTNET REHEARSAL**
- Same-account-address Recovery: **PASS ON BSC TESTNET**
- Evolution authority separation: **PASS**
- BSC Testnet deployment and verification: **PASS**
- Mainnet deployment: **NOT STARTED**
- Production security audit: **NOT COMPLETED**
- Paymaster and Pools: **NOT IMPLEMENTED**
- Marketplace lifecycle and Trading Settlement: **PASS — EXPERIMENTAL BSC TESTNET**

This checkpoint includes Economic Generation 1, the immutable Access API
v1.1.0, the completed primary capital and Marketplace lifecycle, and the first
Trading Settlement on BSC Testnet. It does not claim that the current
Smart Account or economic model is the final product architecture.

## Current experimental account model

The canonical browser reference is [`apps/passkey-demo/`](apps/passkey-demo/).
It demonstrates:

- platform Passkey / WebAuthn authorization;
- ERC-4337 UserOperations through the canonical EntryPoint v0.8;
- separate Transaction, Recovery, and Evolution authority;
- an encrypted offline Recovery Kit using Argon2id and AES-256-GCM;
- immediate atomic rotation of the Transaction and Recovery roots;
- invalidation of the old Transaction credential and old Recovery Kit;
- preservation of the same Smart Account address, assets, EntryPoint,
  Authority, and EvolutionController across Recovery;
- an Evolution path that remains separate from Recovery and retains its own
  existing timelock.

Recovery has no backend signer and grants no authority to the relay. The
browser creates and uses Recovery secret material locally. Public protocol
source describes the cryptographic enforcement; security does not depend on
hiding the algorithms.

## BSC Testnet checkpoint

| Component                       | Value                                        |
| ------------------------------- | -------------------------------------------- |
| Network                         | BSC Testnet                                  |
| Chain ID                        | `97`                                         |
| Canonical EntryPoint v0.8       | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| Phase 3B Factory                | `0xf3b30D7e6EB3639d056c66AABd10F904BA22487A` |
| Phase 3B Authority              | `0x23026F82317b82283537466d4ba3A5A05F74bb11` |
| EvolutionController             | `0x9d5d16C84D7E36a1436979fe164Af81D62B59A9e` |
| Initial bounded implementation  | `0x6aCA3dCA40A3d031163686547F42Fe6fb55E8797` |
| TestReceiver                    | `0x99907924aBC19287E8f1e68b124bDFF31d06563e` |
| Phase 4A AVSLedger (superseded) | `0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04` |
| Phase 4C AVSLedger candidate    | `0x643c16B56f528503FB0f4e3e95E48eBf1D73982e` |
| Phase 4B AVSToken               | `0x2861F3d12082710118391f06F818CA3412ffFE87` |
| Phase 4C TestUSDT test asset    | `0x398bc6c1201690ec7cDF632aDc82B805240c3F9a` |
| Phase 4C AVSVault candidate     | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85` |

The sanitized deployment and validation records are in
[`docs/deployments/bsc-testnet-phase-3b.md`](docs/deployments/bsc-testnet-phase-3b.md)
and
[`docs/deployments/bsc-testnet-phase-4a.md`](docs/deployments/bsc-testnet-phase-4a.md),
and
[`docs/deployments/bsc-testnet-phase-4b.md`](docs/deployments/bsc-testnet-phase-4b.md),
and
[`docs/deployments/bsc-testnet-phase-4c.md`](docs/deployments/bsc-testnet-phase-4c.md).
Historical Phase 1, Phase 2, and Phase 3A records remain unchanged.

The Phase 4D migration design, Testnet deployment, and execution evidence are
documented in
[`docs/phases/phase-04d-migration.md`](docs/phases/phase-04d-migration.md).

## Developer Access — BSC Testnet

AVS currently exposes an immutable Access API for direct blockchain
integrations.

| Property             | Current value |
| -------------------- | ------------- |
| Network              | BNB Smart Chain Testnet |
| Chain ID             | `97` |
| Economic Generation  | `1` |
| Access API           | `v1.1.0` |
| Gateway              | `0x53818cc4105b918042a3799e757771A4555C60F0` |
| Lens                 | `0x7ca0b7dD14A0991eBe029508e0F4Fa03cB0b007b` |

A developer can start with a BSC RPC, the AVSGateway address, and the
AVSGateway ABI. The Gateway discovers the current protocol modules and exposes
the protocol read layer; integrations should discover module addresses through
the Gateway rather than hard-coding every module independently.

Applications can verify the chain ID, Economic Generation, Access API version,
module addresses and runtime code hashes, wiring health, protocol and
Marketplace snapshots, order history and pagination, and Trading Settlement
history and pagination.

The public Gateway is an integration and access layer. It does not grant
authority to fabricate trading activity, submit arbitrary protocol PnL,
modify NAV directly, mint AVS arbitrarily, bypass Marketplace authorization,
or obtain protocol administration. Trading Settlement submission is separately
authorization-gated by the Trading Settlement contract.

The Gateway is non-custodial. Marketplace remains the EIP-712 verifying
contract, and user token approvals are granted directly to Marketplace.
Gateway must not receive user token allowances merely because it is the
frontend integration entry point.

All addresses in this section are **BSC TESTNET ONLY**. Do not treat them as
Mainnet deployments. No Mainnet deployment is represented by this checkpoint.
Economic Generation `1` and Access API version `1.1.0` are separate concepts;
an Access API update does not automatically change the economic generation.

The previous Access API v1.0.0 endpoints are historical only:
`0x18097B9Af3AfFf28B07Bf4C762e50DF4802bB778` (Gateway) and
`0x822555dE56fe9Fc2d4DF59E75bf59DF05e233F15` (Lens).

## Security boundaries

1. User financial authorization is enforced on-chain.
2. Passkey private keys remain inside the platform authenticator.
3. Recovery private material remains in the encrypted offline kit and the
   active local browser session.
4. The relay may pay BSC Testnet gas but cannot authorize an account action.
5. Recovery rotates Transaction and Recovery roots atomically; it does not
   rotate or bypass Evolution authority.
6. No Mainnet deployment or production-fund use is permitted before an
   independent security review and explicit approval.

See [`SECURITY.md`](SECURITY.md) and
[`SECURITY-DISCLOSURE-POLICY.md`](SECURITY-DISCLOSURE-POLICY.md).

## Repository layout

- `contracts/` — historical account contracts plus the experimental Phase 3A
  and Phase 3B account contracts, the revised Ledger, the Phase 4B AVS Token,
  the Testnet-only TestUSDT asset, the Phase 4C Vault, and the Testnet-only Phase
  4D Migration bridge and Testnet execution evidence.
- `test/` — Hardhat protocol and adversarial regression tests.
- `apps/passkey-demo/` — the only canonical browser application.
- `scripts/src/` — reproducible Testnet deployment and verification scripts.
- `docs/` — architecture, phase history, deployment evidence, and release
  records.

Generated artifacts, private environment files, uploads, internal workspace
memory, Recovery Kit files, and browser/session dumps are not public source.

## Validation

```bash
pnpm install
cp apps/passkey-demo/.env.example apps/passkey-demo/.env.local
pnpm run compile
pnpm test
pnpm run typecheck
pnpm --filter @workspace/passkey-demo test:recovery-kit
pnpm --filter @workspace/passkey-demo run build
pnpm run phase3b:bsc:verify
pnpm hardhat test test/access/AVSAccessLayer.test.ts
pnpm run phase4a:bsc:preflight
pnpm run phase4b:local:validate
pnpm run phase4b:bsc:verify
```

The BSC verification command is read-only. Deployment commands require an
explicit Testnet confirmation variable and are not part of ordinary validation.

## Publication status

This repository records the experimental BSC Testnet account and economic
checkpoint, Economic Generation 1, Access API v1.1.0, the completed primary
capital and Marketplace lifecycle, and the first Trading Settlement. It also
contains the later Ledger, Token, Vault, and Migration development records.
No Mainnet release is authorized.
