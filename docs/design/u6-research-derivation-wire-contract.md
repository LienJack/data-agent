# U6 Research 派生 Hash 与 v2 Wire 合同

> `FROZEN_DESIGN_CONTRACT / TYPESCRIPT_IMPLEMENTED` ·
> `u6-research-derivation-wire@1.0.0`
>
> 本文唯一拥有跨 TypeScript/PostgreSQL Research Hash、Coverage/Stop v2 delta、
> Receipt hash codec 与 Enumerator Attestation Wire；表、事务、锁与 currentness 取
> `u6-research-derivation-receipt-contract.md`。
>
> 实施基线起点为 `data-agent@fe212f1`；TypeScript strict Hash/Reference、v2 tuple、
> 五类 Receipt、Budget Ledger 与 Enumerator Attestation 已实现。PG17 parity、
> DB-owned 表/Authority 与 C2a Root 未实现，不代表数据库或产品交付。

## 1. Research Hash 值域与前像

`ResearchHashJson` 只允许 `null | boolean | string | SafeInteger | array | plain object`。
数字是 `-9007199254740991..9007199254740991` 十进制整数；禁止 float、NaN、Infinity、
BigInt、`undefined`、sparse array、accessor、symbol、duplicate raw key 与自定义
prototype。key/value string 须为不含 U+0000 的 Unicode scalar sequence，拒绝孤立
UTF-16 surrogate（PostgreSQL `text/jsonb` 物理边界）。Timestamp、UUID、decimal 与大整数
用已验证 string；`-0` 规范为 `0`，不做 Unicode normalization。

v2 helper 的资源边界继承 `U6_WIRE_LIMITS`：最大嵌套深度 `32`，单容器最大 `256`
项，展开后的 container/value occurrence 分别不超过 `1024*32` 与 `1024*256`，
展开后的 canonical JSON 不超过 `16_777_216` bytes。共享 DAG 合法，但同一节点每次
展开均重新计入 occurrence/bytes；超限须在 SHA-256 前以 `TypeError` 失败关闭。

所有接收 `unknown` 的公开 compute/verify/binder 入口必须先用同一 descriptor、
prototype 与容器预算规则复制为 inert JSON，再把该副本交给 Zod。不得先让 Zod 读取原
对象；accessor 须在 getter 零调用时失败，自定义 prototype 与反射异常 Proxy 也须失败，
避免校验与 Hash 间出现可变对象视图。

```text
research_kernel_sha256(domain, value) =
  "sha256:" || lowercase_hex(
    SHA256(UTF8(CANONICAL_JSON({"hash_domain":domain,"value":value})))
  )
```

`CANONICAL_JSON` 按 ECMAScript JSON 序列化：object key 以 UTF-16 code unit 升序，array
保序，string 用 ECMAScript escaping，SafeInteger 用 `JSON.stringify`，无空白。现有 v1
`canonicalizeJson/computeResearchKernelHash` 不改义；C2 新增先执行
`assertResearchHashJson` 的 v2 helper。PostgreSQL 新增 internal
`u6_research_kernel_sha256(text,jsonb)`，只散列由 typed row/strict projection 重建的值；
raw JSON duplicate 只能由 TS/JSON-text ingress 在转 `jsonb` 前拒绝，数据库函数不接收
raw caller JSON，也不得声称能从 `jsonb` 恢复 duplicate。现有
`u6_domain_sha256` 继续只服务 DB command/event domain。

共同 golden vector：

| domain | value | digest |
| --- | --- | --- |
| `u6-research-kernel-golden@1` | `null` | `sha256:51dacd1978a6947cdcbde96adec1ea904902e13413dd68d51ec8002d73655848` |
| 同上 | `{"z":0,"a":["汉字",true,null,9007199254740991]}` | `sha256:0bdc423617d839a21b608aa2035f5d7bc5398e99a4ad3e9a3bb1f15d5ac5256b` |
| 同上 | `{"refs":["a","b"],"nested":{"quote":"\"","slash":"\\","control":"\n"}}` | `sha256:a6a35ba5cc1bc49654d895abeb22b83eb246d7bf2f584480782bda4db32ce65b` |
| 同上 | `{"\uE000":"pua","😀":"face"}` | `sha256:8d5d2a6a2f5bccb7968d5413b934a36cd4c5eac366d71e9390f661528452f888` |

TS 与真实 PG17 分别重算；末项证明 UTF-16 排序。U+0000、孤立 surrogate、sparse array、
超 SafeInteger 是 TS reject vector；duplicate raw key 由 JSON-text ingress Oracle 证明在
进入 `jsonb` 前失败。PG17 只证明 typed-row projection parity，函数不向 Browser/Backend
直接开放 EXECUTE。

## 2. Reference 排序

