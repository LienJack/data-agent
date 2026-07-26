# 数据库与共享 Supabase 规范

> 本文记录 U2/U4 已实现并由 PostgreSQL 17 烟测覆盖的约定。

## 权威边界

- PostgreSQL 是 Run、Command、Artifact Revision、Event、Outbox、Eval、Audit、
  App Lifecycle、Membership、SecretRef Metadata 与 Operation Receipt 的唯一权威。
- Upstash Redis 只保存可丢弃的 Projection/Cache；任何发布、权限、幂等或恢复判断都不能
  依赖 Redis。
- 对象存储只保存内容寻址对象；可见性、Active Revision 与生命周期仍由 PostgreSQL
  决定。
- 生产请求必须由 `createPostgresCapabilityAuthority` 从服务端选定的
  `deployment_id + tenant_id + verified principal_id` 解析权限。客户端提供的
  App/Tenant/Role Header 或 JWT Custom Claim 不能成为权威。

## Schema 与命名

共享一个 Supabase Project 时使用三层命名：

| 层 | 示例 | 约束 |
| --- | --- | --- |
| Platform | `platform.apps`、`platform.app_environment_lifecycle`、`platform.deployment_mappings` | 只保存跨 App/Environment 控制面数据 |
| App Private | `app_data_agent.runs` | 业务表不可暴露到浏览器 |
| Public API | `api.data_agent__get_run` | 必须带 App 前缀，防止多个 App 同名操作冲突 |

所有业务对象键都必须显式包含：

```text
app_id + tenant_id + environment + object_id
```

按用户拥有或命名的对象/命名空间还必须包含 `principal_id`。例如幂等键的完整作用域是
`app_id + tenant_id + environment + principal_id + idempotency_key`，不能让同租户用户
互相碰撞、探测或重放。

禁止只靠 Schema、Bucket、连接池或 RLS 中任意单层实现隔离。

## 服务端事务

`withAppTransaction` 的固定顺序是：

1. 拒绝普通内存 `CapabilityAuthorizer`；生产入口只接受可在同一 SQL 事务内复核的
   `TransactionalCapabilityAuthorizer`。
2. 用绑定的 Authority 做本地 issuer/role preflight。
3. 从 Pool checkout 一个 client 并 `BEGIN`。
4. 在同一 client 内调用 `platform.revalidate_backend_authority`，校验
   Membership Version、App/Environment Authority Epoch 与 Lifecycle。
5. `SET LOCAL search_path TO app_data_agent, pg_catalog`。
6. 参数化设置 `data_agent.app_id`、`tenant_id`、`environment`、
   `principal_id`、`role`、`deployment_id`。
7. 按本次事务的 `READ/WRITE` 传递 `require_write`，再调用
   `platform.backend_context_matches` 确认 RLS 看到相同 Scope。不能按角色推断读写，
   否则会误伤冻结后的只读导出。
8. 执行业务 SQL，成功 `COMMIT`；任意失败 `ROLLBACK`；最后必定 release。

业务 SQL 即使运行在高权限测试连接上，也必须包含显式
`app_id + tenant_id + environment` 谓词；不得把 RLS 当成省略 Scope Predicate
的理由。

## 幂等命令与 Outbox

首个 Run Command 使用同一事务完成：

```text
principal-scoped advisory idempotency lock
  -> app/tenant/environment/run-scoped advisory lock
  -> existing binding check
  -> run
  -> command
  -> idempotency record
  -> initial event
  -> outbox
  -> audit
```

先写 Command 再写 Idempotency Record，避免 Idempotency 的 SELECT RLS 在
`RETURNING` 阶段找不到关联 Command。任何一步失败，整个事务回滚。
同一 Scope 下对同一 `run_id` 的并发首写必须先取得 Run 级事务 Advisory Lock；胜者提交
后，败者稳定返回非重试的 `DA_RUN_ALREADY_EXISTS`，不能泄漏原生 `23505`，也不能留下
Command、Idempotency、Event、Outbox 或 Audit 的半成品。
Browser API 与 Backend Repository 必须构造完全相同的
`data-agent:run:<app_id>:<tenant_id>:<environment>:<run_id>` 锁键，不能只在单一入口
内部防重。
`payload_hash` 统一调用 `platform.canonical_sha256(jsonb)` 计算；Command 表以
Canonical CHECK 拒绝调用方提供的分歧 Hash，Idempotency Record 通过复合外键绑定同一
Requester、Command 与 Hash。
Command Payload 只接受与 TypeScript 相同的严格字段集合：
`kind/mode/question_version/dataset_id/secret_refs`；未知字段、非规范 SecretRef、
非 Canonical Hash 均在数据库边界失败关闭。
首个 Run Command 的 `kind` 只能是 `START_L2_RESEARCH`；`RESUME_RUN` 仅允许由
`request_run_control` 的 Resume 状态迁移生成，不能经 Browser 或 Repository 初始接收
入口伪造。

