# U10 Implementation Plan

## 1. Contracts first

- [x] 新增 `packages/contracts/src/jobs/runtime.ts` 和 barrel export。
- [x] 冻结六类 kind、状态机、commands、attempt lease/fence、events、output receipt、handler manifest、heartbeat、readiness projection。
- [x] 添加 canonical hash/build/verify/tamper/state-transition tests。

## 2. PostgreSQL 10659

- [x] 建立 source fragments、renderer、rendered migration、ledger/postconditions。
- [x] 建立七类 Authority 表、guard、FORCE RLS、NOLOGIN owner、窄 grants。
- [x] 实现 enqueue/claim/start/heartbeat/terminal/cancel/recover/read/list/readiness RPC。
- [x] 新增 `37-job-center-authority-assertions.sql`，覆盖幂等、stale fence、租约恢复、取消、输出/ref、readiness、RLS/grants。

## 3. Platform adapter

- [x] 新增 `packages/platform/src/jobs/postgres-job-queue.ts` 和 export。
- [x] 所有结果走 Contracts verifier；稳定 DB marker 映射；事务 scope/fence correlation。
- [x] fake-pool tests 覆盖坏 hash、wrong scope/attempt/fence、replay/conflict、readiness redaction。

## 4. Worker runtime

- [x] 新增 handler registry、`job-worker-runner.ts` 与 Artifact Export typed handler；DataLink Rebuild 因尚无真实闭环保持未注册/NOT_READY。
- [x] 以两个独立并发 loop 提供等权调度机会，并分别维护 lease/drain/health，避免 Job 阻塞 Run。
- [x] CLI/daemon/package/local runtime 接线；缺 Handler/依赖 fail closed；现有 compose 复用同一 Worker 入口，无需新增服务。
- [x] 测试 generic lifecycle、retry/cancel/stale/takeover、独立 loop 故障隔离与 bounded shutdown。

## 5. Web APIs and concrete migration

- [x] 新增 jobs list/enqueue、commands、authorized readiness routes。
- [x] Artifact Export POST 改 enqueue-only；GET 继续读取 committed export receipt。
- [x] 只迁移真实可执行 handler；无法执行者以 NOT_READY 暴露，不制造占位 output。
- [x] API tests 覆盖 auth/action/scope、idempotency、cancel、minimal public readiness、no inline export。

## 6. Runtime and documentation

- [x] 更新 Worker health 与 runbook，分别报告 Run queue 与 Job queue；复用既有 compose Worker 进程。
- [x] 禁止新增旁路异步状态机；记录旧队列兼容边界与后续 U11/U14/U15/U16 接入方式。

## 7. Verification

- [x] focused/full tests、typecheck/build、Biome、diff-check。
- [x] renderer verify、SQL static-check、fresh PostgreSQL 17 + assertion 37；import hooks `/dev/null`。
- [x] forbidden scans：Falcon/import/provider call/Billing/Credit/Price/Claude/Anthropic、新旁路队列。
- [x] 使用 `trellis-check` 修复全部 U10 P0/P1。
- [x] 更新 Trellis evidence/spec（仅有持久新约定时），精确 stage owned paths，创建单一 scoped commit。

## Rollback points

1. Contracts/SQL 未闭合前不接 HTTP Route。
2. Handler 未可执行前不发布 READY。
3. Artifact Export 切换后若失败，保留 Job 记录并修复 Worker，不回退 inline。
4. fresh PG/static gates 未通过不得提交。
