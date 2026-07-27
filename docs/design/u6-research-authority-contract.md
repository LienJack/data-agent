# U6 L2 研究循环与 ReportReady 权威契约

> 状态：`FROZEN_DESIGN_CONTRACT`
> 冻结基线：`data-agent@cb6d3d14512248b1c524b7ed505adb7b83ff5dd2`
> 研究来源：`data-agent-system-design/RQ092`，
> `RUN20260727-070114-u6-l2-research-loop-repo-b73fca`
> Reader Answer SHA-256：
> `8d6b6b22f4edaa53579b7a5f4710421f96967052a0bf7078ad4fb68a65b9df3b`
> Answer Runtime SHA-256：
> `6fd834e3e2228bf270c6b3556bb0ca23fdc90336950715e7fc59879a20e89eb9`
> Synthetic Proof Result SHA-256：
> `0908d49c91598999e40c3ecebd946b5a72317283dad6368e418ade660ac6df5b`
> 再认证：
> `synthesis/answer-quality-reviews/RQ092-8d6b6b22f4ed-4a1ab76b73fb-recertification.md`，
> `decision=closed`，Codex `remaining_p0_p1=[]`
> 实现状态：纯 Research Kernel 为 `KERNEL_CANDIDATE_ONLY`；生产 Persistence /
> Compiler / Policy Authority 为 `NOT_IMPLEMENTED`
> 发布状态：`HOLD`

## 1. 结论

U6 不是“让 Agent 多执行几步再写一段长答案”，而是把 L2 多步研究编译为一条无法由
Agent、Supervisor、Writer 或普通 Schema Parse 绕过的权威链：

```text
QuestionFrame
→ ResearchBrief@2
→ HypothesisSet@2
→ EvidencePlan@2（逻辑 ProofObligationSet）
→ QueryContract + ObligationExecutionDecision@2
→ QueryEvidence@2
→ AtomicClaim@2 + EvidenceRelation + EvidenceCheckReceipt
→ SupportDecision + HypothesisAssessment
→ CoverageState
→ ResearchStopDecision
→ ReportManifest@2 + AnalysisReport@2 + ReportProjectionReceipt
→ 4 × EvidenceGateReceipt
→ ReportReadyCertificate@3
→ publishCurrentReadiness
→ consumeCurrentReady
→ 历史 RunTerminal=READY + CurrentReadiness=CURRENT / ReportReadGrant
→ 可选 ReadinessRevocationReceipt + CurrentReadiness=REVOKED
```

模型和 Agent 只生产 Candidate。Proof、Coverage、Stop、Projection、Readiness 与
Revocation 分别由确定性 Authority 重新解析精确 Revision、重算领域语义并提交。
Mastra 负责编排、暂停、恢复和 Checkpoint，不是 System of Record。

U6 完成后也只代表“L2 证据受限诊断报告”可运行，不代表 L3 可执行数据科学、L4 主动
观察、L5 因果决策、真实 Benchmark 达标或 Release `GO`。

## 2. 范围与非目标

### 2.1 U6 必须交付

- `packages/contracts` 中的 U6 V2 Artifact、Hash、Reference 与终态证据合同。
- 只依赖 `@data-agent/contracts` 的 `packages/research` 纯领域内核。
- PostgreSQL 中精确 Revision 提交、Run Fence 重验、current-ready 与撤权事务。
- `apps/worker` 中 Mastra Team、Research Kernel、Text2SQL 与 Sandbox 的应用层组合。
- `retail-revenue-investigation-v1` 的 U6-owned 合成协议 Fixture。
- Controlled、Mutation、Crash-Recovery、Resource 与 Revocation-Race Oracle。

### 2.2 U6 明确不交付

- `SourceEvidence`、Source Fetch、网页研究或文档检索。首版成功路径只有
  `QUERY + DETERMINISTIC`。
- InsightBench、DAB、RCAEval 或自建归因题集的 Adapter、评分、调优和 Holdout；
  这些属于 U7。
- 任意自动行动、生产变更或外部副作用；U6 Certificate 只授权数据库本地领域终态和
  当前报告的读取/展示/下载。
- 因果识别、处方性建议、反事实结论或生产行动。
- 尚无真实生产 V1 数据时的通用在线迁移框架。

## 3. 十三条不可绕过不变量

1. **Candidate 永远不是 Authority。** Agent、Model、外部 JSON、普通 Zod Parse 和
   clone 后的品牌对象都不能签发领域成功态。
2. **成功边只消费精确 `COMMITTED` Revision。** 裸 ID、最新版本查询或
   `isCommitted=true` 不能代替完整 Content-Addressed Reference。
3. **每次根授权重新验证。** 递归核验缓存只在单次根调用和当前事务内有效。
4. **`SUPPORTED` 是决策，不是 Claim 字段。** `AtomicClaim@2` 不含
   `support_state`，唯一事实源是 `SupportDecision`。
5. **停止先过 Hard Gate。** Coverage、Conflict、Freshness、Policy、Integrity 和
   Replay 优先于预算与模型的停止建议。
6. **正文是确定性投影。** Writer 可以提出标题、排序与表达建议，不能增加数字、实体、
   比较方向、因果词或行动建议。
7. **`READY` 是 AND Gate。** `STOP_READY` 只打开报告阶段，不是公共终态。
8. **历史终态与当前可读性分离。** 已提交的历史 `RunTerminal=READY` 不改写；
   `CurrentReadiness=CURRENT | REVOKED` 单独表达当前报告是否仍可读取。Certificate
   签发后，Version Frontier 或 Evidence 撤权必须使新的 current-ready 消费、Grant
   消费和 Release `GO` 复核失败。
9. **PostgreSQL 是事实源。** Event、Artifact、Attempt、Fence、Receipt 与 Revocation
   Head 决定恢复；Checkpoint 只加速定位。
10. **Workflow 完成不等于领域完成。** Mastra `finish`、`snapshot.ready` 或 UI
    `ready=true` 不产生任何领域权力。
11. **来源独立是版本化策略。** 同一 PostgreSQL 的两条查询仍是一个 provenance
    group；首版允许单一权威源，但必须披露。
12. **L2 保持非因果。** 只允许 `DESCRIPTIVE | COMPARATIVE | DIAGNOSTIC`。
13. **`READY` 只对有界假设宇宙成立。** 报告必须披露
    `BOUNDED_HYPOTHESIS_UNIVERSE`，不能把有限候选当作开放世界穷尽。

旧 V1 Artifact 只允许进入显式 `readHistorical*` 路径。Current Writer/Committer/
Research Artifact Authority 收到 V1 固定返回 `L2_WIRE_VERSION_WRITE_UNSUPPORTED`；
current-ready、Grant、RunTerminal 与 Release `GO` 收到 V1 固定返回
`READINESS_PROTOCOL_VERSION_UNSUPPORTED`。

