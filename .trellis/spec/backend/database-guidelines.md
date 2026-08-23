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

## U6 PostgreSQL 合同的唯一来源

U6 不在本通用指南复制第二套表、状态机、Wire 或函数白名单。实施与 Migration 的唯一
权威来源固定为：

- `docs/design/u6-research-platform-contract.md`：Frontier、Relation Key、Research
  Terminal、Current Readiness、Publication/Consumption、Revocation、Grant、GO、锁序、
  strict Record/DB CHECK、错误码与平台窄函数；
- `docs/design/u6-research-derivation-wire-contract.md`：跨运行时 Hash、v2 delta、
  Enumerator Attestation 与 exact codec；
- `docs/design/u6-research-derivation-receipt-contract.md`：Budget 双水位、DB-owned
  派生 Receipt、Input Watermark 与 C2a/C2b 边界；
- `docs/design/u6-research-database-surface-contract.md`：数据库 Authority provenance、
  current Artifact Committer、全局锁入口、RPC exposure、GRANT/DML denylist、`10590`
  与 Schema Inventory；
- `docs/design/u6-research-migration-safety-contract.md`：`10590` 维护窗口、已有 Relation
  容量/数据 preflight、fail-fast DDL、整事务回滚与 Hosted/Docker 对等；
- `docs/design/u6-app-lifecycle-cleanup-contract.md`：DELETE_PENDING 下 lifecycle-exclusive
  Job cleanup、无 PII retained receipt、Terminal aggregate 删除、重放与 residual 闭环；
- `docs/design/u6-research-execution-storage-contract.md`：Resource/Invocation/System
  Record/Result/Key metadata 的物理表、非 Terminal 约束、nullable CHECK、TTL、
  `db_now` 与唯一执行域锁序；
- `docs/design/u6-terminal-reference-graph-contract.md`：Invocation/Preparation/
  Result/Blob/Receipt reference key/FK、物理 discriminator 与 Audit 五组 nullable FK；
- `docs/design/u6-research-resource-invocation-contract.md`：Reservation/Seq/Lease、
  Model/SQL/Tool Invocation Wire、System Record/Result、Retention Blob、用量结算、
  Owner Capability 与资源窄函数；
- `docs/design/u6-invocation-state-contract.md`：Invocation 状态迁移、Owner、
  Start-before-I/O、Terminal CAS、幂等与 Crash Recovery；
- `docs/design/u6-invocation-result-crypto-contract.md`：明文 Candidate、跨实例 Terminal
  claim、密文 Command、Resolver/Decrypt Authority、Key Version 与固定密码向量；
- `docs/design/u6-result-key-lifecycle-contract.md`：Key metadata 状态/时间矩阵、
  predecessor exact FK/CAS、transition replay、首次启用/轮换/事故恢复与四个部署函数；
- `docs/design/u6-system-record-lifecycle-contract.md`：Termination、Tool Permit
  expiry/revoke、Result Blob tombstone、Audit Purge strict union/replay、Owner 与幂等；
- `docs/design/u6-research-planning-payload-contract.md`、
  `docs/design/u6-research-oed-v2-contract.md` 与
  `docs/design/u6-research-wire-payload-contract.md`：落库 Artifact/Reference/
  Payload（含 OED v2）的 strict Schema、版本元组与 Hash；
- `.trellis/spec/backend/artifact-authority.md`：Candidate、Committer、Resolver 与
  Authority Brand 边界。

本文件中的通用 Supabase 约束仍适用，但不能覆盖或放宽上述合同。尤其禁止重新引入
`IN_USE|TERMINATED|UNKNOWN` 旧 Invocation 状态、caller 自报 response/usage、独立
usage-adjustment 真值、通用 `INVOCATION_AUTHORITY`、standalone revoke 创建 STALE、
或另一组同名函数。

### U6 Schema inventory gate

Migration 必须从上述全部 U6 权威分册维护一份机器可读
`u6-schema-inventory@1.0.0`，至少列出每张表、PK、UQ、FK、CHECK、RLS、Index、函数完整
签名与 Owner Capability。CI 将实际 `pg_catalog` 投影与 Inventory 做规范化 Exact
Match；缺项、额外兼容表/函数、状态或签名漂移全部失败。Inventory 至少证明：

- Platform 合同列出的 Frontier Event、Current Evidence Relation Key、Stop Terminal
  Commit、Publication/Consumption、Grant/Revocation/GO 对象全部存在；
- Resource 合同列出的 Reservation Head/Transition、Invocation Commit、各 Kind
  System Record/Result 与 Retention Blob 对象全部存在；
