# Artifact 权威与内容寻址

> Schema 只证明载荷形状；权威 Artifact、成功终态和发布决策必须再经过确定性授权。
>
> U6 条款状态：`FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED`。当前 HEAD 仍是 V1
> `ReportReadyCertificate -> authorizeRunTerminal` 行为，不能被描述为已经具备
> current-ready、V2 Support/Coverage/Stop 或撤权权威；U6 必须永久退役这个 READY
> 分支，不能把它留作兼容入口。U6 实现完成时才转为现行约定。
> U6-C2 已实现 TypeScript Research Hash v2、Budget/Receipt/Attestation strict
> codec 与完整 verifier；这只证明内存载荷闭包，不证明 DB-owned Receipt、currentness
> 或 Root Authority，后者仍保持 `NOT_IMPLEMENTED`。
> U6-C2 物理 Schema Descriptor 另已冻结 15 core + 5 companion、11 existing
> mutation 与 Candidate/target Inventory v2；其 `installable=false`，在正式
> `10600`、PG17 Catalog 与双部署 Oracle 完成前仍不构成数据库 Authority。
> `10712..10721` 已单独交付 `RESEARCH_ANALYSIS_WORKER` 固定 13-Purpose Authority
> Provision Profile；这只解决 Worker 研究链的部署签发，不改变本文件所述 Root
> Authority、currentness 与 Terminal 仍未完整交付的状态。

## 场景：创建或消费权威 Artifact 与成功态

### 1. 范围 / 触发条件

- 创建 `COMMITTED` Artifact、`READY` Run Terminal、`GO` Release Decision 或 `DELIVERED` Capability Receipt 时适用。
- Agent、Model、外部 JSON 和普通 Zod Parse 结果始终是不可信 Candidate。

### 2. 签名

```ts
interface L2ArtifactAuthorityContext {
  principalId: string;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveL2(reference: ArtifactReference): Promise<unknown | null>;
  resolveGroundingAuthority?(
    reference: GroundingAuthorityReference,
  ): Promise<unknown | null>;
  resolveSystemArtifact?(reference: ArtifactReference): Promise<unknown | null>;
  verifySystemArtifactCommitted?(reference: ArtifactReference): Promise<boolean>;
  verifySqlArtifactCompilation?(input: {
    sql_artifact: SqlArtifactPayload;
    logical_plan: LogicalPlanPayload;
    grounding: GroundingPackagePayload;
    query_contract: QueryContractPayload;
  }): Promise<boolean>;
  verifyResourceAdmissionReceipt?(receipt: ResourceAdmissionReceipt): Promise<boolean>;
  resolveAuthoritativeMetamorphicFixtureReceipt?(
    reference: ArtifactReference,
  ): Promise<AuthoritativeMetamorphicFixtureReceipt | null>;
  resolveAuthoritativeMetamorphicOracleReceipt?(
    reference: ArtifactReference,
  ): Promise<AuthoritativeMetamorphicOracleReceipt | null>;
  resolveAuthoritativeResultOracleReceipt?(
    reference: ArtifactReference,
    metamorphic: AuthoritativeMetamorphicOracleReceipt,
  ): Promise<AuthoritativeResultOracleReceipt | null>;
  resolveAuthoritativeSandboxExecutionReceipt?(
    reference: ArtifactReference,
  ): Promise<AuthoritativeSandboxExecutionReceipt | null>;
  resolveAuthoritativeSandboxResult?(
    reference: ArtifactReference,
  ): Promise<AuthoritativeSandboxResult | null>;
  verifyCommitterCapability(claim: ArtifactCommitterCapabilityClaim): Promise<boolean>;
}

interface ReleaseAuthorityContext extends L2ArtifactAuthorityContext {
  resolveScoreCard(reference: ArtifactReference): Promise<AuthoritativeScoreCard | null>;
  resolveBenchmarkAdapterReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeBenchmarkAdapterReceipt | null>;
  resolveSandboxExecutionReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeSandboxExecutionReceipt | null>;
  resolveModelCertificationReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeModelCertificationReceipt | null>;
  resolveReleaseManifest(
    reference: ArtifactReference,
  ): Promise<AuthoritativeReleaseManifest | null>;
}

computeL2ArtifactContentHash(document: L2ArtifactDocument): Promise<ContentHash>;
verifyL2ArtifactDocument(
  input: unknown,
  authority: L2ArtifactAuthorityContext,
): Promise<L2ArtifactDocument>;

verifyDerivationReceipt(
  input: unknown,
  inputHashMaterial: unknown,
  subordinateContext?: unknown,
): Promise<DerivationReceipt>;
verifyCandidateEnumeratorAttestation(
  input: unknown,
  budgetReceiptInput: unknown,
): Promise<CandidateEnumeratorAttestation>;
verifyResearchStopDecisionV2(
  input: unknown,
  budgetReceiptInput: unknown,
): Promise<ResearchStopDecisionPayloadV2>;

authorizeRunTerminal(
  input: unknown,
  authority: L2ArtifactAuthorityContext,
): Promise<AuthoritativeRunTerminal>;
// U6 目标契约：拒绝 READY/PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE/STALE。
// READY/STALE 固定抛 CURRENT_READY_CONSUMPTION_REQUIRED；
// 三个 Research Stop 终态固定抛 RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED。

// U6 不在本通用文件定义 *AuthorityContext 或复制签名。
// ResearchStopTerminalPort / CurrentReadinessPort 必须直接 import
// docs/design/u6-research-platform-contract.md 的 strict Schema infer 类型。

authorizeReleaseDecision(
  input: unknown,
  authority: ReleaseAuthorityContext,
): Promise<AuthoritativeReleaseDecision>;

authorizeReleaseManifest(
  reference: ArtifactReference,
  authority: ReleaseManifestAuthorityContext,
): Promise<AuthoritativeReleaseManifest>;

authorizeOracleVerdictReceipt(
  reference: ArtifactReference,
  authority: OracleVerdictAuthorityContext,
): Promise<AuthoritativeOracleVerdictReceipt>;

authorizeScoreCard(
  input: unknown,
  authority: ScoreCardAuthorityContext,
): Promise<AuthoritativeScoreCard>;

issueCapabilityDeliveryReceipt(
  input: Omit<CapabilityDeliveryReceiptInput, "release_decision">,
  decision: AuthoritativeReleaseDecision,
): CapabilityDeliveryReceipt;
```

### 3. 契约

- 只有 `COMMITTED` Revision 能通过当前持久化上下文的递归核验；返回值只是本次调用内的深冻结快照，不携带可跨事务复用的 L2 权威品牌。
- `content_hash` 对规范化 Envelope 版本元组、Scope、Input Reference 与 Payload 计算；不包含可变的 `status`、`created_at` 和 `content_hash` 本身。
- Canonical JSON 的对象 Key 使用 UTF-16 代码单元顺序，不允许 `localeCompare`。
- 当前 Revision 必须已由持久化 Authority 提交；调用方在 Candidate 中自报 `COMMITTED` 不能通过核验。
- `verifyCommitterCapability` 必须由服务端持有，并校验 Scope、Run、Attempt、Artifact Type、Producer 与 Policy Version；不得接受 Candidate 自带的布尔授权结论。
- `resolveL2` 只能返回原始持久化文档；每次消费都必须在当前 Authority Context 中按完整 Reference、Hash、Committer 与语义上游重新核验。
- 单次根核验可以缓存已经完成全部验证的 Content-Addressed Snapshot，但缓存不能跨根调用、事务或 Authority Context；递归分支必须独立检测循环。
- Payload 中的引用必须使用字段对应的 `artifact_type`，与 Envelope 属于同一 `app_id/tenant_id/environment/run_id`，并完整出现在 `input_refs`。
- 首个 Revision 的 `parent_ref` 为 `null`；后续 Revision 必须引用同 Scope、同 Artifact、前一 Revision 的完整 Content-Addressed Reference，Authorizer 还要验证父 Revision 已提交。
- Reference 身份由 App、Tenant、Environment、Run、Artifact ID、Artifact Type、Revision 与 Content Hash 共同决定。
- Authorizer 必须验证所有 Reference 已提交；Execution、Supported Claim 与 Ready Certificate 还必须解析已授权的上游 L2 文档，不能把 `isCommitted=true` 当作成功语义。
- L2 研究链必须按 `ResearchBrief -> HypothesisSet -> EvidencePlan -> QueryContract -> GroundingPackage -> SemanticQuery -> LogicalPlan -> SqlArtifact` 解析权威上游；每个竞争假设都必须被 Evidence Obligation 覆盖。
- ACL-first Grounding 的 Catalog、Semantic Binding、Policy AllowedSchema、Mandatory Predicate、Join Closure、Preaggregation 与 LogicalPlan Scan 统一使用 `<table_id>.<column_id>`；凡同时声明 `table_id` 的结构，限定列前缀必须与其完全一致，不能让 ACL 与 SQL 编译器对字段归属产生两种解释。
- Catalog、Policy 与 Grounding 中会进入 `Map`、`Set` 或 `.find` 的 Table、Column、Metric、Dimension、Relationship、Required Column 与 Candidate 身份必须唯一；重复身份不能依赖覆盖顺序获得 `READY/VALID`。
- Metric 与 Dimension 共用同一个语义 ID 也属于冲突；SemanticRelease、Catalog、QueryContract、GroundingPackage、SemanticQuery 与 Project 输出必须在跨类型命名空间上互斥。
- 首版 QueryContract 只有一个 Metric，因此 Aggregate、Preaggregate 与 Grounding Preaggregation Proof 都只能消费一个 Measure；复制同一 Measure 不能借逐项相等检查与 Set 折叠获得 `VALID`。
- 多路检索可以重复命中同一已授权对象；Grounding 必须按分数降序后以 `object_id` 稳定去重、保留最高分命中，不能因为重复 Hit 抛出 Schema 异常。
- 对外导出的 `SemanticRelease`、`SchemaSnapshot`、`PolicyReceipt` 分支 Schema 必须与联合 Schema 承载相同的 Scope、Revision、Hash、唯一性和分支语义约束，不能把分支 Schema 当作绕过 Authority Refinement 的形状解析器。
- `SqlArtifact.query_hash` 必须由 Dialect、SQL 与 Parameters 的规范内容计算；`ExecutionReceipt` 必须绑定同一 SqlArtifact、同一 Query Hash、同一 Datasource，并消费七道 Gate 全部 PASS 的 `ValidationReceipt`。
- `SqlArtifact` 提交时必须由服务端确定性 PostgreSQL Compiler 对当前权威
  `LogicalPlan + GroundingPackage + QueryContract` 重编译并逐字匹配；重新计算
  `query_hash` 只能证明 SQL 自洽，不能证明它是权威计划的编译结果。持久化载荷还要
  固定 `compiler_version` 与 `ast_hash`，STRUCTURAL Gate 必须逐项回显这些权威字段。