## 4. Envelope、Reference 与双 Hash

U6 沿用现有 `ArtifactEnvelope`，不建立平行身份：

```ts
type EmbeddedNodeReference = {
  container_ref: ArtifactReference;
  node_id: string;
};
```

Hypothesis、Proof Obligation 等容器内节点必须使用
`EmbeddedNodeReference`。Envelope `input_refs` 必须包含对应 `container_ref`，
verifier 再核对 `node_id` 是否存在于该精确 Revision。

### 4.1 Envelope Content Hash

继续调用 `computeL2ArtifactContentHash`：

- 规范材料排除 `content_hash`、`created_at` 与 `status`；
- 保留版本元组、Scope、Run、Revision、`attempt_id`、Producer、`input_refs` 与
  Payload；
- 新 Attempt 重建等价 Artifact 时，外层 Hash 可以变化；
- 不得为 U6 另造 Canonical JSON 或将数据库墙钟加入领域身份。

### 4.2 Domain Semantic Hash

`decision_semantic_hash`、`certificate_semantic_hash` 与
`revocation_semantic_hash` 只覆盖规范化领域输入、Evaluator/Policy Version、
Version Frontier、领域事件水位和输出结论：

- 排除 Worker Fence、Attempt 和墙钟；
- 同一输入闭包在 Crash-Recovery 后必须稳定；
- `evaluated_through_input_event_seq` 参与 Certificate Semantic Hash；
- 实际 `certificate_appended_event_seq` 只存在于 Event/Audit，可随重新追加前进。

### 4.3 Wire Version 判别

当前 `l2ArtifactPayloadSchema` 只按 `artifact_type` 判别，不能把同名多版本
Object 直接并列放入同一个 `z.discriminatedUnion("artifact_type", ...)`。U6 固定改为
“Envelope Type + Envelope Schema Version + Payload Protocol Version”三级注册：

```ts
type L2WireRegistryKey = {
  artifact_type: L2ArtifactType;
  envelope_schema_version: string;
  payload_protocol_version: string | null;
};

parseL2PayloadForEnvelope(envelope, payload);
```

规则：

- 当前 HEAD 的同名旧 Payload 归类为 V1：
  `envelope.schema_version="1.0.0"` 且 Payload 没有 `protocol_version`；
- 同名升级 Artifact 的当前 Writer 固定写版本矩阵指定的
  `envelope.schema_version` 与精确 `protocol_version`；
- U6 新增 Artifact 的首个 Envelope Schema 通常为 `1.0.0`，但 Payload 仍必须写精确
  `protocol_version`；OED 因 reset-only SQL binding breaking 修复直接以 `2.0.0`
  重置当前 tuple，不保留 current 1.0 reader；
- Parser 先按 `artifact_type` 定位注册表，再按
  `(envelope_schema_version,payload_protocol_version)` 选择一个 strict Schema；
- 未注册元组、Envelope/Payload 版本错配或混合历史/当前 Authority 闭包固定失败；
- `consumeCurrentReady` 只接受 `report-ready@3.0.0`，并递归要求所有当前闭包元组
  命中注册表；
- V1 只可由名字显式包含 `readHistorical` 的只读 Resolver 返回；Writer/Committer/
  Research Artifact Authority 固定 `L2_WIRE_VERSION_WRITE_UNSUPPORTED`，
  `authorizeRunTerminal`、current-ready、Grant 和 Release `GO` 固定
  `READINESS_PROTOCOL_VERSION_UNSUPPORTED`；
- Runtime Event、Projection、Mastra Snapshot、Text2SQL Gate/Validation 与 Sandbox
  Grant/Outcome 的既有版本不因 U6 改名或升级。

U6 不以文件名、字段猜测或“包含某个新字段”判定版本。

## 5. V2 Artifact 注册表

| Artifact | 版本 | 提议者 | 唯一提交 Authority | 核心输入 |
| --- | --- | --- | --- | --- |
| `ResearchBrief` | `research-brief@2.0.0` | Supervisor | Brief/Semantic | Question、Policy、Scope、预算 |
| `HypothesisSet` | `hypothesis-set@2.0.0` | Supervisor | Planning | Brief、机制去重、假设宇宙 |
| `EvidencePlan` | `evidence-plan@2.0.0` | Supervisor | Planning | Hypothesis、Success Criteria、Observation Contract |
| `ObligationExecutionDecision` | `obligation-execution@2.0.0` | SQL Worker | Obligation Execution | Brief、Obligation、QueryContract、SqlArtifact、Semantic/Policy |
| `QueryEvidence` | `query-evidence@2.0.0` | SQL Worker | Evidence | OED、Sql/Validation/Execution/Sandbox Result |
| `AtomicClaim` | `atomic-claim@2.0.0` | Evidence Worker | Claim Structure | QueryEvidence 引用；不含支持态 |
| `EvidenceRelation` | `evidence-relation@2.0.0` | Evidence Worker | Relation | Claim、Evidence、Obligation |
| `EvidenceCheckReceipt` | `evidence-check@1.0.0` | 无 | Proof | Relation、Observation Contract、权威结果 |
| `SupportDecision` | `support-decision@1.0.0` | 无 | Proof | Claim、Relation、Check |
| `HypothesisAssessment` | `hypothesis-assessment@1.0.0` | 无 | Proof | Hypothesis、SupportDecision |
| `CoverageState` | `coverage-state@1.0.0` | 无 | Coverage | Plan、OED、Evidence、Support、Assessment、Conflict |
| `ResearchStopDecision` | `research-stop@1.0.0` | Supervisor 可建议 | Research Stop | Coverage、Candidate Query、预算 |
| `ReportManifest` | `report-manifest@2.0.0` | Report Agent | Projection | Stop、Claim、Assessment、Conflict、Limitation |
| `AnalysisReport` | `analysis-report@2.0.0` | Projector | Projection | Manifest |
| `ReportProjectionReceipt` | `report-projection@1.0.0` | 无 | Projection | Manifest、Report、Statement Closure |
| `EvidenceGateReceipt` | `evidence-gate@1.0.0` | 无 | 对应 Gate | Report 闭包、Version Frontier |
| `ReportReadyCertificate` | `report-ready@3.0.0` | 无 | Readiness | STOP_READY、Projection、四 Gate、Frontier |
| `ReadinessRevocationReceipt` | `readiness-revocation@1.0.0` | Frontier 级联事务 / 服务观察器 | Revocation | Current Certificate、最新 Frontier、Trigger/Source Operation |

Registrar、Seal、品牌检查和持久化 Committer 只从 server-only 子路径导出；包根只导出
Schema、纯计算和 Candidate 类型。

### 5.1 精确 Wire 版本矩阵

