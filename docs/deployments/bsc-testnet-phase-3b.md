# BSC Testnet Phase 3B — Frozen Checkpoint

## Status

**VERIFIED — EXPERIMENTAL BSC TESTNET CHECKPOINT**

This record documents the tested Phase 3B deployment and atomic Recovery model.
It is not a final product account architecture, is not audited, is not Mainnet
ready, and must not be used with production funds.

No Recovery Kit, password, private scalar, private Passkey material, signature,
or deployment secret is included here.

## Network and compiler

| Item | Value |
| --- | --- |
| Network | BSC Testnet |
| Chain ID | `97` |
| Canonical EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| EntryPoint runtime hash | `0x9bb19c12079ada979da5294aa219ee5a12a2ce797272b14344e38302a2835a98` |
| Solidity | `0.8.28` |
| Optimizer | enabled, `200` runs |

## Deployment record

| Component | Address | Deployment transaction |
| --- | --- | --- |
| Initial bounded implementation | `0x6aCA3dCA40A3d031163686547F42Fe6fb55E8797` | `0xc3d27e10a7f6f0f4a7ba939582ca1c91ea7fc7ba68e200ce39e50916548211a8` |
| TestReceiver | `0x99907924aBC19287E8f1e68b124bDFF31d06563e` | `0x0fff3c9c85a33600be877e3966b611eeff5a1f34751d3572ecfa4ed1775d788f` |
| AVSAccountRecoveryKernelFactory | `0xf3b30D7e6EB3639d056c66AABd10F904BA22487A` | `0x259ac3e6546c00a5f6ef03ecee7d7cbcfe1f8af64c44b2fb9219d3080f4d72c2` |
| AVSAccountRecoveryAuthority | `0x23026F82317b82283537466d4ba3A5A05F74bb11` | factory deployment transaction |
| AVSEvolutionController | `0x9d5d16C84D7E36a1436979fe164Af81D62B59A9e` | factory deployment transaction |

The Factory, Authority, EvolutionController, and EntryPoint bindings were
verified against deployed code. Runtime comparisons exclude non-executable
Solidity CBOR metadata, normalize only compiler-declared immutable slots, and
independently verify every immutable value.

## Recovery properties validated

- A valid Recovery authorization atomically rotates the Transaction and
  Recovery roots.
- The old Transaction credential and old Recovery Kit no longer match the
  current roots.
- The Smart Account address remains unchanged.
- Account assets and the EntryPoint, Authority, EvolutionController, and
  implementation bindings remain unchanged.
- Recovery has no pending state, delay, cancellation, or separate finalization.
- Recovery does not rotate or bypass Evolution authority.
- Recovery nonce and Transaction/Recovery key versions advance.
- The relay may pay Testnet gas but has no account authorization authority.

## Evolution interaction

Evolution retains its existing independent timelock. An upgrade request records
the Transaction key version that authorized it. If Recovery rotates the
Transaction root before finalization, the stale request cannot finalize.

This protects authorization but may require the current Transaction authority
to cancel the stale request before queuing another upgrade. It is a documented
availability limitation, not an authorization bypass.

## Validation scope

The frozen checkpoint passed:

- Solidity compilation;
- the complete Hardhat suite;
- Recovery/client tests;
- TypeScript checks for the app and scripts;
- production browser build;
- read-only BSC Testnet deployment verification;
- valid account operation and adversarial rejection checks;
- atomic Recovery rotation and post-rotation invariants;
- source, dependency, secret, SAST, privacy, and repository-structure review.

Historical Phase 1, Phase 2, and Phase 3A records are unchanged. No contract was
redeployed for this publication.