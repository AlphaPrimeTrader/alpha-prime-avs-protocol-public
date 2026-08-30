AVS PROTOCOL — SECURITY DISCLOSURE & PUBLICATION POLICY

AVS Protocol is open source, but open source does NOT mean publishing
unpatched vulnerabilities, exploitable attack recipes, secrets, or
unnecessary operational attack surface.

This policy applies to ALL future phases.

==================================================
1. PUBLICATION PRINCIPLE
==================================================

Public repositories should contain enough information for independent
developers and auditors to understand, build, test and integrate AVS.

They must NOT unnecessarily publish material that materially lowers the
cost of exploiting an unresolved vulnerability.

==================================================
2. NEVER PUBLISH BEFORE FIX
==================================================

If any Critical or High security issue is discovered and remains unpatched,
DO NOT publish publicly:

- exploit proof-of-concept code
- exact attack transaction sequences
- payloads that reproduce the exploit
- vulnerable private test fixtures
- internal incident logs exposing attack paths
- exact operational secrets
- private infrastructure details
- keys, tokens or credentials
- temporary bypasses
- comments that reveal an unresolved exploitable weakness

Do not create a public GitHub Issue containing an unresolved exploitable
Critical/High finding.

==================================================
3. PRIVATE SECURITY HANDLING
==================================================

Unresolved security findings must be handled privately.

Record privately:

- finding severity
- affected component
- root cause
- exploitability
- affected versions
- patch plan
- regression tests
- verification result

Fix first.
Test second.
Publish sanitized disclosure only after the patch is available.

==================================================
4. SAFE PUBLIC DISCLOSURE
==================================================

After remediation, public documentation may describe:

- affected version
- vulnerability class
- impact
- fixed version
- mitigation
- upgrade recommendation
- security invariant added

Do not publish weaponized exploit material unless there is a deliberate
security-disclosure decision after remediation.

==================================================
5. TESTS
==================================================

Adversarial tests are encouraged.

However:

- tests proving that a FIXED attack is rejected may be public
- tests exposing a currently exploitable vulnerability must remain private
  until the vulnerability is fixed

Public regression tests should demonstrate protection, not expose an
unpatched attack path.

==================================================
6. OPEN-SOURCE BOUNDARY
==================================================

Public:
- protocol contracts
- interfaces
- SDK
- ABI
- architecture
- deployment records
- security invariants
- fixed regression tests
- audits and advisories after appropriate disclosure

Private:
- deployment secrets
- private keys
- infrastructure credentials
- unresolved exploit PoCs
- operational security details that are not required for protocol use
- internal security investigation material

==================================================
7. STOP RULE
==================================================

Before every public commit/release, perform a SECURITY DISCLOSURE REVIEW.

Ask:

"Does this commit contain information that could enable exploitation of an
unresolved weakness?"

If YES:
STOP BEFORE PUSH.

Escalate the material for private security review.

==================================================
8. PHASE 3B SPECIFIC RULE
==================================================

Offline Recovery Kit work is security-critical.

Do not publicly expose:

- actual recovery secrets
- deterministic derivation material that should remain secret
- test recovery kits that map to live accounts
- private recovery entropy
- unpatched recovery bypass PoCs
- exact exploitable malformed payloads before fixes

Public docs may explain the recovery architecture without publishing user
secret material or unresolved exploit instructions.

==================================================
9. NO SECURITY THROUGH OBSCURITY
==================================================

This policy does NOT mean hiding insecure design.

Protocol security must still rely on cryptography and enforceable on-chain
rules, not secrecy of source code.

The goal is:

Open architecture
+
Open verified code
+
Responsible vulnerability disclosure
+
No publication of unresolved weaponized exploit material