Artifact Reference Identity 固定为
`canonicalizeJson([app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash])`。
set/closure 先生成完整 Identity，duplicate 失败，再按 Identity 升序。现有
`orderedUniqueReferences/uniqueReferences` 用 `Map` 静默去重，不得改义或用于 v2；
C2 新增 `orderedDistinctReferencesV2`。Embedded Ref 先按 container identity，再按 strict
`node_id`。

`SupportedSubsetBinding.claim_refs[i] ↔ support_decision_refs[i]` 是 zipped relation，
非两个独立 set。按 `support_decision_refs` 完整 Identity 升序；`claim_refs` 仅拒重并
保留配对位置。两数组须等长，分别排序会破坏配对并失败关闭。

## 3. Coverage/Stop v2 exact delta

```ts
type ResearchBudgetLedgerBindingV2 = {
  ledger_version: "research-budget-ledger@2.0.0";
  evaluated_through_reservation_seq: NonNegativeInt;
  evaluated_through_budget_event_seq: NonNegativeInt;
  effective_limit: ResearchBudgetLimit;
  actual_used: ResearchBudgetUsage;
  unresolved_hold: ResearchBudgetUsage;
  charged_used: ResearchBudgetUsage;
  remaining: ResearchBudgetBalance;
  overage: ResearchBudgetBalance;
  top_up_allowed: boolean;
  ledger_hash: Sha256;
};
type CoverageStatePayloadV2 =
  Omit<CoverageStatePayload,"protocol_version"|"budget_ledger"> & {
    protocol_version: "coverage-state@2.0.0";
    budget_receipt: ReceiptBinding;
    budget_ledger: ResearchBudgetLedgerBindingV2;
  };
type CoverageStateV2Ref =
  ArtifactReferenceFor<"CoverageState","2.0.0","coverage-state@2.0.0">;
type ResearchStopDecisionV2Ref =
  ArtifactReferenceFor<"ResearchStopDecision","2.0.0","research-stop@2.0.0">;
type NoCandidateAssessment = {
  obligation_ref: ProofObligationRef;
  reason_codes: U6ResearchReasonCode[];
  constraint_closure_hash: Sha256;
  assessment_hash: Sha256;
};
type ResearchStopCommonV2 =
  Omit<
    ResearchStopCommon,
    "protocol_version"|"coverage_ref"|"budget_ledger"|"candidate_set"
  > & {
    protocol_version: "research-stop@2.0.0";
    coverage_ref: CoverageStateV2Ref;
    budget_receipt: ReceiptBinding;
    budget_ledger: ResearchBudgetLedgerBindingV2;
    candidate_set: ResearchStopCommon["candidate_set"] & {
      no_candidate_assessments: NoCandidateAssessment[];
    };
  };
type ResearchStopDecisionPayloadV2 =
  | (ResearchStopCommonV2 & {
      decision: "CONTINUE"; selected_next_query_ref: QueryContractRef;
    })
  | (ResearchStopCommonV2 & {
      decision: "REPLAN"; replan_obligation_refs: ProofObligationRef[];
      replan_assessment: {
        trigger: "PLAN_INVALIDATED" | "QUERY_COMPILATION_GAP";
        executable_with_remaining_budget: true; assessment_hash: Sha256;
      };
    })
  | (ResearchStopCommonV2 & { decision: "STOP_READY" })
  | (ResearchStopCommonV2 & {
      decision: "STOP_PARTIAL"; non_ready_terminal: "PARTIAL";
      partial_disclosure_codes: Identifier[];
    })
  | (ResearchStopCommonV2 & {
      decision: "STOP_NEEDS_MORE_RESEARCH";
      non_ready_terminal: "NEEDS_MORE_RESEARCH";
      resume_requirement_codes: Identifier[];
    })
  | (ResearchStopCommonV2 & {
      decision: "STOP_INCONCLUSIVE"; non_ready_terminal: "INCONCLUSIVE";
      inadmissibility_summary_hash: Sha256;
    });
```

未列字段、数组上限、strict object、联合分支与 refinement 继承 Wire 分册 §2–§3。
`NoCandidateAssessment` 按完整 Obligation identity 升序，与
`no_candidate_obligation_refs` 一一对应；`reason_codes` 非空，
`assessment_hash=research_kernel_sha256("u6-no-candidate-assessment@1",
{obligation_ref,reason_codes,constraint_closure_hash})`。`constraint_closure_hash` 是受控
Enumerator 对确定性约束闭包的权威摘要，C2a Root 必须从 immutable Enumerator
version/输入宇宙重放或解析该闭包。现行 `u6-candidate-set@1` 为兼容旧域，仍只覆盖
`{unresolved,candidateQueries,noCandidateRefs}`；新闭包由 Stop `decision_input_hash`、
Attestation 与 Candidate Receipt self-hash 额外绑定。
Registry 新增
`CoverageState/2.0.0/coverage-state@2.0.0` 与
`ResearchStopDecision/2.0.0/research-stop@2.0.0`。当前纯 Research Kernel 在 C2a
DB-owned Snapshot/Receipt 接通前仍产生两项 v1，故只暂存于显式
`L2_RESEARCH_TRANSITIONAL_WRITABLE_TUPLES`；C2a 必须同步切换 Kernel/Root 后再把 v1
原子转为 `HISTORICAL_READ_ONLY`。过渡 writer 不能进入 v2 Root，也不能获得数据库
Authority。

