# Phase 2 BSC Testnet Deployment

## Status

- **DEPLOYED:** Phase 2 contracts are deployed on BSC Testnet.
- **VERIFIED:** Runtime code, EntryPoint linkage, factory reference, and account
  authorization invariants were checked.
- **NOT PRODUCTION:** No Mainnet or production deployment exists.

## Network

| Field | Value |
| --- | --- |
| Network | BSC Testnet |
| Chain ID | `97` |
| EntryPoint version | v0.8 |
| EntryPoint address | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |

## Deployed contracts

| Component | Address |
| --- | --- |
| `AVSAccount` implementation | `0x86499A2a5390bbb40001c021aF6976F11144F9BC` |
| `AVSAccountFactory` | `0x4EA3e3BEC6DC92e5fFB3275DF377e0792EeD7AdD` |
| `TestReceiver` | `0x3d0d55295e81aA282688031f604A1B37E70009Ef` |

The canonical EntryPoint at the address above is reused. It was not modified
or redeployed by this project.

## Verification evidence

The post-deployment verification checks:

- Confirm the network chain ID is `97`.
- Confirm EntryPoint runtime code exists at the canonical address.
- Compare the EntryPoint runtime against the BSC Testnet chain-specific
  expected runtime hash with its linked immutable values.
- Confirm runtime code exists for all three deployed contracts.
- Confirm `AVSAccountFactory.accountImplementation()` matches the deployed
  `AVSAccount` implementation.
- Confirm Factory-created accounts point to canonical EntryPoint v0.8.
- Confirm Factory-created account signer coordinates match the registered
  Passkey public key.
- Reject direct deployer execution.
- Reject second initialization.
- Confirm the temporary deployment wallet has no permanent Smart Account
  authorization privileges.

Result: **VERIFIED — PASS**.

## Reproduction

The contract verification and Phase 2 tests can be run with standard project
commands:

```bash
pnpm install
pnpm run compile
pnpm test
pnpm run typecheck
pnpm --filter @workspace/avs-passkey-demo run build
```

The expected automated result is:

```text
22 passing
0 failing
```

## Security notice

This is an **EXPERIMENTAL / TESTNET / UNAUDITED** deployment. It must not be
used to custody production funds. Testnet assets, addresses, and deployments
are not a production guarantee.