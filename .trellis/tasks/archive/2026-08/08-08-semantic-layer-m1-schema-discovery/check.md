# M1 Verification and Commit Boundary

Date: 2026-08-09
Status: implementation verified and committed; ready to archive

## Evidence

| Gate | Result |
| --- | --- |
| M1 scoped Biome | PASS; owned TypeScript files clean |
| Workspace typecheck | PASS; 13/13 tasks |
| Workspace unit | PASS; all participating package suites |
| Workspace contract | PASS; 8/8 tasks |
| M1 Web Authority/datasource/service/route/UI | PASS; 16/16 |
| M1 focused contracts/platform/Web | PASS |
| PostgreSQL 17 catalog integration | PASS; 2/2 |
| Fresh PostgreSQL 17 vertical slice | PASS; Platform 13/13 + M1 Web 1/1 + Worker 9/9 |
| 10623 renderer | PASS; `sha256:4e3548e2fbabf2e4a8bf05852550d6c49068d6db31bccdc7de8cc97412f334bb` |
| Full migration chain + M1 authority assertions | PASS |
| Next 16 production build | PASS; M1 page and four dynamic API routes emitted |
| Headed browser visual/interaction pass | PASS; page/forms rendered, browser console clean, missing runtime failed closed with redacted 503 |
| Scoped work commit | PASS; `4cee083 feat(semantic): deliver M1 PostgreSQL schema discovery` |

`pnpm lint` remains red because the dirty worktree contains 142 pre-existing errors in untracked or
unrelated DataFoundry and release files. M1's exact file set passes Biome. No unrelated lint file was
rewritten.

The Next build exits 0 and emits every M1 route. During static page collection it also prints an
existing `libpg-query.wasm` `/ROOT/...` lookup warning from outside M1; it does not prevent route/page
generation and is not claimed fixed here.

The local Next development server reached ready state on port 3010. A headed browser rendered the
Physical Schema page, exposed the evidence-only boundary, enabled the scan action after datasource
input, and showed the redacted `Schema Discovery Authority 尚未配置。` alert for the intentionally
unconfigured production resolver. The browser console contained no errors. The server still emitted
the same existing `libpg-query.wasm` `/ROOT/...` warning described above; it did not prevent the page
or the expected 503 response.

## Adversarial findings fixed

- Fixed server Authority configuration that accidentally validated the injected authority object as
  an unknown strict field and therefore always failed closed.
- Fixed idempotent replay returning a newly generated, uncommitted snapshot ID instead of the
  PostgreSQL-authoritative snapshot ID.
- Recomputed snapshot content hash before the persistence RPC and rejected forged content address.
- Redacted connector `release()` failures after rollback.
- Removed CSS tokens/layout classes that existed only in the unrelated dirty DataFoundry worktree.
- Added a real cross-layer test that uses a minimum-read datasource login, resolves PostgreSQL
  Authority, commits the initial snapshot, verifies authoritative idempotent replay, alters the
  source catalog, and reads the persisted `COLUMN_ADDED` drift event back through the store.

## Static scope proof

- Datasource scanner query registry contains only RR/RO transaction control and fixed
  `pg_catalog` reads; its unit gate rejects datasource DML/DDL/COMMIT tokens.
- M1 contracts/platform/Web files contain no LLM invocation.
- 10623 owns only `catalog.physical_schema_snapshot`, `catalog.schema_scan_run` and
  `catalog.schema_drift_event`; it does not mutate Candidate, ReviewPacket, SemanticRelease or an
  active pointer.
- Web requests cannot carry Authority, password, DSN, arbitrary SQL or a self-reported content hash.

## Deployment boundary

The production composition seam requires deployment-provided datasource metadata, egress approval,
Secret Provider and pinned connector factory. If any is absent, start-scan returns a redacted 503.
M1 does not absorb the existing untracked DataFoundry datasource repository or invent a plaintext
development fallback.

## Rollback

Disable the scan routes or leave the deployment datasource resolver unconfigured. Existing immutable
snapshots, scan runs and drift events remain readable. Do not run a destructive down migration.

## Scoped commit manifest

Include only:

- `.trellis/tasks/08-08-semantic-layer-m1-schema-discovery/**`
- `.trellis/tasks/08-08-semantic-layer-studio/research/m1-schema-discovery-baseline.md`
- `packages/contracts/src/catalog/**`, its catalog test, and the contracts root export
- `packages/platform/src/catalog/**`, its catalog/integration tests, platform root export and surface test
- `infra/supabase/apps/data-agent/migration-sources/10623/**`
- `infra/supabase/apps/data-agent/migrations/20260725010623_app_data_agent_schema_discovery.sql`
- `infra/supabase/test-support/28-schema-discovery-authority-assertions.sql`
- the M1 assertion hook in `infra/supabase/test-support/run-semantic-m0-postgres.sh`
- `scripts/render-10623-migration.ts`
- the M1 Web vertical-slice hook in `scripts/test-platform-integration.sh`
- M1 `apps/web` schema-discovery API/lib/components/page/tests only

Exclude every other modified or untracked file visible in `git status`.
