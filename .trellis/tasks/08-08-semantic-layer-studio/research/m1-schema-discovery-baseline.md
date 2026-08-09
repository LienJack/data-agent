# M1 Schema Discovery Baseline

Date: 2026-08-08
Status: pre-development research; M1 is not activated until M0 is archived

## Required outcome

M1 must let a user connect a PostgreSQL datasource and browse tables, columns, physical types,
constraints and deterministic drift. It must prove all of the following independently:

- the datasource session is read-only and the adapter contains no write SQL;
- allowlisted schemas, timeouts, keyset pagination and cancellation are enforced by the server;
- a repeated scan of unchanged catalog facts has the same content hash;
- table, column, primary-key, foreign-key, unique, nullability and type mutations are detected exactly;
- permission and timeout failures become stable public terminals without leaking DSN or database
  errors;
- physical catalog facts remain evidence only and never become published business semantics.

## Existing assets and non-reuse boundaries

### Reuse

- `@data-agent/contracts` already owns canonical JSON and SHA-256 content hashing.
- `packages/contracts/src/artifacts/grounding-authority.ts` already defines the smaller runtime
  `SchemaSnapshotDocument` consumed by Text2SQL grounding.
- `packages/platform` already depends on `pg` and owns PostgreSQL adapters.
- `packages/platform/src/persistence/transaction.ts` establishes the project error and transaction
  conventions for the authority database.
- `services/sandbox/src/data_agent_sandbox/sql/snapshots.py` contains useful PG17 catalog-query and
  bounded-scan precedents for relations, columns and stable ordering.
- M0 establishes the server-only credential-reference resolver and redacted datasource error seam.

### Do not conflate

- `PhysicalSchemaSnapshot` is the complete observed datasource catalog. The existing runtime
  `SchemaSnapshotDocument` is a narrowed, governed grounding artifact with sensitivity and join
  semantics. M1 must not populate the latter directly from foreign keys or column names.
- The sandbox controlled-revision manifest includes data digests and execution authority. M1 scans
  metadata only; it must not read business rows or reuse sandbox success brands.
- The datasource database and the Data Agent authority database are two local transaction domains.
  M1 must not claim cross-database atomicity or exactly-once behavior.
- Existing untracked datasource and Data Link files are user-owned overlap. M1 must not absorb them
  without an explicit baseline/commit decision.

## Owning modules

```text
packages/contracts/src/catalog/
  physical-schema.ts       strict public snapshot and scan contracts
  schema-drift.ts          deterministic change algebra and stable errors
  index.ts                 narrow exports

packages/platform/src/catalog/
  postgres-catalog.ts      PostgreSQL read-only adapter
  physical-schema.ts       canonical normalization and hashing
  schema-drift.ts          pure deterministic comparison
  postgres-snapshot-store.ts  authority-DB persistence adapter

apps/web/src/app/api/datasources/[id]/schema-scans/
apps/web/src/app/api/datasources/[id]/schema-scans/[runId]/
apps/web/src/app/api/schema-snapshots/[snapshotId]/
apps/web/src/app/api/schema-snapshots/[snapshotId]/diff/
```

`contracts` imports no PostgreSQL or Next.js code. `platform` implements the datasource and
authority-store ports. Web resolves server Authority and credential references, then parses the
returned contracts. React components receive only parsed snapshot/drift projections.

## Cross-layer data flow

```text
authenticated server Authority
  -> datasource metadata + DataSourceCredentialRef
  -> SecretResolverPort (short-lived credential)
  -> egress target authorization
  -> PostgreSQL read-only catalog transaction
  -> normalized PhysicalSchemaFacts
  -> canonical sort + content hash
  -> authority database scan run/snapshot/drift commit
  -> parsed API DTO
  -> Physical Schema tree / snapshot selector / drift diff
```

Validation ownership:

| Boundary | Owner |
| --- | --- |
| HTTP body/query | shared strict contract parsed by Web route |
| server scope/principal | server Authority resolver; never request JSON |
| credential value | server-only SecretResolver; never persisted or returned |
| datasource catalog rows | platform adapter Zod row decoders |
| canonical ordering/hash | contracts/platform deterministic kernel |
| scan/snapshot persistence | Data Agent authority PostgreSQL transaction |
| rendering | parsed read projection only |

## Contract decisions

### `SchemaScanRequest`

Versioned strict input with:

- `datasource_id`;
- schema allowlist (non-empty, unique, bounded, sorted after parse);
- `page_size` bounded by a server ceiling;
- `statement_timeout_ms` bounded by server policy;
- optional base snapshot identity for drift comparison.

It does not accept app, tenant, environment, principal, role, password, DSN, arbitrary SQL or a
client-supplied snapshot hash.

### `PhysicalSchemaSnapshot`

The content-addressed facts include:

- datasource ID and server-owned datasource fingerprint;
- engine=`postgresql`, server major/minor version and database/catalog identity;
- exact allowlisted schemas;
- stable, sorted table/view facts;
- stable, sorted column facts: ordinal, physical type, normalized type identity, nullable, default,
  generated/identity and comment;
