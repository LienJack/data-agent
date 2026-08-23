# U6-C2 PostgreSQL 物理 Schema Descriptor 合同

> `FROZEN_TABLE_SURFACE / NOT_INSTALLABLE` ·
> `u6-c2-physical-schema-descriptor@1.0.0`
>
> 本文冻结 U6-C2 的物理 relation 边界、存储投影、Catalog/Inventory 完整性与失败恢复
> Oracle。Hash/Wire 取 Derivation Wire，事务与 currentness 取 Derivation Receipt，
> migration 窗口取 Migration Safety，权限与函数面取 Database Surface。
>
> 当前只冻结可进入 machine descriptor 的表面。正式 `10600`、function body hash、
> preflight query hash、PostgreSQL 17 live Catalog extractor/rollback Oracle 以及
> Hosted Supabase/Docker parity 尚未实现。任何文档通过都不能把
> `installable=false` 改写为已安装或可发布。

## 1. 两个“15”是独立集合

U6-C2 有两个碰巧都为 15 的集合，身份与基数必须分别验证：

1. **15 个 source segments** 是 renderer 的有序源码片段；
2. **15 张 core semantic tables** 是业务语义主表。

source segment 不是 relation，relation 也不按 segment 一一生成。为使 variable-length
Artifact Reference 对每个元素都有 declarative exact FK，物理表面还必须增加 5 张
parent-specific companion table。因此 C2 的新增 relation 总数是 **20**，不是 15。
renderer、descriptor 或测试若以“同为 15”为依据建立位置映射，必须失败。

### 1.1 15 张 core semantic tables

```text
app_data_agent.research_budget_policy_versions
app_data_agent.research_budget_policy_heads
app_data_agent.research_enumerator_versions
app_data_agent.research_enumerator_version_heads
app_data_agent.research_budget_events
app_data_agent.research_step_operations
app_data_agent.research_budget_ledger_receipts
app_data_agent.research_coverage_derivation_receipts
app_data_agent.research_candidate_enumerator_attestations
app_data_agent.research_candidate_enumeration_receipts
app_data_agent.research_stop_derivation_receipts
app_data_agent.research_input_event_heads
app_data_agent.research_input_events
app_data_agent.research_input_event_watermark_receipts
app_data_agent.research_backend_artifact_commit_operations
```

### 1.2 5 张 parent-specific companion tables

```text
app_data_agent.research_budget_ledger_input_bindings
app_data_agent.research_coverage_derivation_ref_bindings
app_data_agent.research_candidate_attestation_ref_bindings
app_data_agent.research_candidate_enumeration_ref_bindings
app_data_agent.research_stop_derivation_ref_bindings
```

这 5 张不是可选的“查询优化表”，而是 Receipt/Attestation 可逐字重放与 exact FK
完整性的一部分。禁止用一个 polymorphic global reference table、任意 `target_table text`
或 trigger-only 伪造 parent FK。

## 2. exact storage policy

### 2.1 顶层、嵌套与 Reference

存储规则固定如下：

- persisted Receipt/Attestation Wire 的每个**顶层标量**都有同名 typed column；
  不能只存一个整包 `jsonb`。Command→row 允许且只允许下列冻结 alias：
  `parent_step_id→parent_logical_step_id`、
  `snapshot_operation_id→receipt_id`、
  `attestation_operation_id→attestation_id`；除此之外改名必须先修订 Wire 与 descriptor；
- 顶层嵌套 object/array 同时保存 strict `jsonb`，供逐字回放与 Hash 重建；
- 单个 Artifact Reference 在 parent row 展开
  `*_ref_json/*_artifact_id/*_artifact_type/*_revision/*_content_hash`，或在明确指定的
  parent-specific companion 中保存；二者都必须有 exact FK；
- variable-length Artifact Reference 的每一个元素必须写 companion row；
- companion 保存 parent exact key、`canonical_path`、`binding_group`、`ordinal`、
  strict Ref JSON、artifact identity/type/revision/hash；Embedded Ref 另保存
  `node_id`；
- companion 对 parent 和 `app_data_agent.artifacts` 分别使用
  `ON DELETE RESTRICT NOT DEFERRABLE` exact FK。Ref JSON 只作 strict replay
  projection，**JSONB 本身没有、也不能冒充 FK**；
- parent row 的嵌套 JSON 与 companion closed set 必须由 owner function 在同一事务
  逐字比对；Catalog postcondition 再验证 constraint/trigger/body hash。只校验数量或
  JSON hash 不足以替代逐元素 identity/FK；
