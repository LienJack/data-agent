# 自适应 Agent 调度实施计划

## 1. Baseline And Contracts

- [ ] 记录 dirty worktree 并隔离其他任务文件；运行 current Contracts/Worker focused baseline。
- [ ] 新增 `packages/contracts/src/agents/dispatch.ts` 与 exports，完成 plan/admission/binding build+verify、canonical hash 和 bad cases。
- [ ] 版本化扩展 Effective Config lease payload；legacy exact-three decoder 规范化为 LEGACY_FIXED，新 writer 只写 adaptive binding。
- [ ] 更新 contract tests：DIRECT、selected subset、dependency graph、DEFERRED、tamper、legacy read。

## 2. Admission And PostgreSQL Authority

- [ ] 在 Platform 实现 deterministic classifier/eligibility/planner，复用统一 decoder，禁止 Web/Worker local casts。
- [ ] Q&A 与兼容 Run route 在 resolve/accept 前使用同一 planner；去除“必须启用全部三个 Profile”的 API 硬编码，只要求 selected refs ready。
- [ ] 新增 10674 source fragments、renderer manifest 与生成 migration；更新 acceptance、routing、lease validation、rollout binding 和 Ledger。
- [ ] 扩展 PostgreSQL smoke：DIRECT、single/multi TEAM、DEFERRED no runnable work、legacy lease、tamper/mismatch/replay。

## 3. Worker Runtime

- [ ] `data-agent-team-runner.ts` 验证 selected refs/dispatch binding，不再要求 exact three selected set。
- [ ] `mastra-profile-composition.ts` 区分 enabled catalog validation 与 selected workflow registration。
- [ ] `production-team-runtime.ts` 按 selected graph 创建/执行 child；移除 Semantic placeholder 和固定 Report replay/acceptance。
- [ ] 增加 DIRECT executor，走现有 Provider dispatch、usage/billing/public answer authority，无 child event。
- [ ] router/CLI/effective config revalidation 支持 frozen executor 与 legacy/adaptive 兼容。
- [ ] focused tests 覆盖 DIRECT、四种 TEAM 组合、DEFERRED、SHADOW、rollback、crash/replay 和 closure。

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

- [ ] 启动 database、Web、Worker、Indexer，真实验证 DIRECT/selective TEAM/DEFERRED。
- [ ] 保存脱敏 command/dispatch/lease/events/acceptance evidence，证明未选择 Agent 零 Task/事件。
- [ ] 使用 `trellis-check` 做跨层 review，修复 P0/P1/P2；更新 backend executable spec。
- [ ] 仅暂存本 child owned paths，创建一个 scoped commit，记录验证与任何 HOLD。

## Owned Paths

- `packages/contracts/src/agents/**`、`packages/contracts/src/runs/effective-config.ts` 及 focused tests
- `packages/platform/src/runs/**`、Q&A admission integration 与 focused tests
- `infra/supabase/apps/data-agent/migration-sources/10674/**`、生成 migration、renderer manifest、PostgreSQL test-support
- `apps/worker/src/teams/**`、必要的 run router/CLI seam 与 focused tests
- 两个 Q&A Run admission route 的最小适配及 focused tests

与其他 dirty files 重叠前重新读取；禁止 reset/checkout、禁止纳入 Falcon artifacts、语义知识库任务或生成 tsbuildinfo。