| Artifact | Envelope `schema_version` | Payload `protocol_version` |
| --- | --- | --- |
| `ResearchBrief` V2 | `2.0.0` | `research-brief@2.0.0` |
| `HypothesisSet` V2 | `2.0.0` | `hypothesis-set@2.0.0` |
| `EvidencePlan` V2 | `2.0.0` | `evidence-plan@2.0.0` |
| `ObligationExecutionDecision` | `2.0.0` | `obligation-execution@2.0.0` |
| `QueryEvidence` V2 | `2.0.0` | `query-evidence@2.0.0` |
| `AtomicClaim` V2 | `2.0.0` | `atomic-claim@2.0.0` |
| `EvidenceRelation` V2 | `2.0.0` | `evidence-relation@2.0.0` |
| `EvidenceCheckReceipt` | `1.0.0` | `evidence-check@1.0.0` |
| `SupportDecision` | `1.0.0` | `support-decision@1.0.0` |
| `HypothesisAssessment` | `1.0.0` | `hypothesis-assessment@1.0.0` |
| `CoverageState` | `1.0.0` | `coverage-state@1.0.0` |
| `ResearchStopDecision` | `1.0.0` | `research-stop@1.0.0` |
| `ReportManifest` V2 | `2.0.0` | `report-manifest@2.0.0` |
| `AnalysisReport` V2 | `2.0.0` | `analysis-report@2.0.0` |
| `ReportProjectionReceipt` | `1.0.0` | `report-projection@1.0.0` |
| `EvidenceGateReceipt` | `1.0.0` | `evidence-gate@1.0.0` |
| `ReportReadyCertificate` V3 | `3.0.0` | `report-ready@3.0.0` |
| `ReadinessRevocationReceipt` | `1.0.0` | `readiness-revocation@1.0.0` |

`EvidenceGateReceipt` 是研究报告四道 Gate，不能与现有 Text2SQL
`GateReceipt/text2sql-gates@3.0.0` 共用 Schema 或 Evaluator Version。

`ReportManifest/1.0.0/report-manifest@1.0.0` 与
`ReportReadyCertificate/2.0.0/report-ready@2.0.0` 是
`HISTORICAL_READ_ONLY` tuple，并保留 material Claim/Support 非空语义。它们只能经
显式 historical resolver 读取，不能进入当前 Candidate Writer、current-ready、Grant
或 Release Authority；全反驳能力只属于当前 ReportManifest V2 / Certificate V3。

### 5.2 类型与 Store 分类

- 上表 18 个类型进入 `L2_ARTIFACT_TYPES`；同名类型通过 Wire Registry 解析历史/当前 tuple。
- `IdentityBinding` 是认证事务派生的 Value，不是 Artifact。
- `AgentDataProjectionReceipt` 是 `SYSTEM_ARTIFACT_TYPES` 中的
  `agent-data-projection@1.0.0`，保存在新建的 append-only
  `app_data_agent.research_system_artifacts`，不进入 L2 union。
- `ReportReadGrant` 和 `RevocationOperation` 是平台授权/操作记录，不是 Artifact；
  正式表名分别为 `app_data_agent.report_read_grants` 和
  `app_data_agent.research_revocation_operations`。
- `current_report_readiness` 的正式表名为
  `app_data_agent.current_report_readiness`。
- `ExecutionReceipt` 与 `ValidationReceipt` 是 L2 Artifact，保存在
  `app_data_agent.artifacts`；只有 `SandboxExecutionReceipt`、`SandboxResult`、
  Resource/Fixture/Metamorphic/Result Oracle 等既有 System Artifact 进入
  `app_data_agent.text2sql_system_artifacts`。
- 当前 Repository 的权威写路径保持 `COMMITTED`-only。Agent Candidate、Rejected
  Proposal 与 Stop Suggestion 默认只存在于工具结果/Trace；若未来需要长期审计，必须
  进入独立非权威 Candidate Store，不能写入 `app_data_agent.artifacts` 冒充
  Authority。
- 新 Revision 提交后，旧数据库行只把 `is_active` 置为 false；旧 Envelope 仍保持
  append-only `COMMITTED`，不得原地改写为 `SUPERSEDED`。

### 5.3 完整 Payload 骨架

全部 strict Payload 字段拆分冻结在：

- [`u6-research-planning-payload-contract.md`](./u6-research-planning-payload-contract.md)：
  primitive、Reference、`ResearchBrief/HypothesisSet/EvidencePlan`；
- [`u6-research-oed-v2-contract.md`](./u6-research-oed-v2-contract.md)：
  OED v2 的十二项语义检查、server-only assurance 与执行前失败关闭边界；
- [`u6-research-wire-payload-contract.md`](./u6-research-wire-payload-contract.md)：
  Evidence、Proof、Stop、Projection、Certificate 与 Revocation；
- [`u6-research-platform-contract.md`](./u6-research-platform-contract.md)：
  Frontier、Terminal、Current、Grant、Revocation 与 GO；
- [`u6-research-resource-invocation-contract.md`](./u6-research-resource-invocation-contract.md)：
  Resource、Model/SQL/Tool Invocation Wire 与 System Record；
- [`u6-invocation-state-contract.md`](./u6-invocation-state-contract.md)：
  Invocation 状态迁移、Owner、幂等与 Crash Recovery；
- [`u6-system-record-lifecycle-contract.md`](./u6-system-record-lifecycle-contract.md)：
  Termination、Tool Permit 与 Result Blob 生命周期；
- [`u6-controlled-fixture-contract.md`](./u6-controlled-fixture-contract.md)：
  受控两查询真值、Mutation、配对反例与竞态 Oracle。

这些文档共同构成 U6 冻结设计，任何实现不得只采纳其中一部分。

## 6. 规划合同

### 6.1 `ResearchBrief@2`

至少冻结：

- Subject、半开时间窗、Dimension 和 `metric_refs`；
- 带 `CRITICAL | SUPPORTING` 的 Success Criteria；
- `allowed_kinds=["QUERY"]`、`minimum_support_mode="DETERMINISTIC"`；
- 有界假设枚举来源、Enumerator Version 和强制披露；
- Freshness、Snapshot Replay 与 Source Independence Policy；
- 允许/禁止 Claim Mode；
- steps、model calls、SQL、elapsed、token、cost 等预算；
- `PolicyReceipt`、数据分类与 Retention Policy。

`max_source_calls` 固定为 `0`。V2 编译器遇到
`SOURCE | DOCUMENT | BENCHMARK` 必须返回 `UNSUPPORTED_SOURCE_KIND`，不能创建一个
看似完整但没有 Resolver 的 Source Artifact。

### 6.2 `HypothesisSet@2`

- 至少两个 `MATERIAL` 竞争假设；
- 每个假设包含 `mechanism_class`、Predictions、Falsifiers 与
  `discriminating_test_ids`；
