# U7 Implementation Plan

## Ordered Work

1. Add failing Contract tests for strict source identity, preview/export schemas, receipt hashes, formula policy and tamper/cross-scope
   rejection.
2. Implement `export-receipt.ts`, register `ArtifactExportReceipt`, and expose safe builders/types.
3. Add deterministic preview adapters and CSV/XLSX exporter tests for XSS, dangerous URLs, formula injection, escaping and stable bytes.
4. Add Platform red tests and implement `PostgresArtifactWorkspaceStore` with exact create/load RPC verification.
5. Add 10657 renderer, append-only table/RLS/NOLOGIN/grants/RPCs/static assertions and rollback-only SQL fixtures.
6. Add Web service/routes. Preview resolves committed source; export derives bytes before receipt commit; download reloads receipt and
   source, rebuilds bytes and verifies output hash before response.
7. Add `ArtifactWorkspace` and the smallest exact integration hunk in `AnalysisReportDocument`; do not absorb unrelated parallel work.
8. Run focused tests, typecheck/build, renderer/static, fresh PG17 with import hooks `/dev/null`, Biome, diff-check and forbidden scans.
9. Run Trellis check, repair all U7-owned P0/P1, update evidence, stage exact owned paths/hunks and create one scoped commit.

## Owned Paths

- `.trellis/tasks/08-16-u07-artifact-workspace/**`
- `packages/contracts/src/artifacts/export-receipt.ts`
- `packages/contracts/src/artifacts/envelope.ts`, `types.ts`, `index.ts` U7 exact hunks only
- `packages/contracts/test/artifact-export-receipt.spec.ts`
- `packages/platform/src/artifacts/postgres-artifact-workspace-store.ts`
- `packages/platform/src/index.ts` U7 export hunk only
- `packages/platform/test/artifacts/postgres-artifact-workspace-store.spec.ts`
- `apps/web/src/lib/artifact-workspace-service.ts`
- `apps/web/src/lib/workspace-identity.ts` U7 exact hunk only
- `apps/web/src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/route.ts`
- `apps/web/src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/exports/route.ts`
- `apps/web/src/components/workbench/artifact-workspace.tsx`
- `apps/web/src/components/workbench/analysis-report-document.tsx` U7 exact hunk only
- `apps/web/test/artifact-workspace.spec.tsx`
- `apps/web/test/artifact-export-routes.spec.ts`
- `infra/supabase/apps/data-agent/migration-sources/10657/**`
- `infra/supabase/apps/data-agent/migrations/20260725010657_app_data_agent_artifact_export_authority.sql`
- `infra/supabase/test-support/35-artifact-export-authority-assertions.sql`
- `infra/supabase/test-support/static-check.sh` 10657 exact hunk only
- `scripts/render-10657-migration.ts`

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/artifact-export-receipt.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/artifacts/postgres-artifact-workspace-store.spec.ts
pnpm --filter @data-agent/web exec vitest run test/artifact-workspace.spec.tsx test/artifact-export-routes.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm --filter @data-agent/web typecheck && pnpm --filter @data-agent/web build
pnpm exec tsx scripts/render-10657-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
```

Fresh PostgreSQL 17 maps all import hooks to `/dev/null`, installs migrations and runs only U7 Authority assertions. It does not import
data, run Falcon or call a Provider.

## Completion Evidence

- Contracts focused `6/6`; Platform focused `3/3`; Web focused `9/9`。Contracts/Platform typecheck+build、Web typecheck 与
  Next production build 全绿；Next 仅保留既有动态 filesystem tracing warnings。
- Trellis review 补齐了 export POST 的 WRITE Authority、真实 OOXML ZIP/XML 解析、Chart column closure、Report evidence
  exact scope/run、filename fail-closed，以及 load receipt/source/output substitution 反例。
- 固定 cross-language request fixture 在 Contracts 与 PostgreSQL `u2_canonical_sha256` 得到同一
  `sha256:5f7576e1518c98aa257ccea5ce5515e66ce68b15c5a938455e74c939fecb8493`；旧
  `platform.canonical_sha256` 漂移已在提交前机械发现并移除。
- 10657 renderer、完整 Supabase static-check、scoped Biome、diff-check 与 production forbidden scan 全绿；最终 checksum
  `sha256:caae29f6bc66b0fe1d18f496454a778a248d16991ef1a42383df95002134ce0a`。
- 独立 fresh PostgreSQL 17 使用 ecommerce/Falcon import hooks `/dev/null` 安装全量 migrations，随后只运行 rollback-only
  assertion 35；Ledger checksum 与 rendered migration exact 一致，create/replay 与 RLS/NOLOGIN/grants/FK/immutable checks
  全绿，容器已删除。
- 本单元没有导入数据、运行 Falcon、调用 Provider、使用 Claude/Anthropic、进入商业计费路径或修改并行
  `AnalysisReportDocument`；报告 evidence cross-link 由 U7 自有 `ArtifactWorkspace` 使用完整 ref 实现。

## Risks

- Shared barrels/static-check/workbench files are dirty; stage only U7 hunks.
- XLSX must use fixed ZIP metadata; default timestamps are not deterministic.
- Heterogeneous or unknown Artifact documents fail closed rather than heuristically render.
- Web export receipt persistence cannot reuse the Worker-fenced generic artifact commit.