- 所有 ordinal 为**每个 `(canonical_path,binding_group)` 内**的 `0..255` safe
  integer，PK/UQ 使同一
  `(S,run,parent_id,parent_hash,canonical_path,binding_group,ordinal)` 唯一；
  canonical path 闭集、规范顺序和 duplicate 拒绝取 Wire，而非 SQL 默认排序。

共同 Reference companion 模板是：

```text
S=(app_id uuid, tenant_id uuid, environment text)
run_id uuid
parent_id uuid
parent_hash text
canonical_path text
binding_group text
ordinal integer
strict_ref_json jsonb
artifact_id uuid
artifact_type text
revision integer
content_hash text
node_id text|null
```

`binding_group` 不接受调用方自由文本，编码规则固定为：

- 单层数组、singular Ref 与 object member 使用字面量 `ROOT`，ordinal 是该
  canonical path 内的 Wire 顺序；singular Ref 固定为 0；
- `candidate_queries[*].query_contract_ref` 与
  `candidate_queries[*].obligation_refs` 使用
  `REF:` + `artifactReferenceIdentity(query_contract_ref)`，前者 ordinal=0，后者
  ordinal 在该 Query 内从 0 重置；
- `no_candidate_assessments[*].obligation_ref` 使用
  `EMBEDDED:` + `embeddedNodeReferenceIdentity(obligation_ref)`，ordinal=0；
- outer Candidate Query/Assessment 必须先按 Wire 的完整 identity 排序和拒重，再生成
  group；group 重复、未知前缀、空洞 ordinal 或跨 group 续号均失败。

因此最多 32×32 个 Candidate obligation refs 时，每组 ordinal 仍最多 31；不存在把
二维数组展平到一个 `0..255` 全局计数器的路径。`canonical_path` 保存带 `[*]` 的冻结
模板，不保存运行时数组下标；外层 identity 只进入规范 `binding_group`。

每张 Receipt parent 必须提供
`(S,run_id,receipt_id,receipt_hash)` exact UQ；Attestation parent 必须提供
`(S,run_id,attestation_id,attestation_hash)` exact UQ。companion 的
`parent_id/parent_hash` 以对应完整列组作 parent FK，不能只靠随机 UUID 或无 Hash
parent key。Artifact FK 固定到
`artifacts(S,run_id,artifact_id,artifact_type,revision,content_hash)`。Embedded Ref 的
`strict_ref_json.container_ref` 与展开 Artifact 列逐字相等，`node_id` 必须非空；
普通 Artifact Ref 的 `node_id` 必须为 NULL。以上分支由命名 CHECK 和 owner function
双重验证。

### 2.2 Budget input companion

`research_budget_ledger_input_bindings` 不是普通 Ref 表。它以 `binding_kind` 固定三支：

1. `ARTIFACT_REF`：保存 `research_brief_ref` 的 strict/expanded exact Artifact Ref；
2. `BUDGET_EVENT`：按 `budget_event_seq` 保存 event hash chain，并以
   `(S,run_id,budget_epoch,budget_event_seq,event_hash)` exact FK 到 immutable
   `research_budget_events`；
3. `RESERVATION_STATE`：按 `reservation_seq,reservation_id` 保存 strict
   `ReservationBudgetStateProjection`、projection hash 与快照时的 state，并以
   `(S,run_id,reservation_id)` exact FK 到 Reservation identity。

三支互斥 CHECK 禁止混填。Budget Event 行保持 immutable，所以 event exact FK 可证明
历史链；Reservation 后续可能合法转态，因此 companion 保存的是签发时 immutable
projection，而不是把当前 mutable Reservation state 伪称为历史 state。Receipt
`input_hash` 必须从这三支的完整 canonical closed set 重建；缺、重、乱序、event 断链或
projection 与签发事务快照不符均拒绝。该表由 Budget Receipt child-first cleanup 删除。

### 2.3 其他四张 Ref companion 的 canonical path

路径集合由 Wire 版本固定，不允许调用方自由提交：

- Coverage：
  `version_frontier.{semantic_release_ref,schema_snapshot_ref,policy_receipt_ref}` 与
  `closure_refs.{obligation_execution_decision_refs,query_evidence_refs,
  atomic_claim_refs,evidence_relation_refs,support_decision_refs,
  hypothesis_assessment_refs}`；
