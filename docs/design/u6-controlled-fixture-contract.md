# U6 受控协议 Fixture 合同

> 状态：`FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED`
> 协议：`u6-controlled-fixture@1.0.0`
> Fixture：`retail-revenue-investigation-v1`
> 证据等级：`SYNTHETIC_PROTOCOL_FIXTURE`
> Benchmark / Demo / Release Evidence 资格：`false / false / false`

本文是 U6 实现代理与检查代理可独立加载的受控 Fixture 真值源。它冻结字面查询结果、
阈值、派生规则、RQ092 的 14 个 Mutation、配对反例和跨事务攻击 Oracle。实现不得从
Agent 输出、Mutation 名称、报告文本或测试代码中的预填结论读取期望结果；必须从本文
冻结的输入重新执行同一生产 Kernel。

本文只证明 U6 Research Authority 协议是否不可绕过，不证明真实业务结论、Benchmark
质量、Hosted/Docker 部署或 Release `GO`。U7 独占 Benchmark Manifest、Answer/Oracle、
Demo/Holdout 身份、License 和评分真值；U7 可以复用业务域或数据生成器，但不得读取本
Fixture 的字面行、阈值或期望终态作为 Benchmark 分数。

额外负测 `claim-tolerance-inflation` 把 Diagnostic Predicate 的固定
`tolerance: 0` 改成任意正数，必须在 Strict Parse 阶段失败；`title-claim-tamper` 在
确定性标题中注入“促销导致收入暴跌 95%”，必须
`REPORT_PROJECTION_AUTHORITY_INVALID`，不得签发 Certificate。

## 1. Strict 文档与注册规则

实现必须把本合同落成一个 `z.strictObject` 常量。所有嵌套对象同样使用
`z.strictObject`，固定列表使用 `z.tuple`；未知字段、缺字段、重复 ID、非有限数、
额外行、额外列或顺序漂移都必须失败。测试只能从 server-only Fixture Registry 按
`fixture_id + protocol_version` 解析，不能接受请求方上传的替代 Fixture。

