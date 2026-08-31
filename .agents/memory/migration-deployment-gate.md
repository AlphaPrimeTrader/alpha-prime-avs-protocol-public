---
name: Migration deployment gate
description: Safety prerequisite for any Phase 4D deployment or live Vault binding.
---

Do not deploy or bind the Phase 4D Migration contract until the real legacy
Ledger return shape and legacy Vault withdrawal authorization semantics are
independently matched to the narrow migration interfaces.

**Why:** Local mocks intentionally model only the minimum atomic behavior. A
successful local proof cannot establish compatibility with an undeclared legacy
deployment.

**How to apply:** Before proposing Testnet deployment, verify the canonical
legacy contract addresses and bytecode, compare their live ABIs to the Phase 4D
interfaces, and prove the Migration contract can be authorized without adding a
broader funds-out authority.