# U6 实施与检查合同

> 状态：`FROZEN_IMPLEMENTATION_CONTRACT / NOT_IMPLEMENTED`
> 单元：`U6 L2 Research Authority`
> 发布状态：`HOLD`
> 作用：在 Trellis 单文件 32 KiB 上限内提供实现与检查所需的完整核心闭包

本文件是 U6 执行代理与检查代理的首要上下文。详细人读设计位于
`docs/design/u6-research-authority-contract.md`，但该文件可能超过 Trellis 的单文件
注入上限，因此不得依赖其被完整注入。Strict Payload 必须同时读取：

- `docs/design/u6-research-planning-payload-contract.md`
- `docs/design/u6-research-wire-payload-contract.md`
- `docs/design/u6-research-platform-contract.md`
- `docs/design/u6-research-resource-invocation-contract.md`
- `docs/design/u6-invocation-state-contract.md`
- `docs/design/u6-system-record-lifecycle-contract.md`
- `docs/design/u6-controlled-fixture-contract.md`

研究证据摘要固定为 `docs/research/u6-rq092-contract-evidence.md`。上述任一必需文件
缺失、超过 `context_injection.max_file_bytes=32768`、被截断或 `task.py validate` 出现
Warning，都视为 U6 任务门禁失败；不能把 Warning 当成通过，也不能从记忆补全合同。
“上下文文件”仅指 `implement.jsonl/check.jsonl` 实际列出的注入文件和任务 Artifact；
未列入清单的 `.trellis/spec/**` 是可直接读取的补充导航，不参与注入字节门禁，也不能
替代上述 compact/strict 合同。

## 1. 范围

### 必须交付

- U6 V2 Artifact、strict Schema、Wire Registry、Exact Reference 与双 Hash。
- 只依赖 `@data-agent/contracts` 的 `packages/research` 纯领域内核。
- PostgreSQL exact-revision Committer、CurrentReadiness、Revocation、Grant 与资源事务。
- Mastra Team、Research Kernel、Text2SQL、Sandbox 和 Authority 的 Worker 组合。
- U6-owned `retail-revenue-investigation-v1` protocol fixture。
- Controlled、14 Mutation 及配对反例、Crash-Recovery、Resource、V1、READY/GO
  Bypass、Schema Frontier 和 Revocation Race Oracle。

### 明确不交付

- SourceEvidence、网页/文档研究或 Benchmark Adapter；成功路径只允许
  `QUERY + DETERMINISTIC`。
- InsightBench、DAB、RCAEval、自建归因评分、Demo/Holdout 真值；它们属于 U7。
- 自动行动、生产写入、外部副作用、因果识别或 L3–L5 能力。
- 真实 Benchmark、Hosted/Docker 或 Release `GO` 结论。

U6 protocol fixture 可以与 U7 复用业务域或生成器，但 U7 必须拥有独立 Manifest、
Answer/Oracle、Demo/Holdout 身份与评分；不得读取 U6 字面期望行或阈值冒充 Benchmark
真值。

## 2. 不可绕过 Authority 链

```text
QuestionFrame
→ ResearchBrief@2
→ HypothesisSet@2
→ EvidencePlan@2
→ QueryContract + ObligationExecutionDecision
→ QueryEvidence@2
→ AtomicClaim@2 + EvidenceRelation + EvidenceCheckReceipt
→ SupportDecision + HypothesisAssessment
→ CoverageState
→ ResearchStopDecision
→ ReportManifest + AnalysisReport@2 + ReportProjectionReceipt
→ Support/Conflict/Freshness/Source-Independence Gate
→ ReportReadyCertificate@2
→ publishCurrentReadiness
→ consumeCurrentReady(DOMAIN_TERMINAL)
→ Historical RunTerminal=READY + CurrentReadiness=CURRENT
→ optional consumeCurrentReady(REPORT_READ)
→ ReportReadGrant → consumeGrant → commitResponse
→ optional ReadinessRevocationReceipt + CurrentReadiness=REVOKED
```

