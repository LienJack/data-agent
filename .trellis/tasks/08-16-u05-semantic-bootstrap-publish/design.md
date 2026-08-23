# U5 Technical Design

## Authority Boundary

U5 新增的是一次性首发 Admission Authority，不替代已有 Candidate、Ontology Package、Graph Projection、
`semantic_source_release` 或人工治理 Authority。

```text
U1 Bootstrap Candidate + Signer Registry
                  │
                  ├─ Platform verifier: Ed25519 verification
                  │        └─ PostgreSQL verified-domain receipt
                  │
U4 Package/Validation/Preview ── deterministic bootstrap validation receipt
                  │
SemanticBootstrapPolicy + DB-held Publisher Grant
                  │
                  └─ one transaction: generation 0 -> 1
                         ├─ Initial Release Set + package admissions
                         ├─ semantic_source_release runtime projection
                         ├─ graph bindings + active pointer
                         ├─ PUBLISHED_ONLY activation + outbox
                         └─ consumed grant + permanent tombstone
```

## Contract Modules

Create `packages/contracts/src/semantic/semantic-bootstrap-release.ts` with:

- public `SemanticBootstrapPolicyView` and private-safe policy reference;
- signed domain packet hash material and `VerifiedDomainBootstrapReceipt`;
- `SemanticBootstrapValidationReceipt` with canonical ordered package/projection gate results;
- `SemanticPublisherGrantReference` only—no nonce/bearer value in public contracts;
- `InitialSemanticReleaseSet`, `SemanticPackageAdmissionReceipt`, `FirstReleaseAdmissionReceipt`;
- strict command/result/load schemas plus compute/build/verify helpers.

Every builder canonicalizes package entries by namespace/package/version/hash and rejects duplicates before hashing. Verifiers
recompute hashes and enforce scope, signer separation, package-set closure, generation=1/base=null, validation PASS, admission mode,
and First Receipt ↔ package receipts ↔ Release Set exact correlation.

## Signer and Grant Architecture

`semantic_bootstrap_signer_key_revisions` persists U1-compatible public Ed25519 JWK revisions, role, purpose, principal binding,
status and revocation epoch. A STAGED revision becomes ACTIVE only after a nonce-bound possession challenge is verified and committed;
registering canonical public material alone is never authority. Private keys never enter PostgreSQL or public contracts.

The Platform verifier loads the exact ACTIVE key revision inside an authorized transaction, verifies the canonical packet bytes with
Node crypto, then invokes `commit_verified_semantic_domain_bootstrap`. That RPC is executable only by a dedicated NOLOGIN verifier
role through a separately configured service login. The RPC re-locks both key revisions and validates scope/role/purpose/principal/
status/revision/nonce/expiry/digest before committing the verified receipt and genesis domain. Backend roles lose EXECUTE on the old
string-only bootstrap RPC.

The runtime composition requires two explicit, non-fallback service DSNs:
`DATA_AGENT_SEMANTIC_VERIFIER_DATABASE_URL` and `DATA_AGENT_SEMANTIC_PUBLISHER_DATABASE_URL`. Neither may fall back to the ordinary
backend `DATABASE_URL`; startup fails closed when either identity is absent or has the wrong database membership.

`semantic_bootstrap_publisher_grants` stores the authoritative nonce and revocation epoch. Public consumers only receive grant_id/hash;
the dedicated publisher role resolves and consumes the secret state internally. No Agent context, event, artifact, log or API response
contains the usable grant material.

## PostgreSQL 10656 Authority

Allocate 10656 with append-only tables:

- signer key revisions and nonce usage;
- signer activation challenge receipts;
- verified domain bootstrap receipts;
- bootstrap policy revisions/pointer;
- publisher grants and consumption tombstones;
- bootstrap validation receipts;
- initial release sets and package bindings;
- package admission receipts and first-release admission receipts;
- permanent bootstrap capability tombstones.

All tables use composite app/tenant/environment/domain keys, immutable document/hash columns, FORCE RLS and dedicated U5 NOLOGIN
data/RPC/verifier/publisher owners. Backend receives only safe read/list operations; verifier/publisher service identities receive only
their narrow RPCs and no direct DML.

10656 also closes the historical 10610 application surface instead of inheriting it as trusted authority. The legacy string-only
bootstrap and positional publish/rollback RPCs lose PUBLIC/application EXECUTE. New strict Human Governance RPCs run as a dedicated
NOLOGIN, NOBYPASSRLS owner, revalidate the transaction-local backend authority, and accept only `HUMAN_REVIEW` packets for
generation>=2. Their table policies are scoped to the exact app/tenant/environment/domain GUCs. System verifier/publisher roles cannot
invoke them, and the human governance role cannot invoke U5 bootstrap RPCs.

