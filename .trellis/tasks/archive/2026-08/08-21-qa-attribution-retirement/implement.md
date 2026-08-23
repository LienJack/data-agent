# Legacy Attribution Route and Runtime Retirement — Implementation

## Owned Files

- `.trellis/tasks/08-21-qa-attribution-retirement/**`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/w/[workspaceId]/analysis/page.tsx`
- `apps/web/src/lib/workspace-navigation.ts`
- `apps/web/src/i18n/messages.ts`
- `apps/web/src/components/layout/{sidebar,mobile-workspace-nav,workspace-topbar,workspace-shell,workspace-nav-icon}.tsx`
- `apps/web/src/components/workspaces/workspace-home.tsx`
- `apps/web/test/{legacy-workspace-routes,workspace-navigation}.spec.ts`
- `packages/platform/src/runs/agent-dispatch-planner.ts`
- `packages/platform/test/runs/agent-dispatch-planner.spec.ts`

## Steps

- [x] 产出 read-only attribution inventory，冻结 product-only/shared/ambiguous/cleanup-candidate 边界。
- [x] 先更新 Platform regression，证明 ATTRIBUTION 三种 rollout 都 stable DEFERRED。
- [x] 删除 Workspace navigation `analysis` key、入口、图标、i18n 产品文案和旧 projection 快捷项。
- [x] 将旧 workspace route 改为 authorization-first redirect；root page 改为 workspace selection redirect。
- [x] 更新 Web characterization，并运行 focused tests/typecheck/scoped Biome。
- [x] 运行 Trellis check/review，确认 diff 没有 destructive action，创建一个 scoped implementation commit。
- [ ] 归档 task 并记录 session；destructive cleanup 留待独立 Go/No-Go。

## Validation

```bash
pnpm --filter @data-agent/platform exec vitest run test/runs/agent-dispatch-planner.spec.ts
pnpm --filter @data-agent/web exec vitest run \
  test/workspace-navigation.spec.ts \
  test/legacy-workspace-routes.spec.ts \
  test/qa-deferred-admission.spec.tsx \
  test/workspace-run-effective-config.spec.ts
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/web typecheck
pnpm exec biome check <owned TS/TSX files>
git diff --check
```

Static acceptance:

```bash
if rg -n 'workspace\.surface\.analysis|workspace\.description\.analysis|归因分析' apps/web/src; then exit 1; fi
if rg -n 'href=.*analysis|workspacePath\([^)]*"analysis"' apps/web/src; then exit 1; fi
```

## HOLD

- 不执行历史数据 DELETE 或 Artifact purge。
- 不修改 10619–10622 migration 或 controlled-attribution eval。
- 没有独立 cleanup approval、inventory digest、PITR/backup 与 exact count receipt 前，不宣称历史数据已清理。

## Verification Record

- Platform planner focused: 1 file / 6 tests PASS；Platform typecheck PASS。
- Web focused: 4 files / 30 tests PASS；Web full unit: 108 passed + 1 skipped files,
  396 passed + 1 skipped tests；typecheck/build PASS。
- Attribution contracts: 2 files / 97 tests PASS；eval shared regressions: 3 files / 26 tests PASS。
- Scoped Biome、static old-entry scan、destructive diff audit 与 `git diff --check` PASS。
- Browser：authenticated legacy route 保留 workspace 并落到 `/qa`，旧 query/deep link 不恢复；新未登录 session
  落到 `/login`；Sidebar 只显示“对话分析 / Conversation Analysis”产品入口。
- Full Web lint remains HOLD only on unrelated existing formatting/import findings in agent-profile and artifact-export
  routes. Full Platform unit remains HOLD on unrelated `postgres-semantic-induction.spec.ts` foundational-source fixture;
  the task-owned planner suite passes.