v2 Artifact 仅绑定已存在的 DB-owned Budget Snapshot Receipt，不引用未来 Receipt。
Artifact Writer 先提交普通 content-addressed Candidate；Stop Root 只收两个 exact v2 Ref，
从 Artifact 唯一定位 Snapshot，重算并让三张新 Receipt 单向绑定 Artifact，Terminal 再绑
Receipt chain。projection 不等只返回 stale/tampered，调用方提交新 revision，DB 不改旧
Artifact。

九字段 Usage 中 input/output token 是 `provider_tokens` 分量；七字段 Balance 是 Run
限额轴。每个 Usage 要求
`provider_tokens=provider_input_tokens+provider_output_tokens`。七轴映射为
`max_steps/max_model_calls/max_sql_executions/max_source_calls/max_elapsed_ms/
max_provider_tokens_per_run/max_provider_cost_microusd_per_run`；per-call token 上限在每个
MODEL Reserve/Settle 验证。

## 4. Enumerator Attestation Wire

```ts
type CandidateEnumeratorAttestation = {
  protocol_version: "candidate-enumerator-attestation@1.0.0";
  attestation_id: ImmutableId;
  scope: AppScope;
  run_id: ImmutableId;
  issuer_principal_id: PrincipalId;
  issuer_capability_id: ImmutableId;
  issuer_authority_epoch: NonNegativeInt;
  idempotency_key: IdempotencyKey;
  coverage_ref: CoverageStateV2Ref;
  budget_receipt: ReceiptBinding;
  budget_input_hash: Sha256;
  enumerator_version: Version;
  eig_policy_version: Version;
  implementation_digest: Sha256;
  query_contract_universe_refs: QueryContractRef[];
  unresolved_obligation_refs: ProofObligationRef[];
  no_candidate_obligation_refs: ProofObligationRef[];
  no_candidate_assessments: NoCandidateAssessment[];
  candidate_queries: CandidateQueryAssessment[];
  enumeration_universe_hash: Sha256;
  candidate_set_hash: Sha256;
  attestation_command_hash: Sha256;
  input_hash: Sha256;
  attestation_hash: Sha256;
  committed_at: Timestamp;
};
```

表的 semantic UQ 是
`(S,run_id,coverage_ref_identity,budget_receipt_id,budget_receipt_hash,
enumerator_version,eig_policy_version,enumeration_universe_hash)`；同键只能有一个
output。`budget_input_hash` 必须等于该 Receipt。issuer 必须是
`RESEARCH_STOP_AUTHORITY`，并与随后 Root caller 的 principal/capability/epoch exact。
`input_hash` domain `u6-candidate-enumerator-attestation-input@1`，material 是
`Omit<CandidateEnumeratorAttestation,
"attestation_id"|"input_hash"|"attestation_hash"|"committed_at">`；
`attestation_hash` domain `u6-candidate-enumerator-attestation@1`，覆盖含 input_hash
与 DB committed_at、除自身外全部字段。

`attestation_id=attestation_operation_id`；
`attestation_command_hash=research_kernel_sha256(
"u6-candidate-enumerator-attestation-command@1",
strict IssueCandidateEnumeratorAttestationInput)`。RPC 先按 ID/idempotency 查旧行，同
command Hash 返回原 Attestation，异 Hash conflict；仅新命令生成 DB time/input/hash。

QueryContract universe predicate 固定：同 `S/run`、active exact revision、
`query_contract.evidence_plan_ref` 等于 Coverage 的 exact `evidence_plan_ref`。旧 Plan
即使仍 active 也排除；同一 Query identity 多个 active revision、未通过 QueryContract
strict/Policy/Schema binding 或 cross-plan ref 直接失败。Universe 每个 QueryContract
须在 Attestation 恰有一个 Assessment（含 INADMISSIBLE/BUDGET_BLOCKED），不得遗漏；
Assessment 的非空 `obligation_refs` 必须属于 current Plan 的 unresolved set，不做
first-wins。

## 5. Hash domain 与 exact projection

所有 `input_hash` 都是
`research_kernel_sha256(input_domain, exact_projection)`；所有 Receipt Hash 都是
`research_kernel_sha256(receipt_domain, strict receipt excluding only receipt_hash)`。
`committed_at` 由 DB 生成 UTC RFC3339 六位小数并进入 Receipt Hash。

