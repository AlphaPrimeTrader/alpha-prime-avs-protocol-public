# Phase 4B — AVS Token Foundation

## Objective

Implement and validate the restricted AVS protocol share token, then deploy and
source-verify exactly one unconfigured instance on BSC Testnet. Do not bind,
mint, configure protocol authorities, or start Phase 4C.

## Implemented

- `AVS` / `AVS` ERC-20 metadata with exactly 18 decimals;
- zero initial supply and hard `20,000,000 AVS` maximum supply;
- no burn, pause, freeze, blacklist, seizure, forced transfer, upgrade, or
  arbitrary admin control;
- constant-time mapping whitelist with permanent authorization;
- Account Policy-only authorization;
- Vault-only positive minting to whitelisted accounts;
- whitelist enforcement for `transfer`, `approve`, and `transferFrom`;
- explicit-owner configuration with separate Vault and Account Policy locks;
- irreversible ownership renunciation only after both configured locks;
- post-renunciation continuity for Vault minting, Account Policy authorization,
  balances, approvals, and authorized transfers.

## Authority model

The Owner only controls lifecycle configuration. Account Policy authorizes new
accounts and cannot mint. Vault mints and cannot authorize. Users can move
tokens only between whitelisted accounts. No authority may substitute for
another.

## BSC Testnet deployment boundary

The canonical Phase 4B Token is deployed and source-verified at:

```text
0x2861F3d12082710118391f06F818CA3412ffFE87
```

Its Vault and Account Policy remain zero, both locks remain false, ownership
has not been renounced, and total supply remains zero. It is not bound to the
Phase 4A Ledger. No Vault, Account Policy, mock, or Phase 4C contract was
deployed.

See
[`docs/deployments/bsc-testnet-phase-4b.md`](../deployments/bsc-testnet-phase-4b.md)
for the transaction, compiler settings, source-verification evidence, and
direct state reads.

## Validation target

The Phase 4B gate includes compilation, the focused AVS Token suite, all
historical protocol tests, TypeScript checks, formatting, diff checks, secret
and repository-scope checks, SAST, and privacy scanning.

Required completion status:

```text
PHASE 4B CLOSED
```
