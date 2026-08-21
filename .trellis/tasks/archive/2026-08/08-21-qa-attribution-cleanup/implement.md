# Legacy Attribution Destructive Cleanup — Implementation

## Owned Files

- `.trellis/tasks/08-21-qa-attribution-cleanup/**`
- `infra/supabase/apps/data-agent/migration-sources/10678/**`
- `infra/supabase/apps/data-agent/migrations/20260725010678_app_data_agent_legacy_attribution_cleanup.sql`
- `infra/supabase/apps/data-agent/migration-sources/10679/**`
- `infra/supabase/apps/data-agent/migrations/20260725010679_app_data_agent_legacy_attribution_scope_repair.sql`
- `scripts/render-10678-migration.ts`
- `scripts/render-10679-migration.ts`
- `scripts/lib/legacy-attribution-cleanup.ts`
- `scripts/legacy-attribution-cleanup.ts`
- `tests/legacy-attribution-cleanup.spec.ts`
- `infra/supabase/test-support/51-legacy-attribution-cleanup-assertions.sql`
- `infra/supabase/test-support/static-check.sh`

## Steps

- [x] Freeze exact inventory/receipt/execute contracts and task docs.
- [x] Test-first pure allowlist, strict CLI args, backup manifest and redaction helpers.
- [x] Implement/render 10678; prove migration contains no destructive DML.
- [x] Add PostgreSQL smoke for failure matrix, rows/NOOP/replay/immutability/shared survival.
- [x] Run fresh full chain + assertion 51 and scoped type/lint tests.
- [x] Apply 10678 to current local DB after ledger/schema preflight.
- [x] Capture inventory JSON; create custom pg_dump; verify SHA-256, archive TOC and full restore; generate manifest.
- [x] Execute exact cleanup using new operation id and confirmation; save DB receipt/post-check.
- [x] Revalidate shared table counts, services and retired route/deferred behavior.
- [x] Trellis check, scoped commit, archive and journal.

## Validation

```bash
pnpm exec vitest run tests/legacy-attribution-cleanup.spec.ts
pnpm exec tsx scripts/render-10678-migration.ts --verify
DATA_AGENT_POSTGRES_ASSERTION_FILTER=51-legacy-attribution-cleanup-assertions.sql \
  ./infra/supabase/test-support/run-postgres-smoke.sh
pnpm typecheck
pnpm exec biome check <owned TS files>
git diff --check
```

## Destructive Execution Gate

Execution is authorized only when all are true:

- exact user confirmation for this child exists;
- live inventory equals reviewed digest and counts;
- backup archive SHA-256 and restore list verify;
- external FK/hold counts are zero;
- current database/system/environment match manifest;
- 10678 receipt authority is installed and exact;
- CLI receives exact confirmation phrase.

Otherwise write no cleanup receipt and perform no DELETE.

## Verification Record

- Pure helper unit: 1 file / 5 tests PASS；standalone strict CLI typecheck PASS。
- 10678 renderer verify PASS，checksum
  `sha256:6ad81cf69acc1af798706b089df747fb040d96ecc5d03b30e8eae2db2f0ce462`。
- Trellis safety review 发现 10678 count/delete 原先只锁定表、未锁定 environment；当前操作全库 0 rows，确认无误删。
  已用 immutable forward repair 10679 收紧为 exact `app_id + environment`，checksum
  `sha256:bdd263ebd13ba0025558f931b8419e51e1d4692f2eb51432c7b468ce75af7171`。
- Fresh PostgreSQL 17 full migration chain + assertion 51 PASS：12 synthetic rows deleted，wrong caller/approval/digest/
  counts/stale backup/external FK/hold 全部 fail closed，replay/immutability/NOOP/shared survival PASS；另一 environment
  Attribution sentinel 明确存活。
- Full monorepo typecheck 16/16 PASS；scoped Biome 与 `git diff --check` PASS。
- Runtime regression：Platform planner 6/6、Web legacy route/deferred 7/7 PASS；live unauthorized legacy route 307 `/login`。
- Web、Worker、Indexer 均 ready；PostgreSQL 与 Neo4j 均 healthy。
- Current operation receipt：`NOOP / LEGACY_ATTRIBUTION_NO_ROWS_FOUND`，total deleted 0，CLI replay byte-identical。
- 149 MB custom backup archive list + full disposable restore PASS；主机备份保留，temporary restore DB/container copy 已移除。
- Public artifacts Secret/PII field scan PASS；machine-local backup manifest 与 binary backup 均不进入 Git。