```ts
type ReceiptBinding = { receipt_id: ImmutableId; receipt_hash: Sha256 };
type ReservationBudgetStateProjection = {
  reservation_id: ImmutableId;
  reservation_seq: PositiveInt;
  resource_kind: "MODEL" | "SQL" | "TOOL";
  state:
    | "RESERVED" | "IN_USE" | "SETTLED" | "SETTLED_OVER_LIMIT"
    | "CANCELLED" | "EXPIRED" | "ABANDONED";
  reserved_usage: ResearchBudgetUsage;
  actual_usage: ResearchBudgetUsage | null;
  outcome_usage_ref: SystemRecordReference | null;
  outcome_unknown_hash: Sha256 | null;
  end_reason_code: Identifier | null;
};
type BudgetLedgerInputHashMaterial = {
  research_brief_ref: ResearchBriefRef;
  runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1";
  runtime_limits_hash: Sha256;
  tenant_policy_version: Version;
  tenant_policy_hash: Sha256;
  budget_epoch: PositiveInt;
  budget_started_at: Timestamp;
  evaluated_at: Timestamp;
  evaluated_through_reservation_seq: NonNegativeInt;
  evaluated_through_budget_event_seq: NonNegativeInt;
  budget_event_head_hash: Sha256;
  ordered_budget_event_hashes: Sha256[];
  ordered_reservation_states: ReservationBudgetStateProjection[];
  outstanding_set_hash: Sha256;
};
type CoverageDerivationInputHashMaterial = {
  evidence_plan_ref: EvidencePlanRef;
  budget_receipt: ReceiptBinding;
  version_frontier: VersionFrontier;
  version_frontier_hash: Sha256;
  closure_refs: CoverageDerivationReceipt["closure_refs"];
  kernel_version: Version;
};
type CandidateEnumerationInputHashMaterial = {
  coverage_receipt: ReceiptBinding;
  budget_receipt: ReceiptBinding;
  enumerator_attestation_id: ImmutableId;
  enumerator_attestation_hash: Sha256;
  enumerator_head_version: NonNegativeInt;
  enumerator_version: Version;
  eig_policy_version: Version;
  query_contract_universe_refs: QueryContractRef[];
};
type StopDerivationInputHashMaterial = {
  stop_ref: ResearchStopDecisionV2Ref;
  coverage_ref: CoverageStateV2Ref;
  coverage_receipt: ReceiptBinding;
  candidate_receipt: ReceiptBinding;
  budget_receipt: ReceiptBinding;
  supported_subset: SupportedSubsetBinding;
  required_disclosures: Identifier[];
  pre_stop_readiness_hash: Sha256;
  kernel_version: Version;
  enumerator_version: Version;
  eig_policy_version: Version;
};
type InputWatermarkInputHashMaterial = {
  certificate_ref:
    ArtifactReferenceFor<"ReportReadyCertificate","3.0.0","report-ready@3.0.0">;
  observed_event_seq: NonNegativeInt;
  observed_head_hash: Sha256;
  certificate_input_closure_hash: Sha256;
};
type StrictReceiptHashMaterial<T extends { receipt_hash: Sha256 }> =
  Omit<T,"receipt_hash">;
```

上述类型是 exact key/nesting 合同：无 optional key；空集为 `[]`，不存在的判别字段由
对应 strict union 排除而不是写 `undefined`。Reference set/closure 依 §2 拒重排序；
`ordered_budget_event_hashes` 是 Event Chain，须按 `budget_event_seq` 保序、拒重且末项
等于 Head，不得按随机 digest 字典序排序。

`ReservationBudgetStateProjection` 仅描述一次受控资源调用，不含 `steps` 或
`elapsed_ms`：MODEL 只允许 `model_calls` 与 provider token/cost 分量，SQL 只允许
`sql_executions`，当前 `NON_SOURCE` TOOL 的九字段 Usage 必须全零。MODEL/SQL
`reserved_usage` 的主调用轴必须恰好为 `1`。`SETTLED` 要求所有 actual 维度不超过
reserved；`SETTLED_OVER_LIMIT` 要求至少一个 actual 维度严格超过 reserved。post-I/O
`CANCELLED` 仍按 committed OutcomeUsage 记 actual，但须 within-limit；任一轴超额的唯一
合法终态是 `SETTLED_OVER_LIMIT`。

主 input 引用的四个二级 Hash 须独立重算，不信任存储列：

```ts
type RuntimeLimitsHashMaterial = {
  runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1";
  limits: ResearchBudgetLimit;
};
type TenantBudgetPolicyHashMaterial = {
  scope: AppScope;
  tenant_policy_version: Version;
  limits: ResearchBudgetLimit;
  top_up_allowed: boolean;
};
type OutstandingReservationSetHashMaterial = {
  scope: AppScope;
  run_id: ImmutableId;
  budget_epoch: PositiveInt;
  reservations: ReservationBudgetStateProjection[];
};
type EnumerationUniverseHashMaterial = {
  coverage_ref: CoverageStateV2Ref;
  budget_input_hash: Sha256;
  enumerator_version: Version;
  eig_policy_version: Version;
  query_contract_universe_refs: QueryContractRef[];
  unresolved_obligation_refs: ProofObligationRef[];
};
```