- Invocation State 合同列出的 Transition Operation、状态 CHECK、Start/Unknown/
  Terminal CAS 与 Owner 全部存在；
- System Record Lifecycle 合同列出的 Transition Operation、Permit expiry/revoke、
  Blob tombstone、Audit Purge、DB time 与窄 Owner 全部存在；
- App Lifecycle Cleanup 合同列出的 retained Operation/Batch Receipt、job-only
  cleanup function、cleanup rank 与 Terminal deferrability 全部存在；
- 函数集合严格等于 Database Surface Function Manifest 的 public/internal/Resolver/
  Provisioner/Platform-helper/JOB_CLEANUP 白名单，并与其他 U6 分册 exact protocol 对齐；
- 普通 U6 relation 的 Key/FK/Index 与普通 RLS 展开
  `app_id + tenant_id + environment`，共享 Supabase 项目下不可跨 App 解析。Cleanup
  Owner 仅可凭四个可信 binding 使用 exact-L destructive policy；两张 retained
  cleanup table 仍是唯一 scope=L relation，并另限 operation/batch；
- 所有 `SECURITY DEFINER` 函数 `set search_path = ''`，只授予精确
  `EXECUTE(signature)`，Browser 角色无底表写权。

### U6 事务与验证

U6 Artifact/Readiness Root 只使用 Database Surface §1/§3 的 Authority prefix 与逐行锁序；
Resource/Invocation/System Record 只使用 Execution Storage §5 的逐行锁序。任一执行域
取得子锁后不得反向进入 Root。

必须用真实 PostgreSQL 双连接与 clean-install Migration 覆盖上述权威分册列出的全部
竞态、幂等重放、Reference A/Payload B、状态 nullable truth table、
Owner 冒充、Retention expiry/replay、迟到 Usage 和零旁路 I/O Oracle。In-Memory 通过
不能替代数据库证据。

## Migration

### 场景：常规 Migration 声明式渲染

#### 1. Scope / Trigger

- 新增由有序 sql.inc segments、单一 checksum placeholder 和 checksum header 组成的 App Migration 时适用。
- 只有旧函数抽取、结构变换、额外 manifest hash 或已冻结历史 checksum 行为才保留专用 renderer。

#### 2. Signatures

```text
pnpm exec tsx scripts/render-migration.ts <manifest-id> [--verify]
pnpm exec tsx scripts/render-migration.ts --all --verify
```

Manifest 固定字段为 id、migration_name、source_directory、segments、placeholder、
checksum_header 和可选 postcondition.checksum_occurrences。专用例外必须登记 renderer、reason 与
verification_command。

#### 3. Contracts

- scripts/migration-manifests.json 是常规 renderer 与专用例外的单一注册点，严格拒绝未知字段和重复 ID。
- 通用 renderer 精确校验 segment closure，统一 CRLF/LF 与末尾换行，要求 placeholder 恰好出现一次。
- checksum 对“header 与 body checksum 均归零”的完整内容计算；--verify 必须逐字节比较已发布 SQL。
- 不允许为已删除的独立 renderer 保留长期 wrapper；调用方直接使用 manifest ID。
- 历史无 header 或零占位符异常不得由通用 renderer 自动修复，也不得改写已执行 SQL。

#### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| segment 缺少、额外或重命名 | MIGRATION_SEGMENT_CLOSURE_DRIFT |
| placeholder 为 0 次或多次 | MIGRATION_PLACEHOLDER_DRIFT |
| postcondition 不满足 | MIGRATION_POSTCONDITION_FAILED |
| 已生成 SQL 字节不同 | MIGRATION_RENDER_DRIFT |
| manifest 未登记或重复 | MIGRATION_MANIFEST_NOT_FOUND / MIGRATION_MANIFEST_DUPLICATE_ID |

#### 5. Good / Base / Bad Cases

- Good：新增 source 目录和一项 manifest，先运行单项 --verify，再运行 --all --verify。
- Base：确有结构变换时保留专用脚本，并在 exceptions 中记录原因和验证命令。
- Bad：复制现有 50 行 renderer、保留旧 wrapper，或为统一接口重算历史 Migration。

#### 6. Tests Required

- tests/migration-renderer.spec.ts 覆盖生成、verify、segment/placeholder/checksum drift。
- 同一测试逐项验证仓库全部 manifest 与已发布 SQL 字节一致，并核对剩余 renderer 等于 exceptions。
- infra/supabase/test-support/static-check.sh 必须从 manifest 动态解析常规 renderer。
- tests/workspace-migration-inventory.spec.ts 继续证明 frontier、重复序号与 checksum 历史豁免。