- 文本不同但机制、Prediction 与 Falsifier 等价时返回
  `HYPOTHESIS_COLLAPSE`；
- Agent 的 `HypothesisProposal.status=PROPOSED` 只是工具输出；只有提交后的节点为
  `ADMISSIBLE`；
- `hypothesis_universe_hash` 由完整候选宇宙和 Enumerator Version 重算。

### 6.3 `EvidencePlan@2`

完整 strict 字段只以
[`u6-research-planning-payload-contract.md`](./u6-research-planning-payload-contract.md)
第 6 节为准。关键边界是：

- Payload 同时绑定 exact `brief_ref` 与 `hypothesis_set_ref`；
- public compiler 只接收并重验 exact `ResearchBriefDocument` 与
  `HypothesisSetDocument`，再由文档派生引用；接受独立 `ref + payload` 的纯 reducer
  仅保留为包内构建块，不进入 package root 公共面；
- Obligation 显式引用 Hypothesis、Success Criterion 与全局唯一
  `discriminating_test_ids`；
- 容器内 `depends_on` 使用 `LocalProofObligationReference`，不得把尚未提交的自身
  Content Hash 写回 Payload 形成循环；
- Support 与 Refute 使用两个独立 Predicate，不共享一个 Comparison 猜测方向；
- 所有 material Hypothesis、critical Success Criterion 和 Test ID 均精确覆盖，依赖
  图无环，且预算下不可执行的计划不得提交。

## 7. Evidence、Proof 与 Coverage

### 7.1 SQL 前的 Obligation Execution

`ObligationExecutionDecision@2` 必须在 Sandbox 前绑定 exact Brief、EvidencePlan
Obligation、QueryContract、**SqlArtifact**、Semantic Release 与 Policy，并由可信
Compiler/Policy Verifier 的结果重算：

```text
metric
metric_formula
time_window
timezone
grain
dimensions
grouping
joins
canonical_predicates
cohort
null_semantics
authorization_scope
```

任一 `MISMATCH` 都返回 `OBLIGATION_QUERY_SEMANTICS_MISMATCH`。SQL 合法、执行成功、
结果非空或新鲜都不能补救“回答了错误问题”。

当前纯 Research Kernel 只实现受控 `KERNEL_CANDIDATE_ONLY` profile：server 内部 issuer
把 exact Brief/Plan/QueryContract/SqlArtifact/Semantic/Policy Reference 与可信 verifier
结果绑定到进程内 identity token。token 固定声明
`persistence_authority=NONE`、`can_authorize_execution=false`；WeakMap 身份使
clone/spread/JSON round-trip 失效。package root 无 issuer，普通 root 调用一律
fail closed 为 OED `FAIL/MISMATCH`。特别地，SQL alias regex、SQL 注释/字符串和
同 Scope Policy Ref 都不是 `metric_formula`/`authorization_scope` 证明。

Production 的 SemanticQuery→LogicalPlan→SqlArtifact compiler lineage、Gate Receipt、
Policy Authority 与 COMMITTED/current 验证仍是 `NOT_IMPLEMENTED`。受控 assurance
不得持久化，不得授权 SQL 执行，也不得宣传为 production authority。

### 7.2 `QueryEvidence@2`

QueryEvidence 必须绑定：

- **一个且仅一个**精确 Obligation Node Reference；
- replay 后与 production derivation canonical exact 相等的
  `ObligationExecutionDecision=PASS`；
- OED 的 `sql_artifact_ref` 与当前 QueryEvidence 的 SqlArtifact exact 相等；
- QueryContract、SqlArtifact、ValidationReceipt、ExecutionReceipt 与 SandboxResult；
- Semantic、Schema、Data Snapshot、Policy 与 Identity Version Frontier；
- 服务端推导的 `provenance_group`；
- Result Hash、Row Count 与 Schema Hash。

Q2 等依赖查询必须在 `input_refs` 中绑定 Q1 的精确 QueryEvidence Revision。Prompt
中的“基于上一步”不形成依赖。同一 SQL/Execution 若服务多个 Obligation，必须为每个
Obligation 分别提交独立 OED 与 QueryEvidence；它们可共享 Sql/Execution/Sandbox
Receipt，但不得改成 Obligation 数组模型。

### 7.3 Claim 与 Support

`EvidenceRelation.proposed_relation` 固定为：

```text
SUPPORTS | REFUTES | CONFLICTS | QUALIFIES | CONTEXT_ONLY
```

U6 成功路径必须存在 `DETERMINISTIC_CHECK` 与 `PROVENANCE_CHECK`。模型只能产生
`SEMANTIC_CHECK_CANDIDATE`；没有隔离的 `HumanReviewReceipt` 时不得升级为权威
Semantic Check。

`SupportDecision` 的终态为：

```text
SUPPORTED | REFUTED | CONFLICTED | INSUFFICIENT | UNSUPPORTED
```

引用存在、SQL 非空或文本相似都不能单独得到 `SUPPORTED`。
每个 `AtomicClaim` 必须恰有一个 `SupportDecision`；缺失、重复或游离 Support 都必须
在 Coverage 前失败关闭。

### 7.4 Hypothesis 与 Coverage 派生

`HypothesisAssessment.status` 固定为：

```text
TESTED | REFUTED | SURVIVED | UNRESOLVED
```

`SURVIVED` 只表示在冻结测试中未被反证，不表示普遍为真。

每个 Obligation 的 Coverage 状态按以下优先级派生：

```text
STALE > FAILED > BLOCKED > SATISFIED > OPEN
```

| 状态 | 判定 |
| --- | --- |
| `STALE` | 任一必须输入 Revision/Frontier 已失效或被撤权 |
| `FAILED` | 当前有 OED/执行/验证/检查失败或未解决 material conflict，尚未被后续成功闭包消解 |
| `BLOCKED` | 输入仍当前，但在等待可识别的外部权限/能力 |
| `SATISFIED` | OED PASS、执行成功、Observation Contract 命中、Support/Assessment 已提交且无未处理冲突 |
| `OPEN` | 尚未满足且存在语义 admissible 的研究路径；不要求当前预算足够 |

`derived_counts` 必须从 Obligation 数组重算。只有全部 critical obligation 严格等于
`SATISFIED` 才能进入 `STOP_READY` 前置条件。

Stop Candidate Enumerator 不得只看 `OPEN`：它必须精确覆盖 Coverage 的
`OPEN|BLOCKED|FAILED` 全部 unresolved Obligation。由此失败尝试仍可在预算可用时产生
`CONTINUE/REPLAN`，BLOCKED 可产生 `WAITING_EXTERNAL_CAPABILITY`，硬预算封顶但语义
admissible 的 OPEN 可产生 `BUDGET_BLOCKED`；`STALE` 交给 Revocation，不进入 Stop。
除显式 `REPLAN` 外，Candidate Query 集合不得为空或漏掉任一 unresolved Obligation，
防止 vacuous `every([])` 或部分枚举伪造 `STOP_INCONCLUSIVE`。

