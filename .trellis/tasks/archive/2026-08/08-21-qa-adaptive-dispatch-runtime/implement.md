# 自适应 Agent 调度实施计划

## 1. Baseline And Contracts

- [x] 记录 dirty worktree 并隔离其他任务文件；运行 current Contracts/Worker focused baseline。
- [x] 新增 `packages/contracts/src/agents/dispatch.ts` 与 exports，完成 plan/admission/binding build+verify、canonical hash 和 bad cases。
- [x] 版本化扩展 Effective Config lease payload；legacy exact-three decoder 规范化为 LEGACY_FIXED，新 writer 只写 adaptive binding。
- [x] 更新 contract tests：DIRECT、selected subset、dependency graph、DEFERRED、tamper、legacy read。

## 2. Admission And PostgreSQL Authority

- [x] 在 Platform 实现 deterministic classifier/eligibility/planner，复用统一 decoder，禁止 Web/Worker local casts。
- [x] Q&A 与兼容 Run route 在 resolve/accept 前使用同一 planner；去除“必须启用全部三个 Profile”的 API 硬编码，只要求 selected refs ready。
- [x] 新增 10674 source fragments、renderer manifest 与生成 migration；更新 acceptance、routing、lease validation、rollout binding 和 Ledger。
- [x] 扩展 PostgreSQL smoke：DIRECT、single/multi TEAM、DEFERRED no runnable work、legacy lease、tamper/mismatch/replay。

## 3. Worker Runtime

- [x] `data-agent-team-runner.ts` 验证 selected refs/dispatch binding，不再要求 exact three selected set。
- [x] `mastra-profile-composition.ts` 区分 enabled catalog validation 与 selected workflow registration。
- [x] `production-team-runtime.ts` 按 selected graph 创建/执行 child；移除 Semantic placeholder 和固定 Report replay/acceptance。
- [x] 增加 DIRECT executor，走现有 Provider dispatch、usage/billing/public answer authority，无 child event。
- [x] router/CLI/effective config revalidation 支持 frozen executor 与 legacy/adaptive 兼容。
- [x] focused tests 覆盖 DIRECT、四种 TEAM 组合、DEFERRED、SHADOW、rollback、crash/replay 和 closure。

## 4. Validation

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker exec vitest run test/teams
pnpm --filter @data-agent/worker typecheck
./infra/supabase/test-support/run-postgres-smoke.sh
pnpm test:contract
```

- [x] 启动 database、Web、Worker、Indexer，真实验证 DIRECT/selective TEAM/DEFERRED。
- [x] 保存脱敏 command/dispatch/lease/events/acceptance evidence，证明未选择 Agent 零 Task/事件。
- [x] 使用 `trellis-check` 做跨层 review，修复 P0/P1/P2；更新 backend executable spec。
- [x] 仅暂存本 child owned paths，创建一个 scoped commit，记录验证与任何 HOLD。

## Validation Evidence — 2026-08-22

- Contracts full unit：73 files / 809 tests PASS；dispatch/profile focused：9/9 PASS；typecheck PASS。
- Platform dispatch planner/authority：5/5 PASS；typecheck PASS。全量 Platform suite 的其余任务通过，但仓库既有 `postgres-semantic-induction.spec.ts` fixture 仍因空 foundational facts 失败，未纳入本 child。
- Agent Runtime full unit：23 files / 153 tests PASS；typecheck PASS。
- Worker team：8 files / 26 tests PASS；Worker unit：10 files / 74 tests PASS；typecheck PASS。
- Web full unit：98 files，353 PASS / 1 skip；admission focused：21/21 PASS；typecheck PASS。
- `pnpm test:contract` 10/10 tasks PASS；Platform public surface PASS；10674 renderer verify 与 SQL static check PASS。
- Fresh PostgreSQL 17 full migration chain、36 authority assertions、48 adaptive assertions PASS；10674 checksum `sha256:65b2f5b06dea3b580c41dce18b28998cd46c40573918d9e86922002b6e714f56`。
- 真实纵向：DIRECT Run `129aa4b9-fcb3-882e-997b-cbe8281b5405`（0 child）；selective TEAM Run `da3967be-67a3-8937-a554-f2b93dd0072b`（仅 Text2SQL）；DEFERRED receipt `18981d44-1600-8339-964a-166b028ba76e`（0 Run / 0 outbox）。脱敏证据见 `evidence/2026-08-22-adaptive-dispatch-vertical.{json,png}`。
- 本 child 无发布阻断。DEFERRED 当前在旧 UI 仍显示通用 409；公开阻断态呈现由后续 Activity/Rich Text child 接管。

## Owned Paths

- `packages/contracts/src/agents/**`、`packages/contracts/src/runs/effective-config.ts` 及 focused tests
- `packages/platform/src/runs/**`、Q&A admission integration 与 focused tests
- `infra/supabase/apps/data-agent/migration-sources/10674/**`、生成 migration、renderer manifest、PostgreSQL test-support
- `apps/worker/src/teams/**`、必要的 run router/CLI seam 与 focused tests
- 两个 Q&A Run admission route 的最小适配及 focused tests

与其他 dirty files 重叠前重新读取；禁止 reset/checkout、禁止纳入 Falcon artifacts、语义知识库任务或生成 tsbuildinfo。