- Candidate Attestation：
  `query_contract_universe_refs`、`unresolved_obligation_refs`、
  `no_candidate_obligation_refs`、`no_candidate_assessments[*].obligation_ref`、
  `candidate_queries[*].query_contract_ref` 与
  `candidate_queries[*].obligation_refs`；
- Candidate Receipt：与 Attestation 的可变闭包相同，但 parent 是 exact
  Candidate Receipt；上游 Receipt ID/Hash 仍是 parent typed columns/FK；
- Stop Receipt：
  `supported_subset.claim_refs`、`supported_subset.support_decision_refs`。

Coverage/Stop 的 `coverage_ref`、`stop_ref`、`evidence_plan_ref` 等 singular Ref 在
parent row 展开；Watermark 的 `certificate_ref` 也在 parent 展开，因此不再创建第六张
companion。`required_disclosures`、reason code、budget usage/balance 等不是 Artifact
Reference，保留 strict JSON + Hash/跨字段 CHECK，不能为了凑表数写入 Ref companion。

## 3. target descriptor 与 Inventory 协议

### 3.1 顶层 Schema

machine descriptor 的导出符号固定为 `U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR`，语义结构为：

```ts
type U6C2PhysicalSchemaDescriptor = {
  protocol_version: "u6-c2-physical-schema-descriptor@1.0.0";
  target_inventory_protocol: "u6-schema-inventory@2.0.0";
  candidate_inventory_protocol:
    "u6-schema-inventory-candidate@2.0.0";
  status: "FROZEN_TABLE_SURFACE";
  installable: false;
  baseline: ImmutableC1Baseline;
  migrations: [
    ImmutableMigrationProjection<"10590">,
    PendingMigrationProjection<"10600">,
  ];
  source_segments: readonly SourceSegmentDescriptor[]; // exact 15
  semantic_core_relations: readonly string[]; // exact 15
  core_relations_are_source_segments: false;
  authority: AuthorityDescriptor;
  relation_additions: readonly PhysicalRelationDescriptor[]; // exact 20
  existing_relation_mutations:
    readonly ExistingRelationMutationDescriptor[]; // exact 11
  future_catalog_facets: BlockedCatalogFacetDescriptor;
  canonicalization: CanonicalizationDescriptor;
  release_blockers: readonly ReleaseBlocker[];
  physical_descriptor_hash: Sha256;
};
```

`u6-schema-inventory@1.0.0` 是已提交 `10590` 的 immutable live baseline；字段、字节和
hash 都不修改。C2 Candidate 从
`u6-schema-inventory-candidate@1.0.0` 升为
`u6-schema-inventory-candidate@2.0.0`，因为它新增
`physical_descriptor_hash` 且 target protocol 切换为
`u6-schema-inventory@2.0.0`。升级后的 target Inventory 使用 plural
`migrations=[10590,10600]`，其中 10590 name/hash 必须与 v1 baseline 逐字相等。

当前正式 `10600` 尚不存在，所以 descriptor 保持 `status=FROZEN_TABLE_SURFACE`、
`installable=false`。不得伪造 `10600` checksum、function body hash 或 preflight query
hash 来填满 Schema。只有全部 blocker 关闭后的 reviewed revision 才能生成 live v2
Inventory；v1 live 文件在那之前仍是唯一已安装事实。

### 3.2 完整 relation descriptor

每张新增和 existing relation 都必须完整列出：

```text
qualified_name / relation_kind / mutation_mode / owner
columns(name,type,nullable,default_expression,collation,identity/generated)
primary_key
unique_constraints(name,columns,nulls_not_distinct,deferrability)
foreign_keys(name,columns,target,target_columns,on_delete,on_update,deferrability)
checks(name,normalized_expression)
indexes(name,method,keys,include,unique,predicate)
rls(enabled,forced)
policies(name,command,roles,permissive,using,with_check)
relation_acl / column_acl / authority.default_acl
triggers(name,timing,events,level,when,function)
sequences
cleanup_owner / scope_columns / identity_order / cleanup_phases
maintenance_reasons / preflight_check_ids
```

空集合也必须显式为 `[]`；unknown/省略与 extra key 均失败。default、CHECK、predicate、
policy expression 使用 PG17 canonical extractor 的 normalized form，禁止比较
`pg_get_expr` 的环境相关空白。列顺序按 `attnum`，其他命名对象按
`qualified identity` UTF-8 bytes 升序。

## 4. exact 20-addition tuple

