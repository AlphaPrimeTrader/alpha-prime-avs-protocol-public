# Phase 4D — Atomic Legacy Migration

## Status

**LOCAL VALIDATION ONLY — NOT DEPLOYED**

Phase 4D introduces an owner-executed bridge for moving a legacy user's complete
live balance into the existing AVS capital path. The implementation and its
legacy-system mocks exist only for local compilation and testing. No Migration
address has been configured on BSC Testnet.

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
- `OldVault.oldLedger()` equals the configured legacy Ledger;
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

The following sequence is documentation only and has not been executed:

1. Deploy the Testnet-only `OldLedgerMock`.
2. Deploy the Testnet-only `OldVaultMock` using the existing TestUSDT and the
   new legacy Ledger.
3. Configure `OldLedgerMock.vault` to the new legacy Vault.
4. Seed the old test user
   `0x3FE6f0b8777a7BaAF945ea8FEE6a657f3bd632Ba` with a 10,000 TestUSDT deposit,
   2,000 TestUSDT accumulated profit, zero daily APY, and an expected 12,000
   TestUSDT live balance.
5. Fund `OldVaultMock` with exactly 12,000 existing TestUSDT.
6. Deploy a minimal Testnet-only Account Policy mock.
7. Configure `AVSToken.accountPolicy` to that temporary policy without locking
   the Account Policy configuration.
8. Authorize beneficiary
   `0x46785c0bcb28c29e0CfBeF23101C98CA8356FC27`.
9. Deploy Migration against the validated legacy mocks and current AVS Testnet
   contracts.
10. Add Migration as an executor in `OldVaultMock`.
11. Configure `AVSVault.migration` to Migration.
12. Set `AVSVault.reserveTarget` to at least 12,000 TestUSDT before migration.
13. Run the complete read-only preflight.
14. Execute `migrate(oldUser, beneficiary)` only after separate approval of the
    preflight result.

The current `AVSVault._routeExcessToTrading()` retains funds when
`tradingContract` is zero and emits `ExcessRetainedBecauseTradingNotConfigured`;
it does not transfer to `address(0)`. Setting the reserve target to at least the
first 12,000 TestUSDT nevertheless makes the intended first-migration custody
path explicit and prevents excess routing if Trading becomes configured before
execution.

The read-only preflight must verify all constructor relationships again, the
post-deployment Migration and executor bindings, owner and network identities,
the exact seeded live balance and Vault funding, beneficiary authorization,
current AVS supply and quote, unused capital ID, reserve target, zero Migration
USDT balance, and zero Migration-to-Vault allowance.

## Deliberate stop point

Phase 4D does not:

- deploy Migration or either legacy mock;
- configure `AVSVault.migration`;
- configure `AVSToken.accountPolicy`;
- transfer TestUSDT on BSC Testnet;
- mint AVS on BSC Testnet;
- implement Marketplace or Trading; or
- authorize any Mainnet or production use.