```ts
type FiniteNumber = number; // z.number().finite()

type ClosedPredicate =
  | { operator: "GTE"; threshold: FiniteNumber }
  | { operator: "LTE"; threshold: FiniteNumber };

type ControlledHypotheses = readonly [
  {
    hypothesis_id: "promotion-mix";
    metric_alias: "promotion_decline_share";
    support_predicate: { operator: "GTE"; threshold: 0.60 };
    refute_predicate: { operator: "LTE"; threshold: 0.30 };
    expected_assessment: "SURVIVED";
  },
  {
    hypothesis_id: "late-refund";
    metric_alias: "late_refund_decline_share";
    support_predicate: { operator: "GTE"; threshold: 0.40 };
    refute_predicate: { operator: "LTE"; threshold: 0.20 };
    expected_assessment: "REFUTED";
  },
];

type PartialPreconditions = {
  hard_budget_cap: true;
  deliverable_supported_subset: true;
  budget_executable_query_count: 0;
};

type ExpectedPublicTerminal =
  | { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" }
  | { terminal: "STALE"; reason_code: "RUN_STALE" }
  | { terminal: "FAILED"; reason_code: "INTERNAL_EXECUTION_FAILED" }
  | null;

type MutationCase<
  MutationId extends string,
  Preconditions extends PartialPreconditions | null,
  Terminal extends ExpectedPublicTerminal,
  DomainReason extends string,
> = {
  mutation_id: MutationId;
  partial_preconditions: Preconditions;
  public_terminal: Terminal;
  domain_reason_code: DomainReason;
  certificate_issued: false;
  grant_issued: false;
};

type ControlledMutationRegistry = readonly [
  MutationCase<"citation-only", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "EVIDENCE_SUPPORT_INSUFFICIENT">,
  MutationCase<"hidden-conflict", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "MATERIAL_CONFLICT_UNDISCLOSED">,
  MutationCase<"critical-query-failure", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "CRITICAL_OBLIGATION_FAILED">,
  MutationCase<"stale-cross-revision", null,
    { terminal: "STALE"; reason_code: "RUN_STALE" },
    "EVIDENCE_REVISION_STALE">,
  MutationCase<"budget-false-complete", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION">,
  MutationCase<"writer-bypass", null,
    { terminal: "FAILED"; reason_code: "INTERNAL_EXECUTION_FAILED" },
    "REPORT_PROJECTION_AUTHORITY_INVALID">,
  MutationCase<"false-source-independence", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED">,
  MutationCase<"wrong-successful-sql", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "OBLIGATION_QUERY_SEMANTICS_MISMATCH">,
  MutationCase<"wrong-filter-successful-sql", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "OBLIGATION_QUERY_SEMANTICS_MISMATCH">,
  MutationCase<"bounded-universe-disclosure-omission", PartialPreconditions,
    { terminal: "PARTIAL"; reason_code: "EVIDENCE_PARTIAL" },
    "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED">,
  MutationCase<"supervisor-certificate-bypass", null, null,
    "REPORT_READY_AUTHORITY_REQUIRED">,
  MutationCase<"certificate-tamper", null,
    null,
    "REPORT_READY_CERTIFICATE_TAMPERED">,
  MutationCase<"certificate-semantic-hash-tamper", null,
    null,
    "CERTIFICATE_SEMANTIC_HASH_MISMATCH">,
  MutationCase<"current-ready-revocation-race", null,
    { terminal: "STALE"; reason_code: "RUN_STALE" },
    "READINESS_REVOKED_DURING_CONSUMPTION">,
];

type PartialPairGeneration = {
  base_mutation_ids: readonly [
    "citation-only",
    "hidden-conflict",
    "critical-query-failure",
    "budget-false-complete",
    "false-source-independence",
    "wrong-successful-sql",
    "wrong-filter-successful-sql",
    "bounded-universe-disclosure-omission",
  ];
  continue_suffix: "--continue";
  replan_suffix: "--replan";
  continue_template: {
    hard_budget_cap: false;
    deliverable_supported_subset: true;
    budget_executable_query_count: 1;
    executable_replan_count: 0;
    expected_decision: "CONTINUE";
    expected_reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE";
    public_terminal: null;
    certificate_issued: false;
    grant_issued: false;
  };
  replan_template: {
    hard_budget_cap: false;
    deliverable_supported_subset: true;
    budget_executable_query_count: 0;
    waiting_query_count: 0;
    budget_blocked_query_count: 0;
    open_obligation_count: 1;
    replan_trigger: "PLAN_INVALIDATED" | "QUERY_COMPILATION_GAP";
    executable_with_remaining_budget: true;
    expected_decision: "REPLAN";
    expected_reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED";
    public_terminal: null;
    certificate_issued: false;
    grant_issued: false;
  };
  generated_count: 16;
};

type ControlledFixtureContract = {
  protocol_version: "u6-controlled-fixture@1.0.0";
  fixture_id: "retail-revenue-investigation-v1";
  authority_kind: "SYNTHETIC_PROTOCOL_FIXTURE";
  benchmark_eligible: false;
  demo_truth_eligible: false;
  release_evidence_eligible: false;
  question: "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？";
  hypotheses: ControlledHypotheses;
  queries: readonly [Q1Fixture, Q2Fixture];
  rq092_mutation_ids: readonly [
    "citation-only",
    "hidden-conflict",
    "critical-query-failure",
    "stale-cross-revision",
    "budget-false-complete",
    "writer-bypass",
    "false-source-independence",
    "wrong-successful-sql",
    "wrong-filter-successful-sql",
    "bounded-universe-disclosure-omission",
    "supervisor-certificate-bypass",
    "certificate-tamper",
    "certificate-semantic-hash-tamper",
    "current-ready-revocation-race",
  ];
  mutation_count: 14;
  partial_mutation_count: 8;
  generated_partial_pair_count: 16;
  mutation_registry: ControlledMutationRegistry;
  partial_pair_generation: PartialPairGeneration;
  required_disclosures: readonly [
    "SINGLE_AUTHORITY_SOURCE",
    "L2_NON_CAUSAL",
    "BOUNDED_HYPOTHESIS_UNIVERSE",
  ];
  expected: {
    promotion_mix: "SURVIVED";
    late_refund: "REFUTED";
    stop_decision: "STOP_READY";
    public_terminal: "READY";
    public_reason_code: "RUN_READY";
    release_decision: "HOLD";
  };
};
```