- Bounded Repair 只能消费服务端解析的失败 `GateReceipt` 和冻结的
  `QueryContract/GroundingPackage/SemanticQuery/LogicalPlan/root SqlArtifact`
  完整 Reference、Payload Hash、Principal、Policy 与 Semantic Signature。`failed_gate`
  和 `failure_code` 不能由调用者用两个字符串重新标注。
- Repair Session 由 `@data-agent/text2sql/server` 创建；Episode 只由
  Scope/Run 与冻结 Query/Grounding/Semantic/Plan/Policy 内容身份派生，不把
  `repair_id`、Principal 或可重发的 Root Reference 当作 Salt，从而保证同一冻结问题
  只能有一个预算账本；当前 Parent 必须沿同一
  SqlArtifact 的连续 Revision 前进。每次 CAS 必须原子持久化完整 Trace、
  Receipt 与 Candidate，而不是只保存 Hash；`loadCurrentRepairSession` 重启恢复时
  必须重新授权 Compiler Input，并重放 deterministic compiler、Patch Derivation、
  Gate→Outcome 状态机和整条 History；只同步重算公开 SHA 不能重新品牌化伪造
  Candidate。新建 repair_id、复制 Root Artifact、切换 Principal、把 Child Revision
  重新封成 Root、复用旧 Head、未授权 JSON 或并发分叉都不能重置两次 Attempt 上限。
- Repair 的 `compiler_input` 必须保留同进程 `AuthoritativeLogicalPlanBinding` 品牌，
  拒绝 Accessor，并对解析后的 Grounding 内容重新计算 `grounding_hash`；校验、History
  重放与 live compile 必须复用同一份深冻结规范快照。clone/plain/Schema 非法输入或
  “内容漂移但复用旧声明 Hash”必须在 Attempt/CAS 前失败关闭，不能折叠为
  `REPAIR_COMPILER_UNAVAILABLE`、消费预算或写入终态。`RepairReceipt` 的
  Candidate/Route/Terminal 字段必须穷尽互斥，`REPAIR_SESSION_TERMINATED` 只表示
  Trace 吸收态，不能伪造成持久 Attempt Receipt。
- Frozen Artifact、当前 Parent 与失败 Gate 都必须调用服务端
  `verifyExactArtifactRevision(reference, payload)`；不能把“Reference A 已提交”
  和 Resolver 返回的“Payload B 自洽”拼成 Repair Authority。CAS loser 与过期 Head
  只返回可恢复的 `STALE_HEAD`，不能伪造权威 `TERMINAL`。
- 当前可证明的 Repair 只把当前 Parent SqlArtifact 的 SQL/参数、Compiler Metadata 和
  Query Hash 恢复为同一冻结 LogicalPlan 的 deterministic PostgreSQL compilation，
  每轮最多四个无值 Patch Op。输出状态只能是
  `CANDIDATE + NEEDS_FULL_REVALIDATION`，不能自称 `REPAIRED`；必须重新通过七道
  Gate 后才可进入
  Validation/Execution 权威链。Join、Metric、Filter、Grain、Time、Policy、Literal
  或 Result Contract 变化一律路由到 Replan/Clarify/Human。
- `ResourceAdmissionReceipt`、`FixtureMutationRecord`、`MetamorphicFixtureReceipt`、
  `MetamorphicOracleReceipt`、`ResultOracleReceipt`、`SandboxExecutionReceipt` 与
  `SandboxResult` 属于专用 System Artifact；L2 Resolver 必须按完整 Reference 取回、
  重算规范 Hash，并消费对应服务端 Authority 签发的不可克隆品牌，不能只接受任意已提交
  JSON。PostgreSQL 提交边界必须按 Artifact Type 把这些 Input Reference 路由到同一
  事务内的 System Store；不得要求它们镜像进通用 `artifacts` 表，也不得让
  `FixtureMutationRecord` 落入普通 Artifact 路由。
- `MetamorphicFixtureReceipt` 与 `MetamorphicOracleReceipt` 只能存在于 System
  Artifact 白名单，不能进入 `L2_ARTIFACT_TYPES` 或复制字段到 `QueryEvidence`。
  Fixture Authority 必须从当前已提交的
  `QueryContract -> GroundingPackage -> SemanticQuery -> LogicalPlan -> SqlArtifact`
  关闭适用性。Fixture、Meta、Result 三条服务端 Authority 只能调用 contracts 内置的
  固定 kernel；公开 Composition API 只能接收 Identity、System Store、Sandbox 与上游
  Authority，不能接收调用方注入的 `verify*Closure` 或 Applicability Callback。
  首版仅对非 `DISTINCT` 的整数 `SUM` 与普通 `COUNT`、Additive Metric、
  `HALF_OPEN` 时间语义和精确 Aggregate/Project 形态可用；
  `AVG/MIN/MAX/COUNT_DISTINCT`、数值但非整数的 `SUM` 与其他计划形态必须返回不可用。
- Fixture 固定按
  `FAN_OUT -> NULL_ANTI_MEMBERSHIP -> HALF_OPEN_ADDITIVE_PARTITION ->
  SAME_VALUED_DISTINCT_FACT` 封存四个 Case。三个单数据变换 Case 必须绑定已提交的
  `FixtureMutationRecord`；Record 必须由严格的 `relation_kind` 判别 Schema 解析，并将
  Scope、Run、Case、Baseline/Follow-up Snapshot 与 kind-specific Witness 逐字段绑定，
  不能只证明自报 JSON 与自报 Hash 一致。每个 Case 还必须有恰好一行的 Selection
  Probe，精确证明 relation-specific key、Group Key、可选时间与非零整数 Measure。
  半开分区不是伪造 Follow-up：whole 使用 Meta Baseline，left/right 必须绑定同一
  Snapshot 上三个互异 `SqlArtifact` 的真实 `query_hash`、三个互异 Input Hash 与两份
  完整 Sandbox 结果。
  三者必须复用同一 Compiler/AST/LogicalPlan/SQL 模板和参数键；QueryContract 与
  Witness 固定 whole=`[start,end)`、left=`[start,midpoint)`、
  right=`[midpoint,end)`，除上下界参数外其余参数必须逐项相同。仅追加注释、复用
  Baseline 参数或改动非时间参数均不是有效 Query Variant。
- Metamorphic Receipt 固定封存四项 RelationSample；每项必须有规范 `sample_hash`、
  非空 kind-specific witness 和互异的完整 Sandbox Receipt/Result Reference。
  Resolver 必须重算 sample/evidence/receipt 三层 Hash，逐组品牌化
  `SandboxExecutionReceipt + SandboxResult`，并验证同一稳定 Sandbox Identity、
  Scope/Run、Input Hash、Snapshot、完成时间和 Fixture 绑定。SQL 结果按保留重复项的
  无序 Multiset 比较；空 `group_key=[]` 是合法全局聚合。半开分区用同一 Snapshot 的
  whole/left/right 原始行重算加法，不信任声明值。分组 `SUM/COUNT` 的 left 可以为空，
  但必须满足 `whole = right`；right 仍须包含边界事实，全局聚合不能用零行伪装数值
  `0`。每项 Relation 的声明 Verdict 必须等于固定 Verifier 的计算 Verdict，总 Verdict
  必须等于四项计算结果的聚合；声明与计算不一致时不得把 Receipt 品牌化为 observed
  FAIL。
- `FIXTURE_MUTATION`、`SANDBOX_EXECUTION`、`METAMORPHIC_VERIFIER` 与
  `RESULT_PRODUCER` 四个角色的 `authority_id/principal_id/key_id` 必须分别两两互异；
  UUID 在比较前规范为小写，不能用大小写别名绕过角色独立。Fixture 签发时间不得晚于
  Meta 评估时间，Meta 不得晚于 Result 评估时间。缺少任一品牌、错 Revision、
  Reference A/Payload B、重复执行引用、伪 Snapshot、空/多行 Probe 或执行晚于
  `evaluated_at` 都失败关闭。
- Sandbox 在消费 `ExecutionPermit` 与 `SqlArtifact` 时，必须让完整 Reference 与
  Resolver 返回的精确 Revision Payload 在同一事务快照内闭合；不得把“Reference A
  已提交”和“Payload B 自身 Hash 合法”拼成执行授权。
- 执行前必须按 `INTENT -> SEMANTIC -> STRUCTURAL -> POLICY -> RESOURCE` 固定顺序消费
  五张新鲜 PASS GateReceipt；`ExecutionPermit` 直接绑定同一 Resource Admission、
  Principal、PolicyReceipt、Datasource、Schema、PostgreSQL Settings 和
  Timeout/Lock/Rows/Bytes/Memory 五维预算。