## Atomic First Publish

`publish_initial_semantic_release_set(command)` performs:

1. Resolve backend authority and acquire canonical domain fence.
2. Check exact committed idempotency receipt first; return `REPLAYED` without new writes.
3. Lock active pointer, runtime activation, policy pointer, grant and package/validation rows.
4. Require verified domain receipt, generation=0, active release null, grant ACTIVE/unexpired/unrevoked/unconsumed and no tombstone.
5. Recompute candidate-set/release-set/request hashes in PostgreSQL; validate package ordering, scope, U4 valid receipts, projections,
   snapshot/source/policy/compiler hashes and mandatory admission gates.
6. Require one real 10610 Candidate Revision whose immutable payload is the canonical Candidate Set Root manifest. Every admitted U4
   Package Candidate/Validation/Preview must project from that same root revision and match its package entry exactly.
7. Create one explicit system-bootstrap packet/attempt bridge anchored to that root. Migration 10656 forward-extends
   `semantic_review_task` with the only valid system pair
   `packet_kind=SYSTEM_BOOTSTRAP_ADMISSION` + `approval_mode=SYSTEM_BOOTSTRAP_POLICY`, and extends publish attempt/source release with
   the same approval mode. Existing rows and ordinary RPCs remain `HUMAN_REVIEW`. A decision-table guard rejects every attempted human
   decision for a system packet. Its `quorum_snapshot` records the frozen bootstrap policy and its `decision_set_digest` is the exact
   First Release Admission digest, never a fabricated set of reviewers.
8. Insert the canonical `semantic_source_release` using the Release Set digest and exact executable/relationship/restriction refs so
   U2 remains authoritative and unchanged.
9. Insert Initial Release Set, graph/package bindings, per-package and first-release receipts; update active pointer and activation.
10. Consume grant, insert permanent tombstone and outbox/audit rows in the same transaction.

The Initial Release Set is the source authority for first-publish membership. The existing `semantic_source_release` row is the runtime
projection for the same release_id/digest, not a second independently mutable release. Its `candidate_id` is always the Candidate Set
Root, never an arbitrary member package.

## Idempotency and Failure Semantics

- `(scope, idempotency_key)` maps to one request hash and receipt.
- Exact replay wins before current-state expiry/generation checks and returns the existing immutable receipt.
- Same key/different request is a non-retryable conflict.
- Any partial failure rolls back grant consumption, release rows, pointer, activation, outbox and tombstone together.
- After commit, every new bootstrap request fails with `SEMANTIC_BOOTSTRAP_CAPABILITY_CLOSED`; it cannot reopen generation 0.

## Public and Existing Governance Surfaces

The ordinary governance publish route remains human-review-only and its strict parser rejects all U5 grant/policy fields. A new
server-internal composition invokes verifier and publisher ports; there is no public bearer-bearing endpoint. Read APIs may expose
safe policy/admission/receipt projections only.

OSI/Ossie import remains Candidate-only dry run. Export resolves the active Published Release and content hashes. Existing v2 publish
and rollback semantics remain the only generation≥2 path, but the Web adapter moves to the strict 10656 Human Governance RPCs. A real
PostgreSQL characterization publishes a base-release-bound v2 with its actual quorum snapshot and decision-set digest, then executes
rollback/roll-forward. This explicitly catches the 10610 baseline defect where `commit_publish_attempt` omitted the non-null
`semantic_source_release.quorum_snapshot` column.

## Security and Privacy

- No raw private key, usable grant nonce, signed payload body, source document body, Falcon sealed/gold/expected value, credential,
  Provider request or prompt is stored in public JSON or emitted to logs.
- Agent/Worker/backend roles have no EXECUTE on verifier/publisher RPCs and no direct DML on U5 tables.
- All hashes use the repository canonical JSON SHA-256 implementation; SQL and TypeScript fixtures cross-check the same bytes.
- Old `semantic.bootstrap_domain` application grants are revoked; maintenance superuser access is not treated as product authority.

## Compatibility and Rollback

Greenfield only: no historical data migration or dual-read. The 10610 table constraint/function repairs are forward-only schema/API
hardening and never rewrite existing rows. Before v1, candidate/policy/grant can expire or be revoked with no release mutation. After
v1, immutable receipts and release remain; downstream work is stopped and a corrected generation≥2 release requires normal human
governance.
