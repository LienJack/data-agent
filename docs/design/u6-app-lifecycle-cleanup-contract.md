# U6 App Lifecycle Cleanup 合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` · `u6-app-lifecycle-cleanup@1.0.0`
> 本文冻结待实现的 `DELETE_PENDING` 清理边界；不证明实际删除、外部备份验证或
> `DELETE_CONFIRMED` 已交付。

本文是 U6 整个 `(app_id,environment)` 物理清理的唯一合同。它不属于普通
`U6DbCommand`、Principal Capability 或 Result Retention；函数/ACL 取 Database
Surface，Terminal FK 延迟集合取 Terminal Reference Graph，物理表字段取 Execution
Storage，外层生命周期与 residual receipt 取 Platform；cleanup rank/aggregate 的唯一
来源是本文。

## 1. Job-only Command 与返回值

唯一入口为
`app_data_agent.cleanup_u6_delete_pending_environment(jsonb) returns jsonb`：

```ts
type CleanupU6DeletePendingEnvironmentInput = {
  protocol_version: "u6-app-lifecycle-cleanup@1.0.0";
  operation_id: ImmutableId;
  batch_id: ImmutableId;
  app_id: ImmutableId;
  environment: NonEmptyText;
  expected_app_epoch: PositiveInt;
  resource_manifest_id: ImmutableId;
  resource_manifest_hash: Sha256;
  export_boundary_receipt_id: ImmutableId;
  export_boundary_receipt_hash: Sha256;
  export_operation_receipt_id: ImmutableId;
  export_operation_receipt_hash: Sha256;
  backup_operation_receipt_id: ImmutableId;
  backup_operation_receipt_hash: Sha256;
  schema_inventory_hash: Sha256;
  batch_limit: PositiveInt; // 1..500
  operation_hash: Sha256;
  request_hash: Sha256;
};
type U6CleanupBatchReceipt = {
  protocol_version: "u6-app-lifecycle-cleanup-receipt@1.0.0";
  operation_id: ImmutableId;
  batch_id: ImmutableId;
  batch_seq: PositiveInt;
  app_id: ImmutableId;
  environment: NonEmptyText;
  app_epoch: PositiveInt;
  component: "U6_AUTHORITY_RELATIONS";
  cleanup_rank: NonNegativeInt;
  deleted_rows: NonNegativeInt;
  live_result_bodies_destroyed: NonNegativeInt;
  metadata_only_results_deleted: NonNegativeInt;
  component_residual_rows: NonNegativeInt;
  state: "RUNNING" | "COMMITTED";
  committed_at: Timestamp;
  operation_hash: Sha256;
  request_hash: Sha256;
  receipt_hash: Sha256;
  created: boolean;
};
type U6CleanupManifestBinding = {
  protocol_version: "u6-cleanup-manifest-binding@1.0.0";
  app_id: ImmutableId;
  environment: NonEmptyText;
  app_epoch: PositiveInt;
  schema_inventory_hash: Sha256;
  export_boundary_receipt_id: ImmutableId;
  export_boundary_receipt_hash: Sha256;
  export_operation_receipt_id: ImmutableId;
  export_operation_receipt_hash: Sha256;
  backup_operation_receipt_id: ImmutableId;
  backup_operation_receipt_hash: Sha256;
};
```

输入是 strict object，禁止 tenant/principal/run/result identity、caller count、表名、
约束名、绝对时间或 delete predicate。`JCS` 使用 Wire Registry 的 UTF-16 key order；
以下数组位置即字段顺序，Hash 输出为小写 hex：