- `ExecutionReceipt` 必须逐字段匹配同一 Permit 与 Sandbox 的实际执行事实，包括只读事务、
  事务开始时 Principal/Policy 重验证、Datasource/Schema/Settings、Snapshot/Watermark、
  Result Hash、行数、字节数、内存与时间顺序。Permit 的有效性以事务开始时刻判断；
  已合法开始的事务可以跨过 `expires_at` 完成，但权威 `completed_at - started_at` 与
  服务端记录的 `elapsed_ms` 都不得超过 Timeout Budget。
- QueryContract、ResourcePolicy、ResourceAdmission、ExecutionPermit、Sandbox 与 Result
  Oracle 必须复用单一 `EXECUTABLE_QUERY_LIMITS`：最多 256 列、10,000 行、64 MiB
  Result、512 MiB 峰值内存；计划估算的行数/字节数属于另一组策略预算，不能混为执行上限。
  PostgreSQL 输出 Alias 必须满足 63-byte ASCII 限制，EXPLAIN Node Type 保留数据库真实
  名称并以唯一、有序列表封存。
- 执行后必须按 `EXECUTION -> RESULT` 消费权威 Sandbox Evidence、
  `MetamorphicOracleReceipt` 与 `ResultOracleReceipt`。RESULT `PASS` 与“已观察到且
  已授权”的 `FAIL` 都必须精确有序引用
  `[当前 SandboxResult, MetamorphicOracleReceipt, ResultOracleReceipt]`；L2 在一次根
  核验内只解析一次 Meta，并把同一个品牌对象交给 Result Resolver，不能以第二次解析
  替换证据。RESULT Gate 必须经 Result Authority 自有的专用 System Store 校验
  Commit 与 Exact Revision，再调用固定 Result kernel；通用 Artifact Store 中即使存在
  Hash 自洽镜像也不能得到品牌。只有 Oracle/Verifier 缺失或无法授权时，
  `UNAVAILABLE` 才可退化为精确单项 `[当前 ExecutionReceipt]`，以保留可观察失败并供
  Bounded Repair 消费；该退化形态不得进入 PASS、Validation 或 QueryEvidence 成功闭包。
  Result Oracle 的列顺序、行数、Invariant、Metamorphic Verdict 和 Query/Result Hash
  必须与冻结的 QueryContract 和同一执行精确闭合；总 PASS 当且仅当普通 Invariant
  与四项 Metamorphic Relation 全部 PASS。Meta 计算失败映射
  `RESULT_METAMORPHIC_FAILED`，普通不变量失败映射 `RESULT_INVARIANT_FAILED`，不能把
  有权威证据的 FAIL 降级成 `UNAVAILABLE`。最终 `ValidationReceipt` 只能按固定
  七 Gate 顺序封存，前五张引用必须与 Permit 已消费的引用完全相同，且
  `EXECUTION.evaluated_at <= RESULT.evaluated_at`；执行前五 Gate 可并发，不要求彼此时间单调。
- `QueryEvidence` 至少有一个 Invariant Verdict，并且必须沿 Validation 的 RESULT Gate
  解析同一权威 ResultOracleReceipt，按 QueryContract 顺序逐项匹配 ID 与 Verdict；
  `SUPPORTED` Claim 只能消费全 PASS Evidence。
- U6 V2 成功闭包只允许 `QUERY + DETERMINISTIC`。`EvidencePlan@2` 中的
  `evidence_kind` 固定为 `QUERY`；V1 `document/benchmark` 只允许历史读取。V2 编译器
  遇到 `SOURCE/DOCUMENT/BENCHMARK` 必须返回 `UNSUPPORTED_SOURCE_KIND`，不能创建
  `SourceEvidence`、Source Receipt 或无人消费的 Source System Store。
- 所有 V1 U6 Artifact 只允许由显式 `readHistorical*` Resolver 返回。Writer/
  Committer/Research Artifact Authority 收到 V1 固定
  `L2_WIRE_VERSION_WRITE_UNSUPPORTED`；current-ready、ReportReadGrant、RunTerminal
  与 Release `GO` 固定 `READINESS_PROTOCOL_VERSION_UNSUPPORTED`；普通
  `resolveL2` 或 Parser 成功不能把 V1 升级为当前 Authority。
- U6 容器内的 Hypothesis 与 Proof Obligation 必须使用
  `EmbeddedNodeReference={container_ref,node_id}`；Envelope `input_refs` 必须包含
  container 的精确 Content-Addressed Revision。裸 Node ID 或“读取最新容器”不能进入
  Support、Coverage、Stop 或 Replay。
- `ObligationExecutionDecision` 必须在 Sandbox 前从 Brief、Observation Contract、
  Semantic Release、Policy 与 QueryContract 重算 metric/formula、window/timezone、
  grain/dimension/grouping、join、canonical predicate/cohort、NULL 与授权 Scope。任一
  不匹配都以 `OBLIGATION_QUERY_SEMANTICS_MISMATCH` 失败关闭；SQL 合法、执行成功、
  非空或新鲜不能替代语义匹配。
- `QueryEvidence@2` 必须消费 `ObligationExecutionDecision=PASS`、QueryContract、
  SqlArtifact、Validation/Execution Receipt、SandboxResult 与当前
  Semantic/Schema/Data/Policy/Identity Frontier。`provenance_group`、Result Hash、
  Row Count 与 Schema Hash 由服务端重算；依赖查询必须在 `input_refs` 中精确引用上游
  QueryEvidence Revision。
- `AtomicClaim@2` 不包含可权威自报的 `support_state`。V1 字段只允许历史 UI 读取，
  不得进入 V2 Evidence、Support、Coverage 或 Readiness 闭包；唯一权威支持态来自
  `SupportDecision`。
- `SupportDecision` 必须消费 EvidenceRelation 与确定性/Provenance Check Receipt；
  Citation 存在、SQL 非空或模型语义相关不能单独得到 `SUPPORTED`。模型输出只允许成为
  `SEMANTIC_CHECK_CANDIDATE`，没有隔离的权威 HumanReviewReceipt 时不得提交成功
  Semantic Check。
