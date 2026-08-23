# U6 Invocation Terminal PostgreSQL 引用图合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` · `u6-terminal-reference-graph@1.0.0`
> 本文冻结 candidate key、物理 discriminator 与 FK；不证明 `10590` 已交付。

本文是 Request Operation、Invocation、Preparation、Terminal System Record、Result、
Blob、Usage、Receipt 与 Ciphertext Access Audit 五组 nullable terminal reference 的
唯一引用图。Audit Retention Policy FK/delete_after 仍取 Execution Storage。业务状态取
Invocation State/Crypto/Lifecycle；表、nullable CHECK、锁序取 Execution Storage；
ACL/RPC 取 Database Surface。DDL 禁止用 JSON/hash/literal/predicate 冒充 FK。

## 1. 关系缩写与 candidate key

```text
S = (app_id,tenant_id,environment)
I = (S,invocation_id,run_id,principal_id,reservation_id,reservation_seq,
     resource_lease_id,request_id,attempt_id,worker_fence,resource_kind,
     canonical_request_digest)
SR = (S,record_kind,record_id,record_version,run_id,principal_id)
```

`I` 仅含 immutable Invocation facts，不含 state/version/terminal nullable 字段。下列
candidate key 都是 non-partial、NOT DEFERRABLE `UNIQUE CONSTRAINT`：

| 记号 | 表 | candidate key |
| --- | --- | --- |
| M | `memberships` | PK `(S,principal_id)` |
| RP | `runs` | `(S,run_id,principal_id)` |
| RS | `research_resource_reservations` | `(S,reservation_id,run_id,principal_id,reservation_seq,resource_lease_id)` |
| A | `run_attempts` | `(S,attempt_id,outbox_id,run_id,worker_fence)` |
| I | `research_invocation_commits` | `I` |
| RO | `research_invocation_request_operations` | `(S,invocation_id,request_id)` |
| TR | `research_invocation_transition_operations` | `(S,invocation_id,transition_id)` |
| P | `research_invocation_terminal_preparations` | `(I,preparation_id,preparation_version)` |
| SR | `research_system_record_identities` | `SR` |
| RX | `research_invocation_results` | `(I,record_kind,record_id,record_version)` |
| RA | `research_invocation_results` | `(S,record_kind,record_id,record_version,run_id,principal_id)` |
| QX | `research_secure_sql_execution_receipts` | `(I,record_kind,record_id,record_version)` |
| UX | `research_invocation_outcome_usage` | `(I,record_kind,record_id,record_version)` |
| TX | `research_adapter_termination_receipts` | `(I,record_kind,record_id,record_version)` |
| BI | `research_invocation_result_blobs` | `(I,blob_id)` |
| BX | `research_invocation_result_blobs` | `(I,result_record_kind,result_record_id,result_record_version)` |
| BA | `research_invocation_result_blobs` | `(S,result_record_kind,result_record_id,result_record_version,blob_id,encryption_key_kind,encryption_key_version)` |
| CA | `research_authority_capabilities` | `(S,capability_id,authority_epoch,principal_id)` |
| K | `research_result_key_versions` | PK `(S,key_kind,key_version)` |

供 FK 使用的 UQ 不能是 partial index 或 deferrable UQ。

## 2. Membership、Run、Reservation 与 Attempt

```text
runs.(S,principal_id) → memberships.M
所有普通 run-scoped U6 行：
  (S,run_id,principal_id) → runs.RP
Invocation:
  (S,reservation_id,run_id,principal_id,reservation_seq,resource_lease_id)
    → Reservation.RS
  (S,attempt_id,outbox_id,run_id,worker_fence) → RunAttempt.A
```

Membership FK 只绑定 retained immutable identity；`revoked_at IS NULL`、Role、Version
由共同 Authority prefix 锁内重验。撤权不能破坏历史 FK。

## 3. Request Operation 与 Invocation

两向在正常 Runtime 均即时检查；物理属性是 §6 的 cleanup-only
`DEFERRABLE INITIALLY IMMEDIATE`：

```text
RequestOp.I → Invocation.I
TransitionOp.I → Invocation.I
Invocation.(S,request_operation_invocation_id,request_id)
  → RequestOp.RO MATCH SIMPLE
```

AUTHORIZED 时 pointer/start time 全 null；STARTED/OUTCOME_UNKNOWN/COMPLETED 时
pointer=`invocation_id` 且 start time 非 null；FAILED 只能完整采用其中一组。写序是先
AUTHORIZED Invocation、再 RequestOp、最后更新 pointer，因此正常 Runtime 不开启
deferred window。

## 4. Preparation、Transition 与 committed refs

Preparation 保存完整 `I` 并以 cleanup-only `INITIALLY IMMEDIATE` FK 到 Invocation.I。
两类物理 kind 列为 generated constant，CHECK 固定 `ENCRYPTION` / `COMMITMENT`，
再分别以普通 immediate FK 到 K；禁止
`(S,'ENCRYPTION',version)` literal FK。

