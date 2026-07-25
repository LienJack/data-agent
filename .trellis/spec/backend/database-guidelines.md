# 数据库与共享 Supabase 规范

> 本文只记录 U2 已实现并由 PostgreSQL 17 烟测覆盖的约定。

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
`payload_hash` 统一调用 `platform.canonical_sha256(jsonb)` 计算；Command 表以
Canonical CHECK 拒绝调用方提供的分歧 Hash，Idempotency Record 通过复合外键绑定同一
Requester、Command 与 Hash。
Command Payload 只接受与 TypeScript 相同的严格字段集合：
`kind/mode/question_version/dataset_id/secret_refs`；未知字段、非规范 SecretRef、
非 Canonical Hash 均在数据库边界失败关闭。

Outbox 调度只能调用以下窄函数，不能给 Backend Role 表级 UPDATE 权限：

- `app_data_agent.claim_outbox`
- `app_data_agent.publish_outbox`
- `app_data_agent.retry_outbox`

Lease Owner、Lease Token 与过期时间必须同时匹配；Outbox 的 `(command_id, run_id)`
必须通过复合外键指向同一 Command，不能把别人的 Run 当作待发布载荷；Sink 使用
`outbox_id` 作为幂等键。

Run 的身份、Question、Status 与时间线不可直接 UPDATE。Worker Fence 只能通过
`app_data_agent.advance_run_fence(run_id, expected_fence)` 做单调 CAS；Backend 获得的
窄列 UPDATE 权限只用于 PostgreSQL `SELECT ... FOR UPDATE`，Trigger 会拒绝绕过函数的
实际改写。

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