- `CoverageState` 必须按
  `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 从 OED、执行、Evidence、
  SupportDecision、HypothesisAssessment、Conflict 与 Version Frontier 重算；未解决
  material conflict 必须使对应 Obligation 为 `FAILED`，不得由旧 Support 包装为
  `SATISFIED`。
- `ReportManifest.material_claim_refs` 由 Projection Authority重算为 Executive
  Summary 与 Supported Findings 两节 `claim_refs` 的规范去重并集。用于满足
  Critical Success Criterion 或承载报告主要数字/比较方向的 Atomic Claim 必须进入
  这两节之一；被反证假设与冲突分别使用 Assessment/Relation 引用。每个 material
  Claim、SupportDecision、QueryEvidence 与 Certificate 必须绑定同一个精确
  `schema_snapshot_ref`；Schema Frontier 变化使旧 material Support `STALE`，并要求
  OED、Proof、Coverage、Projection、Gate 与 current-ready 全链重算。
- `ResearchStopDecision` 的六个分支固定为
  `CONTINUE/REPLAN/STOP_READY/STOP_PARTIAL/STOP_NEEDS_MORE_RESEARCH/
  STOP_INCONCLUSIVE`。不存在无条件 Partial fallback；只有 Authority 重算得到
  `hard_budget_cap=true`、`deliverable_supported_subset=true` 且
  `budget_executable_query_count=0` 才能 `STOP_PARTIAL`。同一失败在仍有预算和合法
  Query 时只能 `CONTINUE`，需要重编计划时只能 `REPLAN`；输入不一致必须失败关闭。
- Candidate Enumerator 与 Stop v2 中的每个 `no_candidate_obligation_ref` 必须按完整
  Obligation identity 规范排序，并与恰好一项
  `NoCandidateAssessment={obligation_ref,reason_codes,constraint_closure_hash,
  assessment_hash}` 一一对应。旧 `u6-candidate-set@1` 只继续哈希
  `unresolved/candidateQueries/noCandidateRefs`；NoCandidate Assessment 由
  Attestation、Stop decision 与 Candidate Receipt 的外层 Hash 绑定，不能静默改变旧域。
- `verifyDerivationReceipt` 不能把 Stop Receipt 当作只需 self-hash 的叶节点。
  `research-stop-derivation-receipt@2.0.0` 必须携带 `STOP` subordinate context：
  exact Stop decision、Candidate Receipt、Candidate input material，以及 Candidate 的
  Attestation、Coverage Receipt 与 Budget Receipt context。验证顺序固定递归为
  `Stop Receipt -> Candidate Receipt -> Attestation -> Coverage/Budget`，随后 exact
  绑定 candidate projection、issuer/capability/epoch、Enumerator/EIG version、
  Supported Subset、decision 和三张上游 Receipt ID/Hash。
- 所有公开 `unknown` 验证入口必须先复制为 inert JSON，再读取 discriminator 或字段；
  Accessor、自定义 prototype、Proxy、稀疏数组与超限容器不能在验证前执行调用方行为。
  self-hash 成功只允许作为完整 verifier 的一个步骤，不能替代 subordinate closure。
- Research derivation 的包根只从短 facade 显式重导出稳定 API；Budget、Decision、
  Receipt Contract 与 Receipt Verifier 叶模块保持单向依赖。兼容 facade 禁止
  `export *`，叶模块禁止回指 facade、`wire`、`platform` 或 `index`，避免私有 helper
  意外成为公共协议或形成循环。
- `ReportManifest`、`AnalysisReport@2` 与 `ReportProjectionReceipt` 由确定性中文
  Projector 从已提交 Claim/Assessment/Conflict/Limitation 生成。Title 只能由
  `ZH_L2_RESEARCH_TITLE_V1(exact ResearchBrief)` 唯一渲染，Receipt 必须绑定
  `title_hash`，且 forbidden-claim 扫描同时覆盖 Title 与正文。Writer 新增数字、
  实体、比较方向、因果词或行动建议时，Projection Authority 必须返回
  `REPORT_PROJECTION_AUTHORITY_INVALID`。
- `ReportReadyCertificate@3` 必须消费同 Run 的 `STOP_READY`、Manifest@2、Report@2、
  Projection Receipt、四张独立 PASS EvidenceGateReceipt、全部 material
  SupportDecision 与精确 Version Frontier。服务端分别重算 Gate Input Hash、
  Input Closure Hash 与 Certificate Semantic Hash；普通 Parse、Supervisor、Writer
  或包根导出的构造函数都不能获得 Readiness 品牌。
- Envelope `content_hash` 继续包含 Attempt、Revision 与精确 `input_refs`；
  `decision_semantic_hash/certificate_semantic_hash` 排除 Attempt、Fence 和墙钟，只
  绑定领域输入、Evaluator/Policy、Version Frontier、领域事件水位与输出结论。重启后
  领域 Hash 必须稳定；新 Attempt 重建等价 Artifact 时 Envelope Hash 可以变化。
- `READY` 不得由历史上曾经合法的 Certificate 直接授权。server-only
  `CurrentReadinessPort.consume` 必须在同一 PostgreSQL 事务中锁定并核验 exact Certificate、
  current Semantic/Schema/Data/Policy/Identity Frontier，并在已锁 Current 行上校验
  内嵌 revocation seq/receipt，重算 Certificate
  Authority 后才能提交 DB-local Domain Terminal 或签发绑定 exact
  report/principal/服务端确定性 Report Projection/短 TTL 的单次
  `ReportReadGrant`。Issue/Response 的调用方都不能自报响应 Digest 或 Bytes；相同
  idempotency key 重放仍须重新检查撤权。
- 通用 `authorizeRunTerminal` 永久拒绝 U6 拥有的
  `READY/PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE/STALE`。`READY/STALE` 返回
  `CURRENT_READY_CONSUMPTION_REQUIRED`，三个 Research Stop 终态返回
  `RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED`；它不能委托历史 Certificate、
  StopDecision 或 Revocation Resolver 后补签，也不能从包根导出兼容旁路。
- `ResearchStopTerminalPort.commit` 是三个研究停止终态的唯一入口；它在同一持锁
  PostgreSQL 事务中解析 exact Strict `ResearchStopDecision`、重算 Coverage/预算/
  候选测试闭包，并执行固定映射：
  `STOP_PARTIAL -> PARTIAL/EVIDENCE_PARTIAL`、
  `STOP_NEEDS_MORE_RESEARCH -> NEEDS_MORE_RESEARCH/EVIDENCE_COVERAGE_INSUFFICIENT`、
  `STOP_INCONCLUSIVE -> INCONCLUSIVE/ANALYSIS_INCONCLUSIVE`。每 Run 只追加一条
  Domain Terminal；空引用、错分支、同键异载荷与已有 Terminal 均失败关闭。
- 历史 `RunTerminal=READY` 不可变；当前授权由独立
  `CurrentReadiness=CURRENT|REVOKED` 表达。READY 提交前撤权胜出可产生 `STALE`
  Terminal；READY 提交后的撤权只推进 CurrentReadiness，不改写历史 Terminal，也不在
  Durable Runtime 终态后追加 lifecycle Event。
- U6 Root 事务逐行锁序唯一取自
  `docs/design/u6-research-database-surface-contract.md` §3；任何子流程不得省略共同
  Authority prefix、Run 或从后段反向进入。
- `ReportReadGrant` 的 Issue 只创建待消费能力；Consume 是单次占用线性化点，必须在
  CAS 事务中再次锁定 CurrentReadiness、排序 Frontier，并在该 Current 行上校验内嵌
  revocation seq/receipt，只授权
  服务端物化绑定响应。`commitReportReadResponse` 必须第三次重验 current 状态，从
  exact Report 重跑固定版本 Projector 并逐字节匹配 immutable Projection，CAS 为
  `RESPONDED` 后才允许发送首字节；此前撤权胜出则
  零字节输出，Response CAS 先胜出后才只阻止新的读取/下载。
- `ReadinessRevocationReceipt` 追加而不覆盖历史 Certificate；撤权使用独立服务级
  `RevocationOperation` Attempt 和窄化 Capability，不要求已结束 Worker Fence 仍活动，
  也不能获得执行 SQL 或提交其他 Research Artifact 的权力。
- U6 研究终态 Owner 固定：`READY=Readiness`，
  `PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE=Research Stop`，`STALE=Revocation`；
  Clarification、Policy、Failed、Cancelled 与 Replay Unavailable 继续由既有
  Semantic/Policy/Runtime/Sandbox Authority 提交。不得新增万能 Research Terminal
  Receipt。
- `READY` 必须绑定同 Scope、经过四道 Evidence Gate 且覆盖 Report 全部 Claim
  Evidence 的权威 `ReportReadyCertificate`，并通过上述 current-ready 原子消费。
- `GO` 必须绑定同 Scope、同发布策略的版本化 `ReleaseManifest`，并覆盖
  `ReportReadyCertificate@3`、确定性 PASS 且 Safety Counter 全零的 `ScoreCard`、
  成功终态 `BenchmarkAdapterReceipt`、成功终态 `SandboxExecutionReceipt`、绑定
  Profile Hash 的 `ModelCertificationReceipt` 与同一 exact Certificate 的不可变
  `READY/RUN_READY` Domain Terminal。Release Authority 必须在 GO 事务中
  current-V3 revalidate Certificate、完整 material Claim/Schema Frontier、
  `CurrentReadiness=CURRENT` 与其内嵌 revocation seq/receipt；历史 Resolver PASS、V1 或
  `REVOKED` 均不能授权 GO。
- `ReleaseManifest` 必须内容寻址、已提交，至少各含一项 Hosted 与 Docker Evidence，并聚合 Release Decision 的全部 Evidence；领域 Resolver 返回的对象必须带有对应 Authorizer 在当前进程签发的品牌。U9 的生产 Deployment Receipt 类型交付前，Hosted/Docker/Signed Outcome 三个入口至少显式拒绝合成的 `MetamorphicOracleReceipt`。
- `OracleVerdictReceipt` 必须由持久化 Resolver 按完整 Reference 取回，校验 Receipt/Case/EvalRun 已提交，并通过服务端持有的 Suite-Specific Deterministic Oracle Capability 复核；调用方自报 `PASS` 或普通已提交 Evidence 不能获得品牌。
- `ScoreCard` 必须绑定权威 `OracleVerdictReceipt`，并逐项匹配 Case、EvalRun、Suite、Suite/Dataset/Oracle Version、Oracle Type 与 Deterministic Verdict。
- `ScoreCard.comparison` 明确区分 `SINGLE` 与 `PAIRED`；`PAIRED` 必须绑定不同的权威且已完成 Baseline/Candidate EvalRun，Candidate 等于当前 ScoreCard EvalRun，并携带版本化 Metric Interval、Confidence、Sample Size 与 Method。
- `DELIVERED` 只能由运行时验证过的 `AuthoritativeReleaseDecision` 签发；类型断言或普通 Schema Parse 不构成授权。
- 历史 Provider `AVAILABLE`、Eval Registry Assignment 与 `PASS ScoreCard` 仍有独立 Resolver/Authorizer；
  活动模型直连不消费 `AVAILABLE` 或 Certification Receipt。Schema Parse 仍不能产生 SQL、Evidence 或发布权威。

### 4. 校验与错误矩阵

| 条件 | 稳定失败 |
| --- | --- |
| Agent 直接提交 `COMMITTED` | Envelope Parse 失败 |
| 非 `COMMITTED` Revision 请求当前权威核验 | `ARTIFACT_NOT_AUTHORITATIVE` |
| 当前 Revision 未提交或服务端提交者能力不匹配 | `ARTIFACT_NOT_AUTHORITATIVE` |
| Payload 或 Version Tuple 与 Hash 不符 | `ARTIFACT_CONTENT_HASH_MISMATCH` |
| Input Reference 不存在或未提交 | `ARTIFACT_INPUT_NOT_COMMITTED` |
| 成功链无法解析权威上游文档或 Gate 失败 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| SQL 仅 Hash 自洽但不匹配确定性 Compiler 输出 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Repair Episode 已存在、旧 Trace Head 或并发 CAS 分叉 | `TEXT2SQL_REPAIR_SESSION_ALREADY_EXISTS` / `STALE_HEAD + REPAIR_CONCURRENT_TRANSITION` |
| Repair 使用未提交/错 Scope Gate、漂移 Bundle 或普通 callback Authority | `TEXT2SQL_REPAIR_FAILURE_AUTHORITY_REQUIRED` / `TEXT2SQL_REPAIR_FROZEN_BUNDLE_AUTHORITY_REQUIRED` / `TEXT2SQL_REPAIR_AUTHORITY_REQUIRED` |
| Repair Resolver 为完整 Reference A 返回 Payload B，或持久 Session 闭包无法恢复 | `TEXT2SQL_REPAIR_FAILURE_AUTHORITY_REQUIRED` / `TEXT2SQL_REPAIR_SESSION_REHYDRATION_FAILED` |
| Resource/Oracle/Sandbox Evidence 缺领域 Authority、Hash 漂移或换绑 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Metamorphic Receipt 缺固定关系、Sandbox 闭包、独立 Authority 或三层 Hash 漂移 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` / RESULT `RESULT_METAMORPHIC_FAILED` |
| Permit 缺 Gate、顺序/新鲜度错误、预算或 Principal/Policy/Settings 漂移 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Execution/Result/Validation 使用另一执行、另一结果或非当前七 Gate | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Payload Reference 跨 Scope 或未声明 | Document Parse 失败 |
| Stop Receipt 缺 `STOP` context、Candidate/Coverage/Budget 换绑或版本/issuer 不一致 | `TypeError`，不得返回已验证 Receipt |
| NoCandidate 引用缺失、重复、乱序、reason/constraint closure 漂移或 assessment hash 不符 | `TypeError`，不得返回已验证 Attestation/Stop |
| 只重算 Stop decision、Stop Ref、input/receipt outer hash，但 Candidate Receipt 仍是旧闭包 | `TypeError`，在 subordinate exact binding 失败 |
| `unknown` 输入携带 Accessor、自定义 prototype、Proxy、稀疏/超限数组 | inert-copy/strict parse `TypeError`，不得读取业务 discriminator |
| 通用 `authorizeRunTerminal` 收到 READY | `CURRENT_READY_CONSUMPTION_REQUIRED` |
| V1 Writer/Committer/Research Artifact Authority | `L2_WIRE_VERSION_WRITE_UNSUPPORTED` |
| V1 current-ready/Grant/RunTerminal/GO | `READINESS_PROTOCOL_VERSION_UNSUPPORTED` |
| material Claim 与当前 Schema Frontier 不一致 | `EVIDENCE_REVISION_STALE` |
| 历史 READY 已撤权后请求新 Issue | `CURRENT_READINESS_REVOKED` |
| 已撤权 Grant 再 Consume/Response | `REPORT_READ_GRANT_NOT_CONSUMABLE` / `REPORT_READ_GRANT_REVOKED` |
| `READY/GO` Reference 未提交 | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |
| `GO` 收到未品牌化、失败终态、证据不匹配或不完整 Manifest | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |
| `GO` 缺同 Certificate 的 READY/RUN_READY Terminal | `RESEARCH_READY_TERMINAL_REQUIRED` |
| `GO` 只有历史 Certificate 或 CurrentReadiness 缺失 | `AUTHORITY_EVIDENCE_NOT_CURRENT` |
| `GO` 的 CurrentReadiness 已撤权 | `CURRENT_READINESS_REVOKED` |
| Oracle Receipt 未提交、Hash/Reference 漂移或服务端 Oracle 复核失败 | `ORACLE_VERDICT_RECEIPT_NOT_AUTHORITATIVE` |
| ScoreCard 自报 Verdict、Oracle/Version 不匹配或 Paired Run 不权威 | `SCORECARD_NOT_AUTHORITATIVE` |
| Receipt Issuer 收到普通 GO 对象 | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |

### 5. Good / Base / Bad

- Good：确定性编译器生成 Candidate，计算 Hash，验证全部输入，再提交不可变权威对象。
- Base：普通消费者只解析 Candidate，用于诊断或展示，不把它写成成功态。
- Bad：`schema.parse(raw) as CapabilityDeliveryReceipt` 后直接显示“已交付”。
- Good（Research Stop）：调用统一 full verifier，并提供与 Stop Receipt exact 的
  Candidate input/context；验证器递归关闭 Attestation、Coverage 与 Budget。
- Base（Research Stop）：只通过 self-hash 的 Receipt 可用于完整性诊断，但不能授权
  terminal 或标成 DB-owned。
- Bad（Research Stop）：篡改 NoCandidate constraint closure 后重算所有可见外层 Hash，
  再省略 Candidate subordinate context，试图把“自洽”升级成“同一权威闭包”。

### 6. 必需测试

- 内容或 Version Tuple 改变但复用旧 Hash 时失败。
- 当前 Revision 未提交、或调用方无法证明服务端提交者能力时失败。
- 正确 Hash 但 Input Reference 不存在时失败。
- 后续 Revision 的完整 `parent_ref` 不存在时失败。
- 错误 Artifact Type、跨 Scope、未声明 Reference 时失败。
- 研究链断裂、未知 Hypothesis、Evidence Plan 覆盖不全时失败。
- `orders` 携带 `customers.id`、Relationship 两侧字段归属漂移、跨表 Metric/Dimension/Policy/Preaggregation 或 Scan 时失败。
- 重复 Table、Column、Metric、Dimension、Relationship、Required Column 或 Candidate 身份在进入检索与计划前失败。
- Metric/Dimension 跨类型同名、Project 重复 Alias，以及直接调用 Grounding Authority 分支 Schema 绕过联合约束时失败。
- Aggregate/Preaggregate 复制 Measure、或 Preaggregation 重复 Group Column 时在 LogicalPlan Schema 边界失败。
- 同一授权对象以不同分数重复返回时只进入一次 `accepted_candidate_ids`，且仍返回确定性的 GroundingResult。
- SqlArtifact Query Hash、Execution Query Hash 或 Datasource 与上游不一致时失败。
- Plan A 搭配 Ref B、未提交/合成 LogicalPlan、SQL 换写后重算 Hash、输出 Alias 与
  QueryContract 列不一致，或 STRUCTURAL 回显伪造 Compiler/AST 时失败。
- Repair 新建 repair_id 或把 Child Revision 重新封成 Root 不能重置同一 episode；
  当前 Parent 只允许沿 Root Artifact 的连续 Revision 前进；同一 Trace 的两个并发
  Attempt 只能有一个 CAS 成功，loser/旧 Head 只能返回 `STALE_HEAD`。完整
  Trace/Receipt/Candidate 必须原子保存并能在重启后恢复；Frozen Artifact 与失败 Gate
  的 Reference A/Payload B 换绑必须失败。Policy 失败不能重标为 Structural；
  No-progress、Compiler Unavailable 与非机械 Gate 路由必须留下内容寻址 Receipt；
  clone/plain/Schema 非法 Compiler Input，以及 Grounding 内容漂移却复用旧声明 Hash，
  必须在写入前失败且保持 Attempt/History 不变；
  第二次 Attempt 形成的终态必须吸收后续重放，不能再追加或覆写终态。Candidate 必须
  明确要求七门重验证且没有 Gate/Permit/Validation 字段。
- 五张执行前 Gate 缺失、重复、乱序、过期或刷新时间，Resource Admission 的 Principal、
  PolicyReceipt、Settings 与五维预算漂移时不能签发 Permit。
- Sandbox 在 Permit Seal 后撤权、实际 Datasource/Schema/Settings/Snapshot 与 Request
  回显不同、Result Hash/Bytes/Schema/Execution 换绑、真实墙钟跨度超时却低报
  `elapsed_ms` 时失败；事务开始前过期必须拒绝，开始后跨过过期点但仍在 Timeout Budget
  内完成则允许。
- Result Oracle 缺失、伪造自签、列顺序/行数/Invariant/Hash 不一致，以及 Validation
  混用另一轮 Gate、不复用 Permit 的前五 Gate、RESULT 时间早于 EXECUTION，或
  QueryEvidence 改写 Oracle Verdict/顺序时失败。
- Metamorphic Fixture/Receipt 缺少、重复或乱序四项关系，适用性不是由五段权威链
  推导，调用方注入恒真闭包，Mutation Record 错绑 Case/Relation/Snapshot/Witness，
  Mutation/Selection Probe 不闭合，sample/evidence/receipt Hash 漂移，
  witness 为空或无法证明非平凡性，baseline/follow-up Reference 重复/跨 Scope，
  HALF_OPEN 复用 Baseline SQL、缺 left/right 任一执行或 Query Variant Hash，
  Sandbox/Fixture/Meta/Result 四角色任一重用身份或品牌缺失时失败。RESULT
  PASS/observed FAIL 的三引用缺失、增加、乱序、换绑或 verdict/hash/时间不一致时不能
  封存；Oracle 不可用只能形成单 `ExecutionReceipt` 的 `UNAVAILABLE`。
- UUID 大小写别名不能绕过四角色独立；Fixture 晚于 Meta、Meta 晚于 Result、L2
  Result Resolver 二次解析另一 Meta 对象，以及有权威 Meta/Result FAIL 却缺少三品牌
  Resolver 时都必须失败关闭。
- 专用 System Store 已确认运行证据、但通用 `artifacts` 表不存在镜像行时，L2 提交仍成功；
  只有通用镜像、Exact Revision 被拒绝、Reference A/Payload B 或两个 Store 都无法确认时
  失败关闭。
- `REJECTED/SUPERSEDED`、缺 Validation Receipt、空 Invariant、缺 Evidence Gate 时失败。
- Authoritative 对象及嵌套 Payload 为冻结状态。
- `READY`、`GO` 与 `DELIVERED` 分别拒绝未验证证据和伪造品牌。
- 直接把合法 V2 Certificate 传给通用 `authorizeRunTerminal(READY)`，必须稳定返回
  `CURRENT_READY_CONSUMPTION_REQUIRED`；把合法 StopDecision 直接传给通用入口也必须
  返回 `RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED`。只有真实 PostgreSQL
  `CurrentReadinessPort.consume` 可以提交 READY，只有
  `ResearchStopTerminalPort.commit` 可以提交
  三个 Research Stop 终态。
- V1 只通过 `readHistorical*` 返回；V1 经 Writer、Committer、Research Artifact
  Authority 固定 `L2_WIRE_VERSION_WRITE_UNSUPPORTED`，经 current-ready、Grant、
  RunTerminal 或 GO 固定 `READINESS_PROTOCOL_VERSION_UNSUPPORTED`。
- READY 提交前撤权胜出得到 `STALE` 且无 READY/Grant；READY 提交后撤权保持历史
  READY、把 CurrentReadiness 置为 REVOKED，并拒绝新的 Grant Issue/Consume。
  Grant Issue 后、Response CAS 前撤权（包括 Consume 后/Response 前）都必须使本次
  响应零字节；只有 Response CAS 先胜出，本次单次响应才可完成，后续新读失败。