### 7.5 Material Claim 与 Schema Frontier

`material Claim` 不是 Writer 自报标签。Projection Authority 必须把
`ReportManifest.material_claim_refs` 重算为 `EXECUTIVE_SUMMARY` 与
`SUPPORTED_FINDINGS` 两节 `claim_refs` 的规范去重并集。用于满足任一 `CRITICAL`
Success Criterion，或承载报告主要数字、比较方向的 Atomic Claim，必须先进入这两节
之一；遗漏即 `REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE`。被反证假设与冲突分别使用
精确 `HypothesisAssessment` / `EvidenceRelation` 引用，不伪装成未受支持的 material
Claim。

`material_claim_refs` 可以为空，但只允许发生在“全反驳”的 `STOP_READY`：
`supported_subset.claim_refs` 与 `supported_subset.support_decision_refs` 也必须同时
为空，`REFUTED_HYPOTHESES` 必须非空并精确覆盖当前全部 `REFUTED`
Assessment。Authority 必须继续重放
Assessment → REFUTED Support → Claim → REFUTES Relation → PASS Check →
QueryEvidence 的非空闭包；没有受支持 Claim、也没有反证闭包的空报告固定失败关闭，
不能利用空集合真值获得 Ready。

每个 material Claim、对应 `SupportDecision`、`QueryEvidence.observed_version` 与
Certificate `VersionFrontier` 必须绑定同一个精确 `schema_snapshot_ref`。Schema
Frontier 变化后，即使 SQL 文本、Result Hash 或 Claim 文本没有变化，旧 material
Support 也必须进入 `STALE`，重新执行 OED、Evidence Check、Coverage、Projection、
Gate 与 current-ready。Certificate 的 `material_support_decision_refs` 必须与服务端
重算出的完整 material Claim 集合一一闭合，禁止漏项后签发 Ready；全反驳时该集合
允许为空，但必须由上一段的非空反证闭包替代，不能签发完全空的 Certificate。

## 8. Stop、报告与公共终态

### 8.1 Stop 决策顺序

```text
1. Policy / Integrity / Fence / Replay hard failure
2. Brief/Semantic clarification
3. 全部 critical SATISFIED 且无未处理 conflict → STOP_READY
4. 合法且预算可执行的区分性查询 → CONTINUE / REPLAN
5. 已知合法路径但等待新预算/权限 → STOP_NEEDS_MORE_RESEARCH
6. 硬预算封顶、存在可披露受支持子集，且不存在预算内可执行的合法 Query →
   STOP_PARTIAL
7. 不存在 admissible distinguishing test → STOP_INCONCLUSIVE
```

不存在兜底式 `STOP_PARTIAL`。`hard_budget_cap=true`、
`deliverable_supported_subset=true` 和 `budget_executable_query_count=0` 必须由
Authority 从 Brief、Resource Ledger、Coverage、SupportDecision 与 Query Candidate
闭包重算，不能信任 Candidate 自报。无法命中互斥分支的输入必须以
`RESEARCH_STOP_INPUT_INCONSISTENT` 失败关闭。
任何分支计算前都必须重验 exact current Frontier 且 Coverage 不含 `STALE`；
否则固定 `RESEARCH_STOP_INPUT_STALE`，不提交 StopDecision 或 Public Terminal。
`STALE` 只能由 Revocation Owner 消费权威 Receipt 后提交。

### 8.2 确定性报告投影

`ReportManifest` 只允许：

```text
EXECUTIVE_SUMMARY
SUPPORTED_FINDINGS
REFUTED_HYPOTHESES
CONFLICTS
LIMITATIONS
METHOD
```

`AnalysisReport@2` 首版使用 `ZH_L2_RESEARCH_V1` 模板。Projection Authority 重算
Manifest Hash、Claim Closure Hash、每个 Statement Hash、Projection Hash 和禁止
Claim Mode 扫描。新增数字、实体、比较方向、因果措辞或行动建议必须返回
`REPORT_PROJECTION_AUTHORITY_INVALID`。

### 8.3 四张 Evidence Gate

| Gate | PASS 条件 |
| --- | --- |
| `SUPPORT` | 每个报告 material Claim 都有当前 `SUPPORTED` Decision |
| `CONFLICT` | 无未披露 material conflict；被反证假设进入正确章节 |
| `FRESHNESS` | critical Evidence 满足 Brief 时效，Snapshot 可按策略复核 |
| `SOURCE_INDEPENDENCE` | 满足版本化 provenance policy 且限制已披露 |

Gate Receipt 必须分开提交并分别重算 `gate_input_hash`。

### 8.4 终态唯一所有者与双状态

| Public Terminal | 必备 Evidence | 唯一领域所有者 |
| --- | --- | --- |
| `READY` | STOP_READY、Projection Receipt、四 Gate、current V3 Certificate | Readiness |
| `PARTIAL` | STOP_PARTIAL、Coverage、已披露缺口 | Research Stop |
| `NEEDS_MORE_RESEARCH` | StopDecision、开放 critical obligation | Research Stop |
| `INCONCLUSIVE` | StopDecision、无 admissible test | Research Stop |
| `NEEDS_CLARIFICATION` | Clarification Decision | Brief/Semantic |
| `POLICY_BLOCKED` | Policy Decision/Receipt | Policy |
| `FAILED` | Runtime Failure Receipt | Runtime |
| `CANCELLED` | Cancel Receipt、当前 Fence | Runtime |
| `REPLAY_UNAVAILABLE` | Replay Decision | Runtime/Sandbox |
| `STALE` | ReadinessRevocationReceipt | Revocation |

U6 只强化 `READY/PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE/STALE` 五条研究分支；
其余终态继续使用现有 Owner，不能创建万能 Research Terminal Receipt。

`RunTerminal` 是不可变历史结论；`CurrentReadiness` 是可撤销的当前授权状态：

```text
Historical RunTerminal = READY
CurrentReadiness = CURRENT | REVOKED
```

- READY 提交前，只有 `consumeCurrentReady(purpose=DOMAIN_TERMINAL)` 与撤权竞争且
  撤权先胜出时，才能由同一事务下的 Revocation Authority 分支提交唯一 `STALE`
  RunTerminal，且不能同时提交 `READY`。独立 `revokeCurrentReadiness` 只推进
  CurrentReadiness/Head，不主动占用历史 Terminal。