Agent、Model、Supervisor、Writer、普通 Schema Parse、Mastra Snapshot、UI 与 Redis
只产生 Candidate 或 Projection，不能提交领域成功态。每次根授权必须从 PostgreSQL
重新解析精确 `COMMITTED` Revision、重算 Envelope Hash、Domain Semantic Hash 和领域
闭包；裸 ID、最新 Revision、`isCommitted=true` 或跨事务品牌缓存都无权。

## 3. V1/V2 与旧 READY 旁路退役

- V1 只允许显式 `readHistorical*` Resolver。Writer/Committer/Research Artifact
  Authority 固定返回 `L2_WIRE_VERSION_WRITE_UNSUPPORTED`；current-ready、Grant、
  RunTerminal 与 Release `GO` 固定返回
  `READINESS_PROTOCOL_VERSION_UNSUPPORTED`。
- 同名 V1/V2 必须通过
  `(artifact_type,envelope_schema_version,payload_protocol_version)` Wire Registry
  选择唯一 strict Schema；未知元组与混合闭包失败关闭。
- 通用 `authorizeRunTerminal` 不得处理 U6 拥有的
  `READY/PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE/STALE`。`READY/STALE` 固定返回
  `CURRENT_READY_CONSUMPTION_REQUIRED`；三个 Research Stop 终态固定返回
  `RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED`。
- 只有 server-only PostgreSQL `consumeCurrentReady` 可以提交历史 READY。
- 只有 server-only PostgreSQL `commitResearchStopTerminal` 可以按 Strict
  `ResearchStopDecision` 提交
  `PARTIAL/EVIDENCE_PARTIAL`、`NEEDS_MORE_RESEARCH/EVIDENCE_COVERAGE_INSUFFICIENT`
  或 `INCONCLUSIVE/ANALYSIS_INCONCLUSIVE`；空引用和分支错配失败关闭。
- 包根不能导出 Registrar、Seal、Authority Brand、READY 构造器或兼容旁路。

必须保留一个直接调用当前旧 API 的负测，证明旧
`ReportReadyCertificate -> authorizeRunTerminal(READY)` 行为已经退役，而不是仅新增
另一条安全路径。

## 4. Proof、Material Claim 与 Schema Frontier

- `AtomicClaim@2` 不含 `support_state`；唯一事实源为 `SupportDecision`。
- QueryEvidence 必须绑定 OED PASS、QueryContract、SqlArtifact、Validation/
  Execution Receipt、SandboxResult 与完整 Version Frontier。
- Coverage 按 `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 从原始输入重算；
  material conflict 未解决时对应 Obligation 必须 `FAILED`。
- Stop Candidate Enumerator 必须覆盖 Coverage 的全部
  `OPEN|BLOCKED|FAILED` unresolved Obligation，而非只看 OPEN；OPEN 表示语义上仍有
  admissible path，与当前预算是否足够无关。这样可恢复失败仍可 CONTINUE/REPLAN，
  BLOCKED 可进入等待分支，硬预算封顶可形成 BUDGET_BLOCKED。
- `ReportManifest.material_claim_refs` 必须严格等于 Executive Summary 与 Supported
  Findings 两节 `claim_refs` 的规范去重并集。用于满足 Critical Success Criterion，
  或承载主要数字、比较方向的 Atomic Claim 必须进入这两节之一；被反证假设与冲突
  分别使用精确 Assessment/Relation 引用，不能由 Writer 自报 materiality。
- 每个 material Claim、SupportDecision、QueryEvidence 与 Certificate 必须绑定同一
  精确 `schema_snapshot_ref`。Schema Frontier 变化后，即使 SQL、Result 或 Claim 文本
  未变，旧 material Support 也必须 `STALE`，并重跑 OED、Proof、Coverage、
  Projection、Gate 与 current-ready。
- Certificate 的 `material_support_decision_refs` 必须与服务端重算出的 material
  Claim 集合一一闭合，禁止漏项。
- AnalysisReport Title 只能由 `ZH_L2_RESEARCH_TITLE_V1` 从 exact Brief 研究问题唯一
  渲染；Receipt 绑定 `title_hash`，同一 forbidden-claim 扫描覆盖 Title 与正文。

## 5. Stop 合同

决策顺序固定：

```text
1. Policy / Integrity / Fence / Replay hard failure
2. Brief / Semantic clarification
3. critical 全 SATISFIED 且无未处理 conflict → STOP_READY
4. Frontier 漂移或任一 Obligation STALE → `RESEARCH_STOP_INPUT_STALE`，不创建
   StopDecision/Public Terminal，转 Revocation Owner