- material Claim 的 `schema_snapshot_ref` 与 Certificate Frontier 换绑时，即使
  Claim/SQL/Result Hash 不变也必须 `STALE` 并重跑全链。
- 每个预期 Partial 的 Mutation 都有“预算仍可执行”的成对反例，后者只能
  `CONTINUE/REPLAN`，不能产生 Public Terminal。
- Stop Receipt 正路径必须从 Candidate Receipt 递归重验 Attestation、Coverage 与
  Budget；缺任一 context、跨 Scope/Run、Receipt ID/Hash、issuer/capability/epoch、
  Enumerator/EIG version、Supported Subset 或 decision 换绑均失败。
- NoCandidate 必须覆盖空集合与非空集合；非空时测试缺失、重复、乱序 Obligation，
  reason code/constraint closure/assessment hash 漂移，以及篡改内层后同时重算
  Stop decision、Stop Ref、input hash 与 Receipt hash 的攻击，最后一种仍必须因
  Candidate Receipt 不匹配而失败。
- 对所有 Research derivation 公共 `unknown` 入口复用 hostile-object vectors：
  getter、自定义 prototype、Proxy trap、稀疏/超长 Array 都必须在业务字段读取前拒绝。
- 模块拆分后必须保持包根 API、旧 `u6-candidate-set@1` golden hash 与 4 个 focused
  derivation 测试文件不变，并用静态导入扫描证明叶模块无 facade/index/wire/platform
  回指。
- 历史 Provider 假 Receipt 或不匹配 Capability Hash 不能成为 `AVAILABLE`；活动直连不得读取该状态。
  EvalCase 不能被重新标为 Demo/Holdout；未完成 EvalRun、未提交 Evidence 或孤立 `PASS ScoreCard` 不能授权。
- Oracle Receipt 拒绝未提交、Hash 漂移、Reference 不匹配、Suite/Oracle Type 错配和服务端 Oracle 验真失败。
- ScoreCard 拒绝伪造 Oracle 品牌、自报 PASS、Receipt Verdict/Version/Reference 不匹配；Paired ScoreCard 拒绝 Candidate 漂移、未授权 Baseline 与非法 Interval。
- `GO` 拒绝失败/不确定 ScoreCard、非零 Safety Counter、领域伪造 Receipt、策略不匹配、
  未同时覆盖 Hosted/Docker 的 Manifest、尚无同 Certificate READY Terminal、
  V1/REVOKED Certificate、只做历史
  Certificate 校验或 material Claim/Schema Frontier 漂移；`MetamorphicOracleReceipt`
  不能冒充 Hosted、Docker 或 Signed Outcome Evidence。
- `commitGo` 的同幂等键重放也必须先重验 current/READY/Frontier/Revocation；历史 GO
  提交后若发生撤权，重放只能返回 `CURRENT_READINESS_REVOKED`，不能复用旧 GO 品牌。
- L3–L5 不能注册 Workflow、Route、Tool 或签发 Receipt。

### Governed chart companion

- `ArtifactWorkspaceDocument` V2 Chart 只能由已提交的同 Scope/Run `QueryEvidence` 确定性派生；它是公开 companion，不得替换专职任务验收使用的 `output_ref`。
- Chart document 必须原子携带完整 bounded dataset（LINE ≤100、BAR ≤30、PIE ≤12，`total_rows === rows.length`），并把 source ref、transform version、dataset hash 与 Resolved Context package/receipt identity 纳入 document hash。
- PostgreSQL commit 必须在有效 Worker fence 下重验 exact source revision/hash；VChart spec、Provider/模型 JSON、客户端行或 Tool output 都不是 Artifact authority。
- Preview 只返回 strict V1/V2 projection。V2 dataset/hash/document hash 任一不一致时失败关闭，不得回退到 `document_json` 或 raw Tool output。
- `query-evidence-chart@1.1.0` 保留 LINE/BAR 中缺失观测的行与 NULL，不因某个同比序列缺值删除整个时期。至少两个时期含真实数值；PIE 必须完整且非负，不得丢弃缺失类别后计算占比。历史 `@1.0.0` 文档及 hash 保持可读。
- nullable chart 的 dataset hash 包含 NULL，NULL → 0 或丢行均是内容变更；Web 使用 `invalidType=break`，不补零、不跨缺口连线，等价表保留完整受限数据集。
- TABLE column 可携带可选 `display={kind:TEMPORAL, logical_type, granularity, timezone}`。QueryEvidence 的显示元数据只能从已校验 semantic binding 派生，DATETIME 必须匹配 time window 的维度与显式时区；缺少该证据时保留原字符串，禁止浏览器本地时区或字符串猜测。DATE 是日历日期，不做时区偏移。
- `projectQueryEvidenceTablePresentation` 与 `formatArtifactTableCell` 是表格、Root ARTIFACT_FACTS 正文和图表横轴的共同呈现入口。只增加显示元数据/格式化文本，不更改 QueryEvidence rows、原始数值、source ref 或旧 document hash；chart companion 的新增显示元数据由新 document/dataset hash 封存。
- 已发布独立公式使用 QueryEvidence `semantic_role=FORMULA`（NUMBER、非空 formula_hash、aggregate=null），由发布 AST 与
  exact physical binding 的共同证明封存；不得冒充 Metric。AnalysisInputMaterializationReceipt 保留该 role/object_id，
  source_binding_hash 继续绑定完整 QueryEvidence 公式证明；Arrow 数值转换不产生新的语义权威。
  Analysis 方法授权仍只使用真正的 Metric，Report/Chart/Trace 继续沿原 exact QueryEvidence 引用链读取。
- 新 QueryEvidence 的 `time_window=null` 不得掩盖 SQL 中的时间选择。compile/执行前与 acceptance 共用 AST/CTE
  时间依赖反向校验；文本日期从已选 Metric 的绑定关系定位，不能因缺少独立时间 Dimension 跳过。
  仅投影/分组/最新行排序不要求窗口；完整规则见 `backend/text2sql-resolved-context.md`。旧证据 hash/历史不改写。
- 请求内同比使用 `REQUEST_DERIVED`，不得冒充已发布 FORMULA/METRIC。exact Context hash、REQUEST_ONLY/NONE 解释和
  物理来源/算式证明进入 QueryEvidence binding hash；Analysis Arrow 保留 role/id 与 source_binding_hash。
  compile/admission/acceptance 共用证明，缺失同期列 nullable；限定执行子集与负例见 `backend/text2sql-resolved-context.md`。
- Root TABLE 正文保留 exact current-Run accepted-ref 校验，输出有界 Markdown 表（最多前 100 行）、总行数、显式时区与 NULL 说明，转义单元格文本；不得把内部 JSON dump 当成业务答案，也不得为排版新增模型事实。数值显示最多 12 位有效数字，整数不截精度，完整原值在表格提示与原始导出保留；不凭列名猜测币种/百分比。

### 7. Wrong vs Correct

#### Wrong

```ts
const historicalCertificate = await resolveReadyCertificate(raw.certificate_ref, authority);
const decision = releaseDecisionSchema.parse({
  ...raw,
  certificate: historicalCertificate,
});
return capabilityDeliveryReceiptSchema.parse({ ...input, release_decision: decision });
```

#### Correct

```ts
const currentReadiness = createCurrentReadinessPort({
  releaseAuthority: {
    principalId: serverPrincipal.id,
    verifyCommitted: artifactStore.isCommitted,
    resolveL2: artifactStore.resolveRawL2,
    resolveScoreCard: evalStore.resolveAuthoritativeScoreCard,
    resolveBenchmarkAdapterReceipt: evalStore.resolveAuthoritativeBenchmarkReceipt,
    resolveSandboxExecutionReceipt: sandboxStore.resolveAuthoritativeReceipt,
    resolveModelCertificationReceipt: providerStore.resolveAuthoritativeCertification,
    resolveReleaseManifest: releaseStore.resolveAuthoritativeManifest,
  },
});
const committedGo = await currentReadiness.commitGo(releaseCapabilityInput, {
  schema_version: "1.0.0",
  scope: raw.scope,
  run_id: raw.run_id,
  certificate_ref: raw.certificate_ref,
  candidate: raw,
  idempotency_key: raw.idempotency_key,
});
// commitGo 在同一持锁 PostgreSQL 事务内调用 server-only Authorizer 并追加 Decision；
// 不存在可在锁外复用的 current-readiness snapshot。
return issueCapabilityDeliveryReceipt(input, committedGo.decision);
```

#### Research Stop Receipt：错误与正确

```ts
// Wrong：self-hash 只能证明外层自洽，不能证明 Stop 与 Candidate closure 相同。
const stopReceipt = await verifyDerivationReceiptSelfHash(raw.stopReceipt);

// Correct：统一 full verifier 递归关闭 Candidate -> Attestation -> Coverage/Budget。
const stopReceipt = await verifyDerivationReceipt(
  raw.stopReceipt,
  raw.stopInputMaterial,
  {
    kind: "STOP",
    stop_decision: raw.stopDecision,
    candidate_receipt: raw.candidateReceipt,
    candidate_input_material: raw.candidateInputMaterial,
    candidate_context: raw.candidateContext,
  },
);
```

## Scenario: Semantic successor runtime closure and Falcon24 E4 activation

### 1. Scope / Trigger

- 当前 Published Semantic Release 的投影 payload 无法被生产读路径解释，且历史 Release/Authority Epoch 必须保持不可变时适用。
- PostgreSQL 是 stage、receipt、formal Release、pointer、workspace defaults 与 Falcon current authority 的唯一权威。

### 2. Signatures