```text
operation_hash =
  sha256(UTF8("u6-cleanup-operation@1.0.0\0") ||
    UTF8(JCS([protocol_version,operation_id,app_id,environment,
      expected_app_epoch,resource_manifest_id,resource_manifest_hash,
      export_boundary_receipt_id,export_boundary_receipt_hash,
      export_operation_receipt_id,export_operation_receipt_hash,
      backup_operation_receipt_id,backup_operation_receipt_hash,
      schema_inventory_hash])))

request_hash =
  sha256(UTF8("u6-cleanup-batch-request@1.0.0\0") ||
    UTF8(JCS([operation_hash,batch_id,batch_limit])))

receipt_hash =
  sha256(UTF8("u6-cleanup-batch-receipt@1.0.0\0") ||
    UTF8(JCS([protocol_version,operation_id,batch_id,batch_seq,app_id,
      environment,app_epoch,component,cleanup_rank,deleted_rows,
      live_result_bodies_destroyed,metadata_only_results_deleted,
      component_residual_rows,state,committed_at_utc,
      operation_hash,request_hash])))
```

`operation_hash` 排除两个 batch 字段和两个 hash 字段；`request_hash` 排除自身；
`receipt_hash` 排除自身与 response-only `created`。`committed_at_utc` 由数据库固定为
UTC、六位微秒的 `YYYY-MM-DDTHH24:MI:SS.USZ`，不得受 session TimeZone 影响。
因此同一 Operation 的多个 batch 共用 `operation_hash`，每个 batch 有独立
`request_hash`。返回不含业务内容或 subject identity；count、rank/hash 只是治理事实，
不能单独推进 App Lifecycle。

固定向量：operation=`11111111-1111-4111-8111-111111111111`、batch=
`22222222-2222-4222-8222-222222222222`、app=
`33333333-3333-4333-8333-333333333333`、manifest=
`44444444-4444-4444-8444-444444444444`、Export Boundary=
`55555555-5555-4555-8555-555555555555`、Export Operation=
`66666666-6666-4666-8666-666666666666`、Backup Operation=
`77777777-7777-4777-8777-777777777777`、environment=`test`、epoch=7；Manifest、
Boundary、Inventory、Export 与 Backup hash 依次为 `sha256:` 加 64 个
`a/b/c/d/e`、limit=100 时，
operation hash 为
`sha256:14b095443e909d89bbb4ed5a9b54c2769eff591c816a1c177b247bdfff11e6d2`，
request hash 为
`sha256:73a7d60ee224c4be7483e3ee1705964d6e3d4eff5d8c41a2890b35c0e9a33bad`。
再令 seq=1、rank=3、deleted/live/metadata/residual=`8/1/2/42`、state=`RUNNING`、
time=`2026-07-27T12:34:56.123456Z`，receipt hash 固定为
`sha256:93666688a1bc4de0f1fda4263bc62d641cf6702a28f6bc40d39723393eede7f0`。

## 2. Authority 与唯一锁序

调用者只允许既有 `data_agent_job_authority`；在 `app_data_agent`/U6 namespace 内该
角色只获此函数 EXECUTE 和必要 schema USAGE，没有 U6 table ACL、普通 RPC、Resolver、
Provisioner 或 Result Decryption 权限；既有 Platform lifecycle allowlist 保持不变并
纳入 Inventory。函数由专用 NOLOGIN `data_agent_u6_cleanup_owner` 持有，并按以下顺序执行：

```text
platform lifecycle exclusive advisory（全局第一把）
→ platform.lock_u6_cleanup_platform_evidence(...)
  → exact app_environment_lifecycle FOR UPDATE
  → exact resource_manifests FOR KEY SHARE
  → exact app_lifecycle_events(EXPORT_COMPLETED) FOR KEY SHARE
  → exact boundary_audit_receipts + EXPORT/BACKUP operation receipts FOR KEY SHARE
→ 覆盖四个 transaction-local cleanup binding
→ cleanup operation advisory / retained operation row
→ retained batch receipt slot
→ current Result/Audit retention heads + policies（tenant UUID bytes 升序）
→ cleanup rank 的静态 U6 rows
```