5. 存在预算内合法 Query → CONTINUE / REPLAN
6. 已知合法路径但等待新预算/权限 → STOP_NEEDS_MORE_RESEARCH
7. hard budget cap + deliverable supported subset + 无预算内合法 Query
   → STOP_PARTIAL
8. 不存在 admissible distinguishing test → STOP_INCONCLUSIVE
```

`STOP_PARTIAL` 必须由 Authority 从 Brief、Resource Ledger、Coverage、
SupportDecision 与 Query Candidate 闭包重算：

```text
hard_budget_cap=true
deliverable_supported_subset=true
budget_executable_query_count=0
```

不能信任 Candidate 自报。无法命中互斥分支时固定
`RESEARCH_STOP_INPUT_INCONSISTENT`，不存在默认 Partial。

14 个注册 Mutation 中，凡预期 `PARTIAL` 的 Case 都必须显式带上述三项前提；每个还要
有成对反例：

- 预算仍可执行且有合法 Query → `CONTINUE /
  ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE`；
- 预算仍可执行但需要重编 Plan → `REPLAN /
  EVIDENCE_PLAN_REPLAN_REQUIRED`。

配对反例不得签发 Public Terminal。`STOP_FAILED`、`STOP_STALE` 不存在；
Writer/Projection 绕过归 Runtime `FAILED`，READY 前 Frontier/Tamper/Race 归
Revocation `STALE`。

## 6. Historical Terminal 与 CurrentReadiness

状态必须分离：

```text
Historical RunTerminal = READY
CurrentReadiness = CURRENT | REVOKED
```

- READY 提交前，Certificate、Frontier、Authority Epoch 或 Revocation 校验失败时，
  只有 `DOMAIN_TERMINAL` consume 与撤权竞争且撤权先胜出时，同一事务的 Revocation
  分支才可提交唯一 `STALE` Terminal，且不能同时提交 READY/Grant；独立 revoke 不
  创建 Terminal。
- READY 提交后，历史 READY 不可变；撤权只把 CurrentReadiness 从 CURRENT 推进为
  REVOKED，并追加 Receipt、Head 与 Audit。
- post-READY 撤权不得 UPDATE 历史 READY，也不得在 Durable Runtime 终态后追加
  `run.completed/run.failed` 或其他 lifecycle Event。
- API/UI 必须并列投影 Historical Terminal 与 CurrentReadiness；历史 READY、当前
  REVOKED 时禁用新读、展示、下载与 Release，不得压平为成功。
- Release `commitGo` 必须锁定并验证同一 exact Certificate 的
  `READY/RUN_READY` Domain Terminal；每次同键重放仍先重验 current。GO 后撤权再重放
  返回 `CURRENT_READINESS_REVOKED`，历史 GO 只作为审计事实。

`consumeCurrentReady` 固定锁序：

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

同一事务解析 exact V2 Certificate、Stop、Projection、四 Gate、material Support
闭包，重算 Semantic Hash；相同 idempotency key 重放仍重新核验当前 Frontier 与撤权。

在 consume 之前，`publishCurrentReadiness` 是创建 CURRENT 的唯一入口；只有尚无
Domain Terminal 时，才能用新 Certificate/Frontier 做
`ABSENT/CURRENT/REVOKED -> CURRENT` CAS，相同已撤 Certificate 不得复活。
Publish 的同键重放也必须先锁 Run/Current/Frontier 重验；撤权后返回
`CURRENT_READINESS_REVOKED`，历史 Publication 只供审计。
`REPORT_READ` 还必须验证同 Run、同 Certificate 已有不可变
`READY/RUN_READY` Terminal；仅发布 CURRENT 不能提前签 Grant。

方法 Owner 固定：五类 Frontier 方法各用 matching Frontier Authority；
Publish/DOMAIN_TERMINAL 用 `CURRENT_READINESS_AUTHORITY`；REPORT_READ
Issue/Consume/Response 用 `REPORT_READ_AUTHORITY`；public Revoke 用
`SERVICE_REVOCATION_AUTHORITY`；GO 用 `RELEASE_GO_AUTHORITY`；非 Ready Stop 用
`RESEARCH_STOP_AUTHORITY`。Frontier advance 的撤权是同事务内部固定级联，不向调用方
授予或调用 public Service Revocation Capability。

## 7. Grant Issue / Consume / Response

三个线性化点不可合并或省略：

1. **Issue：** 服务端 Deterministic Report Projector 从 exact report 生成
   `canonical-response@1.0.0` immutable Projection，只创建绑定该 Projection、
   principal 和短 TTL 的单次待消费 Grant；调用方不能自报 Digest/Bytes，Issue 成功
   不是响应授权。Digest 统一覆盖协议域、固定 JSON Media Type、`inline` disposition
   与 decoded canonical bytes。
2. **Consume：** PostgreSQL CAS 事务再次锁 CurrentReadiness、排序 Frontier 与
   Revocation Head。只有仍为 CURRENT 才把 Grant 标为 consumed；它只授权服务端物化
   绑定响应。
3. **Response：** 再次锁定 CurrentReadiness、Frontier 与 Revocation Head，从 exact
   Report 重跑同版本 Projector 并逐字节匹配 immutable Projection，再 CAS 为
   RESPONDED；提交后才能发送绑定字节，这是外发授权线性化点。

撤权在 Response 提交前胜出时，Grant 失败且不得发送字节；Response 已提交后的单次
响应无法撤回，但 Grant 不可复用，撤权阻断之后所有新 Issue/Consume/Response。

## 8. Release GO 当前性

Release Authority 必须在签发 `GO` 的同一事务中 current-V2 revalidate：

- exact `ReportReadyCertificate@2`；
- 完整 material Claim/Support 与同一 Schema Frontier；
- current Semantic/Schema/Data/Policy/Identity Frontier；
- `CurrentReadiness=CURRENT`；
- Revocation Head；
- 绑定同一 exact Certificate 的不可变 `READY/RUN_READY` Domain Terminal；
- ReleaseManifest、ScoreCard、Benchmark/Sandbox/Model Certification 等 U7–U9 证据。

V1、REVOKED、Schema Frontier 漂移、只完成历史 `resolveReadyCertificate` 或缺少任一
签名 Outcome 时不得 GO。每次调用（包含同幂等键重放）必须先重验上述 current 条件；
GO 后撤权再重放只能返回 `CURRENT_READINESS_REVOKED`，历史 GO 只供审计。
U6 完成后的预期 Release 仍为 `HOLD`。

## 9. 持久化、恢复与迁移

- Data Agent U6 App Migration 唯一目录：
  `infra/supabase/apps/data-agent/migrations/`。
- 不得在 `packages/platform/migrations/`、
  `infra/supabase/platform/migrations/` 或应用代码目录建立第二条 U6 迁移链。
- PostgreSQL 是 Event、Artifact、Attempt、Fence、Receipt、CurrentReadiness 与
  Revocation 的事实源；Redis/Upstash 只做通知和可丢弃缓存。
- Crash-after-SQL-receipt：Attempt A 提交 Q1/Q2 后崩溃，Attempt B 使用更高 Fence，
  精确复用 Receipt，SQL 总执行次数仍为 2；Domain Semantic Hash 稳定，Envelope Hash
  可随 Attempt 改变，旧 Fence 提交失败。
- Invocation 固定为 `ABSENT→AUTHORIZED→STARTED→COMPLETED|FAILED`，STARTED 还可
  进入 `OUTCOME_UNKNOWN→COMPLETED|FAILED`；Begin 由 Resource Owner 原子创建
  AUTHORIZED，matching Adapter Owner 必须在真实 I/O 前提交 STARTED。COMPLETED/
  FAILED 吸收；UNKNOWN 不释放预算，late Terminal 只允许原 Binding 单次 CAS 后结算。
- Tool Permit 固定 `ABSENT→ACTIVE→REVOKED|EXPIRED`；Result Blob 固定
  `ABSENT→AVAILABLE→TOMBSTONED`。Expiry/Retention 使用独立窄 Owner 和 DB time；
  调度未及时运行也不能让过期 Permit 通过 resolver 或让已删正文伪装可重放。

## 10. 实施工作包

1. 完成 Planning/Downstream Wire strict Schema、Registry、版本矩阵、上限与
   Reference closure。
2. 实现 Research planning/evidence/coverage/reporting/readiness 纯 Kernel。
3. 实现 server-only Registrar、Brand、Committer 与 Candidate/clone/parse 反例。
4. 在唯一 App Migration 目录新增 Research Artifact、CurrentReadiness、Revocation、
   Grant、Resource 与 Projection Receipt 持久化。
5. 永久退役通用 READY API；实现 current-V2 Release revalidation。
6. 实现 material Claim/Schema Frontier 闭包与完整性检查。
7. 实现 Stop 六分支、Partial 三前提和预算可执行配对反例。
8. 实现 Grant Issue/Consume/Response 与 READY 前后撤权竞态。
9. 接入 Resource Reservation、Invocation/System Record 状态机与
   AgentDataProjectionReceipt。
10. 在 Worker 组合 Mastra、Research、Text2SQL、Sandbox 和 PostgreSQL Authority；
    Checkpoint 只保存执行位置与精确引用。
11. 跑 Controlled、Mutation、Crash-Recovery、Resource、V1、Bypass、Schema、
    Revocation 与 GO Oracle。
12. UI/API 实现前先冻结双状态 Projection；U6 不自行实现 U8 产品界面。

## 11. 必需测试与 Gate

必需 Oracle：

- Controlled 两查询链到达历史 READY 和 CurrentReadiness=CURRENT；
- Coverage 五态、Stop 六分支；
- STALE Obligation/Frontier 漂移时 Stop 固定拒绝且不创建 Public Terminal；
- 14 Mutation 及每个 Partial 的 CONTINUE/REPLAN 配对反例；
- wrong metric/window/join/predicate/cohort/null 的成功 SQL 失败关闭；
- material Claim/Schema Frontier 漂移为 STALE；
- Writer/Supervisor/Schema Parse/clone/V1 不能获得 Authority；
- 通用 `authorizeRunTerminal(READY)` 固定拒绝；
- READY 前撤权无 READY/Grant；READY 后撤权保留历史 READY、当前 REVOKED；
- Grant Issue 后、Response CAS 前撤权（含 Consume 后/Response 前）均零字节；
  Response CAS 先胜出后本次可完成，撤权只阻止后续读取；
- Release GO 拒绝 before-READY、V1、REVOKED、历史-only Certificate 与 Schema
  漂移；`GO -> revoke -> same-key replay` 不得返回历史 GO；
- Crash-Recovery SQL 次数为 2，旧 Fence/伪造 Checkpoint 失败；
- Tenant Burst、Provider Cost、SQL Result Amplification 与 Cancel Reservation Leak
  失败关闭。
- Invocation Start-before-I/O、非法状态跳转、三类 COMPLETED 零计数与 UNKNOWN late
  CAS 全部通过。
- Permit expiry/revoke 不可复活，Result tombstone 原子删 ciphertext 且保留 metadata。

命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:research
pnpm test:unit
pnpm test:integration
pnpm test:architecture
pnpm verify:release
python3 .trellis/scripts/task.py validate 07-25-data-agent-reset-refactor
```

`task.py validate` 的 Warning、缺失文件或任一上下文文件超过 32768 bytes 都视为失败。
`pnpm verify:release` 的 U6 预期结果仍为 `HOLD`；不得为了绿色退出把缺失 U7–U9 或签名
Outcome Evidence 静默跳过。

## 12. U6 完成定义

- 所有新增 Artifact 有 strict Schema、双 Hash、Exact Reference、Authority Brand 与
  Candidate Bypass 反例。
- Controlled Case 经真实 Research Kernel、PostgreSQL Authority 与 Worker 到达 READY。
- 本文件第 11 节全部 Oracle 和命令执行并保存真实证据。
- U6 只标记自己的 Research Authority 工程单元完成，不冒充 U5–U9 完整纵向切片。
- Release 保持 `HOLD`，直到 U7–U9 和签名 Outcome Evidence 闭合。