```ts
buildStageReviewedSemanticSuccessorCommand(input: unknown);
verifySemanticReleaseEnvelope(input: unknown): Promise<VerifiedSemanticReleaseEnvelope>;
validateSemanticRuntimeClosure(
  envelope: VerifiedSemanticReleaseEnvelope,
): Promise<SemanticRuntimeClosureValidationReceipt>;
buildFalcon24SemanticReleaseAuthorityProofV2(input: unknown);
buildCombinedFalcon24SemanticActivationCommand(input: unknown);
verifyFalcon24RetainedAssets(repositoryRoot: string): Promise<Falcon24RetainedAssetsProof>;
runFalcon24AuthorityFinalization(environment?: NodeJS.ProcessEnv);
runFalcon24E1Bootstrap(environment?: NodeJS.ProcessEnv);
createPostgresFalcon24DiagnosticAuthority({ pool, authorizer });
buildFalcon24QualificationManifestV3(input: unknown);
```

```sql
app_data_agent.activate_falcon24_authority_with_semantic_successor(requested jsonb) returns jsonb
```

### 3. Contracts

- Stage command 只包含 ChangeSet/review/source snapshot/compiler bundle refs、expected predecessor/pointer version、target generation 与
  idempotency key；禁止 client projection payload/digest。
- Stage envelope 恰好包含 `EXECUTABLE | RELATIONSHIP | RUNTIME_RESTRICTION | GRAPH` 四类 typed canonical projection。
- `projection_digest`、`release_digest`、`stage_digest`、validation/smoke/proof/activation receipt hash 使用独立 hash domain，均排除自身 hash；
  stage digest 还排除 mutable status/timestamp。
- `verifySemanticReleaseEnvelope` 先 inert-copy `unknown`，拒绝 Proxy、accessor、自定义 prototype、sparse/超限容器，再验证 strict schema、
  projection digest、release digest 与 stage exact refs。其返回值使用进程内 WeakSet 品牌；结构克隆不能生成 validation receipt。
- `validateSemanticRuntimeClosure` 是 stage validation、Worker smoke 与生产 read port 的唯一闭包实现，覆盖 metric/dimension/formula/time/
  relationship/physical binding/runtime restriction/graph/source/datasource。Quality free-text expression 只验证现有 schema 与 identity，不声明
  字段级证明。
- Falcon24 proof v2 固定证明 gen1 predecessor 到 distinct gen2 candidate 的 lineage；combined command 只带 refs/CAS，在一个 PostgreSQL
  事务内 promotion gen2 并激活 E4。W8 数据库执行需要独立用户授权。
- Finalizer 只接受 `FALCON24_AUTHORITY_EPOCH=E4`，且确认变量必须为
  `DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION=YES`。必需业务 refs 为
  `FALCON24_SUCCESSOR_CHANGE_SET_ID/HASH` 与 `FALCON24_SUCCESSOR_REVIEW_ID/HASH`；build closure 由绝对路径的 Web/Worker identity 与
  attestation 文件证明。`DATABASE_URL` 与 deployment/workspace/principal 只用于服务器 capability，不进入 Tool Result/Artifact。
- 历史 `bootstrap:falcon24-e1` 永久 fail closed：无确认返回 `NOT_RUN`；有确认返回
  `HOLD / FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED / NO_GENERATION_1_WRITES`。该函数不得读取数据库、创建 gen1 或
  调用任何 publisher；现有 exact E3 的唯一执行入口是 `finalize:falcon24-authority`。
- Diagnostic attempt 只绑定 exact E4 baseline/activation、promoted generation 2、source/build/attestation 与固定问题。其 Run ID 由
  attempt/scoped idempotency 确定；浏览器从真实 composer 提交，但不 claim 正式 Qualification/Campaign slot。
- Diagnostic browser claim 只向普通 Q&A start 传递确定性 idempotency key，不携带 acceptance fence 或扩权字段。完成后的
  `observed_execution_path` 是实际观察证据；Root 仍逐轮决定当前调用，Host 不把该字段用于后续能力调度。
- `begin_falcon24_diagnostic` 的 adapter 必须在同一 transaction 设置 `app.semantic_domain=falcon24`。Worker diagnostic reclamation 只加载
  active attempt、核对 runtime attestation、执行 exact Run cleanup 并生成 residual=0 receipt；不得调用 formal gate authority。
- E4-Q1 只能构建 `falcon24-qualification-manifest@3.0.0`，并绑定同一 PASSED diagnostic 的 attempt/run/receipt hash；v2 manifest 在 E4
  必须被 Port 和 PostgreSQL 双重拒绝。
- `falcon24-retained-assets@1.0.0` 本身及其三个 E1 semantic source hash 属于历史证据；当前同路径源码允许随 generation 2 前进。
  W8 preflight 必须证明 v1 manifest bytes 与首次引入提交相同，并从该提交读取三个 Git blob 复核历史 hash；对 E4 仍直接消费的
  dataset、LLM 与 analysis runtime 文件则继续核对当前 checkout hash。不得修改 v1 manifest 或把当前源码退回 E1 来消除 drift。
- 数据保留按权威身份而不是“年代久远”判断：plan 明列的 generation 1/E1-E3 Release、pointer、baseline、receipt、activation、Run、gate、
  Artifact、diagnostic 永不删除；只有只读证明未被 current closure/receipt 引用且不参与完成证据的旧非权威数据，才可通过已审查
  lifecycle/forward migration 丢弃。手工 SQL 与删除受保护历史始终禁止。

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| target generation 不是 predecessor + 1 | `SEMANTIC_SUCCESSOR_GENERATION_INVALID` |
| projection 缺失/多余、unknown field 或 accessor/Proxy | `SEMANTIC_RELEASE_ENVELOPE_INVALID` |
| projection/release/stage digest 漂移 | 对应 `*_HASH_MISMATCH` / `*_DIGEST_MISMATCH` |
| metric/dimension/binding/formula/time/relationship/graph 引用不闭合 | deterministic validation `FAIL` receipt + canonical reason codes |
| 结构克隆冒充 verified envelope | `SEMANTIC_RELEASE_ENVELOPE_NOT_VERIFIED` |
| proof candidate 等于 predecessor 或 generation 不连续 | `FALCON24_SEMANTIC_SUCCESSOR_LINEAGE_INVALID` |
| combined command 携带 projection payload | strict parse failure；数据库 I/O 为 0 |
| activation 任一步失败 | 整笔 rollback，只观察完整 gen1/E3 |
| Finalizer 缺少确认 | `NOT_RUN / FALCON24_AUTHORITY_ACTIVATION_CONFIRMATION_REQUIRED`，数据库 I/O 为 0 |
| Finalizer 不是 E4、current 不是 exact E3 或 build/ref/CAS 漂移 | stable `HOLD` reason，combined activation 不发生 |
| 调用历史 E1 bootstrap | 永不成功；确认后仍为 retired `HOLD`，且数据库 I/O 为 0 |
| diagnostic begin 未设置 semantic domain 或 current 不是 exact E4/gen2 | `FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH`，不创建 attempt |
| diagnostic UI/Artifact/Run/build/reclamation 任一不闭合 | 对应 `FALCON24_DIAGNOSTIC_*`，attempt 不得伪造 PASS |
| E4-Q1 缺 PASSED diagnostic receipt 或仍使用 manifest v2 | `FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED` / `...PASSED_REQUIRED` |
| v1 retained manifest bytes 或 origin Git blob 漂移 | `FALCON24_E1_RETAINED_MANIFEST_BYTES_DRIFT` / `...HISTORICAL_SOURCE_HASH_INVALID` |
| E4 当前消费的 retained 文件 hash 漂移 | `FALCON24_E1_RETAINED_CURRENT_FILE_HASH_INVALID` |

### 5. Good / Base / Bad Cases

- Good：服务器锁定 reviewed ChangeSet/source，编译四类投影，重算全部 digest，共享 validator PASS 后 stage；smoke PASS 后 combined RPC 原子切换。
- Base：candidate 闭包失败时完整 stage 与 rejection receipt 原子保存为 `REJECTED`，current 保持 gen1/E3。
- Good diagnostic：active attempt → 真实 composer exact Run → 答案页 Trace UI → 五 Artifact → Worker residual=0 → PASS receipt → E4-Q1 v3。
- Good retained：v1 manifest 与 origin Git blobs 保持原样，当前三个 semantic source drift 被显式报告并由 clean build attestation 接管。
- Bad：CLI 传 projection bytes、UPDATE generation 1、Worker fallback、用 retired bootstrap 创建新 gen1、API-only diagnostic、让
  diagnostic claim 正式 gate slot、把当前源码退回 E1、修改旧 retained manifest，或先切 semantic 再激活 E4。

### 6. Tests Required

- Contracts：strict/unknown/tamper/hash-domain、generation lineage、proof/combined command/receipt。
- Semantic：valid closure；metric、dimension、relationship、formula slot、time、quality identity、datasource、graph/source 负例矩阵；恶意
  accessor/Proxy 与品牌伪造。
- PostgreSQL 17：fresh chain、exact E3 fixture upgrade、历史 byte invariance、RLS/grants、direct DML denial、same-key replay/conflict。
- Concurrency/failure injection：combined activation 只能观察 all-old 或 all-new，固定 Semantic -> Falcon 锁序无死锁。
- Web Finalizer：E4-only、四个 reviewed successor refs 必需、stage -> smoke -> proof -> E4 staging -> combined RPC -> production readback
  严格顺序；断言没有 `prepareWorkspaceAuthority` defaults writer、generation-1 equality receipt、普通 `epoch.activate` 或失败后补写。
- Bootstrap：确认/未确认都不得连接数据库或导入 publication/SQL authority；确认路径稳定 `HOLD` 并指向 Finalizer。
- Diagnostic：begin transaction semantic domain、one-active/replay、deterministic non-scoring browser claim、真实 composer/Trace UI、同源
  QA/Trace receipt、五 Artifact、Worker no-formal-gate reclamation、residual=0、PASS/FAIL immutability。