#### 7. Wrong vs Correct

```text
# Wrong
pnpm exec tsx scripts/render-10706-migration.ts --verify

# Correct
pnpm exec tsx scripts/render-migration.ts 10706 --verify
```

### 场景：Graph v2 Revision Digest 与内容 Digest 校验

#### 1. Scope / Trigger

- Graph v2 的 read、bind、publish RPC 同时读取 `semantic_source_revision`、
  `semantic_graph_projection` 与 `semantic_source_release_graph_projection` 时适用。

#### 2. Signatures

- Read RPC：`semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text) -> jsonb`。
- `semantic_source_revision.source_digest` 是完整 Source Revision 的存储摘要。
- `semantic_graph_projection.source_digest` 与 `projection_payload.source_digest` 是 Graph
  内容摘要；binding 同名列冻结该值。

#### 3. Contracts

- Revision 摘要只与 `binding.source_revision_digest` 比较。
- Graph 内容摘要必须在 projection 列、projection payload 与 binding 三方 exact match。
- Projection storage 摘要、source revision ID、graph ID 与 graph version 仍独立校验，不能因
  digest 修复而放宽。

#### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| Revision 摘要与 binding 不同 | `SEMANTIC_GRAPH_STUDIO_SOURCE_BINDING_MISMATCH` |
| Graph 内容摘要三方任一不同 | `SEMANTIC_GRAPH_STUDIO_SOURCE_BINDING_MISMATCH` |
| 误把 Graph 内容摘要与 Revision 摘要比较 | 合法 release 会被错误拒绝，必须由 forward migration 修复 |

#### 5. Good / Base / Bad Cases

- Good：分别冻结并核对 Revision、Graph content、Projection storage 三类摘要。
- Base：同一类摘要只在其权威列和序列化 payload 之间比较。
- Bad：因为字段都叫 `source_digest`，跨 `source_revision` 与 projection payload 直接比较。

#### 6. Tests Required

- Migration 静态测试必须断言 payload `source_digest` 与
  `v_projection.source_digest` 比较，并拒绝与 `v_source.source_digest` 比较。
- PostgreSQL clean-install 必须执行 renderer、checksum、owner/ACL postcondition。
- 已发布 Graph 的浏览器/API 回归必须返回 200，并显示 exact release generation。

#### 7. Wrong vs Correct

```sql
-- Wrong: 两列代表不同内容域
projection_payload ->> 'source_digest' is distinct from source_revision.source_digest

-- Correct: Graph 内容摘要与 Graph 内容摘要比较
projection_payload ->> 'source_digest' is distinct from graph_projection.source_digest
```

- Platform Migration 位于 `infra/supabase/platform/migrations/`；唯一例外是 U6
  `10590` 内由 Database Surface 冻结的 `platform.lock_u6_authority_binding`、
  `platform.lock_u6_cleanup_platform_evidence` 与 Lifecycle identity guard，禁止拆出
  第二条 Platform migration chain。
- App Migration 位于 `infra/supabase/apps/data-agent/migrations/`。
- App Migration 文件名固定为 `<14 位数字序号>_<lowercase_stem>.sql`。完整文件 stem
  必须与 `platform.assert_migration_checksum` 的 `migration_version` 完全一致，数字序号
  也必须唯一；不能因为完整 stem 不同就复用同一序号。历史重复序号、缺 header 或旧
  checksum 占位符只能在 `scripts/lib/workspace-migration-inventory.ts` 以 exact stem
  grandfather，任何新 Migration 不得扩大 allowlist。
- 新 Migration 落笔前必须运行 `pnpm tsx scripts/verify-workspace-migration-inventory.ts`
  读取当前 frontier，禁止从计划文档直接沿用可能已被占用的序号。校验必须同时覆盖
  header checksum、ledger checksum 与把 checksum 归零后的完整文件 SHA-256。
- U6 `10590` 的生产安装还必须满足 Migration Safety 分册；clean install 不能替代
  populated relation、lock contention 与 rollback Oracle。
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

U6 额外只允许 Cleanup 分册的 job-only 函数：先持 lifecycle exclusive lock，再清理
全部 tenant 的 Inventory owner=`U6_JOB` relation；普通 U6 Authority/Backend 无此权限。U6
component residual=0 仍不能冒充全 Database/Storage/Redis residual=0；两张无 PII
retained cleanup receipt 与 Platform lifecycle receipt 是 control evidence，不计业务
资源 residual，也不得被删除来伪造零残留。外部 Export/Backup verifier 不可用时首条
destructive DML 前即 HOLD。

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