U4 已把 Transactional Outbox 收敛为 Durable Run Queue。旧
`claim_outbox`、`publish_outbox`、`retry_outbox` 与 `advance_run_fence`
会绕过 Attempt、Projection 和 Fence 生命周期，因此必须对全部应用角色撤权，也不得再
导出对应 TypeScript Adapter。

Run 的身份、Question、Status、Fence 与时间线不可直接 UPDATE。Worker 只能通过 U4
Runtime 窄函数推进；Artifact/Certification 需要锁定本人 Run 时，只能调用完整
App/Tenant/Environment/Principal 绑定的 `lock_owned_run_fence(run_id)`。

## 持久 Run 运行时

U4 继续复用 Transactional Outbox 作为首版 PostgreSQL Run Queue，不引入第二套消息
权威。`run_attempts`、`run_projections`、`run_checkpoints` 与
`run_effect_receipts` 都显式带完整 App Scope 和 Run ID。

固定规则：

- 新 Run 的首条 Outbox 固定 `queue_sequence=1`，同时令
  `runs.next_queue_sequence=2`。已有 Run 的所有入队入口必须先
  `SELECT ... FOR UPDATE` 锁定完整 Scope 的 `runs` 行，再在同一事务把旧
  `next_queue_sequence` 写入 Outbox 并只递增一次 Counter。唯一键固定为
  `(app_id, tenant_id, environment, run_id, queue_sequence)`；
  `queue_sequence` 不得有 Identity/Sequence Default，Backend 也不得直接 UPDATE
  Counter 或 INSERT Outbox。
- Claim 使用 `FOR UPDATE SKIP LOCKED`，在同一事务内创建 Attempt、提升 Lease Token
  与 `runs.active_fence`；同一 Run 同时最多一个活动 Attempt。已过期且耗尽第 5 次投递
  预算的 Head 使用独立清理预算收敛为 Dead Letter，不能占用
  `requested_limit` 的正常领取名额，也不能在持续繁忙流量下永久饥饿。
- Claim、Heartbeat、Event Append、Checkpoint、Effect Receipt 等 Worker 数据面入口
  必须精确匹配 `runs.principal_id = current principal_id`。Owner 的同租户跨 Principal
  权限只属于 Cancel/Resume 等控制面，不得成为领取或提交他人 Run 的数据面旁路。
- `run.accepted.occurred_at` 可保留规范化调用时间，但 Run、Command、Idempotency、
  Outbox 与 Audit 的接收元数据必须统一使用 PostgreSQL 签发的 `accept_at`，且 Outbox
  `available_at=accept_at`。未来 Event 时间不能延迟已接收任务的领取。
- Worker 可能在 Claim 后、提交 `run.leased` 前崩溃，因此投影的 `attempt_count`
  必须采用权威 Event Payload 中的 Attempt 编号；不得假设每个 Attempt 都已经投影，
  也不得用 Projection 当前值加一。
- Heartbeat、Event Append、Checkpoint 与 Side Effect Commit 必须先按统一顺序锁定
  Run、Outbox、Attempt 等身份行，再取 `clock_timestamp()` 检查 Outbox 与 Attempt
  Lease；不得使用等待行锁之前缓存的时间放行已经过期的写入。Heartbeat 时间必须相对
  两张 Lease 行严格单调，交错调用不能倒退或把另一次合法续租误判为过期。
- Complete、Retry 也必须同时匹配 Outbox、Attempt、Worker、Lease Token、Fence 与当前
  Principal。
- Claim 必须把 `lease_duration_ms` 随 Lease 返回；Runner 在 `run.leased` 后立即续租，
  后续 Heartbeat 间隔不得大于 Lease Duration 的三分之一。
- Retry Delay 不得小于 1 秒；Lease 必须区分 Run 全局单调 `attempt_no` 与当前 Outbox
  的 `delivery_attempt_no`。单个 Outbox 最多自动交付 5 次，显式 Resume 创建新 Outbox
  并重置交付预算。预算耗尽时必须在同一事务追加 `run.failed`，并把 Projection、Run、
  Command 和 Outbox 分别结算为 `FAILED / FAILED / FAILED / DEAD_LETTER`，禁止同一
  Outbox 自动签发第 6 次交付。
- Run Event 是追加事实；Projection 只能随相同事务中的连续 Event 前进。Event、
  Projection 与 Snapshot 都保存 Canonical SHA-256，重放结果必须与 Live Projection
  一致。