```text
Preparation.(S,invocation_id,terminal_transition_id) → TR cleanup-only deferrable
(S,invocation_id,committed_transition_id) → TR MATCH SIMPLE cleanup-only deferrable
(S,invocation_id,aborted_transition_id)   → TR MATCH SIMPLE cleanup-only deferrable
(I,committed_result_kind,id,version)       → RX MATCH SIMPLE cleanup-only deferrable
(I,committed_blob_id)                     → BI MATCH SIMPLE cleanup-only deferrable
(I,committed_usage_kind,id,version)        → UX MATCH SIMPLE cleanup-only deferrable
Result.(I,preparation_id,preparation_version) → P cleanup-only deferrable
Blob.(I,preparation_id,preparation_version)   → P cleanup-only deferrable
```

CLAIMED/ABORTED 的三组 committed ref 全空；COMMITTED/TOMBSTONED 全非空。TOMBSTONED
保留 `I`、Result/Blob/Usage refs 与两类 key kind/version/FK，只清 HMAC、structured
AAD/seed/密文字节；ABORTED 保留 `I` 与 key FK，三组 committed ref 全空。

## 5. System Identity 与 subtype

每张 subtype 物化 `record_kind`、固定 CHECK，再以 `Subtype.SR → SystemIdentity.SR`
immediate FK：

```text
AdapterTermination  = ADAPTER_TERMINATION_RECEIPT
OutcomeUsage        = INVOCATION_OUTCOME_USAGE
ToolPermit          = TOOL_INVOCATION_PERMIT
SecureSqlReceipt    = SECURE_SQL_EXECUTION_RECEIPT
InvocationResult    =
  MODEL → MODEL_INVOCATION_RESULT
  SQL   → SQL_INVOCATION_RESULT
  TOOL  → TOOL_INVOCATION_RESULT
```

Result、Blob、OutcomeUsage、AdapterTermination、SecureSqlReceipt 均携完整 `I` 并
FK 到 Invocation.I，禁止只凭 invocation id 换绑 Reservation/Lease/Attempt/
Fence/Kind/Digest。Result、Blob、OutcomeUsage、SecureSqlReceipt 都在 `T` 内，使用
§6 cleanup-only `INITIALLY IMMEDIATE`；不在 `T` 的 AdapterTermination 保持普通
immediate。

OutcomeUsage 的 nullable completion refs：

```text
(I,result_kind,id,version)  → RX MATCH SIMPLE cleanup-only deferrable
(I,receipt_kind,id,version) → QX MATCH SIMPLE cleanup-only deferrable
```

FAILED 两组全空；MODEL/TOOL COMPLETED 仅 Result 非空；SQL COMPLETED 两组非空。Result
kind 必须匹配 resource kind，Receipt kind 只能 SQL Receipt。Invocation current row 的
Result/Receipt/Usage refs 使用相同 RX/QX/UX cleanup-only `INITIALLY IMMEDIATE` FK：
非终态全空，FAILED 仅 Usage，COMPLETED Result+Usage 且仅 SQL 有 Receipt。

## 6. Runtime reciprocal 与 cleanup-only deferred FK

正常 Runtime 只有下列四条 reciprocal FK 使用
`ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED`：

```text
Result.(I,blob_id) → Blob.BI
Blob.(I,result_record_kind,result_record_id,result_record_version) → Result.RX
SQL Result.(I,receipt_record_kind,receipt_record_id,receipt_record_version)
  → SecureSqlReceipt.QX
SecureSqlReceipt.(I,result_record_kind,result_record_id,result_record_version)
  → Result.RX
```

其 candidate key 仍 NOT DEFERRABLE。其他全部 FK 为
`ON DELETE RESTRICT NOT DEFERRABLE`，但下列 App Lifecycle Terminal aggregate 是唯一
例外：

```text
T = {
  research_invocation_commits,
  research_invocation_request_operations,
  research_invocation_transition_operations,
  research_invocation_terminal_preparations,
  research_invocation_results,
  research_invocation_result_blobs,
  research_secure_sql_execution_receipts,
  research_invocation_outcome_usage
}
```

除上列四条 runtime reciprocal 外，所有 source 与 target 都在 `T` 内的 FK 固定为
`ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE`；它们在正常 public RPC 中仍
逐条即时检查。`T` 到 Run/Reservation/Attempt/System Identity/Policy/Key 等外部 target
的 FK 仍为 `RESTRICT NOT DEFERRABLE`。只有 Database Surface 冻结的 job-only
`cleanup_u6_delete_pending_environment` 在持有 lifecycle exclusive lock、重验
`DELETE_PENDING`/epoch 与 Cleanup Contract 的 exact `EXPORT_COMPLETED` Boundary
receipt 后，才可按约束名 closed allowlist
执行 `SET CONSTRAINTS ... DEFERRED`，并在同一事务删除一个完整 Invocation aggregate。
禁止 `SET CONSTRAINTS ALL`、禁止把其他 FK 改成 deferred，也禁止按 caller 提交约束名。