Registry 必须对规范对象执行 JCS 后计算内容 Hash。Fixture Hash、数据 Manifest Hash、
运行时 Artifact Hash 和 U7 Benchmark Hash 是四种不同身份，不能互相替代。

Registry 还必须执行以下 Refinement：

1. `mutation_registry[*].mutation_id` 按顺序严格等于 `rq092_mutation_ids`，不能只比较
   Set 或 Count；
2. `mutation_count`、`partial_mutation_count` 与 `generated_partial_pair_count` 必须从
   Registry 重算为 `14 / 8 / 16`；
3. 只有八个 `PartialPreconditions` 分支可以生成 Pair，且每个恰好生成一个 Continue 和
   一个 Replan；重复、漏项或为非 Partial Mutation 生成 Pair 均失败；
4. `expected`、Mutation 期望终态和 Pair 期望决策只属于测试 Oracle 输入，生产
   Research Kernel 的参数类型不得包含这些字段。

## 2. 快照与两次依赖查询

### 2.1 同一数据快照

Q1 与 Q2 必须在同一 `CONTROLLED_REVISION` 上执行。运行时可以为每次测试分配新的
UUID，但同一 Case 一旦开始，下列值全部冻结：

```ts
type FrozenSnapshotIdentity = {
  strategy: "CONTROLLED_REVISION";
  datasource_id: string; // immutableIdSchema；同一 Case 内逐字相等
  snapshot_token: "retail-revenue-investigation-v1:r1";
  schema_manifest_hash: `sha256:${string}`;
  data_manifest_hash: `sha256:${string}`;
  fixture_manifest_hash: `sha256:${string}`;
  replay_state: "REPLAYABLE";
  binding_hash: `sha256:${string}`;
};
```

两张 `SandboxExecutionReceipt` 可以有不同 `execution_id/observed_at/descriptor_hash`，
但必须从 Descriptor 重算出完全相同的 `FrozenSnapshotIdentity`。任一 Token、Manifest、
Datasource 或 Binding Hash 不同都不是“第二次合法查询”，而是
`STALE / DATA_SNAPSHOT_STALE`。

### 2.2 字面结果行

Q1 与 Q2 都只允许恰好一行；列名、列数和数值逐字固定：

```ts
type Q1Fixture = {
  query_id: "Q1";
  depends_on_query_ids: readonly [];
  rows: readonly [{
    baseline_net_revenue: 1000;
    current_net_revenue: 800;
    decline_amount: 200;
    promotion_contribution: 140;
    late_refund_contribution: 20;
    other_contribution: 40;
  }];
};

type Q2Fixture = {
  query_id: "Q2";
  depends_on_query_ids: readonly ["Q1"];
  rows: readonly [{
    promotion_decline_share: 0.70;
    late_refund_decline_share: 0.10;
  }];
};
```

Q2 的 Artifact Envelope 和 `dependency_evidence_refs` 必须同时包含 exact Q1
`QueryEvidence@2` Revision；Prompt 中写“基于上一步”、复用 Q1 裸 ID 或只引用 Q1
`SandboxResult` 都不形成依赖。

正常执行恰好产生两次 SQL Operation。`crash-after-sql-receipt` 在 Q1/Q2 Receipt 均已
提交后崩溃时，新 Attempt 必须以更高 Worker Fence 精确复用两张 Receipt，总 SQL
Operation Count 仍为 `2`；旧 Fence、结构克隆 Receipt 或伪造 Checkpoint 不能提交后续
Research Artifact。

