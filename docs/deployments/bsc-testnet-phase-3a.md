# BSC Testnet Phase 3A — Final Deployment and Security Validation Report

## Final status

**PHASE 3A BSC TESTNET DEPLOYMENT AND LIVE VALIDATION: PASS**

Phase 3A is deployed and validated on BNB Smart Chain Testnet only. The
deployment is experimental, unaudited, and not approved for Mainnet or
production funds.

This report records only verified source, automated-test, browser, transaction,
receipt, event, and on-chain state evidence.

## Scope and exclusions

Validated scope:

- `AVSAccountAuthority`;
- `AVSEvolutionController`;
- `AVSAccountKernelFactory`;
- `AVSAccountSecurityKernel`;
- bounded implementation compatibility;
- deterministic account creation;
- separate Transaction, Recovery, and Evolution Passkeys;
- canonical EntryPoint v0.8 UserOperations;
- authorization tampering and replay rejection;
- dual-authorized Evolution request and authorized cancellation;
- temporary deployer privilege boundaries.

Explicitly excluded:

- Mainnet;
- Phase 3B Recovery behavior;
- Paymaster;
- pools, shares, NAV, marketplace, or liquidity features;
- migration of Phase 2 accounts;
- production-fund custody;
- completion of a pending upgrade before the immutable 48-hour delay.

## Network

| Item | Verified value |
| --- | --- |
| Network | BNB Smart Chain Testnet |
| Chain ID | `97` |
| Canonical EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| EntryPoint runtime hash | `0x9bb19c12079ada979da5294aa219ee5a12a2ce797272b14344e38302a2835a98` |
| Temporary deployer / browser transaction submitter | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |

## Phase 2 separation

The following are the legacy Phase 2 contracts. They were not reported or used
as Phase 3A security components:

| Phase 2 contract | Address |
| --- | --- |
| `AVSAccount` implementation | `0x86499A2a5390bbb40001c021aF6976F11144F9BC` |
| `AVSAccountFactory` | `0x4EA3e3BEC6DC92e5fFB3275DF377e0792EeD7AdD` |
| `TestReceiver` | `0x3d0d55295e81aA282688031f604A1B37E70009Ef` |

`TestReceiver` was intentionally reused only as an event-only validation
target. The Phase 2 Factory and Phase 2 account implementation were not reused
for Phase 3A account creation.

## Phase 3A deployment

### Core deployment

| Contract | Address | Runtime bytecode hash |
| --- | --- | --- |
| `AVSAccountKernelFactory` | `0xe01DAafEcA3e1F63d5528F66facb175169add04e` | `0x581d7eb3d6761cee5bba1b7c3fe309e80c801be6e622afd4a56df95291b00c62` |
| `AVSAccountAuthority` | `0x2dB5Dbe4e7D08998d7bEC496cF24B3151f5cC179` | `0xa75e505b327ff48daf4de9ae3cb41f80f29002a37f67a10d3849cd1c9f486b81` |
| `AVSEvolutionController` | `0x9B3cE988fdfFDeDD0898c171757C99c2079bcEC2` | `0x68095c4c66f220e9c72cf1413d2db16e95f3ea9431469fca0f66f248f27e845c` |

Factory deployment:

- transaction:
  `0x4eed70d736baef18a21745a01d584d8e679d852097cd511c25729de6f248cee6`;
- block: `127972427`;
- gas used: `5,216,064`.

The Authority and EvolutionController were created internally by the Factory
in the same outer deployment transaction.

Verified Factory bindings:

- Authority:
  `0x2dB5Dbe4e7D08998d7bEC496cF24B3151f5cC179`;
- EvolutionController:
  `0x9B3cE988fdfFDeDD0898c171757C99c2079bcEC2`;
- EntryPoint:
  `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`.

### Bounded implementations used for validation

| Purpose | Address | Version | Runtime hash | Deployment transaction |
| --- | --- | ---: | --- | --- |
| Initial implementation | `0x4e68BE79A7ec63De4FB9abD84Addbc87AecC8AC5` | 1 | `0x6047bf2daa7234499683627d588d9e5128da2b87cce5f35ff3c40ea636f453b3` | `0xc5cc878d4f9ad68fee48704798cfd438f04d17d837a207a5c36d9d3d940e04c6` |
| Evolution test target | `0x0ed2097B83F91D25005c0892b6Ee32d4bBD43dE3` | 2 | `0x431059886e19cf26e6d6799d1a49282e7d77195ade2da88c7d8832b4d25ae77c` | `0x36096e69ac54fb679bdbe935b8af51dc6a679066f232a957805977589adab587` |

