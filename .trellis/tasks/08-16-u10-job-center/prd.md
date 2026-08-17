# U10 统一 Job Center 与 Capability Readiness

## Goal

为 Schema Scan、Relationship Index、Artifact Export、Semantic Induction、Metric Import、DataLink Rebuild 建立统一、持久、可恢复的 Job Center，并以真实 Handler/Worker/依赖/输出 Receipt 生成受权限约束的 Capability Readiness。

## Requirements

1. Job 与交互式 Run 分表、分合同、分 Lease/Fence，不复用状态或终态语义。
2. 六种核心 Job Kind 使用同一严格合同：固定 Authority Scope、Input Hash、Idempotency Key、Attempt、Lease/Fence、取消策略、稳定错误码和输出 Receipt。
3. DB 是 Job 状态、ID、Attempt、Fence、时间、幂等与终态唯一 Authority；调用方不得自报成功、Fence 或 Readiness。
4. 重复提交同一 scope/kind/idempotency/input 必须回放；同 key 不同 input 必须稳定冲突。
5. stale lease/fence、过期 attempt、重复终态、无效取消和未注册 Handler 必须 fail closed。
6. Worker 同宿主运行 Run 与 Job 两个独立 loop，并以加权调度、独立并发/lease/drain 防止批量 Job 饿死 Run。
7. Artifact Export Route 只提交 `ARTIFACT_EXPORT` Job，不再同步导出；DataLink Rebuild 使用独立 Handler。只有输出 Artifact/Receipt 提交后相关能力才能 READY。
8. Capability Readiness 必须同时证明固定能力定义、可执行 Handler Revision、fresh Worker Heartbeat、依赖证据和必要 Output Receipt；Route/端口存在不能等同 READY。
9. 容器公开 health 只暴露最小 live/ready；详细 `/api/ready` 必须登录、通过 Workspace/Operations Action，并按 scope 裁剪，不泄露 SecretRef、内部错误、Hash 或 Receipt。
10. 新增 A/M 异步入口必须进入 Job Center。保留既有历史队列用于兼容，但不得创建新的旁路状态机或把未迁移能力伪装 READY。
11. U6 的 FILE_SCAN 属后续单元，本单元不得注册空 Handler 或假 READY。
12. 全程不运行 Falcon、不导入数据、不调用真实 Provider、不引入 Billing/Credit/Price，也不使用 Claude/Anthropic。

## Acceptance Criteria

- [x] 六类 Job 的 strict schema、canonical hash、state machine、command/result/receipt verifier 和 tamper tests 完整。
- [x] 10659 greenfield migration 提供 Job/Attempt/Event/Output/Heartbeat/Handler/Readiness Authority，FORCE RLS、NOLOGIN owner、窄 RPC、无 backend/job direct DML。
- [x] enqueue/claim/start/heartbeat/complete/fail/retry/cancel/recover/read/list RPC 的幂等、stale fence、租约过期和不可取消分支有机械测试。
- [x] Platform queue adapter 对所有 DB 回执进行 schema/hash/scope/attempt/fence 复核并映射稳定错误。
- [x] Worker Job runner 对六类 kind 使用同一生命周期合同；仅注册真实 Artifact Export Handler，其余 fail closed/NOT_READY，并支持受控重试、取消、输出 Receipt、bounded shutdown；独立 Run/Job loop 无相互饥饿。
- [x] Artifact Export HTTP POST 只 enqueue；刷新、重试、取消都从 Job Authority 读取，不退回 inline execution。
- [x] DataLink Rebuild Handler 只有真实依赖/输出闭环时才注册 READY；当前无实现时明确 NOT_READY，而非占位成功。
- [x] `/api/ready` 未授权仅返回最小结果；授权诊断能按 workspace/action 返回去敏 Capability 状态。
- [x] Worker health 分别报告 run queue 与 job queue，既有 compose/local runtime 可独立判定 Job Center。
- [x] 相关 Contracts/Platform/Worker/Web tests、typecheck/build、Biome、SQL renderer/static/fresh PG assertions、diff/forbidden scans全绿。
- [x] Trellis check 无剩余 P0/P1；只提交 U10 owned paths 的单一 scoped commit。

## Non-goals

- 不在 U10 实现 U11 的归纳算法、U14 的 Metric 业务逻辑、U6 的 FILE_SCAN 内容处理。
- 不回填或删除 10625 等历史专用队列；只冻结兼容边界和新入口策略。
- 不以 Falcon 作为中间单元测试；Falcon 仅在 U1–U20 全部完成后的最终门禁运行。