`runtime_limits_hash`、`tenant_policy_hash`、`outstanding_set_hash` 与
`enumeration_universe_hash` 分别使用 domain
`u6-research-runtime-limits@1`、`u6-tenant-budget-policy@1`、
`u6-outstanding-reservation-set@1`、`u6-candidate-enumeration-universe@1`。
Runtime limits 等于代码常量；Policy 由 current immutable version 行重建；outstanding
只含 `RESERVED|IN_USE|ABANDONED`，按 `reservation_seq,reservation_id` 排序且与主
`ordered_reservation_states` 的过滤投影逐字相等；Universe 两个 Ref 数组各自依 §2 拒重
排序并逐字等于 Attestation 输入。TS/PG17 fixture 须先覆盖四个二级 Hash，再覆盖主 input
hash；以存储 digest 拼主前像无效。

| Kind | input domain / exact projection | output hash | receipt domain |
| --- | --- | --- | --- |
| Budget | `u6-budget-ledger-input@2` / `BudgetLedgerInputHashMaterial` | `ledger_hash=u6-research-budget-ledger@2(ledger without ledger_hash)` | `u6-budget-ledger-receipt@2` |
| Coverage | `u6-coverage-derivation-input@2` / `CoverageDerivationInputHashMaterial` | `coverage_ref.content_hash` | `u6-coverage-derivation-receipt@1` |
| Candidate | `u6-candidate-enumeration-input@1` / `CandidateEnumerationInputHashMaterial` | `candidate_set_hash`，旧 `u6-candidate-set@1` 不改义 | `u6-candidate-enumeration-receipt@2` |
| Stop | `u6-stop-derivation-input@2` / `StopDerivationInputHashMaterial` | `stop_ref.content_hash`；另重算 payload `u6-stop-decision@1` | `u6-stop-derivation-receipt@2` |
| Input Watermark | `u6-input-watermark-input@1` / `InputWatermarkInputHashMaterial` | Certificate content hash | `u6-input-watermark-receipt@1` |

Projection 是上述 strict object，不接受省略 key 或改成 hash-of-hash；Reference array
只用 §2 顺序。各 kind 的 `protocol_version` 是
`research-budget-ledger-receipt@2.0.0`、
`coverage-derivation-receipt@1.0.0`、
`candidate-enumeration-receipt@2.0.0`、
`research-stop-derivation-receipt@2.0.0` 与
`research-input-watermark-receipt@1.0.0`。

Candidate Receipt v2 是有意的 Wire 破坏性变更。首次冻结的
`CandidateEnumerationInputHashMaterial` 与其
`u6-candidate-enumeration-input@1` 已包含 `enumerator_head_version`，因此 input
projection/domain 未改义；v2 仅把该字段加入 Receipt row/hash。否则 Head 前进后，历史
Receipt 只剩 input hash，无法从已提交材料恢复当时版本。该字段不得是 Receipt
Wire/hash 外的 DB-only audit 列。

Candidate v2 改变 Stop 父图，首次 C2 只写 Stop v2；禁止 v1
discriminant/domain 双义。

DB-only Budget Event 不冒充 Research Hash；保存非负 before/after，不存歧义 signed delta：

```ts
type ResearchBudgetEvent = {
  budget_epoch: PositiveInt;
  budget_event_seq: PositiveInt;
  event_kind:
    | "BUDGET_OPENED" | "STEP_BEGIN" | "RESERVED" | "BEGUN"
    | "SETTLED" | "CANCELLED" | "EXPIRED" | "ABANDONED";
  source_operation_kind: Identifier;
  source_operation_id: ImmutableId;
  reservation_id: ImmutableId | null;
  logical_step_id: ImmutableId | null;
  actual_before: ResearchBudgetUsage;
  actual_after: ResearchBudgetUsage;
  hold_before: ResearchBudgetUsage;
  hold_after: ResearchBudgetUsage;
  uncertainty_before: {
    active_count: NonNegativeInt;
    outcome_unknown_count: NonNegativeInt;
    abandoned_count: NonNegativeInt;
  };
  uncertainty_after: {
    active_count: NonNegativeInt;
    outcome_unknown_count: NonNegativeInt;
    abandoned_count: NonNegativeInt;
  };
  previous_event_hash: Sha256;
  committed_at: Timestamp;
  event_hash: Sha256;
};
```

`BUDGET_OPENED` 两 ID 都 null，Usage 与三计数全零，其 `previous_event_hash` 固定为
`sha256:3bc87b2221d91db1a157ce845e4ce6667abd5168a634ac0dfbc0c39bc0fac859`
（`SHA256(UTF8("u6-research-budget-event-genesis@1.0.0"))`）；Head 创建前
`last_budget_event_hash=null`，提交 genesis 后等于其 `event_hash`。`STEP_BEGIN` 仅
logical step 非空且只让
`actual.steps+1`；其余仅 reservation 非空。Reserve 只能增加对应 hold，Begin 只改状态，
Settle/Cancel 释放 hold 并按 committed OutcomeUsage 增加 actual，Expire 仅释放 pre-I/O
hold，Abandon 保持 hold 并移动计数。每个 before 等于上一 event after；三计数逐字
等于事件后 Reservation 集合，Usage 满足 provider input+output=total、source_calls=0。