所有 relation 使用 schema `app_data_agent`，owner 固定
`data_agent_u6_data_owner`。下表的“特有字段”是在共同 `S`、共同 Receipt/Ref 模板之外
必须出现的 typed top-level columns；完整 columns/constraint/index 名称仍由 machine
descriptor 逐项承载。

| relation | 家族与主键 | 每表特有字段 |
| --- | --- | --- |
| `research_budget_policy_versions` | immutable version；PK `S,tenant_policy_version` | `limits_json,top_up_allowed,tenant_policy_hash,provision_operation_id,committed_at` |
| `research_budget_policy_heads` | mutable current head；PK `S` | `current_tenant_policy_version,current_tenant_policy_hash,head_version,updated_at` |
| `research_enumerator_versions` | immutable version；PK `S,enumerator_version` | `eig_policy_version,input_schema_version,implementation_digest,enumerator_version_hash,provision_operation_id,committed_at` |
| `research_enumerator_version_heads` | mutable current head；PK `S` | `current_enumerator_version,current_enumerator_version_hash,head_version,updated_at` |
| `research_budget_events` | append event；PK `S,run_id,budget_epoch,budget_event_seq` | `event_kind,source_operation_kind,source_operation_id,reservation_id,logical_step_id,actual_before_json,actual_after_json,hold_before_json,hold_after_json,uncertainty_before_json,uncertainty_after_json,previous_event_hash,event_hash,committed_at` |
| `research_step_operations` | append operation；PK `S,step_operation_id` | `run_id,budget_epoch,logical_step_id,parent_logical_step_id,step_seq,step_kind,step_input_hash,outbox_id,attempt_id,worker_fence,budget_event_seq,budget_event_hash,principal_id,idempotency_key,committed_at` |
| `research_budget_ledger_receipts` | common Receipt；PK `S,receipt_id` | `snapshot_command_hash,runtime_limits_version,runtime_limits_hash,tenant_policy_version,tenant_policy_hash,budget_epoch,budget_started_at,evaluated_through_reservation_seq,evaluated_through_budget_event_seq,evaluated_at,valid_until,outstanding_set_hash,active_count,outcome_unknown_count,abandoned_count,actual_used_json,unresolved_hold_json,ledger_json`；Brief Ref 展开 |
| `research_coverage_derivation_receipts` | common Receipt；PK `S,receipt_id` | `budget_receipt_id,budget_receipt_hash,version_frontier_json,version_frontier_hash,closure_refs_json,coverage_input_hash,kernel_version`；Coverage/EvidencePlan Ref 展开 |
| `research_candidate_enumerator_attestations` | append Attestation；PK `S,attestation_id` | `issuer_*`, `idempotency_key,budget_receipt_id,budget_receipt_hash,budget_input_hash,enumerator_version,eig_policy_version,implementation_digest,query_contract_universe_refs_json,unresolved_obligation_refs_json,no_candidate_obligation_refs_json,no_candidate_assessments_json,candidate_queries_json,enumeration_universe_hash,candidate_set_hash,attestation_command_hash,input_hash,attestation_hash,committed_at`；Coverage Ref 展开 |
| `research_candidate_enumeration_receipts` | common Receipt v2；PK `S,receipt_id` | `coverage_receipt_id/hash,budget_receipt_id/hash,enumerator_head_version,enumerator_version,eig_policy_version,enumerator_capability_id,enumerator_authority_epoch,enumerator_attestation_id/hash,unresolved_obligation_refs_json,no_candidate_obligation_refs_json,no_candidate_assessments_json,candidate_queries_json,query_contract_universe_refs_json,enumeration_universe_hash,candidate_set_hash` |
| `research_stop_derivation_receipts` | common Receipt v2；PK `S,receipt_id` | `coverage_receipt_id/hash,candidate_receipt_id/hash,budget_receipt_id/hash,supported_subset_json,required_disclosures_json,pre_stop_readiness_hash,kernel_version,enumerator_version,eig_policy_version,decision,decision_input_hash`；Stop/Coverage Ref 展开 |
| `research_input_event_heads` | mutable head；PK `S,run_id` | `next_event_seq,head_event_hash,updated_at` |
| `research_input_events` | append event；PK `S,run_id,event_seq` | `event_kind,subject_identity,subject_hash,source_operation_kind,source_operation_id,previous_event_hash,event_hash,committed_at` |
| `research_input_event_watermark_receipts` | common Receipt；PK `S,receipt_id` | `observed_event_seq,observed_head_hash,certificate_input_closure_hash`；Certificate Ref 展开 |
| `research_backend_artifact_commit_operations` | append operation；PK `S,operation_id` | `run_id,principal_id,idempotency_key,commit_mode,command_hash,expected_active_revision,worker_fence,adopted_legacy,committed_at`；committed Artifact Ref 展开 |
| `research_budget_ledger_input_bindings` | Budget companion；PK `S,run_id,receipt_id,receipt_hash,canonical_path,binding_group,ordinal` | `binding_kind,binding_group,budget_epoch,budget_event_seq,event_hash,reservation_id,reservation_seq,reservation_state,reservation_projection_json,reservation_projection_hash` 与 conditional Ref columns |
| `research_coverage_derivation_ref_bindings` | Ref companion；PK `S,run_id,receipt_id,receipt_hash,canonical_path,binding_group,ordinal` | 共同 companion fields；parent FK 到 Coverage Receipt |
| `research_candidate_attestation_ref_bindings` | Ref companion；PK `S,run_id,attestation_id,attestation_hash,canonical_path,binding_group,ordinal` | 共同 companion fields；parent FK 到 Attestation |
| `research_candidate_enumeration_ref_bindings` | Ref companion；PK `S,run_id,receipt_id,receipt_hash,canonical_path,binding_group,ordinal` | 共同 companion fields；parent FK 到 Candidate Receipt v2 |
| `research_stop_derivation_ref_bindings` | Ref companion；PK `S,run_id,receipt_id,receipt_hash,canonical_path,binding_group,ordinal` | 共同 companion fields；parent FK 到 Stop Receipt |