Helper exact signature 为
`platform.lock_u6_cleanup_platform_evidence(uuid,text,bigint,uuid,text,uuid,text,uuid,text,uuid,text)
returns jsonb`，依次接收 app/environment/epoch 与 Manifest/Boundary/Export/Backup 的
id/hash。它是 `VOLATILE STRICT SECURITY DEFINER SET search_path=''`，由 NOLOGIN/
NOINHERIT `data_agent_u6_platform_lock_owner` 持有；Cleanup Owner 仅获 Platform schema
USAGE 与该签名 EXECUTE。Helper 不再取 shared advisory、Deployment 或 Membership，零 DML，返回逐字段 strict locked snapshot，
其锁持续到外层事务结束。Platform Lock Owner 仅获五表 SELECT 与锁列
`UPDATE(app_id|manifest_id|event_id|receipt_id|operation_receipt_id)`；后四表现有 immutable
trigger 与 Lifecycle identity guard 使锁列不可改。五表必须保持 RLS disabled；若任一
启用 RLS，Catalog/preflight 立即 HOLD，须先另行冻结 matching policy。Cleanup Owner
没有五表 ACL，只能调用 Helper。

函数先检查 `pg_has_role(session_user,'data_agent_job_authority','USAGE')`，再取得排他锁；
不得把现有无锁 `platform.cleanup_scope_authority` 的 JSON 返回当成授权。Lifecycle 必须
是 `DELETE_PENDING` 且 epoch 等于输入；`DELETED` 只允许 exact 已 COMMITTED Operation
重放，其他状态零写失败。Manifest 必须同 app/environment/epoch、source state、hash 与
Inventory。上游必须同时存在同 app/environment 的 immutable
`platform.app_lifecycle_events(operation='EXPORT_COMPLETED',
previous_state='EXPORT_PENDING',resulting_state='FROZEN')` 与其 FK 指向的
`platform.boundary_audit_receipts`；输入 id/hash 专指后者的
`receipt_id/receipt_hash`，其 operation/status/state 必须为
`EXPORT_COMPLETED/SUCCEEDED/EXPORT_PENDING→FROZEN`。只从 Boundary Receipt 的
`details.operation_receipt_id` 解析并锁定已签名
`platform.resource_operation_receipts(operation='EXPORT')`；event 本身没有 details/hash。
当前 DELETE_PENDING Manifest 再绑定 Boundary、Operation 及 backup evidence hash。
它的 `manifest_json.u6_cleanup_binding` 必须是 §1 的 strict
`U6CleanupManifestBinding`；缺/多 key、null、错误类型或大小写漂移均在任何
destructive DML 前失败。

十个 identity/hash/scope 字段必须与 Input、Manifest 外层和锁定行逐字相等。Export
Operation 行须为同 `L` 的签名 `operation='EXPORT'`，且 id 同 Boundary
`details.operation_receipt_id`；Backup Operation 行须为同 `L` 的签名
`operation='BACKUP'`，`upstream_receipt_id=export_operation_receipt_id`。两个 Operation
hash 分别绑定 `payload_hash`，Boundary hash 绑定 `receipt_hash`。函数重算 Manifest、
Boundary 与两个 Operation payload hash、状态及 counts，并要求外部 verifier 对
signer/key/signature 与 backup restoreability 给出受签验证结果；只信 Manifest
`payload_hash` 或单独 BACKUP receipt 都不构成授权。当前 Platform external
signature/backup verifier unavailable，因此 destructive branch 必须 HOLD。

取得并重验上述 Platform 锁后，函数必须用
`pg_catalog.set_config(name,value,true)` 覆盖：

```text
app.u6_cleanup_app_id       = input.app_id
app.u6_cleanup_environment  = input.environment
app.u6_cleanup_operation_id = input.operation_id
app.u6_cleanup_batch_id     = input.batch_id
```

随后逐字回读；空值、旧值或类型错误失败。普通 Inventory owner=`U6_JOB`（§4）的表
额外具有仅
`TO data_agent_u6_cleanup_owner` 的 exact-L cleanup policy：`current_user` 必须等于
该 NOLOGIN owner，行的 app/environment 必须等于前两个 binding，后两个 binding
必须等于当前调用 Input；两张 retained 表再分别要求 exact operation
与 exact batch。普通 owner exact-S policy 保持不变；Job 没有 table ACL、不能
SET ROLE，Inventory 断言 cleanup owner 不持有其他 SECURITY DEFINER 函数。因此 caller
预设同名 GUC 不能授权，函数覆盖后的 binding 也只能在本事务内存活。