- READY 已提交后，后续撤权只把 `CurrentReadiness` 从 `CURRENT` 推进为
  `REVOKED`；不得 UPDATE 历史 READY，也不得在 Durable Runtime 终态后追加
  `run.completed/run.failed` 或新的 Run lifecycle Event。
- API/UI 的“当前可读”视图必须同时显示历史 READY 与当前
  `REVOKED`，并禁用新的读取、展示、下载和 Release 使用；不得把历史 READY 单独投影为
  当前成功。

## 9. Certificate、current-ready 与撤权

`ReportReadyCertificate@3` 必须绑定 `STOP_READY`、Report Manifest、Analysis
Report、Projection Receipt、四张 PASS Gate、全部 material SupportDecision、
Version Frontier、Input Closure Hash、Certificate Semantic Hash 与输入事件水位。

通用 `authorizeRunTerminal` 永久只处理非 READY 终态；收到 `READY` 必须固定返回
`CURRENT_READY_CONSUMPTION_REQUIRED`。不得保留
`ReportReadyCertificate -> authorizeRunTerminal(READY)` 的兼容分支。U6 的唯一
READY 入口是 server-only `consumeCurrentReady`：

`publishCurrentReadiness` 必须先把 exact V3 Certificate/Report/五维 Frontier 发布为
`CURRENT`。它只在尚无 Domain Terminal 时允许
`ABSENT -> CURRENT`，或用新 Certificate/Frontier 做
`CURRENT/REVOKED -> CURRENT` CAS；相同已撤 Certificate 不得复活。已有任意 Domain
Terminal 后必须创建新 Run。

```text
BEGIN
  锁 Run
  锁 current_report_readiness
  按固定顺序锁 Semantic/Schema/Data/Policy/Identity Frontier
  锁 Revocation Head
  核验 exact Certificate、Frontier、Authority Epoch 与 Revocation
  重算 Certificate Semantic Hash
  追加 Consumption Event
  若提交 Domain Terminal：同事务提交历史 READY，并置 CurrentReadiness=CURRENT
  若读取报告：创建绑定 exact report/principal/response digest/短 TTL 的单次 Grant
COMMIT
```

相同 idempotency key 的重放也必须重新核验 current Frontier 和 Revocation。撤权在
DOMAIN_TERMINAL 的 READY 插入前胜出时，consumer 只能原子提交唯一
`STALE/RUN_STALE`，不能提交 READY 或 Grant；独立 revoker 不创建 STALE。
`REPORT_READ` 还必须验证同 Run、同 Certificate 已有不可变
`READY/RUN_READY` Domain Terminal，仅发布 CURRENT 不得提前签 Grant。

`ReportReadGrant` 的三个线性化点固定为：

1. **Issue：** 只创建短 TTL、单次、绑定 exact report/principal/response digest 的
   待消费 Grant；Issue 成功不是“响应已获授权”。
2. **Consume：** 在 PostgreSQL CAS 事务中再次锁定
   `current_report_readiness`、排序后的 Frontier 与 Revocation Head。只有仍为
   `CURRENT` 才把 Grant 标记为 consumed；它只授权服务端物化绑定响应，不授权发送。
3. **Response：** `commitReportReadResponse` 再次锁定 Current Readiness、Frontier 与
   Revocation Head，重算 exact canonical response bytes 的 Digest，并 CAS 为
   `RESPONDED`。只有该事务提交后才能发送首个字节；这是外发授权线性化点。此前撤权
   胜出时 Grant 进入 `REVOKED` 且零字节输出，Response 先胜出后已经授权的单次响应
   无法撤回，后续撤权只阻断新的 Issue/Consume/Response。

`ReadinessRevocationReceipt` 追加而不删除历史 Certificate。撤权使用独立
`RevocationOperation` Attempt 和服务级 capability，不冒用已结束 Worker Fence，也
不能获得执行 SQL 或提交其他 Research Artifact 的权力。

Release `GO` 也不能消费历史上曾合法的 Certificate。Release Authority 必须在签发
`GO` 的同一事务中调用 current tuple revalidation，重新核验 exact
`ReportReadyCertificate@3`、完整 material Claim/Schema Frontier、当前
`CurrentReadiness=CURRENT` 与 Revocation Head；V1、`REVOKED` 或只通过
`resolveReadyCertificate` 的历史对象固定拒绝。

## 10. PostgreSQL、恢复与缓存边界

### 10.1 Store 分工

| 数据 | 权威 Store |
| --- | --- |
| Research V2 Artifact | `app_data_agent.artifacts` + 窄化 Committer |
| SQL Sandbox System Artifact | `text2sql_system_artifacts` 专用 Store |
| Run/Event/Attempt/Lease/Fence | PostgreSQL Durable Runtime |
| Current Readiness/Revocation/Grant | U6 绿地 PostgreSQL 表与窄函数；状态只允许 `CURRENT | REVOKED` |
| Mastra Snapshot | `EXECUTION_SNAPSHOT_ONLY` Checkpoint |
| Redis/Upstash | 通知、唤醒、可丢弃缓存 |

纯 Research 内核可在单次根调用内部使用
`REQUEST_LOCAL_VERIFIED_REPLAY` 合并重复验证，但它不是 Authority Cache：

- 仅组合器创建的闭包可以登记；登记前拒绝 accessor/cycle，随后递归冻结；
- 键只使用当前 Context 内的对象身份，不接受 hash、canonical JSON 或结构相等替代；
- 只缓存完整验证成功的结果；失败与异常立即删除；
- Context、WeakMap 与命中结果不跨请求，不进入 Checkpoint、Redis 或 PostgreSQL；
- 未显式接收内部 Context 的公开 API 始终执行完整验证。

Controlled 两查询合成夹具把摘要调用 `<=750`、Research Document 首验 `27`、
L2 Document 首验 `8`、内核耗时 `<=2000ms`、最大 RSS `<=400MiB` 固化为防退化
Oracle。该 Oracle 只证明当前固定夹具和本地纯内核预算，不代表生产 SLA、真实数据规模
或 Platform Authority 已交付。

固定锁顺序为：

```text
Run
→ current_report_readiness（内含 Revocation Head）
→ research_version_frontiers：
  SEMANTIC → SCHEMA → DATA → POLICY → IDENTITY
→ research_domain_terminals
→ report_read_grants（按 grant_id）
→ research_revocation_operations（需要时）
→ research_release_decision_commits（GO 时）
```

U6 App Migration 统一位于
`infra/supabase/apps/data-agent/migrations/`。不得在
`packages/platform/migrations/`、`infra/supabase/platform/migrations/` 或应用代码
目录建立第二套 U6 Schema 入口；共享 Platform Schema 变更不属于 U6。

### 10.2 单次 Authority Commit

除撤权外，每个运行中 Commit 在一个 App Transaction 内执行：

