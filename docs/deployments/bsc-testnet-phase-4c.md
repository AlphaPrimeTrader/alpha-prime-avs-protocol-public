# BSC Testnet Phase 4C — Ledger, TestUSDT, and Vault

## Status

**CORE BINDING COMPLETE — PARTIAL TESTNET CONFIGURATION**

The revised `AVSLedger`, Testnet-only `TestUSDT`, and corrected `AVSVault` are
deployed and source-verified. TestUSDT was minted to the approved owner wallet,
then only the reviewed core bindings were executed. The protocol is not fully
configured or decentralized.

## Revised Ledger deployment

| Item                    | Verified value                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| Network                 | BNB Smart Chain Testnet                                              |
| Chain ID                | `97`                                                                 |
| AVSLedger               | `0x643c16B56f528503FB0f4e3e95E48eBf1D73982e`                         |
| Deployment transaction  | `0x5ce7d9d3e9cf7a3342af97ef6b7d35fc1b22524091d1f894f826064b82d15931` |
| Deployment block        | `128319492`                                                          |
| Deployment time         | `2026-08-31T15:31:12Z`                                               |
| Deployer                | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Explicit `initialOwner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Runtime bytecode hash   | `0x7710e4e11c916a5e7e9510f480e7aa292c02bfcbb99b16d8bdfe39af6ae3d7e6` |
| Gas used                | `1,484,144`                                                          |

Constructor arguments:

```text
["0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9"]
```

## Superseded Ledger

The Phase 4A Ledger at
`0x9eAACE24c68C29D7Bd6cef6A660270bB3566Fa04` is **SUPERSEDED**, not deleted.
The reason is the addition of the narrowly scoped protocol-revenue accounting
path before Vault integration. Its historical transaction and verification
record remain in [`bsc-testnet-phase-4a.md`](bsc-testnet-phase-4a.md).

## Compiler and source verification

| Item                     | Verified value                             |
| ------------------------ | ------------------------------------------ |
| Solidity                 | `0.8.28+commit.7893614a`                   |
| Optimizer                | enabled, `200` runs                        |
| EVM version              | `cancun`                                   |
| Sourcify creation match  | exact match                                |
| Sourcify runtime match   | exact match                                |
| Sourcify verification ID | `80f2bfa4-b04b-4963-8a95-9737f0e75643`     |
| Sourcify match ID        | `46949927`                                 |
| BscScan                  | Source Code Verified — Standard JSON Input |
| Verification time        | `2026-08-31T15:32:12Z`                     |

- BscScan:
  <https://testnet.bscscan.com/address/0x643c16B56f528503FB0f4e3e95E48eBf1D73982e#code>
- Sourcify:
  <https://repo.sourcify.dev/97/0x643c16B56f528503FB0f4e3e95E48eBf1D73982e>

## Initial Ledger state

| State                   | Value                                        |
| ----------------------- | -------------------------------------------- |
| `owner`                 | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| `avsToken`              | `address(0)`                                 |
| `vault`                 | `address(0)`                                 |
| `tradeSettlement`       | `address(0)`                                 |
| `totalNetAssets`        | `0`                                          |
| `totalGrossProfit`      | `0`                                          |
| `totalLoss`             | `0`                                          |
| `totalBuybackAllocated` | `0`                                          |
| `buybackReserve`        | `0`                                          |
| `settlementCount`       | `0`                                          |
| `currentAVSValue()`     | `1e18`                                       |

Unauthorized static calls to capital, protocol-revenue, and trading-settlement
writers all reverted after deployment.

## Testnet core binding

The following one-time bindings were executed in order using the approved
Testnet owner wallet:

| Operation                  | Argument                                     | Transaction                                                                                                                                                               | Block       | Status |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| `AVSLedger.bindAVSToken`   | `0x2861F3d12082710118391f06F818CA3412ffFE87` | [`0x05cbcacfe234df338c3a2ee63b7cae6f25b6a8a6e1abe3166c84dad90db0e419`](https://testnet.bscscan.com/tx/0x05cbcacfe234df338c3a2ee63b7cae6f25b6a8a6e1abe3166c84dad90db0e419) | `128325782` | `1`    |
| `AVSLedger.configureVault` | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85` | [`0xac88fd14ba6f15d8d9e47327caa978b3b8bdf55dfc2ab4b2f10aa6a12839b6f4`](https://testnet.bscscan.com/tx/0xac88fd14ba6f15d8d9e47327caa978b3b8bdf55dfc2ab4b2f10aa6a12839b6f4) | `128325796` | `1`    |
| `AVSToken.setVault`        | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85` | [`0xa32ac003d98d198a41d97e7ae8d9eec62dbcdc28f885b2558ac8006291d0fd63`](https://testnet.bscscan.com/tx/0xa32ac003d98d198a41d97e7ae8d9eec62dbcdc28f885b2558ac8006291d0fd63) | `128325816` | `1`    |
| `AVSVault.setAVSToken`     | `0x2861F3d12082710118391f06F818CA3412ffFE87` | [`0x0f01005da668a7e425d420ecbc62d4bbe0eeeda83a83fedc2f5e766f0787a270`](https://testnet.bscscan.com/tx/0x0f01005da668a7e425d420ecbc62d4bbe0eeeda83a83fedc2f5e766f0787a270) | `128325823` | `1`    |
| `AVSVault.setAVSLedger`    | `0x643c16B56f528503FB0f4e3e95E48eBf1D73982e` | [`0x065133de9a2447bebcd926be9dd8c0dcd3d5c1689b909422c6bfc6dc22251ffe`](https://testnet.bscscan.com/tx/0x065133de9a2447bebcd926be9dd8c0dcd3d5c1689b909422c6bfc6dc22251ffe) | `128325837` | `1`    |

All five transactions used the legacy BSC-compatible gas-price path. No
`tradeSettlement`, `accountPolicy`, Migration, Marketplace, or Trading address
was configured.

## TestUSDT mint

The approved owner minted `1,000,000 TestUSDT` directly to the owner wallet.
No TestUSDT was transferred to the Vault.

| Item                         | Verified value                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mint transaction             | [`0x29d8570aa3a9ba2b927d9587b24ed9f09f2d564f64993f8fc281e571b9e429e6`](https://testnet.bscscan.com/tx/0x29d8570aa3a9ba2b927d9587b24ed9f09f2d564f64993f8fc281e571b9e429e6) |
| Block                        | `128325554`                                                                                                                                                               |
| Timestamp                    | `2026-08-31T16:16:41Z`                                                                                                                                                    |
| Recipient                    | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                                                                                                                              |
| Amount                       | `1,000,000 TestUSDT`                                                                                                                                                      |
| Raw amount                   | `1000000000000000000000000`                                                                                                                                               |
| Total supply after mint      | `1,000,000 TestUSDT`                                                                                                                                                      |
| Recipient balance after mint | `1,000,000 TestUSDT`                                                                                                                                                      |
| Vault balance after mint     | `0`                                                                                                                                                                       |

## TestUSDT deployment

**TESTNET TEST ASSET — NOT PRODUCTION USDT**

| Item                    | Verified value                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| TestUSDT                | `0x398bc6c1201690ec7cDF632aDc82B805240c3F9a`                         |
| Deployment transaction  | `0x0509493fbbf771282a3c4675dc34b85be02310b79f347584fe7232d9c2c723a3` |
| Deployment block        | `128323619`                                                          |
| Deployment time         | `2026-08-31T16:02:10Z`                                               |
| Explicit `initialOwner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Runtime bytecode hash   | `0xfc7ad35d21774bca95105ff1bb8df7aae2dc547ae91b69bd80be02d33d8ee4be` |
| Gas used                | `562,876`                                                            |

Constructor arguments:

```text
["0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9"]
```

Initial state: name `Test USDT`, symbol `USDT`, decimals `18`, total supply `0`,
owner equal to the explicit Testnet owner, and deployer token balance `0`.

- BscScan exact match:
  <https://testnet.bscscan.com/address/0x398bc6c1201690ec7cDF632aDc82B805240c3F9a#code>
- Sourcify exact match:
  <https://repo.sourcify.dev/97/0x398bc6c1201690ec7cDF632aDc82B805240c3F9a>

## AVSVault deployment

| Item                    | Verified value                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| AVSVault                | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85`                         |
| Deployment transaction  | `0xa9fbc45c1264caceb3bf39b407109f1648ce720aea33d0c735d4020a5d8474c2` |
| Deployment block        | `128324068`                                                          |
| Deployment time         | `2026-08-31T16:05:32Z`                                               |
| Explicit `initialOwner` | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`                         |
| Immutable `USDT`        | `0x398bc6c1201690ec7cDF632aDc82B805240c3F9a`                         |
| Runtime bytecode hash   | `0xab870f7b413209ab639c88a106e855655abcb8a6b18a585d1a62b7163d900360` |
| Gas used                | `1,455,807`                                                          |

Constructor arguments:

```text
[
  "0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9",
  "0x398bc6c1201690ec7cDF632aDc82B805240c3F9a"
]
```

Sourcify verification completed at `2026-08-31T16:06:08Z` with exact creation
and runtime matches under verification ID
`80f37b1a-f7fa-4c69-9c12-1fd5bfba3527` and match ID `46950833`.

- BscScan:
  <https://testnet.bscscan.com/address/0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85#code>
- Sourcify:
  <https://repo.sourcify.dev/97/0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85>

## Current post-binding state

### AVSLedger

| State               | Value                                        |
| ------------------- | -------------------------------------------- |
| `avsToken`          | `0x2861F3d12082710118391f06F818CA3412ffFE87` |
| `vault`             | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85` |
| `tradeSettlement`   | `address(0)`                                 |
| `totalNetAssets`    | `0`                                          |
| AVS total supply    | `0`                                          |
| `currentAVSValue()` | `1e18`                                       |

### AVSToken

| State                 | Value                                        |
| --------------------- | -------------------------------------------- |
| `vault`               | `0x02fc1Ca3d9647850982f60b1a61C62dC2E078B85` |
| `accountPolicy`       | `address(0)`                                 |
| `vaultLocked`         | `false`                                      |
| `accountPolicyLocked` | `false`                                      |
| `totalSupply`         | `0`                                          |

### AVSVault

| State                        | Value                                        |
| ---------------------------- | -------------------------------------------- |
| `owner`                      | `0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9` |
| `USDT`                       | `0x398bc6c1201690ec7cDF632aDc82B805240c3F9a` |
| `avsToken`                   | `0x2861F3d12082710118391f06F818CA3412ffFE87` |
| `avsLedger`                  | `0x643c16B56f528503FB0f4e3e95E48eBf1D73982e` |
| `migration`                  | `address(0)`                                 |
| `marketplace`                | `address(0)`                                 |
| `tradingContract`            | `address(0)`                                 |
| `configurationLocked`        | `false`                                      |
| `reserveTarget`              | `0`                                          |
| `availableMarketLiquidity()` | `0`                                          |
| TestUSDT balance             | `0`                                          |

## Pending configuration and prohibited actions

The following remain pending and were not configured:

- `tradeSettlement`;
- `accountPolicy`;
- `migration`;
- `marketplace`;
- `tradingContract`.

The deployments and binding transactions did not call:

- `AVSLedger.configureTradeSettlement`;
- `AVSVault.lockConfiguration`;
- any `AVSToken` account-policy configuration or lock;
- any AVS mint;
- any TestUSDT transfer to the Vault;
- any financial test or protocol-fund transfer;
- `renounceOwnership`.

The Phase 4B AVS Token remains unchanged at
`0x2861F3d12082710118391f06F818CA3412ffFE87`.

## Validation

- focused Ledger tests: `28 passing`;
- focused Vault tests: `17 passing`;
- focused TestUSDT tests: `4 passing`;
- complete Hardhat suite: `105 passing`;
- Solidity compile: pass;
- TypeScript typecheck: pass;
- TypeScript formatting checks: pass;
- `git diff --check`: pass.
- dependency audit: `0 critical`, `0 high`, `1 moderate`, `2 low`;
- SAST scan: no findings;
- privacy/security dataflow scan: no findings.
