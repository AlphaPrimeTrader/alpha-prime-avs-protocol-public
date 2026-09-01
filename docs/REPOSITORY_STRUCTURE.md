# Public Repository Structure

This repository is the canonical public source for the experimental AVS Smart
Account testnet baseline. Its contents are limited to protocol code, reference
application code, tests, documentation, and reproducible tooling.

## Included

| Path                             | Purpose                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `contracts/`                     | AVS Smart Account, Phase 3A security-kernel, Factory, test receiver, and test-token contracts.                              |
| `contracts/accounts/interfaces/` | Public Phase 3A and experimental Phase 3B Authority, Kernel, and EvolutionController interfaces.                            |
| `contracts/ledger/`              | Global economic Ledger, including economic-supply and treasury-inventory accounting.                                        |
| `contracts/token/`               | Phase 4B restricted AVS share token, deployed unconfigured on BSC Testnet.                                                  |
| `contracts/vault/`               | Canonical 5/95 capital allocator, Marketplace-liquidity reserve, and deterministic USDT router.                             |
| `contracts/marketplace/`         | Local NAV-priced Marketplace with escrow, FIFO matching, primary issuance, and revolving protocol inventory.                |
| `contracts/migration/`           | Local-only Phase 4D atomic legacy migration bridge and dependency interfaces.                                               |
| `test/`                          | Historical regressions plus Ledger, Token, Vault, Migration, Marketplace, and full protocol integration tests.              |
| `test/phase3a/`                  | Phase 3A authorization, evolution, boundary, and hostile-implementation tests.                                              |
| `test/phase3b/`                  | Atomic Transaction/Recovery root rotation and authority-boundary tests.                                                     |
| `test/ledger/`                   | Phase 4A economic accounting, authorization, precision, and boundary tests.                                                 |
| `test/token/`                    | Phase 4B restricted-token authority, supply, and ERC-20 boundary tests.                                                     |
| `test/vault/`                    | Phase 4C custody, routing, accounting, minting, and rollback tests.                                                         |
| `test/migration/`                | Phase 4D full-balance migration, authorization, supply, receipt, replay, reentrancy, and atomic rollback tests.             |
| `apps/passkey-demo/`             | The only canonical browser application for the Phase 3A Passkey and Phase 3B atomic recovery flows.                         |
| `scripts/src/`                   | Reproducible Phase 2, Phase 3B, Phase 4A, and Phase 4B deployment and verification scripts, plus local Phase 4B validation. |
| `docs/architecture/`             | Phase 3A/3B account-security, Phase 4A Ledger, and Phase 4B Token architecture.                                             |
| `docs/`                          | Phase history, deployment record, repository structure, and release notes.                                                  |
| Root configuration               | Hardhat, TypeScript, pnpm workspace, and package-locking configuration required to build and test the public source.        |

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

## Phase 4A / Phase 4C Ledger

`contracts/ledger/AVSLedger.sol` is the deployed BSC Testnet global accounting
foundation. It tracks protocol-wide capital, protocol revenue, realized
profit/loss, buyback reserve state, and local-revision treasury AVS. Protocol revenue is a distinct
Vault-only, replay-protected NAV increase that cannot mint AVS or use the
trading buyback allocation. The Ledger does not implement user balances, AVS
Token behavior, custody, minting, withdrawals, trade verification, or arbitrary
economic setters.

The architecture and fixed-point model are documented in
`docs/architecture/avs-ledger.md`. The canonical address and exact-match source
verification are recorded in `deployments/bsc-testnet/avs-ledger.json` and
`docs/deployments/bsc-testnet-phase-4c.md`. The original Phase 4A address is
preserved as superseded historical evidence.

## Phase 4C AVS Vault

`contracts/vault/AVSVault.sol` is the treasury and deterministic USDT router.
The local integration revision allocates every capital receipt as 5% Marketplace
liquidity and 95% productive capital. Its Marketplace revenue path records
protocol revenue atomically and retains 100% of that revenue as additional
Marketplace liquidity. Trading returns remain productive capital. The Vault has
been deployed as a partially configured BSC Testnet candidate using the verified
Testnet-only `TestUSDT` dependency. Its AVS Token and AVS Ledger bindings are
active; Migration, Marketplace, and Trading remain zero, configuration is
unlocked, its reserve target is zero, and it holds no funds.

`contracts/testnet/TestUSDT.sol` is a plain 18-decimal ERC-20 test asset with
explicit owner-only minting. It is deployed with zero supply solely for Testnet
integration and is not production USDT.

## Phase 4B AVS Token

`contracts/token/AVSToken.sol` is a restricted-transfer share-token foundation.
It uses mapping-based permanent authorization, separated Owner, Account Policy,
and Vault authority, and a hard `20,000,000 AVS` cap. Its architecture is
documented in `docs/architecture/avs-token.md`. The canonical BSC Testnet
instance is source-verified, bound to the current Vault, still has no Account
Policy, remains unlocked, and is unminted.

## Phase 4D Migration

`contracts/migration/Migration.sol` is an owner-executed bridge for a legacy
user's full live balance. It checks beneficiary authorization, remaining AVS
supply, deterministic capital-ID uniqueness, actual USDT receipt, and exact AVS
shares before committing the one-time migrated marker. Its legacy Ledger and
Vault mocks are Testnet-only rehearsal components and are not production
deployment candidates.

The flow and Testnet evidence are documented in
`docs/phases/phase-04d-migration.md`. The BSC Testnet Migration and temporary
Account Policy are configured for the completed rehearsal; the Migration
address is not a Mainnet or production authorization, and no Mainnet funds
moved.

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
2. Run the complete historical suite through local Phase 4D tests.
3. Run the Marketplace and full cross-contract integration suites.
4. Typecheck the standalone demo and deployment scripts.
5. Build the standalone Passkey demo.
6. Inspect the documented BSC Testnet deployment and verification scripts.

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
- Phase 4A adds an unaudited, source-verified BSC Testnet global Ledger and
  does not alter the deployed Phase 3B account checkpoint.
- Phase 4B adds an unaudited restricted AVS Token foundation and its
  unconfigured BSC Testnet deployment; it does not alter the deployed Phase 4A
  Ledger.
- Phase 4C adds the BSC Testnet Vault candidate and reviewed core bindings.
- Phase 4D adds the Testnet-only migration rehearsal, including one verified
  12,000 TestUSDT migration into 12,000 AVS shares.
- Phase 4E adds a local-only integrated Marketplace, canonical Vault allocation,
  and treasury/economic-supply accounting; it is not deployed.
- Issuer, Paymaster, Pools, Mainnet, and production
  custody remain outside this checkpoint.
