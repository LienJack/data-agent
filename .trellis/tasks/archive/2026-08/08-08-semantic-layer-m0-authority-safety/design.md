# M0 Semantic Authority and Safety Foundation — Design

## 1. Design Principles

1. A parsed payload is a candidate, not Authority.
2. Scope and principal come from a server resolver, never from request JSON.
3. PostgreSQL owns persisted canonical hashes and state transitions.
4. Missing evidence fails before state mutation; no placeholder succeeds.
5. Mock is a named local adapter, not a fallback.
6. M0 changes the unsafe seams once; M1–M5 reuse them.

## 2. Module Boundaries

### Contracts

Add strict DTOs under `packages/contracts/src/artifacts/` (or a semantic control-plane sibling):

- `SemanticCandidateDraft@1`
- `SemanticCandidateCreateResult@1`
- `SemanticPreparePublishInput@1`
- `SemanticCommitPublishInput@1`
- `SemanticRollbackInput@1`
- `DataSourceCredentialRef@1`

Contracts own parsing and canonical identity material. Web code imports them and does not copy Zod
schemas locally.

### Web server boundary

Split composition concerns:

```text
Next Route
  -> parse request action fields
  -> resolveSemanticAuthority(request)
  -> SemanticGovernanceService method(authorityContext, strictInput)
  -> map ContractError to redacted HTTP response
```

The default resolver is unavailable until a real server authentication integration is configured.
Tests inject a deterministic resolver. Local Demo explicitly selects the mock adapter and uses fixture
identity that is visibly non-authoritative.

### PostgreSQL adapter

Use one transaction runner for all methods:

```text
checkout client
  -> BEGIN
  -> revalidate server-owned capability on same client
  -> SET LOCAL scope/principal/role/deployment
  -> execute scoped SQL/RPC
  -> COMMIT
error -> ROLLBACK
finally -> release
```

Read methods also use this path; a transaction-local setting established in an earlier autocommit
statement is not sufficient.

### Database migration

Add a new migration after the highest migration version present when implementation starts. It must:

- add a narrow security-definer Candidate creation RPC;
- acquire the existing semantic scope authority lock;
- read/lock current source revision and active release identity as required;
- calculate monotonic source revision number inside the lock;
- canonicalize JSONB and calculate DB-owned source/revision/idempotency digests;
- insert source revision, candidate and candidate revision atomically;
- return exact IDs/digests/status;
- create no ReviewTask and no ValidationReceipt;
- expose exact function grants only and record the migration ledger/checksum.

Do not edit 10610 in place.

## 3. Candidate Creation Flow

```text
Client Candidate Draft (no authority fields)
  -> strict contract parse
  -> server Authority Context
  -> create_candidate RPC
     -> scope lock + currentness
     -> canonical source payload
     -> semantic_source_revision
     -> semantic_candidate(DRAFT)
     -> semantic_candidate_revision
  -> {candidate_id, revision_id, source_revision_id, digests, status:DRAFT}
```

The current shortcut that creates an OPEN ReviewTask at Candidate creation is removed from the
PostgreSQL path. Review begins only after a future deterministic validation/submit operation provides a
real ValidationReceipt. Mock may retain a separate fixture workflow, but its result is explicitly demo.

## 4. Publish and Rollback Flow

The service no longer manufactures material:

- Prepare consumes compiler/catalog/dependency/target/idempotency inputs from the deterministic build.
- Commit consumes executable/relationship/runtime-restriction projection refs and hashes.
- Rollback consumes an existing reviewed authorization identity and nonce.

If the upstream producer is not implemented, the Web API returns a stable missing-material error. This
is an intentional M0 HOLD, not an implementation gap hidden behind random UUIDs.

## 5. Datasource Secret Boundary

`DataSourceCredentialRef` contains only provider-neutral metadata such as `secret_ref_id`, version,
scope and rotation state. It never contains the provider locator or secret value.

```text
Datasource metadata -> credential_ref
Connection test -> SecretResolverPort.resolve(ref, authority)
                -> short-lived credential in local stack only
                -> connector
```

M0 defines the ref and port seam. With no resolver implementation, the connector is not invoked and the
API returns `DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED`.

## 6. Error Contract

Public categories:

- configuration: `SEMANTIC_BACKEND_NOT_CONFIGURED`, `SEMANTIC_BACKEND_INVALID`,
  `SEMANTIC_MOCK_FORBIDDEN`, `SEMANTIC_AUTHORITY_NOT_CONFIGURED`;
- authorization/scope: `SEMANTIC_UNAUTHENTICATED`, `SEMANTIC_SCOPE_FORBIDDEN`;
- candidate: `SEMANTIC_CANDIDATE_INVALID`, `SEMANTIC_CANDIDATE_CONFLICT`;
- publish/rollback: `SEMANTIC_PUBLISH_MATERIAL_REQUIRED`,
  `SEMANTIC_ROLLBACK_AUTHORIZATION_REQUIRED`, `SEMANTIC_PUBLISH_CONFLICT`;
- datasource: `DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED`, `DATASOURCE_CREDENTIAL_REF_INVALID`;
- internal: `SEMANTIC_GOVERNANCE_UNAVAILABLE`.

Internal causes remain available to server diagnostics after deep redaction, but are not returned.

## 7. Compatibility and Dirty Worktree

- Existing Review read/decision behavior stays available when backed by already valid database packets.
- Candidate-create response changes from `packetId` to draft Candidate identity; the uncommitted
  `semantic-editor.tsx` must be patched minimally and must not redirect to a nonexistent ReviewPacket.
- Current client-supplied principal/role is removed; Postgres decision requests require server auth.
- Before each edit, inspect `git diff`/untracked content for that path. Do not format or rewrite adjacent
  DataFoundry work.
- Stage and commit only explicit M0 files after checks; the existing dirty branch is not a production
  readiness claim.

## 8. Rollback

- Backend selection and new endpoints are server-config rollback points; disabling PostgreSQL writer
  leaves existing authority rows intact.
- The additive migration is not down-migrated destructively. Revoke function execution from the app
  role to disable the new writer while preserving revisions.
- Candidate drafts created by the new RPC are inert until validated and published.
- Datasource changes can be disabled at the route/feature layer; raw credentials are not restored.
