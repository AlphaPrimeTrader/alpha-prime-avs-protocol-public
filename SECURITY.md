# Security Policy

## Security warning

> **EXPERIMENTAL / TESTNET ONLY**
>
> This code is not audited and must not be used to custody production funds.

Alpha Prime AVS Protocol currently has a BSC Testnet deployment only. There is
no production deployment and no Mainnet deployment. Testnet assets may be
lost, and the contracts, browser demo, SDK surface, and deployment scripts
must not be treated as production-ready.

The current checkpoint includes the validated Smart Account and Passkey /
ERC-4337 foundation plus experimental Phase 3B atomic Recovery root rotation
and a source-verified BSC Testnet Phase 4A Ledger. The account, Recovery, and
economic model may change before Mainnet and must not be treated as a final
product architecture. AVS Token, Vault, Paymaster, Pools, Shares, Marketplace,
and other future protocol features are not implemented or bound.

## Security boundaries

- Never commit private keys, seed phrases, API keys, environment secrets, or
  private Passkey material.
- The Passkey private key must remain inside the platform authenticator.
- Recovery Kit private material must remain encrypted and local to the user.
- Recovery atomically rotates Transaction and Recovery roots while preserving
  the account address and the separate Evolution authority.
- A Testnet relay may pay gas but has no account authorization authority.
- The Phase 4A Ledger is accounting-only: it does not custody funds, mint AVS,
  verify trades, or expose arbitrary economic setters.
- Economic writes require a bound AVS Token. Trading settlement additionally
  requires positive AVS supply and positive net assets, preventing synthetic
  PnL before economic activation.
- Ledger source and token bindings are one-time. Phase 4A contains no migration
  or emergency override mechanism.
- Ledger ownership is supplied explicitly as a non-zero constructor argument;
  the temporary deployer receives no implicit owner or configuration privilege.
- The owner may irreversibly renounce only after all three mandatory Ledger
  links are configured. Renunciation sets the owner to zero without pausing
  accounting or disabling the configured Vault and Trade Settlement, and no
  ownership restoration path exists.
- The irreversible AVS Token binding requires readable name, total supply, and
  an exact 18-decimal unit convention.
- The browser wallet is testnet infrastructure for deployment, account funding,
  and bundler submission; it is not a protocol authorization key.
- Do not use the deployed contracts or this repository to custody production
  funds.
- No Mainnet deployment is permitted before a completed security review and
  explicit approval.

## Reporting a vulnerability

Do not disclose sensitive vulnerability details in a public issue. Report them
privately to the project maintainers with enough information to reproduce the
issue and assess its impact. Do not include private keys, seed phrases, API
keys, or Passkey material in a report.