因此在本 Terminal Graph 范围内，可声明为 DEFERRABLE 的 FK 总集严格等于 `T` 的全部
内部 FK；其中只有四条 runtime reciprocal 是 INITIALLY DEFERRED，其余全部
INITIALLY IMMEDIATE。所有
candidate key 仍是 NOT
DEFERRABLE UQ。Inventory 必须记录每条 FK 的
`runtime_deferral`、`cleanup_group` 与 exact constraint name；Catalog 多一条或少一条都
失败。Backend/Service/Browser 对底表无 DELETE，普通 RPC owner 也无 cleanup function
EXECUTE，不能利用 cleanup deferral 制造半闭合 Runtime 状态。

ACL 不能阻止 caller 在外层事务预先执行 `SET CONSTRAINTS ALL DEFERRED`，因此所有
public/internal/provisioner U6 mutation 在任何业务 DML 前都必须对 Inventory 中每条
cleanup-only `T` FK 执行 exact-name `SET CONSTRAINTS ... IMMEDIATE`，强制结算 caller
遗留的 pending check；禁止使用 `ALL`。普通 mutation 全程保持 immediate。
`commit_invocation_terminal` 只在 Authority/锁/输入校验后临时 defer 上述四条 runtime
reciprocal FK，闭合 Result/Blob/SQL Receipt 后、写最终 operation/return 前恢复 exact-name
IMMEDIATE。Cleanup 同样先 normalize；只有在 lifecycle exclusive lock 与全部
Manifest/Export/Backup/Legal Hold 检查完成后，才临时 defer `T` 全部内部 FK，并在
residual/receipt 前恢复 IMMEDIATE。函数返回时不得把任何 `T` FK 留在 deferred mode。

## 7. Access Audit 的 nullable FK

Audit 的 authoritative `S/principal_id` 与 attempted/caller-claimed `run_id` 均非空；
不对 run_id 建无条件 Run FK，避免 UNRESOLVED 早退触碰声称的 Run。Principal 仅在
current backend Membership 已解析后写入，必须使用普通 immediate
`(S,principal_id) → memberships.M ON DELETE RESTRICT NOT DEFERRABLE`；该 FK 不属于
下列五组 nullable terminal reference。

五组均为 ordinary immediate `MATCH SIMPLE`：

```text
(S,capability_id,authority_epoch,principal_id) → Capability.CA
(S,result_kind,id,version,run_id,principal_id) → SystemIdentity.SR
同组 → InvocationResult.RA
(S,result_kind,id,version,blob_id,encryption_key_kind,key_version) → Blob.BA
(S,encryption_key_kind,key_version) → KeyVersion.K
```

阶段 CHECK 与 `num_nonnulls` 保证每个 nullable identity 组全空或全非空：

- CAPABILITY_UNRESOLVED：capability/result/blob/key 全空；
- CAPABILITY_RESOLVED：仅 capability id/epoch 非空；
- RESULT_RESOLVED：全部非空，Result kind 仅三类 Invocation Result，key kind 固定
  ENCRYPTION。

MATCH SIMPLE 在组含 null 时跳过、全非空时验证 target；禁止称 conditional FK 或改成
MATCH FULL。Blob.BA 一次绑定 Result+Blob+Key，不能拼出 Result A/Blob B/Key C。

## 8. 必需 Oracle

- Catalog 逐条匹配 candidate key、FK 列、MATCH、delete action 与 deferrability；
- Membership revoked 后历史 FK 存续，locked writer 仍拒绝旧 Role/Version；
- Access Audit 的 authoritative Principal 缺失或跨 `S` 时必须由上述非 nullable M FK
  拒绝，不能因五组 nullable identity 为空而绕过；
- RequestOp/TransitionOp/Preparation/Result/Usage/Receipt/Blob 任一 I 字段换绑均失败；
  Preparation 的 terminal transition 跨 Invocation/transition 换绑也失败；
- subtype kind、Result kind、SQL Receipt kind 交叉组合失败；
- `T` 内四条 runtime reciprocal FK 为 INITIALLY DEFERRED，其余内部 FK 为
  INITIALLY IMMEDIATE；普通 RPC 不能延迟，job-only cleanup 可在完整 aggregate 内
  延迟，缺任一步 commit 失败且零孤儿；
- Backend 先执行 `SET CONSTRAINTS ALL DEFERRED` 再调用每个 public RPC、Provisioner
  或 Terminal Commit，入口 exact normalization 仍使非 reciprocal FK 即时失败；Terminal
  与 Cleanup 在返回前恢复 IMMEDIATE，caller 不能扩宽 deferred allowlist；
- DELETE_PENDING cleanup 对一个完整 Invocation aggregate 可关闭整个 `T`；删漏任一
  RequestOp/Transition/Result/Receipt/Usage/Preparation/Blob 时 commit 失败，跨
  app/environment 或正常 lifecycle 调用永远不能进入 deferred 模式；
- Audit 三阶段 partial-null、跨 Result/Blob/Key 与跨 S 组合全部失败。
