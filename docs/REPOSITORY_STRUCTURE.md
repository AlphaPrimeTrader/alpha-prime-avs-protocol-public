# Public Repository Structure

This repository is the canonical public source for the experimental AVS Smart
Account testnet baseline. Its contents are limited to protocol code, reference
application code, tests, documentation, and reproducible tooling.

## Included

| Path | Purpose |
| --- | --- |
| `contracts/` | AVS Smart Account, Phase 3A security-kernel, Factory, test receiver, and test-token contracts. |
| `contracts/accounts/interfaces/` | Public Phase 3A and experimental Phase 3B Authority, Kernel, and EvolutionController interfaces. |
| `test/` | Phase 1 foundation tests, Phase 2 Passkey/UserOperation tests, Phase 3A security-kernel tests, Phase 3B Recovery tests, and EntryPoint fixtures. |
| `test/phase3a/` | Phase 3A authorization, evolution, boundary, and hostile-implementation tests. |
| `test/phase3b/` | Atomic Transaction/Recovery root rotation and authority-boundary tests. |
| `apps/passkey-demo/` | The only canonical browser application for the Phase 3A Passkey and Phase 3B atomic recovery flows. |
| `scripts/src/` | Reproducible Phase 2 and Phase 3B deployment and post-deployment verification scripts. |
| `docs/architecture/` | Phase 3A security-kernel and Phase 3B recovery architecture and authority-boundary documentation. |
| `docs/` | Phase history, deployment record, repository structure, and release notes. |
| Root configuration | Hardhat, TypeScript, pnpm workspace, and package-locking configuration required to build and test the public source. |

## Canonical reference application

`apps/passkey-demo/` is the only published Passkey demo and the canonical
browser reference for Phases 3A and 3B. It is the lean, standalone version that
an independent developer can install, build, and run without workspace preview
infrastructure. Managed/generated artifact directories are not public source
and must not contain a second application implementation.

## Experimental account contracts

The public Phase 3A contract set is:

- `AVSAccountSecurityKernel.sol`;
- `AVSAccountAuthority.sol`;
- `AVSEvolutionController.sol`;
- `AVSAccountKernelFactory.sol`.

The Phase 3A additions are intentionally separate from the historical Phase 1
and Phase 2 contract records.

The Phase 3B additions are:

- `AVSAccountRecoverySecurityKernel.sol`;
- `AVSAccountRecoveryAuthority.sol`;
- `AVSAccountRecoveryKernelFactory.sol`.

They preserve the Phase 3A separation of Transaction and Evolution authority
while adding immediate atomic Transaction/Recovery root rotation. This is a
frozen experimental Testnet checkpoint, not a final product account model.

## Excluded workspace material

The following paths are intentionally not part of the public repository:

- `artifacts/api-server/` — generic API and health-check server unrelated to
  AVS Phase 1 or Phase 2.
- `artifacts/mockup-sandbox/` — generic component-preview and mockup server.
- `lib/` — generic API client, OpenAPI, and database support not used by the
  AVS protocol build or tests.
- `packages/` — empty ABI, address, and type placeholders.
- `sdk/` — empty SDK placeholder.
- `deployments/bsc-mainnet/` — empty placeholder; no Mainnet deployment exists.

These exclusions keep the public tree focused and prevent unrelated workspace
infrastructure from being mistaken for protocol functionality.

## Reproducibility boundary

An independent developer should be able to use the included root
configuration to:

1. Compile the contracts.
2. Run the complete Phase 1 and Phase 2 test suite.
3. Typecheck the standalone demo and deployment scripts.
4. Build the standalone Passkey demo.
5. Inspect the documented BSC Testnet deployment and verification scripts.

Generated output, dependency directories, local environment files, credentials,
private keys, uploads, screenshots, and other local development state are not
public source files.

## Phase boundary

- Phase 1 is the completed Smart Account Foundation.
- Phase 2 is the completed Passkey + ERC-4337 Testnet baseline.
- Phase 3A and Phase 3B remain experimental, BSC Testnet only, unaudited, and
  not for production funds.
- Phase 3B Recovery preserves the same account address and atomically rotates
  Transaction and Recovery roots without backend authority.
- Paymaster, Pools, Marketplace, NAV, Mainnet, and production custody remain
  outside this checkpoint.