共同 Receipt 的 UQ/FK 固定为：

- UQ `(S,run_id,issuer_principal_id,idempotency_key)`；
- semantic UQ `(S,run_id,protocol_version,input_hash)`；
- downstream exact UQ `(S,run_id,receipt_id,receipt_hash)`；
- exact Run、Membership 与
  `(S,issuer_capability_id,issuer_authority_epoch,issuer_principal_id)` FK；
- `receipt_id/input_hash/output_hash/receipt_hash/committed_at` 全部 NOT NULL；
- Receipt 与 append operation/event/version/companion 均有 immutable trigger；
  current Head 只能由 owner RPC/Provisioner CAS，不装 append-only trigger。

Attestation 另固定 downstream exact UQ
`(S,run_id,attestation_id,attestation_hash)`，供其 companion 与 Candidate Receipt
逐字绑定；另有 semantic UQ
`(S,run_id,coverage_ref_identity,budget_receipt_id,budget_receipt_hash,
enumerator_version,eig_policy_version,enumeration_universe_hash)`，禁止同一输入产生多个
输出。Candidate→Attestation exact FK 还必须共同包含 issuer
principal/capability/epoch、Budget Receipt、Enumerator/EIG version、Universe Hash
与 Candidate Set Hash；Candidate 的 `enumerator_capability_id/authority_epoch` 以
CHECK 逐字等于共同 issuer，不能只绑定合法 Attestation ID/Hash 后换入另一套权威列。

Candidate Receipt 必须使用
`candidate-enumeration-receipt@2.0.0`，Receipt Hash domain 必须使用
`u6-candidate-enumeration-receipt@2`。原因是新增
`enumerator_head_version` 改变可重放 Wire 和 self-hash；继续用 v1 protocol 会让旧
verifier 在 Head 前进后无法区分历史 input。该字段已在本切片同步 TypeScript
Wire/verifier，正式 `10600` physical row 与 PG17 parity 仍待实现；禁止使用未进入
Receipt Wire 的 DB-only 隐藏列。

Stop Receipt 同步升级为
`research-stop-derivation-receipt@2.0.0` /
`u6-stop-derivation-receipt@2`，因为它的 subordinate contract 已从 Candidate v1
切换为 Candidate v2。继续沿用 Stop v1 discriminant/hash domain 会让同一个协议版本
对应两种父图。当前 package 为 private、10590 也没有这些 Receipt 表，因此本次是在
首次 installable 版本前修正，不提供会掩盖缺失 Head version 的 v1 writer。

## 5. exact 11-existing tuple 与六个 DDL 变更

existing tuple 固定为：