```text
strict parse
→ lock authenticated scope/run/principal active fence
→ verify attempt/lease/fence
→ resolve exact input revisions
→ recompute envelope hash
→ run domain verifier
→ verify narrow committer capability
→ append artifact
→ append audit/event
→ commit
```

### 10.3 Crash-after-SQL-receipt

受控恢复必须证明：

- Attempt A 已提交 Q1/Q2 SQL Receipt 后崩溃；
- Attempt B 使用更高 Fence，忽略 Checkpoint 中的 `ready` 和 Certificate Hash；
- 精确复用 Q1/Q2 Receipt，不再次执行 SQL；
- 重算 QueryEvidence、Support、Assessment、Coverage、Stop、Report、Gate 与
  Certificate；
- SQL 总执行次数仍为 2；
- Domain Semantic Hash 稳定；新 Attempt 重建时 Envelope Hash 可以改变；
- 旧 Fence 的迟到 Report/Certificate 提交失败。

## 11. 资源、外发与敏感数据

`RESEARCH_RUNTIME_LIMITS@1` 固定服务端上限；Tenant Policy 与 Brief 只能收紧：

```text
max_hypotheses=8
max_obligations=32
max_evidence_relations=256
max_report_sections=8
max_report_statement_units=128
max_artifact_input_refs=256
max_dependency_depth=32
max_recursive_closure_nodes=1024
max_artifact_bytes=1MiB
max_resolved_closure_bytes=16MiB
max_steps=24
max_model_calls=32
max_sql_executions=16
max_source_calls=0
max_elapsed_ms=600000
max_provider_input_tokens_per_call=32000
max_provider_output_tokens_per_call=8000
max_provider_tokens_per_run=256000
max_provider_cost_microusd_per_run=5000000
max_concurrent_model_calls=4
max_concurrent_sql=2
max_concurrent_tools=4
max_concurrent_runs_per_tenant=8
max_concurrent_runs_per_principal=2
max_run_starts_per_minute_per_tenant=20
max_run_starts_per_minute_per_principal=6
max_queued_runs_per_tenant=32
max_provider_tokens_per_tenant_day=2000000
max_provider_cost_microusd_per_tenant_day=50000000
sql_statement_timeout_ms=30000
max_sql_result_rows=10000
max_sql_result_bytes=8MiB
```

资源预检把“逻辑图大小”与“实际展开工作量”分开计量，禁止用同一个数字同时表达两种
风险：

- `max_recursive_closure_nodes=1024` 约束唯一逻辑节点。进程内普通 derivation object
  按 object identity 去重；strict Document 按完整 Artifact Reference Identity 去重；
  Array 只是 adjacency/collection edge，不计逻辑节点。
- Transport 必须先把不可信输入反序列化成 inert JSON；因此 Wire 中的重复副本没有共享
  identity，仍会自然计为不同逻辑节点。Proxy 不属于进程内预检的可信输入。
- Wire/collector 在读取 `protocol_version`、`artifact_type` 等 discriminator 前，只
  接受 own enumerable data descriptor；禁止 accessor、symbol、custom prototype、
  `undefined`、BigInt、非有限数、cycle 与其他非 inert JSON 值。
- Array 必须精确继承 `Array.prototype`，并在调用 `Reflect.ownKeys` 前先从 inert
  `length` data descriptor 检查 entry 上限；超限数组不能触发代理或继承陷阱。
- 每个 strict Document 另受 `1024` 个 unique JSON container、`32` 层和 `1MiB`
  限制；仅有 `{envelope,payload}` 外形但 strict parse 失败的候选，必须把其普通 object
  identity 和真实深度回补到外层预算，不能借候选外形重置深度。
- 共享 DAG 的每次实际展开仍累计保守字节数；全局 container occurrence 上限为
  `1024*32=32768`，包含 primitive 的 total-value occurrence 后备上限为
  `1024*256=262144`，并同时受 `16MiB`、每容器 `256` entries 与 active-ancestor
  cycle 拒绝约束。

这些上限是同时生效的防护面，不承诺各字段最大值的笛卡尔积都可被一个内存闭包承载；
命中任一预算即失败关闭。后续 Platform Authority 应从规范化 Reference Graph 按需解析，
不能通过抬高纯内核预算来容纳重复展开。

每次 Model/SQL/Tool 调用前必须原子 Reserve tenant/principal/run 预算，完成后结算，
失败或取消后幂等释放。缺失可靠 Token/Cost 计价的 Provider 必须失败关闭或走显式
Tenant Policy 例外。

Provider 外发必须经过 `AgentDataProjectionReceipt`：

- 按角色固定字段 Allowlist、Provider Profile、Redaction 与 Byte/Token 上限；
- 原始 Sandbox 行不离开服务端；
- 继承 Column/Metric Lineage 的最高分类；
- 执行小群组抑制、维度基数限制与 DLP；
- 低熵敏感值只能使用 tenant/scope 隔离的 Keyed HMAC，禁止普通 SHA-256；
- Receipt 记录字段清单、Redaction Count 与 Egress Digest，不记录受限原文。

## 12. U6-owned Controlled Fixture

`retail-revenue-investigation-v1` 只证明协议，不提供真实业务或 Benchmark 结论。

### 12.1 竞争假设与阈值

| 假设 | 支持阈值 | 反证阈值 |
| --- | --- | --- |
| `promotion-mix` | 促销贡献份额 `>= 0.60` | `<= 0.30` |
| `late-refund` | 延迟退款份额 `>= 0.40` | `<= 0.20` |

### 12.2 两次依赖查询

```text
Q1
baseline_net_revenue=1000
current_net_revenue=800
decline_amount=200
promotion_contribution=140
late_refund_contribution=20
other_contribution=40

Q2（input_refs 精确绑定 Q1 QueryEvidence）
promotion_decline_share=0.70
late_refund_decline_share=0.10
```

Oracle 必须先验证 `140 + 20 + 40 = 200`，再派生：

```text
promotion-mix → SURVIVED
late-refund → REFUTED
ResearchStopDecision → STOP_READY
Public Terminal → READY
```

报告必须披露 `SINGLE_AUTHORITY_SOURCE`、`L2_NON_CAUSAL` 和
`BOUNDED_HYPOTHESIS_UNIVERSE`。

## 13. 必杀 Mutation 与恢复 Oracle

下表凡预期为 `PARTIAL` 的 Mutation，都必须同时满足由 Authority 重算的三项前提：
`hard_budget_cap=true`、`deliverable_supported_subset=true`、
`budget_executable_query_count=0`。Mutation 名称本身不能推出 Partial。

