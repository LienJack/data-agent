# M3 语义绑定影响候选实施计划

## 1. Contracts first

- [x] 新增 `packages/contracts/src/artifacts/semantic-binding-impact.ts`：authority bundle、plan、commit
  receipt、safe projection、hash builder/verifier 与 canonical validation。
- [x] 从 artifact index 和 semantic application port 导出类型，新增窄 `SemanticBindingImpactPort`。
- [x] 新增 contracts 测试：strict keys、scope/release/snapshot closure、canonical order、hash tamper、safe
  projection redaction、Candidate/null 状态约束。

验证：

```bash
pnpm --filter @data-agent/contracts exec vitest run test/semantic-binding-impact.spec.ts
pnpm --filter @data-agent/contracts typecheck
```

## 2. Pure planner and simplification

- [x] 先为 direct mapping、no-op、ambiguity、cycle、stable hash 写失败测试。
- [x] 从 `induction/impact-planner.ts` 抽取通用 deterministic dependency closure，并证明既有 induction
  测试行为不变。
- [x] 新增 `induction/binding-impact-planner.ts`，实现 exact locator matching、风险/动作矩阵、dependency
  graph 与 manual reason。
- [x] 从 Candidate reducer 抽取通用 draft builder；现有 Agent wrapper 与 M3 共用 diff/risk/MARK_STALE
  转换，不复制 Candidate 流程。
- [x] 新增 application service，串联 load -> plan -> optional Candidate draft -> atomic commit/read。

验证：

```bash
pnpm --filter @data-agent/semantic exec vitest run \
  test/impact-planner.spec.ts \
  test/binding-impact-planner.spec.ts \
  test/semantic-candidate-generation.spec.ts \
  test/semantic-application-boundary.spec.ts
pnpm --filter @data-agent/semantic typecheck
```

## 3. PostgreSQL current authority

- [x] 实施前运行 migration inventory，确认 10706 未被占用。
- [x] 新增 `migration-sources/10706/`、renderer 与 rendered migration；加入 migration ledger/inventory。
- [x] 新增 append-only receipt table、immutable trigger、RLS/grants/postconditions。
- [x] 实现 load/commit/get RPC：exact active release package closure、authority hash、事务内 stale recheck、
  复用 `semantic.create_candidate_draft`、幂等重放与 safe projection。
- [x] 新增 `postgres-semantic-binding-impact.ts`，只通过 transactional capability authority 调用 RPC，
  统一映射 typed errors。
- [x] 增加 platform unit/contract tests 与 PostgreSQL assertions：no-op、review Candidate、replay、conflict、
  stale、跨 scope、不可变、redaction。

验证：

```bash
pnpm exec tsx scripts/render-10706-migration.ts --verify
pnpm exec tsx scripts/verify-workspace-migration-inventory.ts
pnpm exec vitest run tests/semantic-binding-impact-migration.spec.ts tests/workspace-migration-inventory.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/semantic/postgres-semantic-binding-impact.spec.ts
pnpm --filter @data-agent/platform typecheck
DATA_AGENT_POSTGRES_ASSERTION_FILTER=53-semantic-binding-impact-assertions.sql \
  ./infra/supabase/test-support/run-postgres-smoke.sh
```

## 4. Cross-layer cleanup and documentation

- [x] 更新 `.trellis/spec/backend/semantic-induction-maintenance.md`，记录 binding impact authority、Candidate
  reuse、no-auto-publish 和 safe projection。
- [x] 更新 TIS 主方案/M3 文档与父任务验收；保留 M2 量化门禁和 M4 UI 边界。
- [x] 搜索并证明没有新 `binding_impact` 兼容 adapter、双 RPC、第二套 Candidate/Publish 路径或旧数据迁移。
- [x] 对全部 task-owned TS 文件运行 Biome，对 diff 运行 whitespace check。

验证：

```bash
pnpm exec biome check <task-owned-ts-files>
rg -n "binding.*(_v1|_v2)|compat|fallback|dual read|backfill" \
  packages infra/supabase/apps/data-agent/migration-sources/10706 tests
git diff --check
```

## 5. Final gates and commit

- [x] Contracts、Semantic、Platform 的相关完整 test/typecheck 通过。
- [x] migration static/inventory/renderer 与 focused PostgreSQL 17 smoke 通过。
- [x] 使用 Trellis check 复核 spec drift、回归、权限、幂等、敏感数据和旧路径引用。
- [x] 只显式 stage M3-owned files；不纳入 `apps/web/tsconfig.tsbuildinfo`、Falcon artifacts 或其他任务目录。
- [x] 创建一个 scoped work commit，归档子任务并记录 journal。

## Verification Evidence

- Contracts/Semantic/Platform + migration inventory：8 files / 43 tests passed。
- Semantic focused suite（binding planner、application、Candidate reducer）：3 files / 17 tests passed。
- `@data-agent/contracts`、`@data-agent/semantic`、`@data-agent/platform` typecheck passed；依赖包已强制 build，排除 stale `dist`。
- Task-owned TypeScript `biome check`、`git diff --check`、10706 renderer verify、Supabase static check passed。
- Fresh PostgreSQL 17 完整迁移到 10706，`53-semantic-binding-impact-assertions.sql` passed。
- 扫描仅命中禁止兼容 RPC 的 postcondition 与反向测试；运行实现没有 `_v1`/`_v2`、backfill、dual read/write、Submit、Approve 或 Publish 路径。

## Rollback Points

- Contract/planner 未提交前可整体撤销 task-owned changes。
- 10706 尚未部署时可随 work commit 回退；部署后不删除历史 receipt，只停止 application wiring。
- 任一 stale/scope/hash/atomicity PostgreSQL assertion 失败即停止，不以应用侧校验替代数据库门禁。