`10600` 以原 OID `CREATE OR REPLACE platform.reject_immutable_mutation()` 安装
cleanup-aware guard，既有 trigger 无须 disable/重建。它保持 SECURITY INVOKER 与空
search path：`UPDATE` 永远拒绝；`DELETE` 仅当 current user 是 NOLOGIN
`data_agent_u6_cleanup_owner`、四个 binding 均通过 strict parse、`OLD.app_id/environment`
逐字匹配且 `TG_TABLE_SCHEMA='app_data_agent'`、表名属于以下 exact allowlist 时
`RETURN OLD`。实现必须先按 `TG_TABLE_SCHEMA/TG_TABLE_NAME/TG_OP` 拒绝，再读取 OLD：

```text
research_artifact_commit_operations
research_frontier_events
research_readiness_publications
research_readiness_consumptions
research_domain_terminals
research_stop_terminal_commits
research_release_decision_commits
research_result_key_transition_operations
research_resource_transition_operations
research_invocation_request_operations
research_invocation_transition_operations
research_system_artifacts
research_system_record_identities
research_adapter_termination_receipts
research_invocation_outcome_usage
research_result_access_audit_purge_operations
research_backend_artifact_commit_operations
research_budget_ledger_input_bindings
research_budget_events
research_budget_ledger_receipts
research_budget_policy_versions
research_candidate_attestation_ref_bindings
research_candidate_enumeration_ref_bindings
research_candidate_enumeration_receipts
research_candidate_enumerator_attestations
research_coverage_derivation_ref_bindings
research_coverage_derivation_receipts
research_enumerator_versions
research_input_events
research_input_event_watermark_receipts
research_step_operations
research_stop_derivation_ref_bindings
research_stop_derivation_receipts
```

其他 schema/table、空或伪造 binding、普通 RPC/Provisioner/Job、以及 Platform 自身 trigger
仍报 `DA_IMMUTABLE_RECORD`。GUC 单独不授权：Cleanup Owner 无 login/role membership，
且唯一由它持有的 SECURITY DEFINER 入口是已锁定 Platform evidence、覆盖 binding 后才
执行静态 DELETE 的 cleanup function。Inventory 冻结 guard source hash/owner/属性与完整
`tgfoid` dependency set；其中 cleanup-eligible app 子集 replace 前 16 张、postcondition
后 33 张，Platform/其他 dependency 全部 deny-only。少、多或换绑均失败；Guard 不查表取锁。

安全前提不是“10590 没有 cleanup 入口”。它已有 Job 可调用、Cleanup Owner 持有的
SECURITY DEFINER RPC，但旧 body 在任何 retained write/DELETE 前无条件返回
`U6_CLEANUP_EXTERNAL_VERIFIER_UNAVAILABLE`。`10600` pre-DDL 必须按 baseline
Inventory 验证该 RPC 的 OID/body hash/owner/ACL/`prosecdef=true`/空 search path 与
destructive-dormant control flow，再在同一事务同时 replace cleanup RPC 与 guard。
跨越 COMMIT 的旧 invocation 只能继续旧 body 返回 HOLD；新调用才同时看见新 pair。

排他锁先排空所有持 lifecycle shared lock 的 U6/既有写事务；取得后不再调用 Authority
prefix、Run-first profile 或普通 RPC。每个 batch 提交后锁释放，但 Lifecycle 仍为
`DELETE_PENDING`，所以新写继续失败。Restore 若在 batch 间获排他锁，下一 batch 必须
因 state/epoch 漂移拒绝；恢复只能依赖已验证 Export/Backup，不能取消已发生的删除。

## 3. Retained Operation 与 response-loss replay