## 3. 阈值、派生与 Controlled Oracle

假设顺序、谓词和期望固定为：

| 顺序 | Hypothesis | 支持谓词 | 反证谓词 | 观测值 | 期望 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | `promotion-mix` | `x >= 0.60` | `x <= 0.30` | `0.70` | `SURVIVED` |
| 2 | `late-refund` | `x >= 0.40` | `x <= 0.20` | `0.10` | `REFUTED` |

Authority 必须按以下顺序重算，不能直接读取 `expected`：

1. 验证 `baseline_net_revenue - current_net_revenue = decline_amount`，即
   `1000 - 800 = 200`。
2. 验证贡献闭包 `140 + 20 + 40 = 200`；Controlled 的 Diagnostic Tolerance 字面为
   `0`，缺项、重复项或调用方放宽容差都失败。
3. 从 Q1 重算 `140 / 200 = 0.70` 与 `20 / 200 = 0.10`，并与 Q2 字面结果逐值相等。
4. 分别执行每个 Hypothesis 自己的 Support/Refute Predicate；不得共享一个
   Comparison 后猜测相反方向。
5. `promotion-mix -> SURVIVED`，`late-refund -> REFUTED`。
6. 所有 Critical Obligation 均闭合且无未处理 Conflict 后才得到 `STOP_READY`。
7. Report Manifest 必须披露且只少不了
   `SINGLE_AUTHORITY_SOURCE`、`L2_NON_CAUSAL`、
   `BOUNDED_HYPOTHESIS_UNIVERSE`。
8. Certificate/current-ready 原子消费成功后，公共终态为 `READY/RUN_READY`。
9. 本地 Controlled READY 不提供 Hosted/Docker/Benchmark/签名 Outcome，因此 Release
   必须保持 `HOLD`，不得生成 `GO`。

Controlled 测试还必须从 Q1/Q2 的 exact Result Cell 重算结构化
`AtomicClaimPredicate`。把 `0.70` 改成 `0.95`、把“下降”改成“上升”、换单位、换
时间窗、换维度切片或只改自由文本，都必须在 SupportDecision 前以
`ATOMIC_CLAIM_OBSERVATION_MISMATCH` 失败。

## 4. RQ092 十四个 Mutation

Mutation Registry 必须恰好包含下列 14 个 ID，不得增加别名、按前缀匹配或把名称直接
映射成终态。`public_terminal=null` 表示本次 Authority 调用只拒绝 Certificate，不允许
测试替它伪造一个公共终态。

凡 `public_terminal=PARTIAL`，该行的 `partial_preconditions` 必须是字面对象
`{hard_budget_cap:true, deliverable_supported_subset:true,
budget_executable_query_count:0}`，并由 Authority 从 Brief、Ledger、Coverage、
SupportDecision 和完整 Candidate Set 重算。

