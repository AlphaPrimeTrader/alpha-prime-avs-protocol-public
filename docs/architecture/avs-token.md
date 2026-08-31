# AVS Token Architecture

## Status

Phase 4B is an unaudited AVS share-token foundation deployed and
source-verified on BSC Testnet at
`0x2861F3d12082710118391f06F818CA3412ffFE87`. It remains unconfigured, has not
been bound to the BSC Testnet `AVSLedger`, and must not be used for production
funds.

`AVSToken` is a restricted-transfer ERC-20 protocol share token. It uses
OpenZeppelin ERC-20 accounting primitives while applying explicit protocol
authorization rules around minting, transfers, approvals, and configuration.

## Token rules

| Rule           | Value            |
| -------------- | ---------------- |
| Name           | `AVS`            |
| Symbol         | `AVS`            |
| Decimals       | `18`             |
| Initial supply | `0`              |
| Maximum supply | `20,000,000 AVS` |

There is no pre-mint, owner allocation, team allocation, constructor mint,
inflation path, burn function, pause function, upgrade path, forced transfer,
seizure, arbitrary balance setter, or arbitrary supply setter.

## Authority domains

| Authority         | Allowed actions                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Owner             | Configure Vault and Account Policy while unlocked; permanently lock each; renounce ownership |
| Account Policy    | Permanently authorize new non-zero accounts                                                  |
| Vault             | Mint positive amounts to already-authorized accounts                                         |
| Whitelisted users | Transfer and approve only within the whitelisted account set                                 |

No authority can substitute for another. The owner cannot mint or authorize
accounts. Account Policy cannot mint. Vault cannot authorize accounts.
The three configured authority identities must also be distinct; configuration
rejects a Vault or Account Policy address that collides with another authority.

## Permanent whitelist

Authorization is stored in:

```solidity
mapping(address => bool) public isWhitelisted;
```

The mapping provides constant-time authorization checks. There is no on-chain
array, enumeration function, whitelist-sized loop, deauthorization function,
freezing function, blacklist, or administrative removal path. Once an account
is authorized, the Token contract keeps it authorized permanently.

## Restricted ERC-20 behavior

- `transfer` requires the caller and recipient to be whitelisted.
- `approve` requires the caller and spender to be whitelisted.
- `transferFrom` requires the execution-time spender, source, and recipient to
  be whitelisted, then applies normal allowance accounting.
- Standard ERC-20 balances, allowances, and `Transfer`/`Approval` events remain
  provided by OpenZeppelin.

The restriction is enforced at the shared ERC-20 update path so minting and all
transfer paths cannot silently bypass it.

## Minting and cap

Only the configured Vault can call `mint`. Minting requires a non-zero amount,
a whitelisted recipient, and enough remaining capacity to keep:

```text
totalSupply <= 20,000,000 * 1e18
```

The Token does not calculate shares or interact with the Ledger. A future,
separately reviewed Vault/Ledger flow will determine the requested mint amount.

## Configuration and renunciation

The owner receives no implicit authority from `msg.sender`; construction
requires a non-zero explicit `initialOwner`. Vault and Account Policy addresses
must be deployed contracts and may change only before their independent,
irreversible locks. A lock cannot be set before its address is configured.

Ownership renunciation is allowed only after both addresses are configured and
both locks are active. Renunciation sets `owner` to zero and cannot be
reversed. It does not affect balances, whitelist entries, transfers,
approvals, Vault minting, or Account Policy authorization.

This phase is not a claim that the complete AVS protocol is decentralized.