- Cancel 原子追加 `run.cancel_requested` 并提升 Fence；数据库拒绝旧 Worker 的迟到
  Receipt、Checkpoint、Artifact 和 Completion。
- `lock_owned_run_fence` 只在本人 Run 与最新 Projection 都是 `RUNNING`、Fence 一致、
  同 Fence Attempt 为 `ACTIVE`、Outbox 为 `LEASED`，且两张 Lease 均未过期时返回
  Fence。Retry、Suspend、Terminal、尚未投影 `run.leased` 与过期 Lease 一律返回空；
  Artifact 与 Model Certification 不得只凭 `runs.active_fence` 提交。
- Resume 只允许从 `WAITING` 进入 `QUEUED`，创建独立 `RESUME_RUN` Command/Outbox，
  新 Attempt 使用更高 Fence。
- Mastra Snapshot 固定标记 `EXECUTION_SNAPSHOT_ONLY`，并绑定 Workflow Definition
  Revision、Mastra Core Version、Attempt、Event Sequence、Fence 与 Active Artifact；
  它不能替代 Event/Artifact Authority。持久 Snapshot 的 Hash 只能由 PostgreSQL
  `commit_run_checkpoint` 对无 Hash 正文计算并返回；Worker 必须原样传播该 Hash，
  不能用 TypeScript `JSON.stringify` 结果复算或覆盖。读取时同时核对 Binding、持久列与
  PostgreSQL 重算值。
- `run.checkpointed` 只能激活与“追加该事件前的当前 Projection Version”完全相同的
  Snapshot，Event 的 `active_artifact_ref` 还必须与 Snapshot Binding 精确一致；
  任一不匹配都返回 `DA_RUN_EVENT_TRANSITION_INVALID`，不得激活过期 Snapshot 或换绑
  Artifact。
- SQL/Eval Receipt 的内容键是 `run_id + effect_kind + input_hash`。Receipt 已提交而
  Event 中断时，后继 Attempt 重用 Receipt，并通过完整 Scope、Run 与 Event Dedupe Key
  的唯一索引精确判断是否需要补 Event；禁止在每次 Side Effect 上扫描整个 Event 历史。
  外部调用完成但 Receipt 未提交的窗口仍要求目标操作只读或幂等。
- Worker 已读取的 `RunProjectionRecord` 可以作为 Append 的 Compare-and-Swap 输入，
  Adapter 必须先校验其 Scope、Run 与 Content Hash；PostgreSQL 仍在同一事务内锁定并
  复算权威 Projection，不能省略数据库状态机校验。
- Redis/Upstash 只可作为唤醒和缓存；SSE 断线恢复游标必须使用 PostgreSQL Event
  Sequence/Projection Version，并按有界批次补洞，不能一次物化无界 Run 历史。

所有 Runtime 写入都通过窄函数完成：

- `app_data_agent.accept_backend_run_command`
- `app_data_agent.claim_run_work`
- `app_data_agent.heartbeat_run_work`
- `app_data_agent.complete_run_work`
- `app_data_agent.retry_run_work`
- `app_data_agent.append_run_event`
- `app_data_agent.commit_run_checkpoint`
- `app_data_agent.commit_run_effect_receipt`
- `app_data_agent.request_run_control`
- `app_data_agent.lock_owned_run_fence`

详细状态机、恢复流程和诊断查询见
`docs/runbooks/durable-run-runtime.md`。

## Migration

- Platform Migration 位于 `infra/supabase/platform/migrations/`。
- App Migration 位于 `infra/supabase/apps/data-agent/migrations/`。
- 每个 Migration 必须登记固定 SHA-256 Checksum；同名不同内容失败关闭。
- Platform 与每个 App 使用独立 Advisory Lock，禁止全 Project 共用一个粗锁。
- Migration 中所有 `SECURITY DEFINER` 函数必须 `set search_path = ''`，并使用
  schema-qualified object name。
- 禁止 `GRANT ALL`；授权必须精确到 schema、table、view 或 function signature。

## Storage、Cache 与 Secret

- Storage Key：
  `<app_id>/<tenant_id>/<environment>/<owner_principal_id>/<run_id>/<kind>/sha256-<64hex>`；
  SQL Policy 必须同时验证 Run 与 Principal Object Authority，不能让同 Tenant 的 Viewer
  读取另一个 Principal 的 Artifact。
- Redis Key：
  `da:<app_id>:<tenant_id>:<environment>:<kind>:<identifier>`。