```text
event_hash = u6_domain_sha256(
  "u6-research-budget-event@1.0.0",
  {run_id,budget_epoch,budget_event_seq,event_kind,source_operation_kind,
   source_operation_id,reservation_id,logical_step_id,actual_before,actual_after,
   hold_before,hold_after,uncertainty_before,uncertainty_after,
   previous_event_hash,committed_at}
)
```

缺失字段用 JSON `null`，不省略 key；同一 DB transaction time 以固定 RFC3339 字符串进入
前像。TS 与真实 PG17 fixture 须逐 kind 各有 golden input/output/receipt/event vector；
向量随 v2 schema 提交，缺一则 C2a Gate 固定失败。

## 6. Receipt、命令与 Provisioner exact Wire

表列、FK 与事务取 Derivation Receipt；本节唯一拥有 strict object：

```ts
type DerivationReceiptCommon = {
  protocol_version: string;
  receipt_id: ImmutableId;
  scope: AppScope;
  run_id: ImmutableId;
  issuer_principal_id: PrincipalId;
  issuer_capability_id: ImmutableId;
  issuer_authority_epoch: NonNegativeInt;
  idempotency_key: IdempotencyKey;
  input_hash: Sha256;
  output_hash: Sha256;
  receipt_hash: Sha256;
  committed_at: Timestamp;
};
type BudgetLedgerReceipt = DerivationReceiptCommon & {
  protocol_version: "research-budget-ledger-receipt@2.0.0";
  snapshot_command_hash: Sha256;
  research_brief_ref: ResearchBriefRef;
  runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1";
  runtime_limits_hash: Sha256;
  tenant_policy_version: Version;
  tenant_policy_hash: Sha256;
  budget_epoch: PositiveInt;
  budget_started_at: Timestamp;
  evaluated_through_reservation_seq: NonNegativeInt;
  evaluated_through_budget_event_seq: NonNegativeInt;
  evaluated_at: Timestamp;
  valid_until: Timestamp;
  outstanding_set_hash: Sha256;
  active_count: NonNegativeInt;
  outcome_unknown_count: NonNegativeInt;
  abandoned_count: NonNegativeInt;
  actual_used: ResearchBudgetUsage;
  unresolved_hold: ResearchBudgetUsage;
  ledger: ResearchBudgetLedgerBindingV2;
};
type CoverageDerivationReceipt = DerivationReceiptCommon & {
  protocol_version: "coverage-derivation-receipt@1.0.0";
  coverage_ref: CoverageStateV2Ref;
  evidence_plan_ref: EvidencePlanRef;
  budget_receipt_id: ImmutableId;
  budget_receipt_hash: Sha256;
  version_frontier: VersionFrontier;
  version_frontier_hash: Sha256;
  closure_refs: {
    obligation_execution_decision_refs: ObligationExecutionDecisionRef[];
    query_evidence_refs: QueryEvidenceRef[];
    atomic_claim_refs: AtomicClaimRef[];
    evidence_relation_refs: EvidenceRelationRef[];
    support_decision_refs: SupportDecisionRef[];
    hypothesis_assessment_refs: HypothesisAssessmentRef[];
  };
  coverage_input_hash: Sha256;
  kernel_version: Version;
};
type CandidateEnumerationReceipt = DerivationReceiptCommon & {
  protocol_version: "candidate-enumeration-receipt@2.0.0";
  coverage_receipt_id: ImmutableId;
  coverage_receipt_hash: Sha256;
  budget_receipt_id: ImmutableId;
  budget_receipt_hash: Sha256;
  enumerator_head_version: NonNegativeInt;
  enumerator_version: Version;
  eig_policy_version: Version;
  enumerator_capability_id: ImmutableId;
  enumerator_authority_epoch: NonNegativeInt;
  enumerator_attestation_id: ImmutableId;
  enumerator_attestation_hash: Sha256;
  unresolved_obligation_refs: ProofObligationRef[];
  no_candidate_obligation_refs: ProofObligationRef[];
  no_candidate_assessments: NoCandidateAssessment[];
  candidate_queries: CandidateQueryAssessment[];
  query_contract_universe_refs: QueryContractRef[];
  enumeration_universe_hash: Sha256;
  candidate_set_hash: Sha256;
};
type ResearchStopDerivationReceipt = DerivationReceiptCommon & {
  protocol_version: "research-stop-derivation-receipt@2.0.0";
  stop_ref: ResearchStopDecisionV2Ref;
  coverage_ref: CoverageStateV2Ref;
  coverage_receipt_id: ImmutableId;
  coverage_receipt_hash: Sha256;
  candidate_receipt_id: ImmutableId;
  candidate_receipt_hash: Sha256;
  budget_receipt_id: ImmutableId;
  budget_receipt_hash: Sha256;
  supported_subset: SupportedSubsetBinding;
  required_disclosures: Identifier[];
  pre_stop_readiness_hash: Sha256;
  kernel_version: Version;
  enumerator_version: Version;
  eig_policy_version: Version;
  decision: ResearchStopDecisionPayloadV2["decision"];
  decision_input_hash: Sha256;
};
type InputEventWatermarkReceipt = DerivationReceiptCommon & {
  protocol_version: "research-input-watermark-receipt@1.0.0";
  observed_event_seq: NonNegativeInt;
  observed_head_hash: Sha256;
  certificate_ref:
    ArtifactReferenceFor<"ReportReadyCertificate","3.0.0","report-ready@3.0.0">;
  certificate_input_closure_hash: Sha256;
};
```

