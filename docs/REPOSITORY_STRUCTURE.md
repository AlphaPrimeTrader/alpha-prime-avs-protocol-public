# Public Repository Structure

This repository is the canonical public source for the experimental AVS Smart
Account testnet baseline. Its contents are limited to protocol code, reference
application code, tests, documentation, and reproducible tooling.

## Included

| Path | Purpose |
| --- | --- |
| `contracts/` | AVS Smart Account, Phase 3A security-kernel, Factory, test receiver, and test-token contracts. |
| `contracts/accounts/interfaces/` | Public Phase 3A Authority, bounded-logic, Kernel Factory, and EvolutionController interfaces. |
| `test/` | Phase 1 foundation tests, Phase 2 Passkey/UserOperation tests, Phase 3A security-kernel tests, and EntryPoint fixtures. |
| `test/phase3a/` | Phase 3A authorization, evolution, boundary, and hostile-implementation tests. |
| `apps/passkey-demo/` | Canonical standalone browser reference application for the Phase 3A Passkey flow. |
| `scripts/src/` | Reproducible Phase 2 deployment and post-deployment verification scripts. |
| `docs/architecture/` | Phase 3A security-kernel architecture and authority-boundary documentation. |
| `docs/` | Phase history, deployment record, repository structure, and release notes. |
| Root configuration | Hardhat, TypeScript, pnpm workspace, and package-locking configuration required to build and test the public source. |

## Canonical reference application

`apps/passkey-demo/` is the only published Passkey demo and the canonical
Phase 3A browser reference. It is the lean, standalone version that an
independent developer can install, build, and run without workspace preview
infrastructure.

The Phase 3A source was migrated from the managed development copy before the
public release was rebuilt. `artifacts/avs-passkey-demo/` must not become a
second public canonical implementation and is excluded from the public tree.

## Phase 3A canonical contracts

The public Phase 3A contract set is:

- `AVSAccountSecurityKernel.sol`;
- `AVSAccountAuthority.sol`;
- `AVSEvolutionController.sol`;
- `AVSAccountKernelFactory.sol`.

The Phase 3A additions are intentionally separate from the historical Phase 1
and Phase 2 contract records.

## Excluded workspace material

The following paths are intentionally not part of the public repository:

- `artifacts/api-server/` — generic API and health-check server unrelated to
  AVS Phase 1 or Phase 2.
- `artifacts/avs-passkey-demo/` — managed duplicate of the canonical Passkey
  demo, including preview UI and workspace-specific scaffolding.
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
- Phase 2 is the completed Passkey + ERC-4337 testnet baseline.
- Recovery, Paymaster, Pools, Marketplace, NAV, Mainnet, and production
  custody are outside this public baseline.
- Phase 3A is experimental, BSC Testnet only, unaudited, and not for
  production funds.