| # | Mutation ID | `partial_preconditions` | Public Terminal | Domain Outcome / Reason Code | Certificate / Grant |
| ---: | --- | --- | --- | --- | --- |
| 1 | `citation-only` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `EVIDENCE_SUPPORT_INSUFFICIENT` | `false / false` |
| 2 | `hidden-conflict` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `MATERIAL_CONFLICT_UNDISCLOSED` | `false / false` |
| 3 | `critical-query-failure` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `CRITICAL_OBLIGATION_FAILED` | `false / false` |
| 4 | `stale-cross-revision` | `null` | `STALE/RUN_STALE` | `EVIDENCE_REVISION_STALE` | `false / false` |
| 5 | `budget-false-complete` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION` | `false / false` |
| 6 | `writer-bypass` | `null` | `FAILED/INTERNAL_EXECUTION_FAILED` | `REPORT_PROJECTION_AUTHORITY_INVALID` | `false / false` |
| 7 | `false-source-independence` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `SOURCE_INDEPENDENCE_POLICY_UNSATISFIED` | `false / false` |
| 8 | `wrong-successful-sql` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `OBLIGATION_QUERY_SEMANTICS_MISMATCH` | `false / false` |
| 9 | `wrong-filter-successful-sql` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `OBLIGATION_QUERY_SEMANTICS_MISMATCH` | `false / false` |
| 10 | `bounded-universe-disclosure-omission` | `{hard_budget_cap:true, deliverable_supported_subset:true, budget_executable_query_count:0}` | `PARTIAL/EVIDENCE_PARTIAL` | `BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED` | `false / false` |
| 11 | `supervisor-certificate-bypass` | `null` | `null` | `REPORT_READY_AUTHORITY_REQUIRED` | `false / false` |
| 12 | `certificate-tamper` | `null` | `null` | `REPORT_READY_CERTIFICATE_TAMPERED` | `false / false` |
| 13 | `certificate-semantic-hash-tamper` | `null` | `null` | `CERTIFICATE_SEMANTIC_HASH_MISMATCH` | `false / false` |
| 14 | `current-ready-revocation-race` | `null` | `STALE/RUN_STALE` | `READINESS_REVOKED_DURING_CONSUMPTION` | `false / false` |

第 14 项只表示撤权在 `DOMAIN_TERMINAL` 的 READY 序列化点前胜出。READY 已提交后再
撤权的期望是“历史 READY 保留、CurrentReadiness=REVOKED”，不能复用本行伪造第二个
STALE Terminal。

第 4 项必须由真实 Frontier Owner 先提交跨 Revision Advance，并在同一锁序自动产生
Revocation Operation/Receipt；随后与它竞争的 `DOMAIN_TERMINAL` consume 观察到撤权，
才可追加 STALE。第 12/13 项只是恶意或损坏的 Candidate 输入，固定失败关闭且不创建
Revocation Receipt/Public Terminal，避免攻击者借篡改请求终结 Run。

## 5. 每个 Partial Mutation 的配对反例

上表 8 个 Partial Mutation 必须各自动生成且只生成两张 Pair Case，共 `8 x 2 = 16`
张。Pair ID 固定为 `<mutation-id>--continue` 与 `<mutation-id>--replan`；它们复用同一
业务扰动，但替换 Stop Authority 输入，防止实现把 Mutation 名称硬编码成 Partial。

### 5.1 CONTINUE Pair

```ts
const continuePair = {
  hard_budget_cap: false,
  deliverable_supported_subset: true,
  budget_executable_query_count: 1, // 恰好一张最高 EIG 的 EXECUTABLE_NOW Query
  executable_replan_count: 0,
  expected_decision: "CONTINUE",
  expected_reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE",
  public_terminal: null,
  certificate_issued: false,
  grant_issued: false,
} as const;
```

### 5.2 REPLAN Pair

```ts
const replanPair = {
  hard_budget_cap: false,
  deliverable_supported_subset: true,
  budget_executable_query_count: 0,
  waiting_query_count: 0,
  budget_blocked_query_count: 0,
  open_obligation_count: 1, // 至少一项；由 base mutation 精确绑定
  replan_assessment: {
    trigger: "PLAN_INVALIDATED", // 另一合法 Case 为 QUERY_COMPILATION_GAP
    executable_with_remaining_budget: true,
  },
  expected_decision: "REPLAN",
  expected_reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED",
  public_terminal: null,
  certificate_issued: false,
  grant_issued: false,
} as const;
```

任一 Pair 生成 Public Terminal、Certificate 或 Grant 都是测试失败。Pair 完成 Query 或
新 Plan 后必须重新进入 Coverage/Stop，不能沿用 base Mutation 的旧 Decision。

## 6. 额外不可绕过 Oracle

下列 Case 不计入 RQ092 的 14 个 Mutation；它们是同一 Fixture 必须执行的附加
Authority/竞态矩阵。所有失败例都断言：没有意外 Certificate、Grant、`READY` 或 `GO`。

### 6.1 Snapshot、Relation 与 Claim

| Case ID | 单一扰动 | 必须结果 |
| --- | --- | --- |
| `q2-snapshot-token-tamper` | Q2 使用不同 Snapshot Token | `STALE / DATA_SNAPSHOT_STALE` |
| `q2-data-manifest-tamper` | Q2 的 Data Manifest Hash 不同 | `STALE / DATA_SNAPSHOT_STALE` |
| `q2-fixture-manifest-tamper` | Q2 的 Fixture Manifest Hash 不同 | `STALE / DATA_SNAPSHOT_STALE` |
| `q2-datasource-tamper` | Q2 换 Datasource Identity | `STALE / DATA_SNAPSHOT_STALE` |
| `duplicate-relation-hidden-conflict` | 同一 exact Claim×Evidence 同时提交 `SUPPORTS` 与 `CONFLICTS` active Relation | `EVIDENCE_RELATION_IDENTITY_CONFLICT`，不得形成 SupportDecision |
| `claim-number-tamper` | 同一 Evidence 把 `0.70` 声称为 `0.95` | `ATOMIC_CLAIM_OBSERVATION_MISMATCH` |
| `claim-direction-tamper` | 同一 Evidence 把下降声称为上升 | `ATOMIC_CLAIM_OBSERVATION_MISMATCH` |
| `claim-cell-rebind` | 换 `row_key_hash/output_alias/result_cell_hash` 任一项 | `ATOMIC_CLAIM_OBSERVATION_MISMATCH` |
| `claim-tolerance-inflation` | Controlled 精确比较的 Tolerance 从 `0` 放大以掩盖错值 | Strict Parse 失败；不得进入 Claim Authority |
| `report-title-claim-tamper` | 标题新增未被 Claim Predicate 支持的数字、方向或因果措辞 | `REPORT_PROJECTION_AUTHORITY_INVALID`，不得签 Certificate |
| `stop-with-stale-obligation` | 任一 Obligation=`STALE` 时提交任意 Stop 分支 | `RESEARCH_STOP_INPUT_STALE`；无 StopDecision/Public Terminal，必须转 Revocation 流程 |

### 6.2 Threshold 端点与 Null

Predicate 使用数学精确比较，不使用 epsilon：

| Case ID | 输入 | 必须结果 |
| --- | ---: | --- |
| `promotion-support-endpoint` | `0.60` | Support 命中，Refute 不命中 |
| `promotion-refute-endpoint` | `0.30` | Refute 命中，Support 不命中 |
| `promotion-gap` | `0.45` | 两者均不命中，Hypothesis `UNRESOLVED` |
| `late-refund-support-endpoint` | `0.40` | Support 命中，Refute 不命中 |
| `late-refund-refute-endpoint` | `0.20` | Refute 命中，Support 不命中 |
| `late-refund-gap` | `0.30` | 两者均不命中，Hypothesis `UNRESOLVED` |
| `between-low-endpoint` | `BETWEEN [0.30,0.60]` 的 `0.30` | 命中；`bounds=CLOSED` |
| `between-high-endpoint` | `BETWEEN [0.30,0.60]` 的 `0.60` | 命中；`bounds=CLOSED` |
| `null-fail` | 权威聚合标量为 `null`，Policy=`FAIL` | `OBSERVATION_NULL_REJECTED` |
| `null-ignore-empty` | `IGNORE` 后无标量 | `OBSERVATION_EMPTY_AFTER_NULL_FILTER` |
| `null-zero` | 合法聚合标量为 `null`，Policy=`ZERO` | 以 `0` 执行 Predicate；不能替代缺行/类型错 |
| `ratio-zero-denominator` | RATIO 分母为 `0` | `OBSERVATION_RATIO_DENOMINATOR_INVALID` |
| `ratio-null-denominator` | RATIO 分母为 `null` | `OBSERVATION_RATIO_DENOMINATOR_INVALID`；ZERO 不得绕过 |

### 6.3 ReportReadGrant Response

| Case ID | 线性化顺序/扰动 | 必须结果 |
| --- | --- | --- |
| `response-request-extra-bytes` | public Issue/Response request 夹带 bytes/digest/media type | Strict Schema 失败，`0` 响应字节 |
| `response-projection-row-tamper` | Issue 后篡改 immutable Projection 的 body/digest | `REPORT_READ_RESPONSE_DIGEST_MISMATCH`，`0` 响应字节 |
| `response-report-revision-tamper` | Projection 绑定 Report A，Response Resolver 返回 B | `REPORT_READ_RESPONSE_DIGEST_MISMATCH`，`0` 响应字节 |
| `response-projector-version-tamper` | Response 使用不同 Projector Version/输出 | `REPORT_READ_RESPONSE_DIGEST_MISMATCH`，`0` 响应字节 |
| `revoke-before-grant-consume` | Issue → Revoke → Consume | Grant 不可消费，`0` 响应字节 |
| `revoke-after-consume-before-response` | Issue → Consume → Revoke → Response | `REPORT_READ_GRANT_REVOKED`，`0` 响应字节 |
| `response-before-revoke` | Issue → Consume → Response CAS → Revoke | 本次 exact bytes 只发送一次；后续 Issue/Consume/Response 全部拒绝 |
| `response-cross-principal` | 其他 Principal Consume 或 Response | 失败关闭，`0` 响应字节 |
| `response-replay-after-projection-tamper` | 同 Key 重放但服务端 Projection 已被篡改 | 重投影不一致并拒绝，`0` 新响应字节 |

测试必须在 Socket/Stream 写入点计数；只断言函数返回错误而不检查首字节是不合格
Oracle。

### 6.4 Release GO

`GO` 负例使用本 Fixture 检查 current-ready 门禁。只有
`go-vs-revoke-go-first` 使用测试作用域内、经同一 server-only Verifier 闭合的完整
Release Authority Bundle 来覆盖成功竞争分支；该 Bundle 和运行结果都标记为
`SYNTHETIC_CONCURRENCY_PROOF`，不能注册为 Hosted/Docker/签名 Outcome 或产品 Release
Evidence。

| Case ID | 线性化顺序/扰动 | 必须结果 |
| --- | --- | --- |
| `go-before-ready-terminal` | 已 Publish CURRENT，但尚无同 Certificate 的 `READY/RUN_READY` | `RESEARCH_READY_TERMINAL_REQUIRED`，无 GO Commit |
| `go-after-revoke` | Historical READY 存在，但 CurrentReadiness=`REVOKED` | `CURRENT_READINESS_REVOKED`，无新 GO |
| `go-replay-after-revoke` | GO 历史 Commit → Revoke → 同 Key 重放 | 重新核验后拒绝；不得把历史 GO 当新授权返回 |
| `go-vs-revoke-revoke-first` | Revoke 先取得 Current/Frontier/Head 锁 | 无 GO Commit |
| `go-vs-revoke-go-first` | `commitGo` 先持锁并同事务追加 GO | 恰好一张历史 GO；随后撤权使当前状态不可再使用 |
| `go-history-only-certificate` | 只有历史 V2 Certificate，无 current READY | `AUTHORITY_EVIDENCE_NOT_CURRENT` |
| `go-v1-certificate` | V1 Certificate | `READINESS_PROTOCOL_VERSION_UNSUPPORTED` |
`commitGo` 的每次调用（包括相同幂等键重放）都必须先锁定并重验 exact
`READY/RUN_READY` Domain Terminal、CurrentReadiness、五维 Frontier、Revocation
Head、Authority Epoch 与 Release Evidence，再在同一事务追加 Decision。普通 readiness
snapshot、历史 GO 对象或进程内 Brand 不能在锁外签发新 GO。

### 6.5 Research Stop Root 竞态

| Case ID | 线性化顺序 | 必须结果 |
| --- | --- | --- |
| `stop-vs-publish-stop-first` | Stop 先持 Root/Current/Frontier/Terminal 锁并提交 | 只有非 Ready Terminal；Publish 失败 |
| `stop-vs-publish-publish-first` | Publish 先提交 CURRENT | Stop 锁内失败；无非 Ready Terminal |
| `stop-vs-frontier-advance-first` | Frontier Advance 先提交 | Stop 以 `RESEARCH_STOP_INPUT_STALE` 失败 |
| `stop-vs-frontier-stop-first` | Stop 先持锁并提交 | Advance 可推进 Frontier，但不得同时创建 CURRENT 或第二 Terminal |

### 6.6 Resource Terminal 竞态

| Case ID | 线性化顺序/输入 | 必须结果 |
| --- | --- | --- |
| `active-cancel-completed` | Active Cancel 解析 exact COMPLETED Usage | `SETTLED`，不得 `CANCELLED` |
| `active-cancel-over-limit` | Active Cancel 解析任一维度超额 Usage | `SETTLED_OVER_LIMIT` 并返回 `RESEARCH_RESOURCE_LIMIT_EXCEEDED` |
| `active-cancel-failed` | FAILED + matching Termination + 未超额 | `CANCELLED` 且 actual 入账 |
| `settle-vs-cancel-completed` | 两种锁顺序，exact COMPLETED Usage | 恰好一次 `SETTLED`，另一请求重放该终态 |
| `settle-vs-cancel-over-limit` | 两种锁顺序，任一维度超额 | 恰好一次 `SETTLED_OVER_LIMIT`，成功 Authority 被阻断 |
| `settle-vs-cancel-failed` | FAILED + matching Termination + 未超额 | Settle 先胜为 `SETTLED`，Cancel 先胜为 `CANCELLED`；终态吸收且只入账一次 |

## 7. 实现与检查覆盖矩阵

| 层 | 必须消费的合同 | 最小断言 |
| --- | --- | --- |
| Contracts | 本文 Strict Fixture + Planning/Wire | 未知字段失败；14 个 Mutation 与 16 个 Pair 数量精确 |
| Research Kernel | Q1/Q2、Predicate、Claim、Coverage、Stop | 从字面输入重算，不读取 expected |
| Text2SQL/Sandbox | exact QueryContract、Snapshot、Result Row | 两次 SQL；同 Snapshot；行/列逐字相等 |
| Platform/PostgreSQL | CurrentReadiness、Grant、Response、GO | 双连接两种锁顺序；幂等重放重新核验 |
| Worker/Recovery | exact Receipt + Fence + Checkpoint | Crash 后 SQL Operation Count 仍为 2 |
| Report/Certificate | Claim Predicate、Disclosure、四 Gate | Tamper/缺披露不能签 Certificate |
| Eval/Release | U6/U7 边界 | Fixture 不能注册为 Benchmark、Demo Truth 或 Release Evidence |

最小测试文件应分别覆盖：

```text
packages/research/test/controlled-fixture.spec.ts
packages/research/test/mutation-matrix.spec.ts
packages/research/test/claim-observation.spec.ts
packages/research/test/stop-pairing.spec.ts
tests/integration/research/current-ready-race.spec.ts
tests/integration/research/release-current-ready.spec.ts
tests/integration/research/crash-recovery.spec.ts
```

完成条件：

1. Controlled Case 通过真实 Research Kernel、PostgreSQL Authority 与 Worker 到达
   `READY`，Release 仍为 `HOLD`。
2. 14 个 Mutation、16 个 Partial Pair、Snapshot/Relation/Claim、端点/Null、
   Response、GO 与 Crash-Recovery Oracle 全部运行。
3. 每个期望值都有来自输入的重算断言；任何只比较 Fixture 自报 `expected` 的测试均视为
   恒真测试并失败。
4. 本文文件大小必须 `<32768` bytes，且 `task.py validate` 不得出现 Warning。