| Mutation | 额外前提 | 必须结果 | Reason Code |
| --- | --- | --- | --- |
| `citation-only` | Partial 三前提 | `PARTIAL` | `EVIDENCE_SUPPORT_INSUFFICIENT` |
| `hidden-conflict` | Partial 三前提 | `PARTIAL` | `MATERIAL_CONFLICT_UNDISCLOSED` |
| `critical-query-failure` | Partial 三前提 | `PARTIAL` | `CRITICAL_OBLIGATION_FAILED` |
| `stale-cross-revision` | — | `STALE` | `EVIDENCE_REVISION_STALE` |
| `budget-false-complete` | Partial 三前提 | `PARTIAL` | `BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION` |
| `writer-bypass` | — | `FAILED` | `REPORT_PROJECTION_AUTHORITY_INVALID` |
| `false-source-independence` | Partial 三前提 | `PARTIAL` | `SOURCE_INDEPENDENCE_POLICY_UNSATISFIED` |
| `wrong-successful-sql` | Partial 三前提 | `PARTIAL` | `OBLIGATION_QUERY_SEMANTICS_MISMATCH` |
| `wrong-filter-successful-sql` | Partial 三前提 | `PARTIAL` | `OBLIGATION_QUERY_SEMANTICS_MISMATCH` |
| `bounded-universe-disclosure-omission` | Partial 三前提 | `PARTIAL` | `BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED` |
| `supervisor-certificate-bypass` | — | 无 Certificate | `REPORT_READY_AUTHORITY_REQUIRED` |
| `certificate-tamper` | READY 提交前 | 无 Public Terminal | `REPORT_READY_CERTIFICATE_TAMPERED` |
| `certificate-semantic-hash-tamper` | READY 提交前 | 无 Public Terminal | `CERTIFICATE_SEMANTIC_HASH_MISMATCH` |
| `current-ready-revocation-race` | READY/Grant 提交前撤权胜出 | `STALE`，无 READY/Grant | `READINESS_REVOKED_DURING_CONSUMPTION` |

为防 Mutation 表被实现成“失败类型直接映射 Partial”，每个 Partial Mutation 必须有成对
反例：

| 配对状态 | 必须结果 |
| --- | --- |
| 仍有预算且已有合法可执行 Query | `CONTINUE / ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE` |
| 仍有预算且需要重编 EvidencePlan | `REPLAN / EVIDENCE_PLAN_REPLAN_REQUIRED` |

两类配对反例不得签发 Public Terminal；只有查询/重规划完成后重新进入 Stop Authority。

额外 Oracle 必须覆盖：

- Coverage 五态全部可从原始输入重算；
- Stop 六分支全部命中；
- 未解决 material conflict 阻断 `SATISFIED/STOP_READY`；
- material Claim 与当前 Schema Frontier 不一致时进入 `STALE`，不能复用旧 Support；
- Tenant Burst、Provider Cost Exhaustion、SQL Result Amplification 失败关闭；
- Cancel Reservation Leak 幂等释放；
- V1 可历史读取但不能授权 current-ready；
- 通用 `authorizeRunTerminal(READY)` 固定返回
  `CURRENT_READY_CONSUMPTION_REQUIRED`；
- Release `GO` 拒绝 V1、REVOKED 或只完成历史 Certificate 校验的输入；
- Grant Issue 后、Response CAS 前撤权（含 Consume 后/Response 前）必须零字节；
  Response CAS 先胜出后本次单次响应可完成，撤权只阻止后续读取；
- Checkpoint 伪造 READY 不产生 Authority。

## 14. 实现落点与依赖方向

```text
packages/contracts
  Artifact schema、纯 kernel、reference/hash、public terminal evidence contract

packages/research
  planning.ts
  evidence.ts
  coverage.ts
  reporting.ts
  readiness.ts
  server.ts

packages/platform
  PostgreSQL exact-revision committer
  current-ready / revocation / grant
  resource reservation
  AgentDataProjectionReceipt

apps/worker
  Mastra Team + Research + Text2SQL + Sandbox + Platform 的组合
```

依赖规则：

- `packages/research` 只依赖 `@data-agent/contracts`；
- `packages/research` 不导入 Mastra、Supabase SDK、Platform Repository 或
  `packages/text2sql`；
- `packages/platform` 实现持久化与 Port，不拥有领域 Verdict；
- `apps/worker` 只做组合，不定义 Research 真值。

## 15. 实施顺序

1. 升级 V2 Artifact Schema 与 Type Registry；V1 只进入显式
   `readHistorical*` 分支，所有 Writer、Authority、current-ready、Grant 与 Release
   `GO` 拒绝 V1。
2. 实现纯 Research Kernel 与全部确定性单元 Oracle。
3. 增加 server-only Authority Registrar/Brand 与 Candidate/Authority 反例。
4. 在 `infra/supabase/apps/data-agent/migrations/` 增加 PostgreSQL Research
   Committer、`CurrentReadiness=CURRENT|REVOKED`、Revocation、Grant 和 Resource
   Reservation；退役通用 `authorizeRunTerminal(READY)`。
5. 组合 Worker Workflow，验证 Checkpoint 只保存执行位置与精确引用。
6. 跑 Controlled、14 Mutation 及其预算可执行配对反例、Crash-Recovery、Resource、
   READY 前后 Revocation Race、Grant Issue/Consume/Response、V1 Read-Deny 与 Release
   current-tuple 集成测试。
7. 更新 UI/API 之前先冻结 Projection，不让 UI 自行推导 Ready。

## 16. U6 完成定义

U6 只有同时满足以下条件才可标记完成：

- 所有新增 Artifact 有 strict Schema、Hash、Exact Reference、Authority Brand 与
  Candidate Bypass 反例；
- Controlled Case 经真实 `packages/research`、PostgreSQL Authority 和 Worker
  Workflow 到达 `READY`；
- 14 个 Mutation 获得预注册 Owner、终态和 Reason Code；
- 每个 Partial Mutation 的 hard-cap 配对反例在有可执行 Query 时只得到
  `CONTINUE/REPLAN`；
- Crash-Recovery 不重复执行 SQL；
- 历史 READY 与 `CurrentReadiness` 双状态、material Claim/Schema Frontier、
  current-ready、Grant Consume 与撤权竞态在 PostgreSQL 序列化边界内失败关闭；
- 通用 `authorizeRunTerminal(READY)`、V1 Writer/Authority/GO 与历史 Certificate
  Release GO 旁路全部固定拒绝；
- Resource 与 Provider Egress Oracle 全通过；
- `pnpm lint`、`pnpm typecheck`、Unit、Integration、Architecture 与
  `pnpm verify:release` 全部运行；
- `verify:release` 仍诚实返回 `HOLD`，直到 U7–U9 和签名 Outcome Evidence 完成。

本文件冻结的是 U6 目标合同，不是实现或生产认证。任何通过本文档更新、类型断言或本地
合成脚本得到的结果，都不能单独把 U6 或 Release 标记为完成。
