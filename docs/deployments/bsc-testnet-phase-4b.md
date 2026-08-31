# BSC Testnet Phase 4B — AVS Token

## Status

**DEPLOYED AND SOURCE-VERIFIED — UNCONFIGURED EXPERIMENTAL BSC TESTNET ONLY**

This record identifies the canonical Phase 4B `AVSToken` deployment. It is
unaudited, not Mainnet-ready, and must not be used for production funds.

## Network and deployment

| Item                    | Verified value                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| Network                 | BNB Smart Chain Testnet                                              |
| Chain ID                | `97`                                                                 |
| AVSToken                | `0x2861F3d12082710118391f06F818CA3412ffFE87`                         |
| Deployment transaction  | `0xc19783e25908227b72b03e41b17fcece2904c2e6e05209d8640a3de66720ef81` |
| Deployment block        | `128305083`                                                          |
| Deployment time         | `2026-08-31T13:43:08Z`                                               |
| Deployer                | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Explicit `initialOwner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Runtime bytecode hash   | `0x771489fbe6e26bfc5408070a97d11b9f01d8f20b6d64dc83b37f7715adc3b012` |

Ownership was passed explicitly to `constructor(address initialOwner)`. No
constructor mint or implicit owner derivation was used.

## Compiler and source verification

| Item                    | Verified value                     |
| ----------------------- | ---------------------------------- |
| Solidity                | `0.8.28+commit.7893614a`           |
| Optimizer               | enabled, `200` runs                |
| EVM version             | `cancun`                           |
| Sourcify creation match | exact match                        |
| Sourcify runtime match  | exact match                        |
| Sourcify match ID       | `46947812`                         |
| BscScan                 | Source Code Verified — Exact Match |
| Verification time       | `2026-08-31T13:44:41Z`             |

Verified explorer:

<https://testnet.bscscan.com/address/0x2861F3d12082710118391f06F818CA3412ffFE87#code>

BscScan exposes `AVSToken` as Solidity Standard JSON Input with compiler
`v0.8.28+commit.7893614a`, optimizer `200`, and Cancun EVM settings.

## Initial on-chain state

Direct reads after deployment returned:

| State                   | Value                                        |
| ----------------------- | -------------------------------------------- |
| `name()`                | `AVS`                                        |
| `symbol()`              | `AVS`                                        |
| `decimals()`            | `18`                                         |
| `MAX_SUPPLY()`          | `20,000,000 * 1e18`                          |
| `totalSupply()`         | `0`                                          |
| `owner()`               | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| `vault()`               | `address(0)`                                 |
| `accountPolicy()`       | `address(0)`                                 |
| `vaultLocked()`         | `false`                                      |
| `accountPolicyLocked()` | `false`                                      |

With zero total supply, no token balances exist. The deployment did not call
`setVault`, `setAccountPolicy`, `lockVault`, `lockAccountPolicy`,
`renounceOwnership`, `mint`, or any Ledger binding function.

## Final validation

- focused Phase 4B tests: `15 passing`;
- complete Hardhat suite: `81 passing`;
- Solidity compile: pass;
- local Phase 4B validator: pass;
- TypeScript checks: pass;
- `git diff --check`: pass;
- secret and repository-scope checks: pass;
- SAST findings: zero;
- privacy/dataflow findings: zero;
- dependency audit: zero Critical, zero High, one Moderate, and two Low
  development-toolchain advisories.

No Phase 4C contract, Vault, Account Policy, or mock was deployed. The Phase 4A
Ledger remains unchanged and unbound.