- primary key, foreign key, unique, check and index facts with ordered columns and PostgreSQL
  predicates/expressions where applicable.

Structured identity fields are used instead of delimiter-concatenated keys. `captured_at`, scan-run
ID and persistence IDs are envelope metadata and are excluded from the content hash. Therefore two
unchanged scans may create two scan-run observations while resolving to the same snapshot content
identity.

All arrays are normalized by deterministic tuple order before hashing. Duplicate structured
identities fail closed; later rows never overwrite earlier rows in a `Map`.

### `SchemaDriftEvent`

The drift kernel compares two parsed snapshots of the same datasource fingerprint and emits a
stable, sorted operation list. Initial operation kinds cover:

- table add/remove/kind change;
- column add/remove/type/nullability/default/identity/generated change;
- primary-key add/remove/change;
- foreign-key add/remove/change;
- unique/check/index add/remove/change.

Severity is a deterministic projection of operation kind, not an Agent judgment. Binding impact is
`UNKNOWN` until a later governed semantic release is supplied. Rename is not inferred from similar
names: remove+add remains remove+add and cannot delete or rewrite semantic objects automatically.

## PostgreSQL datasource transaction

One checked-out datasource client owns the entire catalog observation:

1. connect through an already authorized egress target with a short-lived resolved credential;
2. `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
3. set bounded `statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`;
4. verify `transaction_read_only = on`, server version and database identity;
5. query only fixed `information_schema`/`pg_catalog` statements with allowlist values as parameters;
6. page by stable tuple cursors, never by unbounded materialization or caller SQL;
7. observe `AbortSignal` between pages and pass cancellation to the PostgreSQL query layer;
8. always `ROLLBACK` and release, including success, timeout, parse failure and cancellation.

The query allowlist covers ordinary/partitioned tables and views visible to the scan role. Internal
schemas (`pg_catalog`, `information_schema`, `pg_toast`, temporary schemas) are denied unless a future
policy explicitly adds a separate trusted mode.

M1's physical verification creates a login with only database CONNECT and allowlisted schema/table
metadata visibility. The test proves `INSERT`, `UPDATE`, `DELETE`, DDL, sequence use and function
execution outside the allowlist fail. A read-only transaction alone is defense in depth, not the
minimum-permission proof.

## Authority persistence

The next additive app migration should own:

- immutable `physical_schema_snapshots` keyed by full app scope, datasource fingerprint and content
  hash;
- append-only `schema_scan_runs` with stable terminal and redacted error code;
- immutable `schema_drift_events` binding exact base/current snapshot content identities;
- exact RLS, grants and narrow RPCs for create/finalize/read operations;
- idempotent same-input replay and conflict behavior;
- audit references without credential or raw database errors.

Candidate, Review, Release and active semantic pointers remain untouched. Disabling the scanner must
leave the last committed snapshots readable.

## Stable terminals

Initial public reason-code set:

- `SCHEMA_SCAN_CANCELLED`;
- `SCHEMA_SCAN_TIMEOUT`;
- `SCHEMA_SCAN_PERMISSION_DENIED`;
- `SCHEMA_SCAN_DATASOURCE_UNAVAILABLE`;
- `SCHEMA_SCAN_CATALOG_CONTRACT_INVALID`;
- `SCHEMA_SCAN_LIMIT_EXCEEDED`;
- `SCHEMA_SCAN_SCOPE_FORBIDDEN`;
- `SCHEMA_SCAN_IDEMPOTENCY_CONFLICT`.

Unknown PostgreSQL/connector failures map to a redacted retryable datasource-unavailable error. SQL,
DSN, host credentials, stack and raw driver messages never enter API DTOs or scan-run error payloads.

## Test-first implementation units

1. Contract tests for strict scan request, snapshot identities, duplicate rejection, stable hashing
   and drift operation exhaustiveness.
2. Pure drift fixtures covering table/column/PK/FK/unique/null/type positive and negative cases.
3. Fake-client adapter tests proving fixed SQL, read-only transaction order, keyset pagination,
   cancel/timeout cleanup and zero queries after a failed preflight.
4. PG17 physical fixture with a minimum-permission scan role and catalog mutations between two
   snapshots; expected drift must match exactly.
5. Additive authority migration tests for scope isolation, immutable content, replay/conflict and
   last-snapshot reads.
6. Route contract tests proving server-derived Authority and public error redaction.
7. UI projection tests proving tree, selector and drift diff share the same snapshot identity and
   never label physical observations as published semantics.

## Activation boundary

The parent implementation order requires M0 to be archived with its PostgreSQL evidence before an M1
child is created or activated. This document removes architecture uncertainty but does not bypass
that gate. The first M1 coding action after activation is the failing contract/drift fixture, followed
by the PostgreSQL adapter; no LLM or schema-to-semantic proposal code belongs in M1.