Both implementations expose the expected Phase 3A security-kernel interface
identifier. Neither implementation receives ownership of the Kernel,
Authority, Factory, or Controller.

## Real browser account creation

Three distinct browser platform credentials were created:

- Transaction Passkey;
- Recovery Passkey;
- Evolution Passkey.

Private Passkey material remained inside the browser authenticator. Only public
P-256 coordinates were registered.

| Item | Verified value |
| --- | --- |
| Predicted account | `0xE01B0203393E6b0c5922434A861aF6dbfA9DE731` |
| Deployed account | `0xE01B0203393E6b0c5922434A861aF6dbfA9DE731` |
| Creation transaction | `0x9f75b525bad60196d8c3b53925a1feae23620389dc4836f15b36c78e3d76c55b` |
| Creation block | `127974605` |
| Creation gas used | `1,842,277` |
| Account runtime hash | `0x5f4c2e3e2a5f23c74518d6b60818d5ca433dd7f93150aa84b5ace3eeea9f05fe` |
| RP-ID hash | `0x76a1dd12d20ea9a2504048fcf3f42a8c638e2ad3ffe15a9a1a557aa887083fb6` |

Predicted and deployed addresses match exactly.

### Registered public keys

Transaction key:

- qx:
  `0xe15896f65680df56f76ba5c8d04440d110b5fc6aa10acaf2d194f48390729f6d`;
- qy:
  `0xa9d44669013f7302e4cbb7b6dca17eacaa5fda629b4979ddc5bf3ea36fa05ebb`.

Recovery key:

- qx:
  `0xb3d9cb9078cbe91ae24024e7e5c450da1eec40d8fb44ca643796b851d8b3cbc2`;
- qy:
  `0x93d5f904a53128df121f2958083c8fb2bc530bfc9af2f83a9ab386a51dbf5eff`.

Evolution key:

- qx:
  `0x7232d556e24c6b7c03d29b227236428aa305c027c1e652f912ff15f39217392a`;
- qy:
  `0x8c290ec3a57b7a112b6218f4fa43cfe44933b5e6ead790c5fe4e16a26275423c`.

The account immutably reports the deployed Authority, EvolutionController, and
canonical EntryPoint addresses listed above.

## UserOperation validation

Valid operation:

| Item | Verified value |
| --- | --- |
| UserOperation hash | `0x6dbd5f20ac216a57c5b1d429d04b14b93ab4886f02029164520963e62246cd17` |
| EntryPoint transaction | `0x962e3b1bea69371a4e63e4d4d6ef57ac8ac6f956b8ade22bd59d1b78f178faaf` |
| Block | `127974660` |
| Transaction gas used | `152,329` |
| UserOperation actual gas used | `300,437` |
| EntryPoint success | `true` |
| Receiver event | `TestExecuted` confirmed |
| Receiver value | `0` |
| Receiver data | `alpha-prime-phase-3a` |

The browser validation also confirmed rejection of the same authorization after
modifying:

- target;
- calldata;
- value;
- nonce.

It additionally confirmed:

- consumed-nonce replay rejection;
- direct EOA execution rejection.

These negative checks were performed before or after the valid operation as
appropriate and were reported as PASS by the live browser console.

## Evolution validation

Upgrade request:

| Item | Verified value |
| --- | --- |
| Request ID | `0x268967f8d9d4d053260a5e4019f95f6d4122a836206125f62c3275b1e1db0613` |
| Requested implementation | `0x0ed2097B83F91D25005c0892b6Ee32d4bBD43dE3` |
| Requested codehash | `0x431059886e19cf26e6d6799d1a49282e7d77195ade2da88c7d8832b4d25ae77c` |
| Requested version | `2` |
| Request UserOperation hash | `0x6808fd8f676b9834099b1626c42ac541a560e5d153b3bfd2456706bd0ffd75c3` |
| Request transaction | `0xa79fc5255a723d57590c8e83aef8fa949ece1d2d66e41626538734e70700a50e` |
| Request block | `127974749` |
| Request transaction gas used | `301,686` |
| Executable at | `1788207888` |