```text
app_data_agent.artifacts
app_data_agent.memberships
app_data_agent.outbox
app_data_agent.research_artifact_commit_operations
app_data_agent.research_authority_capabilities
app_data_agent.research_domain_terminals
app_data_agent.research_resource_reservations
app_data_agent.research_resource_run_heads
app_data_agent.research_stop_terminal_commits
app_data_agent.run_attempts
app_data_agent.runs
```

每项必须有非空 `maintenance_reasons[]`，值域仅
`ALTER|ACL|FUNCTION_LOCK|IMMEDIATE_FK_PARENT`，并记录
`preflight_check_id/query_hash/expected_count=0`、cleanup metadata、before/after
Catalog projection。没有物理 ALTER 的 relation 也不能省略其 function-lock、ACL 或
immediate-FK-parent 原因。

六张真正发生 DDL 的 existing relation 决策固定如下：

1. **`outbox`**
   - 增加 UQ `(S,outbox_id,run_id)`，作为 Step Operation 的稳定 Outbox parent key；
   - 禁止引用 mutable `active_attempt_id/run_fence` tuple，避免历史 Step 阻断 lease
     释放或换代；Attempt/Fence 另由 `run_attempts` exact FK 绑定。
2. **`research_artifact_commit_operations`**
   - 新增 `wire_protocol_version text`；
   - migration 只以 `candidate_json #>> '{payload,protocol_version}'` 回填，
     zero-null/值域
     preflight 后设 NOT NULL；它不是 generated column；
   - 新 RPC 必须显式写入该列，不能长期依赖 JSON expression；
   - 新增 `budget_receipt_id uuid` 与 `budget_receipt_hash text`，二者必须同时 NULL 或
     同时非 NULL；
   - Coverage/Stop v2 branch 必须为非 NULL 并 exact FK 到 Budget Receipt；legacy/v1
     与其他 tuple 必须为 NULL。branch CHECK 必须命名、进入 Catalog，不能只在函数体判断。
3. **`research_resource_run_heads`**
   - 增加 `next_step_seq,next_budget_event_seq,budget_epoch,budget_epoch_state,
     budget_started_at,last_budget_event_hash`；
   - migration 完成 legacy backfill 后，`next_reservation_seq` 与所有新增 seq/epoch
     列均无长期 default；新 RPC 显式写完整 ACTIVE/LEGACY row；
   - ACTIVE 必须有非空 `budget_started_at/last_budget_event_hash`；仅 legacy 允许二者
     为 NULL；
   - ACTIVE/LEGACY nullable 分支与 safe-integer CHECK 命名冻结，禁止把旧 Head 原地激活。
4. **`research_resource_reservations`**
   - 增加 `budget_epoch bigint NOT NULL` 与 `logical_step_id uuid NULL`；
   - legacy `epoch=0` 必须 `logical_step_id=NULL`；
   - ACTIVE MODEL/SQL 必须非 NULL 且 exact FK 到
     `research_step_operations(S,run_id,budget_epoch,logical_step_id)`；
   - ACTIVE TOOL 可为 NULL；若非 NULL，同样必须满足 exact Step FK。不能用
     `TOOL => always NULL` 误拒合法绑定，也不能让非 NULL TOOL 绕过 FK。
   - 增加 UQ `(S,run_id,reservation_id,budget_epoch)` 与
     `(S,run_id,reservation_id,budget_epoch,logical_step_id)`。Budget Event 先以首个
     non-null tuple 强制同 epoch Reservation；当 logical step 非空时再以第二个 optional
     FK 强制同 Reservation/epoch/step，不能因 `MATCH SIMPLE` 的 NULL 分支绕过 epoch。
5. **`research_stop_terminal_commits`**
   - 新增 `stop_derivation_receipt_id/hash` pair；
   - pre-C2 行由 preflight 要求为零，因此两列在 target 均为 NOT NULL，并使用
     descriptor 命名的 both-present CHECK；
   - C2 non-ready Research Stop commit 必须 exact FK 到 Stop Receipt，禁止合成历史
     Receipt。
6. **`research_domain_terminals`**
   - 新增同名 Stop Receipt pair；
   - `authority_kind='RESEARCH_STOP'` 且 terminal 为
     `PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE` 时必须 both-present；READY/STALE 以及
     非 Research Stop branch 必须 both-null；
   - branch CHECK 和 exact FK 分开命名、都进入 descriptor。

constraint/index 名称必须由 machine descriptor 单一拥有；实现不得先让 PostgreSQL
自动命名再从 live Catalog 反向接受。Existing UQ 依 Migration Safety 使用普通 unique
index + `ADD CONSTRAINT ... USING INDEX`，FK/CHECK 在同一事务 VALIDATE 后才可提交。

