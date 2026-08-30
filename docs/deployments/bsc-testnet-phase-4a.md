# BSC Testnet Phase 4A — AVS Ledger

## Status

**DEPLOYED AND SOURCE-VERIFIED — EXPERIMENTAL BSC TESTNET ONLY**

This record identifies the canonical Phase 4A `AVSLedger` deployment for later
Testnet AVS Token, Vault, and Trade Settlement integration. It is unaudited,
not Mainnet-ready, and must not be used for production funds.

## Network and deployment

| Item | Verified value |
| --- | --- |
| Network | BNB Smart Chain Testnet |
| Chain ID | `97` |
| AVSLedger | `0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04` |
| Deployment transaction | `0x8e2323f3584a7f790ee3f41c730bd0e3fca04944caeb1eb1e3b2e5b11b2718b7` |
| Deployment block | `128172839` |
| Deployment time | `2026-08-30T21:11:18Z` |
| Deployer | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| Explicit `initialOwner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| Runtime bytecode hash | `0xe4ea7c783c5a5558d6b89a2392473df58419a1bb170e1e4f7ff2880119be6329` |

The Testnet deployer and `initialOwner` intentionally use the same approved
project test wallet. Ownership was still passed explicitly to
`constructor(address initialOwner)`; the contract does not derive ownership
from `msg.sender`.

## Compiler and source verification

| Item | Verified value |
| --- | --- |
| Solidity | `0.8.28+commit.7893614a` |
| Optimizer | enabled, `200` runs |
| EVM version | `cancun` |
| Sourcify creation match | exact match |
| Sourcify runtime match | exact match |
| BscScan | Source Code Verified — Exact Match |
| Verification time | `2026-08-30T21:13:02Z` |

Verified explorer:

<https://testnet.bscscan.com/address/0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04#code>

BscScan exposes the Standard JSON Input sources, `AVSLedger` contract name,
compiler settings, ABI, bytecode, and ABI-encoded constructor argument.

## Initial on-chain state

Direct reads after deployment returned:

| State | Value |
| --- | --- |
| `owner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| `avsToken` | `address(0)` |
| `vault` | `address(0)` |
| `tradeSettlement` | `address(0)` |
| `totalNetAssets` | `0` |
| `totalGrossProfit` | `0` |
| `totalLoss` | `0` |
| `totalBuybackAllocated` | `0` |
| `buybackReserve` | `0` |
| `settlementCount` | `0` |
| `currentAVSValue()` | `1e18` |

Direct economic-write calls from the deployer EOA reverted because it is
neither the configured Vault nor the configured Trade Settlement source.

No mock or future protocol contract was deployed or bound. The AVS Token,
Vault, and Trade Settlement addresses intentionally remain zero.
`renounceOwnership()` was not called because future Testnet protocol contracts
still need to be connected.

## Final validation

- complete Hardhat suite: `66 passing`;
- AVSLedger tests: `25 passing`;
- historical Phase 1–3 tests: `41 passing`;
- Solidity compile: pass;
- TypeScript checks: pass;
- `git diff --check`: pass;
- secret and repository-scope checks: pass;
- SAST findings: zero;
- privacy/dataflow findings: zero;
- dependency audit: zero Critical, zero High, one Moderate, and two Low
  development-toolchain advisories.

The dependency advisories do not affect the deployed Ledger bytecode and were
not changed as part of this scope-locked contract deployment.