The request required both the Transaction and Evolution Passkeys. The live
browser validation confirmed that finalization before the immutable delay was
rejected and an outsider could not cancel the request.

Authorized cancellation:

| Item | Verified value |
| --- | --- |
| Cancellation UserOperation hash | `0x7ae764d3fd783d9541aa75ef40e200b5c25a457fd0cf7aa0f7c37e3969ca3f0f` |
| Cancellation transaction | `0xc2db205ad1209ad85fff8bfb1ba0e14c3451a9f8b5ccb5baf07e20e9a038e161` |
| Cancellation block | `127974791` |
| Cancellation transaction gas used | `165,492` |
| `UpgradeCancelled` event | confirmed |

Post-cancellation state:

- pending implementation: zero address;
- pending request ID: zero;
- current implementation remains version 1 at
  `0x4e68BE79A7ec63De4FB9abD84Addbc87AecC8AC5`;
- current standard version remains `1`;
- the canceled request cannot be finalized.

No timelock reduction or bypass was used.

## Automated security validation

Final local validation:

```text
36 passing
0 failing
```

Coverage includes:

- deterministic identity and atomic role initialization;
- front-running and initialization tampering rejection;
- valid WebAuthn UserOperation execution;
- wrong-key, target, calldata, value, nonce, and challenge tampering;
- replay rejection;
- EntryPoint-only execution;
- exact dual-signature Evolution authorization;
- codehash and monotonically increasing version checks;
- immutable 48-hour timelock;
- authorized and unauthorized cancellation boundaries;
- hostile bounded-implementation attempts against Kernel, Authority,
  Controller, EntryPoint, unknown selectors, and timelock boundaries.

Compile, TypeScript validation, production web build, diff checks, secret
scans, reference scans, and repository hygiene checks completed without a
blocking finding.

## Privilege and custody audit

The temporary deployer was used only to submit testnet transactions and pay
gas. Verified boundaries:

- the Factory, Authority, and EvolutionController expose no owner,
  administrator, role-admin, ownership-transfer, or proxy-upgrade authority;
- Factory deployment does not make the deployer a Kernel signer;
- account execution requires canonical EntryPoint routing and a valid
  Transaction Passkey assertion;
- direct deployer/EOA execution is rejected;
- Evolution requires account-bound signed authorization;
- the bounded implementation cannot mutate Authority or Controller state;
- the deployer holds no permanent Phase 3A account authority.

## Findings

| Severity | Count | Status |
| --- | ---: | --- |
| Critical | 0 | none found |
| High | 0 | none found |
| Medium | 1 | documented limitation |

### Medium — RP-ID and origin deployment limitation

WebAuthn credentials and the account's RP-ID hash are bound to the hostname used
during registration. Moving the browser flow to another hostname requires new
credentials and a new account initialization for that RP-ID. The application
must not represent credentials created for one origin as portable to another.

This is a known WebAuthn deployment constraint, not an authorization bypass.

## Evidence sources

- on-chain runtime code and contract calls on BSC Testnet;
- transaction receipts and emitted events;
- the automated 36-test suite;
- the live browser console;
- user-provided browser completion screenshot, showing:
  - all six actions complete;
  - two proof groups complete;
  - verified readout status PASS;
  - operation PASS;
  - Evolution PASS.

No private Passkey data, private keys, secrets, or private operational metadata
are included in this report.

## Final recommendation

**READY / PASS for the authorized Phase 3A BSC Testnet scope.**

The deployed Phase 3A foundation and the real browser account flow meet the
reviewed testnet authorization model. The Phase 2 Factory was not reused as the
Phase 3A Factory. The live account is bound to the new Phase 3A Authority,
EvolutionController, Kernel Factory, and canonical EntryPoint.

This recommendation does not authorize:

- Mainnet deployment;
- production-fund custody;
- Phase 3B Recovery;
- weakening or bypassing the 48-hour Evolution delay;
- extending Factory, deployer, backend, bounded implementation, or operator
  authority.