`research_lifecycle_cleanup_operations` 与
`research_lifecycle_cleanup_batch_receipts` 是唯一不使用 `S` 的 U6 表，Scope 固定
`L=(app_id,environment)`；它们属于 Lifecycle control receipt，不属于被清理资源集合：

- Operation PK `(L,operation_id)`，UQ `(L,app_epoch,component)`；保存稳定
  `operation_hash`、Manifest/Boundary/Export/Backup/Inventory hash、next batch seq、
  累计两类 Result count、`RUNNING|COMMITTED` 与 final receipt hash，不保存
  tenant/principal/业务 identity；
- Batch Receipt PK `(L,batch_id)`，UQ `(L,operation_id,batch_seq)`；append-only，保存
  operation/request hash、rank、两类 Result count、residual/DB time/receipt hash；
- Operation 只允许同 `operation_hash` 以数据库生成的连续 `batch_seq` 单调推进
  rank/count，`RUNNING→COMMITTED` 后吸收；同 lifecycle slot 异 operation hash 冲突；
- 同 batch id/hash 重放返回持久 receipt、`created=false`，不再次删除；异 hash 冲突。

一次函数调用中的 delete、exact residual scan、Operation CAS 与 Batch Receipt insert
是同一事务。Crash-before-commit 全回滚；commit 后 response 丢失，same batch replay
读取原 receipt；新 batch 从数据库剩余行继续。禁止把 Redis、进程 checkpoint 或调用方
cursor 当 replay authority。

## 4. 固定清理图

Schema Inventory 对每张 U6 runtime/cleanup relation，以及 Cleanup 直接读取、锁定或
先解引用的 existing relation 固化
`cleanup_owner/scope_columns/identity_order/cleanup_phases[]`。每个 phase 固定
`cleanup_rank/cleanup_group/static_predicate_id/identity_order`；同一 relation 可以有
多个 phase，非 `U6_JOB` owner 的 phases 必须为空。`cleanup_owner` 是逻辑清理责任，
只允许 `U6_JOB|CORE_DATABASE|PLATFORM_CONTROL|RETAINED_CONTROL`，不是 SQL role/table
owner。Renderer 只生成静态全限定 SQL；调用方不能选择 relation、predicate、rank 或
约束名。Migration ledger/schema registry 等安装元数据不属于 Cleanup Inventory。

Owner closed set 如下；遗漏、重复或 owner 漂移都使 Inventory/Postcondition 失败：

```text
CORE_DATABASE =
  app_data_agent.runs, app_data_agent.artifacts, app_data_agent.outbox,
  app_data_agent.run_attempts, app_data_agent.memberships

PLATFORM_CONTROL =
  platform.app_environment_lifecycle, platform.deployment_mappings,
  platform.resource_manifests, platform.app_lifecycle_events,
  platform.boundary_audit_receipts, platform.resource_operation_receipts

RETAINED_CONTROL =
  app_data_agent.research_lifecycle_cleanup_operations,
  app_data_agent.research_lifecycle_cleanup_batch_receipts
```

`CORE_DATABASE` 由外层 core Database cleanup 删除；U6 Job 只先移除 U6 引用。
`PLATFORM_CONTROL` 由 Platform lifecycle 保留/推进；`RETAINED_CONTROL` 永不进入 U6
resource residual。`10600` 后其余 61 张 relation 的 owner 必须为 `U6_JOB`，且 exact phase
allowlist 为：

