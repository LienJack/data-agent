# Artifact 权威与内容寻址

> Schema 只证明载荷形状；权威 Artifact、成功终态和发布决策必须再经过确定性授权。

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
  verifyResultOracleReceipt?(receipt: ResultOracleReceipt): Promise<boolean>;
  verifySandboxExecutionEvidence?(input: {
    receipt: SuccessfulSandboxExecutionReceipt;
    result: SandboxResult;
  }): Promise<boolean>;
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

authorizeRunTerminal(
  input: unknown,
  authority: L2ArtifactAuthorityContext,
): Promise<AuthoritativeRunTerminal>;

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
- `ResourceAdmissionReceipt`、`ResultOracleReceipt`、`SandboxExecutionReceipt` 与
  `SandboxResult` 属于专用 System Artifact；L2 Resolver 必须按完整 Reference 取回、
  重算规范 Hash，并调用对应服务端领域 Authority，不能只接受任意已提交 JSON。
  PostgreSQL 提交边界也必须按 Artifact Type 把这四类 Input Reference 路由到专用
  System Store Verifier；不得要求它们镜像进通用 `artifacts` 表。
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
- 执行后必须按 `EXECUTION -> RESULT` 消费权威 Sandbox Evidence 与
  `ResultOracleReceipt`；Result Oracle 的列顺序、行数、Invariant 和 Query/Result Hash
  必须与冻结的 QueryContract 和同一执行精确闭合。最终 `ValidationReceipt` 只能按固定
  七 Gate 顺序封存，前五张引用必须与 Permit 已消费的引用完全相同，且
  `EXECUTION.evaluated_at <= RESULT.evaluated_at`；执行前五 Gate 可并发，不要求彼此时间单调。
- `QueryEvidence` 至少有一个 Invariant Verdict，并且必须沿 Validation 的 RESULT Gate
  解析同一权威 ResultOracleReceipt，按 QueryContract 顺序逐项匹配 ID 与 Verdict；
  `SUPPORTED` Claim 只能消费全 PASS Evidence。
- `READY` 必须绑定同 Scope、经过四道 Evidence Gate 且覆盖 Report 全部 Claim Evidence 的权威 `ReportReadyCertificate`。
- `GO` 必须绑定同 Scope、同发布策略的版本化 `ReleaseManifest`，并覆盖 `ReportReadyCertificate`、确定性 PASS 且 Safety Counter 全零的 `ScoreCard`、成功终态 `BenchmarkAdapterReceipt`、成功终态 `SandboxExecutionReceipt` 与绑定 Profile Hash 的 `ModelCertificationReceipt`。
- `ReleaseManifest` 必须内容寻址、已提交，至少各含一项 Hosted 与 Docker Evidence，并聚合 Release Decision 的全部 Evidence；领域 Resolver 返回的对象必须带有对应 Authorizer 在当前进程签发的品牌。
- `OracleVerdictReceipt` 必须由持久化 Resolver 按完整 Reference 取回，校验 Receipt/Case/EvalRun 已提交，并通过服务端持有的 Suite-Specific Deterministic Oracle Capability 复核；调用方自报 `PASS` 或普通已提交 Evidence 不能获得品牌。
- `ScoreCard` 必须绑定权威 `OracleVerdictReceipt`，并逐项匹配 Case、EvalRun、Suite、Suite/Dataset/Oracle Version、Oracle Type 与 Deterministic Verdict。
- `ScoreCard.comparison` 明确区分 `SINGLE` 与 `PAIRED`；`PAIRED` 必须绑定不同的权威且已完成 Baseline/Candidate EvalRun，Candidate 等于当前 ScoreCard EvalRun，并携带版本化 Metric Interval、Confidence、Sample Size 与 Method。
- `DELIVERED` 只能由运行时验证过的 `AuthoritativeReleaseDecision` 签发；类型断言或普通 Schema Parse 不构成授权。
- Provider `AVAILABLE`、Eval Registry Assignment 与 `PASS ScoreCard` 都有独立的 Resolver/Authorizer；Schema Parse 只产生声明，不产生可用或通过状态。

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
| Permit 缺 Gate、顺序/新鲜度错误、预算或 Principal/Policy/Settings 漂移 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Execution/Result/Validation 使用另一执行、另一结果或非当前七 Gate | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
| Payload Reference 跨 Scope 或未声明 | Document Parse 失败 |
| `READY/GO` Reference 未提交 | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |
| `GO` 收到未品牌化、失败终态、证据不匹配或不完整 Manifest | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |
| Oracle Receipt 未提交、Hash/Reference 漂移或服务端 Oracle 复核失败 | `ORACLE_VERDICT_RECEIPT_NOT_AUTHORITATIVE` |
| ScoreCard 自报 Verdict、Oracle/Version 不匹配或 Paired Run 不权威 | `SCORECARD_NOT_AUTHORITATIVE` |
| Receipt Issuer 收到普通 GO 对象 | `AUTHORITY_EVIDENCE_NOT_COMMITTED` |

