# Artifact 权威与内容寻址

> Schema 只证明载荷形状；权威 Artifact、成功终态和发布决策必须再经过确定性授权。

## 场景：创建或消费权威 Artifact 与成功态

### 1. 范围 / 触发条件

- 创建 `COMMITTED` Artifact、`READY` Run Terminal、`GO` Release Decision 或 `DELIVERED` Capability Receipt 时适用。
- Agent、Model、外部 JSON 和普通 Zod Parse 结果始终是不可信 Candidate。

### 2. 签名

```ts
interface L2ArtifactAuthorityContext {
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
  resolveL2(reference: ArtifactReference): Promise<AuthoritativeL2ArtifactDocument | null>;
}

interface L2ArtifactPersistenceAuthority extends L2ArtifactAuthorityContext {
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
authorizeL2ArtifactDocument(
  input: unknown,
  authority: L2ArtifactPersistenceAuthority,
): Promise<AuthoritativeL2ArtifactDocument>;

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

- 只有 `COMMITTED` Revision 能取得权威品牌；`CANDIDATE`、`REJECTED`、`SUPERSEDED` 都不能成为当前权威。
- `content_hash` 对规范化 Envelope 版本元组、Scope、Input Reference 与 Payload 计算；不包含可变的 `status`、`created_at` 和 `content_hash` 本身。
- Canonical JSON 的对象 Key 使用 UTF-16 代码单元顺序，不允许 `localeCompare`。
- 当前 Revision 必须已由持久化 Authority 提交；调用方在 Candidate 中自报 `COMMITTED` 不能取得权威品牌。
- `verifyCommitterCapability` 必须由服务端持有，并校验 Scope、Run、Attempt、Artifact Type、Producer 与 Policy Version；不得接受 Candidate 自带的布尔授权结论。
- Payload 中的引用必须使用字段对应的 `artifact_type`，与 Envelope 属于同一 `app_id/tenant_id/environment/run_id`，并完整出现在 `input_refs`。
- 首个 Revision 的 `parent_ref` 为 `null`；后续 Revision 必须引用同 Scope、同 Artifact、前一 Revision 的完整 Content-Addressed Reference，Authorizer 还要验证父 Revision 已提交。
- Reference 身份由 App、Tenant、Environment、Run、Artifact ID、Artifact Type、Revision 与 Content Hash 共同决定。
- Authorizer 必须验证所有 Reference 已提交；Execution、Supported Claim 与 Ready Certificate 还必须解析已授权的上游 L2 文档，不能把 `isCommitted=true` 当作成功语义。
- L2 研究链必须按 `ResearchBrief -> HypothesisSet -> EvidencePlan -> QueryContract -> GroundingPackage -> SemanticQuery -> LogicalPlan -> SqlArtifact` 解析权威上游；每个竞争假设都必须被 Evidence Obligation 覆盖。
- `SqlArtifact.query_hash` 必须由 Dialect、SQL 与 Parameters 的规范内容计算；`ExecutionReceipt` 必须绑定同一 SqlArtifact、同一 Query Hash、同一 Datasource，并消费七道 Gate 全部 PASS 的 `ValidationReceipt`。
- `QueryEvidence` 至少有一个 Invariant Verdict；`SUPPORTED` Claim 只能消费全 PASS Evidence。
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
| 非 `COMMITTED` Revision 请求权威品牌 | `ARTIFACT_NOT_AUTHORITATIVE` |
| 当前 Revision 未提交或服务端提交者能力不匹配 | `ARTIFACT_NOT_AUTHORITATIVE` |
| Payload 或 Version Tuple 与 Hash 不符 | `ARTIFACT_CONTENT_HASH_MISMATCH` |
| Input Reference 不存在或未提交 | `ARTIFACT_INPUT_NOT_COMMITTED` |
| 成功链无法解析权威上游文档或 Gate 失败 | `ARTIFACT_SEMANTIC_AUTHORITY_INVALID` |
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
- SqlArtifact Query Hash、Execution Query Hash 或 Datasource 与上游不一致时失败。
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
  verifyCommitted: artifactStore.isCommitted,
  resolveL2: artifactStore.resolveAuthoritativeL2,
  resolveScoreCard: evalStore.resolveAuthoritativeScoreCard,
  resolveBenchmarkAdapterReceipt: evalStore.resolveAuthoritativeBenchmarkReceipt,
  resolveSandboxExecutionReceipt: sandboxStore.resolveAuthoritativeReceipt,
  resolveModelCertificationReceipt: providerStore.resolveAuthoritativeCertification,
  resolveReleaseManifest: releaseStore.resolveAuthoritativeManifest,
};
const decision = await authorizeReleaseDecision(raw, authority);
return issueCapabilityDeliveryReceipt(input, decision);
```