- E4-Q1：CLI/Port/PostgreSQL 三层拒绝 v2 或 missing/stale/mismatched diagnostic receipt；v3 exact ref 才能 begin。
- Retained preflight：manifest/origin blob/current retained asset 的正反例；合法 semantic forward drift 必须 READY，历史 blob 或当前消费文件
  篡改必须分别以稳定 reason code HOLD。

### 7. Wrong vs Correct

```ts
// Wrong：调用方提供 projection payload 并修补历史 generation 1。
await repairSemanticProjection({ release_id, projection_payload, projection_digest });

// Correct：调用方只提交 refs/CAS，服务器编译并使用唯一共享 validator。
const command = await buildStageReviewedSemanticSuccessorCommand(refsAndExpectedVersions);
const stage = await publicationAuthority.stageReviewedSuccessor(capability, command);
const verified = await verifySemanticReleaseEnvelope(stage.value);
const validation = await validateSemanticRuntimeClosure(verified);

// Wrong：要求 generation 2 当前源码继续等于 E1 manifest 中的历史 source hash。
await verifyCurrentFilesAgainstHistoricalSemanticHashes(retainedV1);

// Correct：历史 bytes 从 manifest origin commit 证明，当前源码由 clean build attestation 证明。
const retainedProof = await verifyFalcon24RetainedAssets(repositoryRoot);
if (retainedProof.verified_historical_semantic_file_count !== 3) {
  throw new TypeError("FALCON24_E1_RETAINED_HISTORY_INCOMPLETE");
}

// Wrong：为 fresh 环境恢复已经失效的 generation-1 bootstrap writer。
await bootstrapFalcon24GenerationOne({ projection_payload });

// Correct：bootstrap 保持 fail closed；经独立 W8 授权后只对 exact E3 执行 E4 Finalizer。
const retired = await runFalcon24E1Bootstrap({ DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP: "YES" });
if (retired.terminal !== "HOLD") throw new TypeError("FALCON24_E1_BOOTSTRAP_MUST_HOLD");

// Wrong：把 diagnostic 当成正式 gate slot，或让 Host 根据观察路径调度下一步。
await qualificationAuthority.claim({ run_id: diagnosticRunId });

// Correct：普通 Q&A 使用确定性 idempotency；完成后才把实际路径封成不可变 diagnostic 证据。
const attempt = await diagnosticAuthority.begin(capability, exactE4DiagnosticManifest);
const receipt = await diagnosticAuthority.complete(capability, exactObservedClosure);
await buildFalcon24QualificationManifestV3({
  ...frozenQualificationRefs,
  diagnostic_receipt_ref: {
    attempt_id: receipt.attempt_id,
    run_id: receipt.run_id,
    receipt_hash: receipt.receipt_hash,
  },
});
```

## Scenario: Falcon24 E8 provider-binding forward recovery

### 1. Scope / Trigger

- current E7 certification 已 PROMOTED，但 frozen public provider reader 因实现缺陷仍返回 `STALE` 时适用。
- E7 及更早 Epoch 不可改写；修复只能由 10800 记录 E7 failure evidence，并随 E8 原子激活变为可见。

### 2. Signatures

```ts
createPostgresFalcon24AuthorityEpoch({ pool, authorizer }).recordEpochClosureFailure(
  capability,
  { receipt_id, idempotency_key, expected_authority, stage_ref },
);
runFalcon24EpochClosureFailureRecord(environment?: NodeJS.ProcessEnv);
runFalcon24AuthorityFinalization(environment?: NodeJS.ProcessEnv);
```

```sql
app_data_agent.record_falcon24_epoch_closure_failure(command jsonb) returns jsonb
app_data_agent.load_falcon24_epoch_closure_failure(requested_receipt_id uuid) returns jsonb
app_data_agent.activate_falcon24_authority(command jsonb) returns jsonb -- request/result @5
```

### 3. Contracts

- Record CLI 必须设置 `DATA_AGENT_ALLOW_FALCON24_EPOCH_CLOSURE_FAILURE_RECORD=YES`，并只接收
  `DATABASE_URL`、deployment/workspace/principal、`FALCON24_EPOCH_CLOSURE_FAILURE_RECEIPT_ID`、
  `FALCON24_EPOCH_CLOSURE_FAILURE_IDEMPOTENCY_KEY` 与 `FALCON24_PREDECESSOR_LLM_EXECUTION_STAGE_ID`。
  CLI 不接收 readiness、subject/evidence hash 或 receipt payload；current、stage、profile 差异及全部 hash 由服务器读取并重算。
- Receipt 固定证明 exact E7 authority、PROMOTED E7 stage、`AVAILABLE -> STALE/selectable=false`，append-only 且 same-key same-payload replay。
- 10800 安装后 current `<E8` 必须完整委托 frozen pre-E8 reader；只有 request@5 同事务切到 E8、推广 fresh stage/artifact 后，修正 reader 才可返回 exact target `AVAILABLE`。
- request@5 锁序为 semantic fence → Falcon advisory/current → semantic/defaults → failure receipt → E8 stage/artifact → E8 baseline/attempt；返回值必须相关 exact receipt、stage 和 E8 authority。
- `SELECT ... FOR SHARE` 读取 failure receipt 需要 function owner 具有 `UPDATE` privilege。该 privilege 只用于取得 row lock；FORCE RLS、NOLOGIN owner、Backend 无表级 DML 与 immutable trigger 仍必须拒绝任何实际 UPDATE/DELETE。
- Finalizer 成功后必须通过生产 `ProviderInvocationStore` 重新读取 exact target profile，并核对 model/config、execution profile hash 与 certification artifact ref；不一致属于严重 post-commit 故障，不得写补偿 HOLD 或开始 formal diagnostic。

### 4. Validation & Error Matrix

| Condition | Stable result |
| --- | --- |
| CLI 无确认、production scope 或 current 非 E7 | `...CONFIRMATION_REQUIRED` / `...LOCAL_ONLY` / `...CURRENT_MISMATCH` |
| stage 非 PROMOTED、不是 E7 或 activation/scope 不同 | `FALCON24_EPOCH_CLOSURE_FAILURE_STAGE_MISMATCH` |
| 服务器未观察到 exact AVAILABLE→STALE 差异 | `FALCON24_EPOCH_CLOSURE_FAILURE_NOT_PROVEN`，零 receipt |
| same idempotency key 对应不同 command | `FALCON24_EPOCH_CLOSURE_FAILURE_IDEMPOTENCY_CONFLICT` |
| request@5 failure receipt/stage/current/CAS 漂移 | transaction rollback，只观察 E7/STAGED/inactive |
| row-lock owner 缺 UPDATE privilege | `permission denied` 被 Platform 映射为 `PERSISTENCE_TRANSACTION_FAILED`；migration postcondition 必须提前拒绝 |
| commit 后生产 profile 不是 exact AVAILABLE | `FALCON24_E8_PROVIDER_EXECUTION_READBACK_*`，不得 formal diagnostic |

### 5. Good / Base / Bad Cases

- Good：record CLI 只给 E7 stage ref，服务器生成 immutable receipt；fresh E8 certification 在 E7 不可见；一次 request@5 后只观察 E8/PROMOTED/active/AVAILABLE。
- Base：非正式 staging 或 activation 失败后 E7 current 不变；已 HOLD staging 不复用，修复后用新 staging/stage id 在一次性 exact E7 fixture 重证。
- Bad：手工拼 receipt JSON、让 10800 立即改变 E7 reader、用逻辑 dump 冒充 CTID-sensitive exact fixture、给 Backend 原始表 DML，或 post-commit 原地修 profile。

### 6. Tests Required

- Contracts/Platform：receipt 与 request/result@5 strict/hash/correlation、同 key replay/conflict、client 无法传 payload/readiness。
- PostgreSQL 17：fresh 与停机物理复制的 exact E7 upgrade；迁移前后 public E7 bytes、protected rows、catalog content digest 相同。
- Security：FORCE RLS、Backend direct DML deny、RPC owner `SELECT,INSERT,UPDATE`、真实 UPDATE/DELETE 由 immutable trigger 拒绝。
- Failure/concurrency：request@5 中段注入失败只能 all-old；两连接同 command 最多一个 E8 authority/stage/artifact，读者只见 all-old/all-new。
- Web/Worker：fresh credential certification 绑定 clean build；Finalizer 构造 v5、只调用唯一 activation RPC，并做 exact production readback。
- Lifecycle：E8 激活前 diagnostic/Q1/C1 均为 0；正式 diagnostic 首败写 immutable FAIL/HOLD 后立即停止。

### 7. Wrong vs Correct

```ts
// Wrong：CLI 伪造失败结论或 digest。
await recordFailure({ readiness: "STALE", evidence_hash, receipt_payload });

// Correct：CLI 只交 current stage identity，RPC 从权威行重算差异与 receipt。
await epoch.recordEpochClosureFailure(capability, {
  receipt_id,
  idempotency_key,
  expected_authority: await epoch.loadCurrent(capability).then(required),
  stage_ref: { stage_id: promoted.proof_document.stage_id, proof_hash: promoted.proof_document.proof_hash },
});

// Wrong：为满足 FOR SHARE 而移除 row lock，或把 UPDATE 直接授予 Backend。
grant update on app_data_agent.falcon24_epoch_closure_failure_receipts to data_agent_backend;

// Correct：仅 NOLOGIN RPC owner 取得锁权限，immutable trigger 继续阻止实际 mutation。
grant select, insert, update on app_data_agent.falcon24_epoch_closure_failure_receipts
  to data_agent_u6_rpc_owner;
```
