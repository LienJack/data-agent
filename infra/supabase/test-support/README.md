# Supabase / PostgreSQL 迁移测试

该目录只为普通 PostgreSQL 容器提供最小 `auth`、`storage` Stub、双应用 Fixture 与 SQL
断言。生产迁移不会创建 Supabase 系统 Schema。

运行：

```bash
infra/supabase/test-support/run-postgres-smoke.sh
```

Smoke 固定执行：

1. 禁止 `GRANT ALL`、生产迁移伪造 `auth/storage`、遗漏空 `search_path`；
2. 校验每个迁移文件的规范化 SHA-256；
3. 按文件名排序执行 Platform 与 Data Agent App 迁移；
4. 按文件名排序执行全部 `*-assertions.sql`；
5. 验证双 App、双 Tenant、双环境、RPC/RLS、Demo、Storage、生命周期、SecretRef
   与 Migration Ledger；当前账本固定为一个 Platform 加十四个 App Migration；
6. 在独立数据库逐步执行到 `10500 / 10505 / 10510 / 10560`，证明 Browser 写入口、
   Backend 直写与旧 Outbox/Fence API 在任一中断前缀都失败关闭；
7. 用两个数据库会话证明同一 Run 只能被一个 Worker Claim，并覆盖
   Browser↔Browser、Browser↔Backend、Backend↔Backend 三类并发首写；
8. 用未来 `occurred_at` 证明 Event 保留调用时间，但数据库 `accept_at` 仍让 Outbox
   立即可领取；
9. 用两个数据库会话证明同 App Migration Lock 互斥、不同 App Lock 相互独立。

U4 Runtime Migration 按依赖拆分为：

1. `runtime_foundation`：规范化 Helper、Runtime 表、基础索引，并前移所有旧写入口撤权；
2. `runtime_api`：前向替换 U2 Browser API，但不提前恢复 Browser 写权限；
3. `runtime_projection_invariants`：初始 Projection、回填与不可变/Fence 约束；
4. `runtime_queue_lease`：Claim、Heartbeat 与 `SKIP LOCKED`；
5. `runtime_event_settlement`：Event Append、Complete 与 Retry；
6. `runtime_checkpoint_effect`：Snapshot 与 Side Effect Receipt；
7. `runtime_control`：Cancel/Resume 控制命令；
8. `runtime_backend_acceptance`：Backend 首写接收；
9. `runtime_security`：RLS、精确 Revoke 与 Grant。

Runtime SQL 断言保持原始状态依赖顺序：

```text
20 U2 core
→ 21 runtime helpers/schema
→ 22 execution/cancel
→ 23 resume
→ 24 retry/takeover
→ 25 Secret
→ 25z concurrent resume/counter
→ 26 Artifact/Lifecycle
→ 27 Text2SQL System Store/Claim/Finalize
```

生产约束：

- 首次请求只开放
  `api.data_agent__accept_run_command(...)`，在一个事务内提交 Run、Command、
  Idempotency、Initial Event、Outbox 与 Audit；`create_run` 保留但没有客户端权限。
- 后台直连先调用 `platform.resolve_backend_authority(...)` 获取数据库权威投影，再在同一事务
  设置 `data_agent.app_id/tenant_id/environment/principal_id/role/deployment_id`；
  RLS 与敏感函数会通过 `platform.current_backend_authority(...)` 再次核对 Deployment、
  Membership Version、App/Environment Epoch 与生命周期。生命周期权威固定以
  `(app_id, environment)` 为主键，冻结 `test` 不得污染同一 App 的 `prod`。跨请求缓存必须调用
  `platform.revalidate_backend_authority(...)`，成员撤销或生命周期变化会立即令旧投影失效。
- U4 Runtime Worker 不能直接 `UPDATE` Outbox、Run 或 Command，只能通过
  `claim_run_work(...)`、事件结算、重试与控制窄函数推进；旧
  `claim_outbox(...)`、`publish_outbox(...)`、`retry_outbox(...)` 与
  `advance_run_fence(...)` 已对全部应用角色撤权。
- U5 SQL Sandbox 的 Claim/Lease/Fence/Cancel 是可变投影；System Artifact、
  Execution Event 与每 Attempt Execution Record 使用独立 append-only 表。
  Backend 只能经 FORCE RLS 直读这四张 Authority 表，并调用窄
  `SECURITY DEFINER` 函数；不能直接 DML。`SandboxResult` 与
  `SandboxExecutionReceipt` 必须和 Claim 终态、ExecutionRecord、终态 Event 在
  同一 Authority 数据库事务中原子提交。领域 `content_hash` 不得替代完整保存体
  `payload_checksum`。
- Artifact Object 的 Storage Key 固定为
  `<app_id>/<tenant_id>/<environment>/<principal_id>/<run_id>/<artifact_kind>/sha256-<digest>`；
  Key 中的 Principal/Run 还必须和私有 Run 元数据一致。Restrictive Guard 同时约束其他
  应用误建的宽松 `PUBLIC` Policy，禁止跨 App、Tenant、环境与对象所有者读写。
- SecretRef 只保存 Provider 引用哈希和状态元数据，不保存明文或 Provider 引用。
  Rotation/Revoke 使用 Version CAS。缺少真实外部验签器时，`SUCCEEDED` Receipt
  失败关闭；精确匹配当前 Request/Version/Operation 的 `FAILED` Receipt 可被 Owner
  显式确认并恢复 `ACTIVE` 以便重试，但不会推进 Version 或 Provider Ref Hash。
  没有 Receipt 时保持 `ROTATION_PENDING` / `REVOCATION_PENDING`，不会伪造成功。
- 生命周期的 `DELETE_CONFIRMED` 必须消费 Job Authority 写入的不可变 Resource
  Manifest 和 Operation Receipt，并要求数据库、Storage、Redis 三类 Residual 全为
  `0`；Manifest/Receipt 还绑定当前 `(app_id, environment, authority_epoch)`，旧环境或
  旧生命周期轮次的证据不能重放。
  当前切片尚未接入真实外部清理与 Ed25519 验签器，因此即便 Receipt 声称零残留，
  `DELETE_CONFIRMED` 也会返回 `DA_EXTERNAL_DELETE_VERIFIER_UNAVAILABLE`，应用保持
  `DELETE_PENDING`（HOLD），不会标记 `DELETED`。删除可能已有破坏性副作用，因此
  不提供无可信恢复证据的 `DELETE_CANCELLED`。签名字段在本阶段只是待验签输入，
  不能作为已验证结论。
- 浏览器提供的 App、Tenant、Role Claim 不构成权限；RPC 只把 Deployment/Tenant
  参数当作待验证的资源选择器，并以 `auth.uid()` 作为 Principal。
- 生产迁移要求 Supabase 已提供真实 `auth.uid()`、`storage.objects` 与 Storage
  helper；只有本目录的 Stub 会在普通 PostgreSQL 容器内模拟这些对象。