命令/结果同样 strict；DB 生成字段不得出现在 command：

```ts
type BeginResearchStepInput = StrictCommandBase & {
  step_operation_id: ImmutableId;
  logical_step_id: ImmutableId;
  step_kind: "PLAN" | "QUERY" | "EVIDENCE" | "ANALYZE" | "REPORT";
  parent_step_id: ImmutableId | null;
  attempt_id: ImmutableId;
  worker_fence: PositiveInt;
  step_input_hash: Sha256;
};
type BegunResearchStep = {
  step_operation_id: ImmutableId;
  logical_step_id: ImmutableId;
  step_seq: PositiveInt;
  budget_event_seq: PositiveInt;
  created: boolean;
  committed_at: Timestamp;
};
type IssueCandidateEnumeratorAttestationInput = StrictCommandBase & {
  attestation_operation_id: ImmutableId;
  coverage_ref: CoverageStateV2Ref;
  budget_receipt: ReceiptBinding;
  budget_input_hash: Sha256;
  enumerator_version: Version;
  eig_policy_version: Version;
  query_contract_universe_refs: QueryContractRef[];
  unresolved_obligation_refs: ProofObligationRef[];
  no_candidate_obligation_refs: ProofObligationRef[];
  no_candidate_assessments: NoCandidateAssessment[];
  candidate_queries: CandidateQueryAssessment[];
  enumeration_universe_hash: Sha256;
  candidate_set_hash: Sha256;
};
type IssueBudgetLedgerSnapshotInput = StrictCommandBase & {
  snapshot_operation_id: ImmutableId;
  research_brief_ref: ResearchBriefRef;
};
type BackendArtifactCommitBase = {
  schema_version: "1.0.0";
  scope: AppScope;
  run_id: ImmutableId;
  operation_id: ImmutableId;
  idempotency_key: IdempotencyKey;
  worker_fence: PositiveInt;
  expected_active_revision: NonNegativeInt;
};
type BackendDbCommand<T> = {
  protocol_version: "u6-backend-db-command@1.0.0";
  command: T;
};
type RunLockedArtifactCommitInput = BackendArtifactCommitBase & (
  | { commit_mode: "ORDINARY_L2"; candidate: L2ArtifactDocument }
  | { commit_mode: "GROUNDING_AUTHORITY"; candidate: GroundingAuthorityDocument }
  | { commit_mode: "MODEL_CERTIFICATION"; candidate: ModelCertificationClaims }
);
type RunLockedArtifactCommitResult = {
  reference: ArtifactReference;
  created: boolean;
};
```

`MODEL_CERTIFICATION` 只收 server Adapter 已验证的 authoritative Draft，DB 再验证
`ModelCertificationClaims` strict、revision=1、`content_hash=probe_hash`、无明文秘密、
`expected_active_revision=0`；同 identity 同内容 replay，异内容 conflict。三分支的 Adapter
都严格拒绝 `worker_fence=0`，并从当前方法入参确定性派生：

```text
operation_id = UUIDv5(
  "ece8bead-86b5-4704-810e-bcc890498f25",
  UTF8(CANONICAL_JSON([scope,run_id,artifact_id,artifact_type,revision]))
)
idempotency_key = "backend-artifact:" || operation_id
command_hash = research_kernel_sha256(
  "u6-backend-artifact-commit-command@1",
  {commit_mode,scope,run_id,worker_fence,expected_active_revision,candidate}
)
```

DB 重算三者；锁 Run 后先查 operation：同 Hash replay、异 Hash conflict；仅新 operation
重验 fence/terminal absent 并锁 Artifact。Grounding 另需 OWNER，U6 reserved tuple 仍
拒绝；operation/idempotency 不受用户控制。

第三份 committed deployment 输入固定为
`infra/supabase/apps/data-agent/u6-derivation-policy-manifest.json`：

