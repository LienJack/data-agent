# 实施计划

## 1. 管理读模型与 identity 编排

- [x] 定义 admin user/workspace/member/health DTO 与严格命令 input。
- [x] 新增 10633 migration、renderer、RLS/GRANT/postcondition 与 PostgreSQL smoke。
- [x] 实现 platform admin repository 和 Better Auth identity side-effect orchestrator。
- [x] 覆盖超级管理员、工作空间管理员、普通角色、停用会话、幂等与补偿测试。

## 2. API 与全局管理界面

- [x] 增加等价的 `/api/admin/operations/users/**`、`/workspaces/**` 和
  `/api/workspaces/:workspaceId/members/**`。
- [x] 在 `/settings` 增加用户/工作空间控制台，复用现有模型、价格、汇率、积分和账单面板。
- [x] 把成员占位页升级为完整成员列表和角色管理界面。
- [x] 每个独立后端/API/UI任务验证后立即 commit。

## 3. 运营健康与观测

- [x] 增加同步失败、identity side effect、billing review、余额异常和 shadow reconciliation 指标。
- [x] 增加深度脱敏结构化诊断和管理员 health panel。
- [x] 证明普通用户只能看个人积分/账单，不能读取全局 health 和 review queue。

## 4. 自动化与视觉验收

- [x] 增加系统角色 × 工作空间角色矩阵、跨空间直接 URL、归档/恢复、会话失效测试。
- [x] 增加长文本与窄屏静态/组件布局检查。
- [x] production build 通过后只截取一张关键界面截图。

## 5. clean-install 与运维收口

- [x] 运行 clean-install、完整 PostgreSQL smoke、shadow billing 对账和回滚演练。
- [x] 完成数据库备份/恢复演练并验证 migration ledger、账本与身份记录。
- [x] 新增管理员运营 runbook 和 `ENFORCED` Go/No-Go checklist。
- [ ] 运行全量 lint/typecheck/unit/contract，更新父 PRD AC1-AC20 与 Phase 7 状态。

## Validation commands

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
./infra/supabase/test-support/static-check.sh
./infra/supabase/test-support/run-postgres-smoke.sh
git diff --check
```

## 2026-08-15 验收证据与发布边界

- 10633 和 operations assertions 已纳入完整 PostgreSQL smoke；clean install、shadow
  reconciliation、`ENFORCED -> SHADOW` 回滚、备份/恢复演练全部通过。
- 2026-08-15 再次执行 `static-check.sh` 与 `run-postgres-smoke.sh`，两者均通过；实时
  `operations-health@1.0.0` 显示 `SHADOW`、epoch 1，六个 gate 均为 `PASS`、count 0。
- Contracts 29 项、Platform 37 项、Web 管理专项 35 项定向测试通过；根级
  `pnpm test:unit` 15/15 tasks 和 `pnpm test:contract` 10/10 tasks 通过。
- Next.js production build 通过；关键截图：
  `/Users/lienli/.codex/visualizations/2026/08/14/019fff6b-8633-72c1-ac95-e8f739243566/phase7-operations-console.png`。
- 按用户要求，角色和越权以 route/component/PostgreSQL 自动化为权威，浏览器仅保留一张桌面+窄屏截图。
- 最新干净 HEAD 的 Biome 检查为 0 error；最后发布门仍未勾选，因为共享工作区的
  `packages/contracts/src/evals/index.ts` 仍有 2 个未提交 lint error，且未跟踪的
  `packages/evals/test/model-analysis-agent.spec.ts:334` 仍有 1 个 typecheck error。在仓库
  全绿前保持 `SHADOW`，不启用 `ENFORCED`。
- 2026-08-15 继续执行最终门禁：`pnpm test:unit` 15/15 tasks、`pnpm test:contract`
  10/10 tasks、`static-check.sh` 和完整 `run-postgres-smoke.sh` 再次通过；实时六项 health gate
  均为 `PASS`，reconciliation 的 missing/duplicate/review/hold mismatch 均为 0，且
  `ready_for_enforced = true`。共享工作区的上述 2 个 lint error 与 1 个 typecheck error
  仍原样存在，因此 AC7 保持未勾选。
- 对提交 `930a9eb` 的 detached clean worktree 复核显示 `pnpm lint` 通过，但 `pnpm typecheck`
  仍因已提交 Web 调用方依赖尚未提交的 Test Center、Semantic Candidate 与 UI 组件而失败；
  因此当前分支的发布工件本身也尚不能独立构建，不能把门禁失败仅视为脏工作树噪声。
- 临时集成 worktree 复刻全部 119 项共享改动后，仅恢复
  `packages/contracts/src/evals/index.ts` 的 Biome 格式/导出顺序，并从 SQL reflection 测试的
  `BenchmarkSqlAgentInvocationContext` 删除不受支持的 `attempt_index`，即可通过 lint、
  typecheck、unit 15/15 tasks 与 contract 10/10 tasks。该验证未修改源工作树，证明最终阻断
  已缩小为两个并行任务应随自身原子提交带入的机械修复。