## 6. Catalog、函数、Trigger、Policy 与 ACL 完整性

### 6.1 函数

每个 created/replaced function 必须登记：

```text
schema/name/identity_arguments/result_type
language/volatility/parallel/null_input/security_definer/leakproof
search_path/owner/body_hash
dependency_relations/dependency_functions
authority_kind/artifact_domain/resource_kind
lock_profile/public_or_internal/caller_roles
execute_acl
```

函数清单至少闭合 hash/UUID primitive、五类 Receipt issuer、Artifact Run-first
committer、Budget/Step/Resource guard、Stop Root、Resolver/Provisioner、Lifecycle
cleanup 与 `platform.reject_immutable_mutation()` replacement。source segment 出现但
descriptor 不存在的函数、同签名 body hash 不同、额外 EXECUTE 或依赖第十二张
existing parent 都失败。

当前 function body 尚未冻结为最终 `sha256:<64hex>`，所以
`installable=false`。不得用函数名、源码 segment hash 或 TypeScript implementation hash
代替 PostgreSQL normalized body hash。

### 6.2 Trigger、RLS、Policy、ACL

- 20 张新增 relation 全部 owner=`data_agent_u6_data_owner`，
  `ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY`；
- immutable version/event/operation/Receipt/Attestation/companion 安装
  `BEFORE UPDATE OR DELETE` guard；Head 只允许受控 CAS；
- 每个 trigger 的 timing/event/level/WHEN/function identity 与 `tgfoid` dependency
  必须 exact；
- policy 逐 relation/command/role 固化 `permissive/USING/WITH CHECK`，不能用“Owner
  可访问”一句话代替；
- relation ACL 与 column ACL 分开；RPC Owner 只获每张 relation 已冻结的
  `SELECT/INSERT`，仅 mutable Head 增加 `UPDATE`；Cleanup 只获
  `SELECT/DELETE`，Provisioner 仅在 version/head relation 获同类最小权限；
- `data_agent_backend` 只获 public allowlist EXECUTE；Provisioner、RPC 与 Cleanup
  Owner 只获其 exact dependency；`service_role|anon|authenticated|PUBLIC|Job` 无 raw
  C2 table DML/internal EXECUTE；
- default ACL 必须为空，不允许 `GRANT ALL`、owner membership 或 default privilege
  形成旁路；
- 无 sequence 的 relation 在 descriptor 中写 `sequences=[]`，不能省略。

### 6.3 Role 与 extension

descriptor 逐 role 固化 `rolcanlogin/rolsuper/rolcreatedb/rolcreaterole/
rolinherit/rolreplication/rolbypassrls`、membership 与 SET ROLE 边；executor
`postgres` 的 Hosted/Docker 允许 `rolsuper` 不同，但必须 BYPASSRLS。运行角色沿用
Database Surface 的 NOLOGIN/NOSUPERUSER/NOINHERIT/NOBYPASSRLS 边界。

extension 至少登记 PG17 `pgcrypto` 的 exact schema=`extensions`、version 与 owner；
未知 extension、schema/version 漂移或 PG major 不在 `170000..179999` 失败关闭。

## 7. stable sort、Hash 与 PG17 extractor

descriptor 的 canonical sort 固定为：

1. migration 按 chain ordinal，source segment 按 frozen ordinal；
2. relation/function/trigger/policy/role/extension 按全限定 identity UTF-8 bytes；
3. column 按 `attnum`；constraint/index/ACL/dependency/preflight 按完整 identity
   UTF-8 bytes；
4. canonical JSON 沿 Research Hash 的 strict scalar/duplicate/extra-key 规则，但
   physical descriptor 使用独立 domain：

```text
physical_descriptor_hash =
  SHA256(
    UTF8("u6-c2-physical-schema-descriptor@1.0.0" || NUL ||
      CanonicalJson(descriptor excluding only physical_descriptor_hash))
  )
```

Candidate Inventory 必须逐字携带该 hash；target v2 Inventory 的 hash 又覆盖 plural
migrations 与完整 Catalog projection。两层 hash 不互相代替。

这里使用 descriptor 专属同步 codec：普通对象 key 按 UTF-16 code unit，identity
数组按 UTF-8 bytes，column 按 `attnum`；它不冒充 Receipt/Artifact 的 Research Hash
v2。validator 先验证 raw 内嵌 hash，再独立匹配 committed
`U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH`，因此改内容并重算 raw hash 仍失败。