| rank / group / predicate / order | exact relation |
| --- | --- |
| `0/AUDIT_LEAF/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_result_ciphertext_access_audits`，随后 `research_result_access_audit_purge_operations` |
| `1/ROOT_GRAPH/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_release_decision_commits`、`research_readiness_consumptions`、`report_read_grant_expiration_operations`、`report_read_grants`、`research_revocation_operations`、`research_readiness_publications`、`current_report_readiness`、`research_stop_terminal_commits`、`research_domain_terminals`、`research_stop_derivation_ref_bindings`、`research_stop_derivation_receipts`、`research_candidate_enumeration_ref_bindings`、`research_candidate_enumeration_receipts`、`research_candidate_attestation_ref_bindings`、`research_candidate_enumerator_attestations`、`research_coverage_derivation_ref_bindings`、`research_coverage_derivation_receipts`、`research_artifact_commit_operations`、`research_budget_ledger_input_bindings`、`research_budget_ledger_receipts`、`research_input_event_watermark_receipts`、`research_input_events`、`research_input_event_heads`、`research_frontier_events`、`research_version_frontiers`、`research_frontier_operations`、`research_current_evidence_relation_keys`、`research_backend_artifact_commit_operations` |
| `2/SYSTEM_CHILD/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_system_record_transition_operations`、`research_adapter_termination_receipts`、`research_tool_invocation_permits`、`research_system_artifacts` |
| `3/TERMINAL_T/INVOCATION_AGGREGATE/I_ASC` | `research_invocation_request_operations`、`research_invocation_commits`、`research_invocation_transition_operations`、`research_invocation_terminal_preparations`、`research_invocation_results`、`research_invocation_result_blobs`、`research_secure_sql_execution_receipts`、`research_invocation_outcome_usage` |
| `4/SYSTEM_IDENTITY/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_system_record_identities` |
| `5/RESOURCE_EVENT/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_budget_events` |
| `5/RESOURCE_TRANSITION/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_resource_transition_operations` |
| `5/RESOURCE_RESERVATION/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_resource_reservations` |
| `5/STEP_TREE/ALL_SCOPE_ROWS/RUN_STEP_DESC` | `research_step_operations` |
| `5/RESOURCE_HEAD/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_resource_run_heads` |
| `6/CAPABILITY_GRAPH/ALL_SCOPE_ROWS/ASSIGNMENT_KEY_ASC` | `research_authority_capability_heads`、`research_authority_capabilities` |
| `6/KEY_TRANSITION/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_result_key_transition_operations` |
| `6/KEY_VERSION_CHAIN/ONE_SCOPE_KIND/S_KIND_ASC` | `research_result_key_versions` |
| `6/TOOL_POLICY/ALL_SCOPE_ROWS/FULL_PK_ASC` | `research_tool_permit_policy_limits` |
| `6/HISTORICAL_DERIVATION_POLICY/NON_CURRENT_VERSION/FULL_PK_ASC` | `research_budget_policy_versions`、`research_enumerator_versions` |
| `6/HISTORICAL_RETENTION/NON_CURRENT_RESULT_POLICY/FULL_PK_ASC` | `research_result_retention_policies` |
| `6/HISTORICAL_RETENTION/NON_CURRENT_AUDIT_POLICY/FULL_PK_ASC` | `research_result_access_audit_retention_policies` |
| `7/TENANT_GOVERNANCE_FINAL/CURRENT_RESULT_POLICY/TENANT_UUID_ASC` | `research_result_retention_policy_heads`、其 exact bound `research_result_retention_policies` |
| `7/TENANT_GOVERNANCE_FINAL/CURRENT_AUDIT_POLICY/TENANT_UUID_ASC` | `research_result_access_audit_retention_heads`、其 exact bound `research_result_access_audit_retention_policies` |
| `7/DERIVATION_GOVERNANCE_FINAL/CURRENT_VERSION/FULL_PK_ASC` | `research_budget_policy_heads`、其 bound `research_budget_policy_versions`；`research_enumerator_version_heads`、其 bound `research_enumerator_versions` |