```ts
type U6DerivationPolicyManifest = {
  protocol_version: "u6-derivation-policy-manifest@1.0.0";
  scope: AppScope;
  deployment_id: ImmutableId;
  budget_policy: {
    tenant_policy_version: Version;
    limits: ResearchBudgetLimit;
    top_up_allowed: boolean;
    tenant_policy_hash: Sha256;
  };
  enumerator: {
    enumerator_version: Version;
    eig_policy_version: Version;
    input_schema_version: "candidate-enumerator-input@1.0.0";
    implementation_digest: Sha256;
    enumerator_version_hash: Sha256;
  };
  manifest_hash: Sha256;
};
type ProvisionDerivationPolicyInput = {
  protocol_version: "u6-derivation-policy-manifest@1.0.0";
  operation_id: ImmutableId;
  manifest: U6DerivationPolicyManifest;
  request_hash: Sha256;
};
type ProvisionedDerivationPolicy = {
  operation_id: ImmutableId;
  manifest_hash: Sha256;
  tenant_policy_version: Version;
  enumerator_version: Version;
  created: boolean;
  committed_at: Timestamp;
};
```

Policy/Enumerator 子对象分别按
`u6-tenant-budget-policy@1`（即 `TenantBudgetPolicyHashMaterial`）与
`u6-enumerator-version@1`（exact `{scope,enumerator_version,eig_policy_version,
input_schema_version,implementation_digest}`）重算；manifest 按
`u6-derivation-policy-manifest@1`、排除自身 Hash 重算。Provisioner command 另带
`operation_id/request_hash`，同 operation 同 input replay；按
`BUDGET_POLICY→ENUMERATOR`、再按 version UTF-8 bytes 锁旧 Head/exact version，
append immutable version 后 CAS Head。空/重复、回退、同 version 异 Hash 或跨 Scope/
deployment 全失败。

## 7. TypeScript 实施边界与验证入口

`@data-agent/contracts` 当前提供：

- `computeResearchBudgetLedgerV2Hash` /
  `verifyResearchBudgetLedgerBindingV2`，按
  `u6-research-budget-ledger@2` 重算完整 Ledger；
- 五类 `compute*InputHash`、`computeDerivationReceiptHash`、
  `verifyDerivationReceipt(receipt,inputMaterial,subordinateContext)`，后者同时检查
  strict input projection 与 Receipt 重复字段、二级派生 Hash 和 Receipt self-hash；
  Budget 从固定字段重建 strict Snapshot command 并重算 `snapshot_command_hash`；
  Coverage 将 Frontier 三项 Ref 纳入同 Scope/Run 校验；Budget context 须含 Runtime
  Limits/Tenant Policy material 与 Brief Budget，重算逐轴最小 `effective_limit` 并由
  Reservation 投影重建 Outstanding Set；Candidate context 须含 exact Attestation、
  Budget/Coverage Receipt，重验四者 Scope/Run 与 Coverage→Budget 绑定；Stop context
  须含 exact Stop v2、Candidate Receipt 及其 full context，递归重验
  Attestation/Coverage/Budget，并逐字闭合 Candidate Query、unresolved/no-candidate
  ref、`NoCandidateAssessment`、版本、issuer、Supported Subset、decision 与三张上游
  Receipt；Coverage/Input Watermark 拒绝多余 context；
- `verifyCandidateEnumeratorAttestation(attestation,budgetReceipt)`，第二参数必填，
  先验证 Budget Receipt/Ledger self-hash 与 exact binding，再逐项重算
  `u6-candidate-assessment@1`、`u6-no-candidate-assessment@1` 及 Attestation 五层
  Hash；
- `verifyResearchStopDecisionV2(stop,budgetReceipt)` 逐项重算 Candidate/no-candidate
  Assessment、兼容域 `u6-candidate-set@1` 与 `u6-stop-decision@1`；该 verifier 证明
  Stop 自洽，只有再经 Stop Receipt full context 与 exact Candidate Receipt 闭合后，
  才能证明 Stop 没有换掉 Enumerator 的 candidate projection；
- Registry 已接受 `CoverageState/2.0.0/coverage-state@2.0.0` 与
  `ResearchStopDecision/2.0.0/research-stop@2.0.0`。C2a DB-owned Snapshot/Receipt
  接通前现有 Kernel 仍产出 v1 tuple，故 v1 暂列
  `L2_RESEARCH_TRANSITIONAL_WRITABLE_TUPLES`；C2a 必须同步切换 Kernel/Root 后再把它们
  原子降为 historical-only，不能提前破坏现有 Research Gate。

TypeScript verifier 只证明 strict bytes/Hash closure，无密钥 Hash 不证明 DB Authority。
调用方仍须从 PG exact FK/Registry resolver 取得 Receipt/versioned Reference；
`ArtifactReference` 不携带 schema/protocol version。PG17 parity、Authority/currentness、
锁与正向 Root Oracle 归 `10600`；缺证据时 Release=`HOLD`。
