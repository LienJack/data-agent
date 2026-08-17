# 统一 Job Center

> U10 建立的 PostgreSQL 后台任务权威，适用于后续新增的异步能力。

## 边界

- Job 与交互式 Run 使用不同表、状态机、Attempt、Lease、Fence 和终态 Receipt；禁止把
  Job 塞入 Run Outbox，或把 Run Lease 当作 Job 执行权限。
- 固定 kind 为 `SCHEMA_SCAN`、`RELATIONSHIP_INDEX`、`ARTIFACT_EXPORT`、
  `SEMANTIC_INDUCTION`、`METRIC_IMPORT`、`DATALINK_REBUILD`、`FILE_SCAN`、
  `KNOWLEDGE_INDEX`。新增 kind 必须先更新
  Contract、10659 后继 migration、Handler、readiness 与测试。
- `FILE_SCAN` 属 U6 后续能力；未交付 Handler 时不得注册空实现或发布 READY。
- 后继 migration 新增 Job Kind 时，必须同步提升 heartbeat/claim 的 handler 闭集上限；SQL 上限与
  Contracts `JOB_KINDS.length` 不一致会使完整 Worker Manifest 在数据库边界被错误拒绝。

## Authority

- PostgreSQL 签发 Job ID、Attempt、Lease Token、Fence、时间、终态与 Capability
  Readiness。调用方只提交 strict command 和 committed Artifact References。
- 幂等作用域固定为 `app_id + tenant_id + environment + principal_id + idempotency_key`。
  同键同规范输入回放，同键异输入稳定冲突。
- 输入与输出 Artifact References 必须属于同 Scope、指向 active committed revision，且按
  完整 reference identity 严格递增；重复、乱序、未提交或跨 Scope 都在 SQL 内失败关闭。
- Worker 先发布 exact Handler manifest heartbeat，随后才可 claim。每次 start、heartbeat、
  terminal、cancel acknowledgement 都复核完整 Lease JSON、Attempt、Worker、Token、Fence、
  Handler Revision 与数据库时间。
- readiness 同时要求 Handler Revision 可执行、Worker heartbeat fresh、依赖 READY，以及
  该能力声明需要时存在成功 output receipt。Route 存在或队列可写不能等同 READY。

## Runtime 与 API

- Run loop 与 Job loop 同宿主但独立轮询、Lease、health 和停止信号；任一队列失败不终止或
  饿死另一队列。`/live` 分别报告 `run_queue_ready` 与 `job_queue_ready`。
- Web Job Center 只读取 Contracts 已解析的 `JobRecord`。Artifact Export POST 只 enqueue，
  bytes 只从 committed `ArtifactExportReceipt` 的 GET 路径读取。
- 公共 `/api/ready` 只返回 `{live,ready}`。只有 workspace authorization 成功时才返回去掉
  receipt hash、内部错误和依赖细节的 capability/status/reason/time 投影。
- 当前 `ARTIFACT_EXPORT`、`FILE_SCAN` 与 `KNOWLEDGE_INDEX` 注册真实 Handler；其余 kind明确 NOT_READY，直到各自单元提供
  真实依赖与输出闭环。
- `FILE_SCAN` 的确定性本地 Policy Block 必须携带同一字节的 Scanner Evidence 后提交领域 Receipt；
  只有 Scanner 不可用、超时、签名过期或未知协议结果才保持 `QUARANTINED` 并走可重试失败。

## 必需门禁

- Contracts happy/tamper/state transition tests；Platform fake-pool bad hash/marker tests；
  Worker lifecycle/crash/health tests；Web auth/enqueue/cancel/readiness tests。
- 10659 renderer/static checks，以及 fresh PostgreSQL 17 上的 37 号 assertions；fresh 验证时
  ecommerce/Falcon import hook 必须挂 `/dev/null`。
- 中间单元不得运行 Falcon、导入数据或调用真实 Provider。Falcon 只在 U1–U20 全部完成后
  作为最终验收门禁。