除 Terminal `T` reciprocal/deferred aggregate 与 Key chain 单 statement 外，表内
relation 顺序就是 child-to-parent delete 顺序。`T` 列表只冻结确定性 DML 顺序，不声称
环内存在拓扑序；其完整闭合与 exact deferral 取 Reference Graph。所有名称都隐含
`app_data_agent.`，Inventory 保存全限定名。`FULL_PK_ASC` 按 PK 每个 UUID 的 16 bytes、
text 的 UTF-8 bytes、整数数值顺序；`I_ASC` 按完整 Invocation `I` 后再按各表 PK；
`ASSIGNMENT_KEY_ASC` 先 assignment key 再 capability id；不得依赖 locale/collation。
同 rank 5 必须按表中 group 顺序逐组归零；`RUN_STEP_DESC` 按
`S,run_id,budget_epoch,step_seq DESC,step_operation_id`。Step 写入约束
`parent_step_seq < child_step_seq`，因此 Reservation 先删、Step 再按 child-first 删除，
immediate self-FK 不需 defer。
每批只处理最小仍有残留的 rank，最多 `batch_limit` 个 aggregate。普通 phase 每行一个
aggregate；Capability Head+bound Capability、完整 Terminal `T`、KeyVersion 同
`S+key_kind` 全链、以及 rank 7 每个治理 Head+bound Version 闭包分别不可拆分。Key chain 只在
Transition Operation 与全部低 rank dependent 已归零后，以一个 DELETE statement 删除
该 S/kind 全部 version；`S_KIND_ASC` 按 S 后 ENCRYPTION=0/COMMITMENT=1，不能按 version
猜拓扑或拆批。`batch_limit` 计 aggregate，不计物理行。

Rank 0 已先清空全部 Audit；Rank 3 只按 Crypto/Lifecycle 敏感字段清单清空
ciphertext/nonce/tag/HMAC、structured AAD/seed 与 terminal commitment，再删除完整
aggregate。它不是 per-result Retention/Subject Erasure，不写伪造的 Result Transition；
Batch Receipt 的 `live_result_bodies_destroyed` 计清理前 AVAILABLE body，
`metadata_only_results_deleted` 计清理前 TOMBSTONED Result。

Terminal Reference Graph 冻结的 `T` 内四条 runtime reciprocal FK 与其余 cleanup-only
FK，是 cleanup 唯一允许显式执行 `SET CONSTRAINTS ... DEFERRED` 的 exact-name
allowlist；Capability Head→Capability 保持 Database Surface 的 INITIALLY DEFERRED，
但不进入该显式 allowlist，也不能由 caller 选择。随后在同一 batch 删除完整
RequestOp/Invocation/Transition Operation/Preparation/Result/Blob/SQL Receipt/
OutcomeUsage aggregate。
禁止 `SET CONSTRAINTS ALL`、`CASCADE`、disable trigger、改变
`session_replication_role` 或提交半个 aggregate。

所有静态 DML 都显式过滤 binding 的 `app_id+environment` 并与 exact-L cleanup RLS
双重匹配，跨该 L 的全部 tenants。`CORE_DATABASE`、`PLATFORM_CONTROL` 与 §3 两张
`RETAINED_CONTROL` 不进入 U6 Job phase；任何 `10590/10600` U6 relation 漏出上述 61+2
closed set、任何非 U6 relation 被标 `U6_JOB`，或任一 predicate/order 漂移，都使
Inventory/Postcondition 失败。

## 5. Legal hold、Result Erasure 与最终 residual

每个 batch 先以 Inventory 生成的静态 `UNION ALL` 从全部 `U6_JOB` relation 物化
`remaining_tenants`，去重后按 tenant UUID 16 bytes 升序。只对这些 tenant 要求并锁定
current Result/Audit Retention Head 与 exact Policy；已在先前 rank-7 aggregate 中归零
的 tenant 不再要求 Head。锁完成后，从 locked Manifest/Export/Backup rows 重验全部
evidence。任一 remaining tenant 的 `legal_hold=ACTIVE`、缺 Head、Head/Policy hash
漂移，或 backup evidence 不完整，都返回 deployment-only HOLD diagnostic，且整个
batch 零写。

Rank 6 只删除与 locked current Head 不匹配的 historical policy。所有较低 rank residual
为零后，Rank 7 才按 tenant bytes 选最多 `batch_limit` 个 tenant；每个 tenant 的两个
current Head 与两个 exact bound Policy 是一个不可拆分治理 aggregate。删除后同一事务
断言该 tenant 在全部 `U6_JOB` relation 的 residual=0。若仍有其他 tenant，Operation
保持 RUNNING；最后一个 tenant aggregate 删除后才断言整个 L residual=0 并置
COMMITTED。不存在“先删 Head、下一 batch 再删 Policy”，也不要求已经归零 tenant
在下一批凭空保留 Head。