PG17 extractor 必须只从 canonical system catalog 取事实，至少覆盖
`pg_namespace/pg_class/pg_attribute/pg_attrdef/pg_constraint/pg_index/
pg_trigger/pg_proc/pg_policy/pg_roles/pg_auth_members/pg_extension` 与 ACL 展开；
过滤 dropped/system-generated noise，并用 `pg_get_expr/pg_get_functiondef` 的冻结
normalizer。不得用 `information_schema`、ORM introspection、`pg_dump` 文本或 Docker
单边 snapshot 冒充 exact Catalog。

## 8. Maintenance、preflight 与 cleanup

11 张 existing relation 的 Maintenance Manifest 仍是唯一容量/锁闭集。descriptor 为
每张 relation 记录：

- exact maintenance reason；
- bytes-before-count limit；
- preflight id、全限定 SQL、`query_hash`、`expected_count=0`；
- DDL 前 Catalog expectation；
- cleanup owner/scope/identity order/phases；
- immediate FK parent 与 function lock dependency。

query hash 未由最终 SQL 生成前保持 blocker，禁止留空后宣称 installable。preflight
至少覆盖 duplicate/null/orphan/cross-S/run/epoch、Receipt pair branch、Ref companion
缺重乱序、legacy Head/Reservation 分类、Artifact protocol 回填、名称冲突与未知 ACL。

cleanup 必须把 5 张 companion 当 parent Receipt/Attestation 的 child；建议 child-first
局部序列为：

```text
Stop/Candidate Receipt/Candidate Attestation/Coverage/Budget companion
→ Stop/Candidate/Coverage/Budget Receipt 与 Attestation
→ Backend Artifact Operation
→ Input Event/Watermark
→ Budget Event/Reservation/Step/Head
→ Policy/Enumerator Head 与 Version
```

完整 rank 仍取 Cleanup 合同。每个新增 relation 必须恰好出现于 cleanup closed set，
residual=0；不能以 FK `CASCADE`、临时 disable trigger/RLS 或未登记 helper 简化删除。

## 9. failure、recovery 与 Release Oracle

### 9.1 必须失败的漂移

- 15 source segments 与 15 core tables 建立位置映射，或新增 relation 不是 exact 20；
- 少任一 companion、把 variable Ref 只存 JSONB、Ref JSON 与展开列/FK 不一致；
- Candidate Receipt 缺 `enumerator_head_version`、仍声称 v1 protocol/hash domain，或
  Head 前进后历史 replay 误用 current Head；
- target Inventory 仍为 v1、Candidate Inventory 仍为 v1，或 v2 `migrations` 少
  10590/10600 任一投影；
- 10590 immutable name/hash 漂移，或为尚不存在的 10600/函数/preflight 编造 hash；
- relation 少 column/default/constraint/index/policy/ACL/cleanup/maintenance facet，
  Catalog 多未知对象，或 stable sort/hash 在两次 extraction 间变化；
- Artifact operation 使用 generated JSON protocol 列，Resource Head 留长期 default，
  TOOL nullable 分支误判，Stop Receipt pair 只填一列；
- PG16、unknown extension/default ACL/raw Backend DML/internal EXECUTE 或第十二张
  existing relation dependency。

### 9.2 rollback 与恢复

`10600` 任一 preflight/DDL/VALIDATE/Catalog/Inventory/ledger 前失败，必须回滚到逐字
10590 baseline：无新增 20 relation、无 existing ALTER、无 function replacement、
trigger/policy/ACL/legacy classification、无 10600 ledger。恢复只允许修正源码/
descriptor/preflight 后在新维护窗口从整个 target 重跑，不能从 segment 续跑。

### 9.3 解除 HOLD 的最小证据

1. machine descriptor strict parser 与 duplicate/missing/extra/drift reject tests；
2. 正式 10600 bytes、checksum、全部 function body/preflight query hash；
3. PG17 clean + populated upgrade Catalog exact，所有 Receipt/Ref FK 与 replay 正反例；
4. 每个 segment/ledger 前 fault injection 的完整 rollback；
5. Backend/service/browser bypass 双连接反例；
6. Hosted Supabase 与 Docker 的相同 Migration bytes、v2 Inventory、Catalog 与 rollback
   Oracle。

缺任一项保持 `Release=HOLD`。本文冻结的是目标物理边界，不是安装证据。
