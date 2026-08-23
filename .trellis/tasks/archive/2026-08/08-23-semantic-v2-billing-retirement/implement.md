# 实施清单

## 执行顺序

- [x] U1 `08-23-u1-boundary-guards`：护栏、surface ledger、migration inventory。
- [x] U2 `08-23-u2-model-control`：提取 Model Control 并切换所有消费者。
- [x] U3 `08-23-u3-remove-monetary-gates`：删除金额 readiness 与 `UNBILLABLE`。
- [x] U4 `08-23-u4-retire-billing-code`：删除计费合同、代码、Route、Worker 和 UI。
- [x] U5 `08-23-u5-billing-db-retirement`：`10703` 与账务只读归档验证。
- [x] U6 `08-23-u6-semantic-v2-only`：V2 runtime content/compiler、Ports、`10704`。
- [x] U7 `08-23-u7-semantic-application-runtime`：用例下沉、Adapter 拆分、唯一 composition。
- [x] U8 `08-23-u8-semantic-ui-cleanup`：UI controller/panel、删除 legacy routes/stores/redirects。

## 每单元门禁

1. 启动对应子任务，读取 PRD/design/implement 与适用 Trellis specs。
2. 先补 characterization 或失败测试，再修改行为。
3. 运行 focused unit/contract/integration；跨 package 类型变化先 build 依赖包。
4. 执行 `git diff --check`，只暂存该子任务文件，创建 scoped commit。
5. 运行 Trellis check，更新适用 spec，归档子任务后进入依赖单元。

## 最终验证

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] 相关 package unit/contract/integration 全量测试（显式排除 `**/.next/**`）
- [x] `pnpm --filter @data-agent/web build`（由 `pnpm verify:release` 强制执行）
- [x] `infra/supabase/test-support/static-check.sh`
- [x] `infra/supabase/test-support/run-postgres-smoke.sh`
- [x] forbidden scans：Semantic Source Bundle V1/V2→V1、商业 Billing/Pricing/Credit/FX/Settlement、旧
  route/runtime compatibility 均为 0
- [x] R1–R16 证据矩阵、代码审查与计划 `status: completed`

## 硬阻塞

- Migration preflight 无法证明目标是本绿地 app/environment 时不得执行破坏性 V1 cleanup。
- 任何目标主路径测试失败、Authority/RBAC 退化或未知用户文件与任务文件冲突时不得提交。
