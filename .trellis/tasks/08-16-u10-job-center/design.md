# U10 Technical Design

## Boundaries

U10 新增独立 `jobs` 领域。Job 可以引用 Run/Artifact/Resource，但不会写入或复用 Run lease/fence 表。PostgreSQL 是状态与调度 Authority；Contracts 负责可签名 wire；Platform 只封装事务/RPC；Worker 只消费持久 Permit；Web 只提交 command 和读取公开投影。

历史的 relationship-index/semantic-authoring 队列保留兼容。新 API 和后续 U11/U14/U15/U16 必须使用 U10 Job Center。

## Contract

### Job kinds

- `SCHEMA_SCAN`
- `RELATIONSHIP_INDEX`
- `ARTIFACT_EXPORT`
- `SEMANTIC_INDUCTION`
- `METRIC_IMPORT`
- `DATALINK_REBUILD`

### States

`QUEUED -> LEASED -> RUNNING -> SUCCEEDED|FAILED|CANCELLED|RETRY_WAIT|DEAD_LETTER`

`QUEUED|RETRY_WAIT|LEASED|RUNNING -> CANCEL_REQUESTED`，Handler 到达可取消点后提交 `CANCELLED`。不可取消 Handler 返回稳定拒绝，不伪造取消。

所有 command/receipt 使用 strict schema、canonical UUID/UTC/hash。Input hash 排除 attempt/fence；execution/lease receipt hash包含 attempt/fence。终态输出只引用 committed Artifact/Receipt，不保存 raw payload、凭据或私有错误。

## PostgreSQL Authority

Ledger `10659` 建议表：

- `job_handler_revisions`
- `jobs`
- `job_attempts`
- `job_events`
- `job_output_receipts`
- `job_worker_heartbeats`
- `capability_readiness_receipts`

所有表 append-only 或受 guard 限制；FORCE RLS；独立 NOLOGIN owner；backend 仅 EXECUTE enqueue/read/command；worker 仅 EXECUTE claim/start/heartbeat/terminal/recover；无 direct DML。

核心 RPC：enqueue、claim、start、heartbeat、succeed、fail、request-cancel、recover-expired、get/list、publish-worker-heartbeat、evaluate-readiness。每次状态变更锁 Job+Attempt 并核对 exact scope/attempt/lease token/fence/handler revision。

## Scheduling and worker runtime

Run loop 与 Job loop 使用独立 queue/lease/abort controller/concurrency。外层 weighted scheduler 以固定配额优先 Run、有限度处理 Job；任一队列 BUSY/ERROR 不永久阻断另一队列。SIGTERM 后停止新 claim，分别 bounded drain，未完成 Job 依赖 lease expiry/recovery。

Handler registry 是启动时固定 manifest。仅可执行 Handler 发布 heartbeat；DB readiness 必须匹配 manifest hash、handler revision、fresh heartbeat、dependency refs 和（需要时）成功 output receipt。

## Concrete handlers

`ARTIFACT_EXPORT` 通过共享的纯导出编译/提交 port 运行；HTTP POST 只 enqueue。`DATALINK_REBUILD` 通过独立 typed port 运行，若仓库当前没有真实 rebuild authority，则 Handler 不注册且 readiness 为 NOT_READY。其余四类先接已有真实 Authority；若尚未迁移，保持明确 NOT_READY，不创建成功占位。

## API and health

- `/api/workspaces/:workspaceId/jobs`：授权 enqueue/list。
- `/api/workspaces/:workspaceId/jobs/:jobId/commands`：授权 cancel/retry command。
- `/api/ready`：未授权只返回 `{live,ready}`；详细模式必须 Workspace/Operations Action，且只返回去敏 capability/status/reason enum。
- Worker `/live` 保持进程活性；`/ready` 分别计算 `run_queue_ready` 与 `job_queue_ready`。

## Compatibility and rollback

Migration 只新增对象，不 ALTER 旧队列表。Artifact Export route 切换由合同测试冻结；若 worker handler 不可用，enqueue/read 可见但 capability NOT_READY，绝不回退 inline。回滚应用代码不会删除 Job Authority，未完成任务可由恢复版本继续处理。

## Security and privacy

Scope 全量绑定 app/tenant/environment/workspace/principal。详细 readiness 不公开 SecretRef、provider body、raw error、input document 或 internal hash。DB 只保存 canonical hashes/refs/stable reasons。不存在 Billing/Credit/Price/Claude/Anthropic/Falcon 路径。
