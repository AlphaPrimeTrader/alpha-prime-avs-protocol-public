# Phase 4D — Atomic Legacy Migration

## Status

**BSC TESTNET DEPLOYED, VERIFIED, AND EXECUTED — EXPERIMENTAL**

Phase 4D introduces an owner-executed bridge for moving a legacy user's complete
live balance into the existing AVS capital path. The bridge and its Testnet-only
legacy-system mocks were deployed to BSC Testnet and used for one approved
12,000 TestUSDT migration. This is not a Mainnet deployment or a production
funds authorization.

## BSC Testnet deployment and execution evidence

All four Phase 4D contracts were deployed once by the explicit Testnet owner
`0x25cb6e07fe7bdc61E3157c5bc207644769e2b0c9`. Their creation transactions,
runtime hashes, and verification records are stored in
`deployments/bsc-testnet/phase4d-migration.json`.

| Contract          | Address                                      | Deployment block | BscScan                                                                                       | Sourcify                                                                               |
| ----------------- | -------------------------------------------- | ---------------: | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OldLedgerMock     | `0x0b921A0FFDE451e4c589F2B247a3D9323C78bf0F` |        128363096 | [source](https://testnet.bscscan.com/address/0x0b921A0FFDE451e4c589F2B247a3D9323C78bf0F#code) | [exact match](https://repo.sourcify.dev/97/0x0b921A0FFDE451e4c589F2B247a3D9323C78bf0F) |
| OldVaultMock      | `0xaC5392753c85925FD96331178a3657C3a0A43242` |        128363102 | [source](https://testnet.bscscan.com/address/0xaC5392753c85925FD96331178a3657C3a0A43242#code) | [exact match](https://repo.sourcify.dev/97/0xaC5392753c85925FD96331178a3657C3a0A43242) |
| AccountPolicyMock | `0xDa45bF8eB3277A6ed919A6ffE7DE69486ebF1AfC` |        128363112 | [source](https://testnet.bscscan.com/address/0xDa45bF8eB3277A6ed919A6ffE7DE69486ebF1AfC#code) | [exact match](https://repo.sourcify.dev/97/0xDa45bF8eB3277A6ed919A6ffE7DE69486ebF1AfC) |
| Migration         | `0xd78345844098B11d41F9608bAeA09abf17216A15` |        128363121 | [source](https://testnet.bscscan.com/address/0xd78345844098B11d41F9608bAeA09abf17216A15#code) | [exact match](https://repo.sourcify.dev/97/0xd78345844098B11d41F9608bAeA09abf17216A15) |

Each contract has Sourcify creation/runtime `exact_match` and public BscScan
source verification using Solidity Standard JSON Input. The four BscScan
verification IDs and Sourcify match IDs are recorded in the deployment record.

The approved Testnet execution used:

- old user: `0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba`;
- beneficiary: `0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27`;
- deposit: `10,000 TestUSDT`;
- accumulated profit: `2,000 TestUSDT`;
- historical profit excluded: `999,000 TestUSDT`; and
- migrated amount and AVS shares: exactly `12,000`.

The read-only preflight passed before any financial/configuration transaction.
The migration transaction was
[`0xd728a77c4048cf3bd9a0c20f3609dfd48cbce1450ffb371964a9fb75eda4048c`](https://testnet.bscscan.com/tx/0xd728a77c4048cf3bd9a0c20f3609dfd48cbce1450ffb371964a9fb75eda4048c)
in block `128366014`. Its deterministic capital ID was
`0x760b224b7af471668b7160ef3fbdff18aa1ee0c385c395b68bc2f5e78d1063b6`.

| Final invariant              |            Result |
| ---------------------------- | ----------------: |
| Old user live balance        |               `0` |
| Old Vault TestUSDT           |               `0` |
| Migration TestUSDT           |               `0` |
| AVS Vault TestUSDT           |          `12,000` |
| AVS Ledger NAV               |          `12,000` |
| AVS Token total supply       |          `12,000` |
| Beneficiary AVS balance      |          `12,000` |
| Migration-to-Vault allowance |               `0` |
| Capital record processed     |            `true` |
| Duplicate simulation         | `AlreadyMigrated` |

Migration remains open and all configuration locks remain unset. No Mainnet
contract or Mainnet funds were touched.

## Atomic flow

For `migrate(oldUser, beneficiary)`, the bridge:

1. requires the configured owner and an open migration window;
2. rejects a previously migrated old user;
3. requires the beneficiary to be permanently authorized by the AVS Token;
4. reads `oldLedger.getUserInfo(oldUser).totalBalance`;
5. quotes AVS shares and checks remaining `MAX_SUPPLY` before withdrawing;
6. rejects an already processed domain-separated capital identifier;
7. asks the legacy Vault to debit the user and transfer the full USDT balance;
8. verifies the Migration contract received exactly that amount;
9. grants the AVS Vault an exact temporary USDT allowance;
10. calls `AVSVault.receiveMigrationCapital(...)`;
11. verifies the returned shares equal the pre-withdrawal quote and clears the
    allowance; and
12. marks the old user migrated only after every downstream operation succeeds.

Any failure reverts the legacy Ledger debit, legacy Vault transfer, AVS Ledger
record, AVS Token mint, allowance, and migration marker in the same
transaction.

## Constructor wiring validation

Because every protocol dependency is immutable, construction validates both
deployed bytecode and every relationship exposed by the current public getters:

- `OldVault.USDT()` equals the configured USDT;
- `OldVault.ledger()` equals the configured legacy Ledger;
- `OldLedger.vault()` equals the configured legacy Vault;
- `AVSVault.USDT()` equals the configured USDT;
- `AVSVault.avsLedger()` equals the configured AVS Ledger;
- `AVSVault.avsToken()` equals the configured AVS Token;
- `AVSLedger.vault()` equals the configured AVS Vault;
- `AVSLedger.avsToken()` equals the configured AVS Token; and
- `AVSToken.vault()` equals the configured AVS Vault.

A mismatch reverts with `WiringMismatch(relationship, expected, actual)`.
Every target relationship is available through an existing getter; no
production contract was changed to expose additional wiring.

Two relationships are deliberately excluded from construction:

- `AVSVault.migration() == Migration`, because the Migration address exists
  only after deployment; and
- legacy Vault executor authorization for Migration, because it is also
  configured after deployment.

Both are mandatory post-deployment preflight checks.

## Deterministic identifier

Each old user has one capital identifier:

```text
keccak256(abi.encode(keccak256("AVS_MIGRATION_V1"), oldUser))
```

The beneficiary may receive multiple migrations, but each legacy user can be
migrated only once.

## Legacy test boundary

`OldLedgerMock` and `OldVaultMock` are testing-only stand-ins. They model only:

- seeded deposit and accumulated-profit state;
- live daily-profit calculation;
- Vault-only balance debit;
- executor-gated withdrawal; and
- actual ERC-20 transfer from the legacy Vault.

They are not deployment candidates and do not reproduce an entire legacy
protocol.

## Permanent close

The owner may call `closeMigration()` once. Closure is irreversible and blocks
all later migrations. The Migration contract exposes no token rescue, sweep,
arbitrary call, or owner-controlled funds-out function.

## Local proof

The primary test vector uses:

- old user: `0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba`;
- beneficiary: `0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27`;
- deposit: `10,000 TestUSDT`;
- accumulated profit: `2,000 TestUSDT`;
- historical total profit: `999,000 TestUSDT`, deliberately excluded from the
  current balance; and
- daily APY: zero.

The resulting migration amount is exactly `12,000 TestUSDT`.

Tests also cover owner authorization, whitelist checks, zero balances,
remaining AVS supply, deterministic-ID collisions, duplicate users, beneficiary
reuse, fee-on-transfer mismatch, downstream atomic rollback, reentrancy, live
profit calculation, allowance cleanup, permanent closure, and rejection of all
nine constructor wiring mismatches.

## Documented Testnet deployment order

The following sequence was executed on BSC Testnet after all four contracts had
public BscScan source verification and Sourcify Exact Match:

1. Deploy the Testnet-only `OldLedgerMock`.
2. Deploy the Testnet-only `OldVaultMock` using the existing TestUSDT and the
   new legacy Ledger.
3. Deploy the minimal Testnet-only Account Policy mock against the canonical
   AVS Token.
4. Configure `OldLedgerMock.vault` to the new legacy Vault.
5. Deploy Migration against the validated legacy mocks and current AVS Testnet
   contracts.
6. Verify all four deployed sources independently with Sourcify Exact Match and
   publicly with BscScan Standard JSON Input.
7. Set legacy daily APY to zero and seed the old test user
   `0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba` with a 10,000 TestUSDT deposit,
   2,000 TestUSDT accumulated profit, zero daily APY, and an expected 12,000
   TestUSDT live balance.
8. Fund `OldVaultMock` with exactly 12,000 existing TestUSDT.
9. Configure `AVSToken.accountPolicy` to that temporary policy without locking
   the Account Policy configuration.
10. Authorize beneficiary
    `0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27`.
11. Add Migration as an executor in `OldVaultMock`.
12. Configure `AVSVault.migration` to Migration.
13. Verify the integrated Vault's fixed capital allocator is active. Migration
    must pass the full amount to the Vault and must not split it itself.
14. Run the complete read-only preflight.
15. Execute `migrate(oldUser, beneficiary)` only after separate approval of the
    preflight result.

The integrated Vault allocates every capital inflow canonically: 5% becomes
pending Marketplace liquidity and 95% becomes productive Trading capital. For
the 12,000 TestUSDT migration this is exactly 600 / 11,400 TestUSDT. If Trading
is not configured, the 11,400 remains explicitly tracked in the Vault and is
never transferred to `address(0)`.

The read-only preflight must verify all constructor relationships again, the
post-deployment Migration and executor bindings, owner and network identities,
the exact seeded live balance and Vault funding, beneficiary authorization,
current AVS supply and quote, unused capital ID, fixed allocator state, zero Migration
USDT balance, and zero Migration-to-Vault allowance.

## Deliberate scope boundary

Phase 4D does not:

- interact with BSC Mainnet or Mainnet USDT;
- implement Marketplace, Trade Settlement, or Trading;
- lock AVSToken, AVSVault, or Account Policy;
- renounce ownership or close Migration; or
- authorize production use or custody production funds.
