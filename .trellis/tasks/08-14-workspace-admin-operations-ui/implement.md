# 实施计划

## 1. 管理读模型与 identity 编排

- [ ] 定义 admin user/workspace/member/health DTO 与严格命令 input。
- [ ] 新增 10633 migration、renderer、RLS/GRANT/postcondition 与 PostgreSQL smoke。
- [ ] 实现 platform admin repository 和 Better Auth identity side-effect orchestrator。
- [ ] 覆盖超级管理员、工作空间管理员、普通角色、停用会话、幂等与补偿测试。

## 2. API 与全局管理界面

- [ ] 增加 `/api/admin/identity/**` 和 `/api/workspaces/:workspaceId/members/**`。
- [ ] 在 `/settings` 增加用户/工作空间控制台，复用现有模型、价格、汇率、积分和账单面板。
- [ ] 把成员占位页升级为完整成员列表和角色管理界面。
- [ ] 每个独立后端/API/UI任务验证后立即 commit。

## 3. 运营健康与观测

- [ ] 增加同步失败、identity side effect、billing review、余额异常和 shadow reconciliation 指标。
- [ ] 增加深度脱敏结构化诊断和管理员 health panel。
- [ ] 证明普通用户只能看个人积分/账单，不能读取全局 health 和 review queue。

## 4. 自动化与视觉验收

- [ ] 增加系统角色 × 工作空间角色矩阵、跨空间直接 URL、归档/恢复、会话失效测试。
- [ ] 增加长文本与窄屏静态/组件布局检查。
- [ ] production build 通过后只截取一张关键界面截图。

## 5. clean-install 与运维收口

- [ ] 运行 clean-install、完整 PostgreSQL smoke、shadow billing 对账和回滚演练。
- [ ] 完成数据库备份/恢复演练并验证 migration ledger、账本与身份记录。
- [ ] 新增管理员运营 runbook 和 `ENFORCED` Go/No-Go checklist。
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