- 包根只导出带 Scope 的 Upstash Factory，不导出 Raw Adapter。
- SecretRef 是数据库中的非授权 locator；每次操作仍需 PostgreSQL Capability。
- Question、Command、Event、Outbox、Artifact、Eval、Audit 等持久化 JSON/Text
  边界都必须递归拒绝疑似明文 Credential。`secret_refs` 只能包含规范 locator；
  `snapshot_token`/`fencing_token` 可保存非凭据值，但仍拒绝明显 Secret 形态。
- Rotate/Revoke 是两阶段流程：先进入 Pending，只有
  `data_agent_secret_authority` 写入 Provider Effect Receipt 后才能继续。当前没有外部
  验签器，`SUCCEEDED` 必须失败关闭；精确匹配当前 Request/Version/Operation 的
  `FAILED` Receipt 可由 Owner 显式确认并恢复 `ACTIVE` 重试，但不能推进 Version 或
  Provider Ref Hash。没有 Receipt 时必须保持 Pending/HOLD，不能伪造成功。
- Datasource Egress Policy 与短时 Approval 持久化在
  `datasource_egress_policies` / `datasource_egress_approvals`。流程固定为
  `PINNED -> VERIFIED -> CONSUMED`，连接前必须再次解析 DNS，地址集合完全一致，
  Approval 与 Target 都未过期且只能消费一次。URL 只允许无 Userinfo/Query/Fragment
  的 Origin Root `/`；数据库重新解析并核对 Protocol/Host/Port，不能相信 TypeScript
  拆分出的旁路字段。Verify/Consume 同时锁定 Approval 与 Policy，因此并发撤销必须在
  连接消费前生效。数据库再次拒绝 Loopback、Private、Link-Local、
  Metadata、Documentation、IPv4-Mapped 与常见 IPv6 Transition Range，不能只信
  TypeScript preflight。
- U2 只交付持久 Policy、DNS Pinning 与一次性消费权威；真实 PostgreSQL/HTTP Socket
  Adapter 在 U5/U9 交付。没有验证“固定 IP 拨号 + Host/SNI + 禁止 Redirect/Peer
  Mismatch”前，不得宣称网络闭环已完成。

## App Lifecycle

生命周期权威的 Scope 是 `(app_id, environment)`，不是 App 全局状态。冻结或删除
`test` 必须保持同一 App 的 `prod` 为独立 `ACTIVE`/Epoch。Transition、Manifest、
Operation Receipt、Authority Revalidation 都必须绑定同一 Environment。
写授权事务持有 `(app_id, environment)` 生命周期共享 Advisory Lock，生命周期迁移持有
同一键的排他 Lock；迁移必须等待在途写事务结束，等待后再重新检查 State/Epoch，避免
“读到 ACTIVE 后与 FREEZE 并发提交”的竞态。

删除流程不是单次 `DELETE`：

```text
ACTIVE -> FROZEN -> EXPORT_PENDING -> FROZEN -> DELETE_PENDING -> DELETED
```

Job Authority 只能通过窄函数记录 Resource Manifest 与 Operation Receipt。
进入终态前必须证明 Database、Storage、Redis residual count 全部为零。Restore 必须
引用同 App/Environment 的 Export/Backup Receipt；普通被冻结的用户 Capability 不得
冒充 Cleanup Job Capability。当前没有外部验签器，`EXPORT_COMPLETED`、
`DELETE_CONFIRMED` 与 `RESTORE` 都失败关闭。`EXPORT_CANCELLED` 可回到 `FROZEN`；
删除可能已执行破坏性操作，不得用无可信恢复证据的 `DELETE_CANCELLED` 逃离 HOLD。

## 禁止模式

- 从请求 Header 直接构造 `AppCapability`。
- 在多个 SQL client 之间拆分同一业务事务。
- 动态拼接 `search_path`、table name 或 Scope 值。
- 先写 Idempotency Record、后写其 RLS 依赖的 Command。
- 向 Backend Role 授予 Platform Owner、Secret Authority 或 Job Authority。
- 把 SecretRef JS 对象身份、进程内 Map、Redis 命中或 Storage Prefix 当成授权。
- 在 Release Gate 中让不存在的 Integration 目录静默通过。

## 验证

```bash
infra/supabase/test-support/static-check.sh
infra/supabase/test-support/run-postgres-smoke.sh
scripts/test-platform-integration.sh
pnpm test:tenancy
pnpm test:security
```

前两个命令验证迁移、Grant/RLS、双 App×双 Tenant、Storage Policy、Migration
Lock、Secret/Lifecycle Receipt；Integration Harness 使用非超级 Backend Role 运行真实
Repository 与 Outbox，并由独立管理连接验证撤权和 Epoch 在多实例间即时生效。