单 Result 提前擦除仍只经 `erase_subject_invocation_result` 与
`RESULT_ERASURE_AUTHORITY`；到期删除仍只经 `tombstone_invocation_result` 与
`RESULT_RETENTION_AUTHORITY`。App cleanup 是 Environment Lifecycle effect，不获得
解密权，也不把 environment-wide receipt 冒充 subject erasure SLA 证明。三条路径共用
敏感字段清单和 backup Oracle，但 Authority、Operation 与 Release Claim 完全分离。

COMMITTED 前函数对全部 Inventory owner=`U6_JOB` relation 做 exact
`count(*) where app_id=? and environment=?`，总和必须为零；retained control receipt
像 Platform lifecycle receipt 一样不计入资源 residual。外层 Job 仍须把 U6 component、
core Database、Storage 与 Redis 的零残留合并进受签
`platform.resource_operation_receipts`，并由外部 verifier 授权
`DELETE_CONFIRMED`。U6 receipt 自身永远不能把 Lifecycle 推进到 `DELETED`。

## 6. 必需 Oracle

- active/FROZEN/错误 epoch、普通 Backend/Provisioner、跨 app/environment、伪造
  Manifest/Export/Backup/Inventory hash 均在任何 DELETE 前失败；binding 缺/多 key、
  错字段路径、跨环境 receipt、错误 upstream 或未签 verifier 同样零写；
- 两连接证明排他锁排空 shared writer；cleanup-first 使新 writer 等待后因
  DELETE_PENDING/epoch 失败，所有路径无 `40P01`；
- 每个 rank 与 Terminal aggregate 中间注入 crash：commit 前零变化，commit 后 same
  batch 精确重放，异 input 冲突并从 remaining rows 继续；
- operation/request/receipt 三个 fixed hash vector 在 PostgreSQL/TypeScript、
  Hosted/Docker 完全一致；换 batch 可推进同 operation，换 stable field 必须冲突；
- 删除环少任一行、漏 defer/多 defer 一条 FK、使用 CASCADE/trigger bypass 时 commit
  失败；Catalog 与 Inventory exact；
- v1→v2→v3 predecessor chain、version bytes 非拓扑序且 `batch_limit=1` 时，Transition
  receipt 先清、随后单一 S/kind aggregate 一条 statement 删除全链；不得先删 predecessor
  卡死，也不得跨 batch 留 successor orphan；
- ACTIVE Result/Audit legal hold 零清理；解除 hold 只能追加新 Policy/CAS Head，旧
  Policy 不可覆盖；多 tenant、`batch_limit=1` 证明每个最终治理 aggregate 原子删除，
  已归零 tenant 的 Head 不会成为下一 batch 的伪缺失；
- `test` cleanup 不改变同 App `prod`，App A 不改变 App B；所有静态 SQL 都含 exact
  app/environment predicate；caller 预设四个 cleanup GUC 或先调用其他
  SECURITY DEFINER 函数不能越权，事务结束后 binding 不泄漏；
- 两连接暂停旧 cleanup invocation 跨越 10600 COMMIT：旧调用仍只能 HOLD，新调用才同时
  看见新 RPC/guard；普通角色、错误 Scope、UPDATE、Platform DELETE 与并发 replacement
  均失败或按 platform→app advisory 顺序串行；
- 最终 component residual=0 但 retained receipt 可重放；缺 core/Storage/Redis 任一
  零残留或外部 verifier 时仍 HOLD；
- 受控 Export/Backup 可在删除前隔离恢复；provider backup window 后的恢复不得含已删
  U6 rows、Result ciphertext 或 subject hash。未取得 external key/KMS destruction
  receipt 时，不宣称 per-result irreversible erasure。
