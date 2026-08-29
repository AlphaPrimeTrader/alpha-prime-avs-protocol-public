# Security Policy

## Security warning

> **EXPERIMENTAL / TESTNET ONLY**
>
> This code is not audited and must not be used to custody production funds.

Alpha Prime AVS Protocol currently has a BSC Testnet deployment only. There is
no production deployment and no Mainnet deployment. Testnet assets may be
lost, and the contracts, browser demo, SDK surface, and deployment scripts
must not be treated as production-ready.

The current release scope is the validated Smart Account and Passkey /
ERC-4337 Phase 2 testnet baseline. Recovery, Paymaster, Pools, Shares,
Marketplace, and other future protocol features are not implemented.

## Security boundaries

- Never commit private keys, seed phrases, API keys, environment secrets, or
  private Passkey material.
- The Passkey private key must remain inside the platform authenticator.
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