### 5. Good / Base / Bad

- Good：确定性编译器生成 Candidate，计算 Hash，验证全部输入，再提交不可变权威对象。
- Base：普通消费者只解析 Candidate，用于诊断或展示，不把它写成成功态。
- Bad：`schema.parse(raw) as CapabilityDeliveryReceipt` 后直接显示“已交付”。

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
- 专用 System Store 已确认运行证据、但通用 `artifacts` 表不存在镜像行时，L2 提交仍成功；
  两个 Store 都无法确认时失败关闭。
- `REJECTED/SUPERSEDED`、缺 Validation Receipt、空 Invariant、缺 Evidence Gate 时失败。
- Authoritative 对象及嵌套 Payload 为冻结状态。
- `READY`、`GO` 与 `DELIVERED` 分别拒绝未验证证据和伪造品牌。
- Provider 假 Receipt 或不匹配 Capability Hash 不能成为 `AVAILABLE`；EvalCase 不能被重新标为 Demo/Holdout；未完成 EvalRun、未提交 Evidence 或孤立 `PASS ScoreCard` 不能授权。
- Oracle Receipt 拒绝未提交、Hash 漂移、Reference 不匹配、Suite/Oracle Type 错配和服务端 Oracle 验真失败。
- ScoreCard 拒绝伪造 Oracle 品牌、自报 PASS、Receipt Verdict/Version/Reference 不匹配；Paired ScoreCard 拒绝 Candidate 漂移、未授权 Baseline 与非法 Interval。
- `GO` 拒绝失败/不确定 ScoreCard、非零 Safety Counter、领域伪造 Receipt、策略不匹配和未同时覆盖 Hosted/Docker 的 Manifest。
- L3–L5 不能注册 Workflow、Route、Tool 或签发 Receipt。

### 7. Wrong vs Correct

#### Wrong

```ts
const decision = releaseDecisionSchema.parse(raw);
return capabilityDeliveryReceiptSchema.parse({ ...input, release_decision: decision });
```

#### Correct

```ts
const authority = {
  principalId: serverPrincipal.id,
  verifyCommitted: artifactStore.isCommitted,
  resolveL2: artifactStore.resolveRawL2,
  resolveGroundingAuthority: groundingStore.resolveRawDocument,
  verifyCommitterCapability: committerRegistry.verify,
  resolveScoreCard: evalStore.resolveAuthoritativeScoreCard,
  resolveBenchmarkAdapterReceipt: evalStore.resolveAuthoritativeBenchmarkReceipt,
  resolveSandboxExecutionReceipt: sandboxStore.resolveAuthoritativeReceipt,
  resolveModelCertificationReceipt: providerStore.resolveAuthoritativeCertification,
  resolveReleaseManifest: releaseStore.resolveAuthoritativeManifest,
};
const decision = await authorizeReleaseDecision(raw, authority);
return issueCapabilityDeliveryReceipt(input, decision);
```
