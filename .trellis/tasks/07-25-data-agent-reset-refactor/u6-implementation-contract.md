# U6 实施与检查合同

> 状态：`PARTIAL_IMPLEMENTATION / U6_B0_CONTRACT_FROZEN`
> 未实现：`POSTGRESQL_AUTHORITY / CURRENT_READINESS / RESOURCE_INVOCATION /
> RESULT_CRYPTO_LIFECYCLE / WORKER_COMPOSITION`
> 单元：`U6 L2 Research Authority`
> 发布状态：`HOLD`
> 作用：在 Trellis 单文件 32 KiB 上限内提供实现与检查所需的完整核心闭包

本文件是 U6 执行代理与检查代理的首要上下文。详细人读设计位于
`docs/design/u6-research-authority-contract.md`，但该文件可能超过 Trellis 的单文件
注入上限，因此不得依赖其被完整注入。Strict Payload 必须同时读取：

- `docs/design/u6-research-planning-payload-contract.md`
- `docs/design/u6-research-oed-v2-contract.md`
- `docs/design/u6-research-wire-payload-contract.md`
- `docs/design/u6-research-platform-contract.md`
- `docs/design/u6-research-database-surface-contract.md`
- `docs/design/u6-research-migration-safety-contract.md`
- `docs/design/u6-research-execution-storage-contract.md`
- `docs/design/u6-research-resource-invocation-contract.md`
- `docs/design/u6-invocation-state-contract.md`
- `docs/design/u6-invocation-result-crypto-contract.md`
- `docs/design/u6-result-key-lifecycle-contract.md`
- `docs/design/u6-system-record-lifecycle-contract.md`
- `docs/design/u6-app-lifecycle-cleanup-contract.md`
- `docs/design/u6-terminal-reference-graph-contract.md`
- `docs/design/u6-controlled-fixture-contract.md`

研究证据摘要固定为 `docs/research/u6-rq092-contract-evidence.md`。上述任一必需文件
缺失、超过 `context_injection.max_file_bytes=32768`、被截断或 `task.py validate` 出现
Warning，都视为 U6 任务门禁失败；不能把 Warning 当成通过，也不能从记忆补全合同。
“上下文文件”仅指 `implement.jsonl/check.jsonl` 实际列出的注入文件和任务 Artifact；
未列入清单的 `.trellis/spec/**` 是可直接读取的补充导航，不参与注入字节门禁，也不能
替代上述 compact/strict 合同。

## 1. 范围

### 必须交付

- U6 当前 Research Artifact tuple、strict Schema、Wire Registry、Exact Reference 与双 Hash。
- 只依赖 `@data-agent/contracts` 的 `packages/research` 纯领域内核。
- PostgreSQL exact-revision Committer、CurrentReadiness、Revocation、Grant 与资源事务。
- Mastra Team、Research Kernel、Text2SQL、Sandbox 和 Authority 的 Worker 组合。
- U6-owned `retail-revenue-investigation-v1` protocol fixture。
- Controlled、14 Mutation 及配对反例、Crash-Recovery、Resource、historical/current tuple、READY/GO
  Bypass、Schema Frontier 和 Revocation Race Oracle。

### 明确不交付

- SourceEvidence、网页/文档研究或 Benchmark Adapter；成功路径只允许
  `QUERY + DETERMINISTIC`。
- InsightBench、DAB、RCAEval、自建归因评分、Demo/Holdout 真值；它们属于 U7。
- 自动行动、生产写入、外部副作用、因果识别或 L3–L5 能力。
- 真实 Benchmark、生产 Hosted/Docker 部署或 Release `GO` 上线结论；但 §11 要求的
  hosted 测试项目与 Docker PostgreSQL 对等 Oracle 仍是 U6 验证范围。

U6 protocol fixture 可以与 U7 复用业务域或生成器，但 U7 必须拥有独立 Manifest、
Answer/Oracle、Demo/Holdout 身份与评分；不得读取 U6 字面期望行或阈值冒充 Benchmark
真值。

## 2. 不可绕过 Authority 链

```text
QuestionFrame
→ ResearchBrief@2
→ HypothesisSet@2
→ EvidencePlan@2
→ QueryContract + ObligationExecutionDecision@2
→ QueryEvidence@2
→ AtomicClaim@2 + EvidenceRelation + EvidenceCheckReceipt
→ SupportDecision + HypothesisAssessment
→ CoverageState
→ ResearchStopDecision
→ ReportManifest@2 + AnalysisReport@2 + ReportProjectionReceipt
→ Support/Conflict/Freshness/Source-Independence Gate
→ ReportReadyCertificate@3
→ publishCurrentReadiness
→ consumeCurrentReady(DOMAIN_TERMINAL)
→ Historical RunTerminal=READY + CurrentReadiness=CURRENT
→ optional consumeCurrentReady(REPORT_READ)
→ ReportReadGrant → consumeGrant → commitResponse
→ 或 db-time expireGrant（ISSUED|CONSUMED→EXPIRED）
→ optional ReadinessRevocationReceipt + CurrentReadiness=REVOKED
```

Agent、Model、Supervisor、Writer、普通 Schema Parse、Mastra Snapshot、UI 与 Redis
只产生 Candidate 或 Projection，不能提交领域成功态。每次根授权必须从 PostgreSQL
重新解析精确 `COMMITTED` Revision、重算 Envelope Hash、Domain Semantic Hash 和领域
闭包；裸 ID、最新 Revision、`isCommitted=true` 或跨事务品牌缓存都无权。

## 3. Historical/Current tuple 与旧 READY 旁路退役

- legacy protocol-null V1、
  `ReportManifest/1.0.0/report-manifest@1.0.0` 与
  `ReportReadyCertificate/2.0.0/report-ready@2.0.0` 只允许显式
  `readHistorical*` Resolver。Writer/Committer/Research Artifact Authority 固定返回
  `L2_WIRE_VERSION_WRITE_UNSUPPORTED`；current-ready、Grant、RunTerminal 与 Release
  `GO` 固定返回 `READINESS_PROTOCOL_VERSION_UNSUPPORTED`。
- 当前 `ReportManifest` 固定为
  `ReportManifest/2.0.0/report-manifest@2.0.0`，当前 Certificate 固定为
  `ReportReadyCertificate/3.0.0/report-ready@3.0.0`。所有 current/historical tuple 必须通过
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
- public `EvidencePlan` compiler 只接收通过 Content Hash 重验的 exact
  `ResearchBriefDocument` 与 `HypothesisSetDocument`，并从文档本身派生引用；
  接收任意 `ref + payload` 的纯 reducer 不进入 package root 公共面。
- QueryEvidence 必须绑定 OED PASS、QueryContract、SqlArtifact、Validation/
  Execution Receipt、SandboxResult 与完整 Version Frontier。
- OED `2.0.0/obligation-execution@2.0.0` 必须绑定 exact
  Brief/Plan/Obligation/QueryContract/SqlArtifact/SemanticRelease/PolicyReceipt；
  QueryEvidence 消费完整 OED derivation resolution 并 production replay。纯 Research
  的 identity-bound transient assurance 仅为 `KERNEL_CANDIDATE_ONLY`，
  `persistence_authority=NONE`、`can_authorize_execution=false`；生产 Authority Adapter
  仍是 `NOT_IMPLEMENTED`。
- 每个 `AtomicClaim` 必须恰有一个 `SupportDecision`；缺失、重复或游离
  Support 均失败关闭。
- Coverage 按 `STALE > FAILED > BLOCKED > SATISFIED > OPEN` 从原始输入重算；
  material conflict 未解决时对应 Obligation 必须 `FAILED`。
- Stop Candidate Enumerator 必须覆盖 Coverage 的全部
  `OPEN|BLOCKED|FAILED` unresolved Obligation，而非只看 OPEN；OPEN 表示语义上仍有
  admissible path，与当前预算是否足够无关。这样可恢复失败仍可 CONTINUE/REPLAN，
  BLOCKED 可进入等待分支，硬预算封顶可形成 BUDGET_BLOCKED。
  除显式 `REPLAN` 外，空或部分 Candidate Query 集合不得通过 `every([])` 或漏项
  伪造 `STOP_INCONCLUSIVE`。
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
3. Frontier 漂移或任一 Obligation STALE → `RESEARCH_STOP_INPUT_STALE`，不创建
   StopDecision/Public Terminal，转 Revocation Owner
4. critical 全 SATISFIED 且无未处理 conflict → STOP_READY
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
  REVOKED，推进其中内嵌的 revocation seq/receipt，并追加 Receipt 与 Audit；不得另建
  或先锁独立 Head 表。
- post-READY 撤权不得 UPDATE 历史 READY，也不得在 Durable Runtime 终态后追加
  `run.completed/run.failed` 或其他 lifecycle Event。
- API/UI 必须并列投影 Historical Terminal 与 CurrentReadiness；历史 READY、当前
  REVOKED 时禁用新读、展示、下载与 Release，不得压平为成功。
- Release `commitGo` 必须锁定并验证同一 exact Certificate 的
  `READY/RUN_READY` Domain Terminal；每次同键重放仍先重验 current。GO 后撤权再重放
  返回 `CURRENT_READINESS_REVOKED`，历史 GO 只作为审计事实。

共同 Authority prefix 完成后的 Platform Root profile suffix：

```text
Run
→ exact Outbox Lease（需要时）
→ exact Attempt/Fence（需要时）
→ canonical Relation Pair keys
→ canonical Artifact identity keys
→ active/exact Artifact revisions
→ exact parent/input Artifact rows
→ current_report_readiness（内嵌 revocation seq/receipt）
→ research_version_frontiers：
  SEMANTIC → SCHEMA → DATA → POLICY → IDENTITY
→ research_domain_terminals
→ report_read_grants（按 grant_id）
→ research_revocation_operations（需要时）
→ research_release_decision_commits（GO 时）
```

同一事务解析 exact V3 Certificate、Stop、Projection、四 Gate、material Support
闭包，重算 Semantic Hash；相同 idempotency key 重放仍重新核验当前 Frontier 与撤权。

在 consume 之前，`publishCurrentReadiness` 是创建 CURRENT 的唯一入口；只有尚无
Domain Terminal 时，才能用新 Certificate/Frontier 做
`ABSENT/CURRENT/REVOKED -> CURRENT` CAS，相同已撤 Certificate 不得复活。
Publish 同键重放也须在共同 prefix 后按 Root profile 锁 Run/Current/Frontier 重验；撤权后返回
`CURRENT_READINESS_REVOKED`，历史 Publication 只供审计。
`REPORT_READ` 还必须验证同 Run、同 Certificate 已有不可变
`READY/RUN_READY` Terminal；仅发布 CURRENT 不能提前签 Grant。

方法 Owner 固定：五类 Frontier 方法各用 matching Frontier Authority；
Publish/DOMAIN_TERMINAL 用 `CURRENT_READINESS_AUTHORITY`；REPORT_READ
Issue/Consume/Response 用 `REPORT_READ_AUTHORITY`，持久 Expire 用
`REPORT_READ_EXPIRY_AUTHORITY`；public Revoke 用
`SERVICE_REVOCATION_AUTHORITY`；GO 用 `RELEASE_GO_AUTHORITY`；非 Ready Stop 用
`RESEARCH_STOP_AUTHORITY`。Frontier advance 的撤权是同事务内部固定级联，不向调用方
授予或调用 public Service Revocation Capability。

## 7. Grant Issue / Consume / Response / Expire

三个线性化点不可合并或省略：

1. **Issue：** 服务端 Deterministic Report Projector 从 exact report 生成
   `canonical-response@1.0.0` immutable Projection，只创建绑定该 Projection、
   principal 和短 TTL 的单次待消费 Grant；调用方不能自报 Digest/Bytes，Issue 成功
   不是响应授权。Digest 统一覆盖协议域、固定 JSON Media Type、`inline` disposition
   与 decoded canonical bytes。
2. **Consume：** PostgreSQL CAS 事务再次锁 CurrentReadiness、排序 Frontier，并在
   已锁 Current 行上校验内嵌 revocation seq/receipt。只有仍为 CURRENT 才把 Grant
   标为 consumed；它只授权服务端物化绑定响应。
3. **Response：** 再次锁定 CurrentReadiness、Frontier，并校验该 Current 行内嵌的
   revocation seq/receipt，从 exact
   Report 重跑同版本 Projector 并逐字节匹配 immutable Projection，再 CAS 为
   RESPONDED；提交后才能发送绑定字节，这是外发授权线性化点。

撤权在 Response 提交前胜出时，Grant 失败且不得发送字节；Response 已提交后的单次
响应无法撤回，但 Grant 不可复用，撤权阻断之后所有新 Issue/Consume/Response。
`db_now>=expires_at` 时 Consume/Response 即使 Expiry Job 未运行也失败；独立 Expire
只把 `ISSUED|CONSUMED` 持久化为 EXPIRED，不是第四个响应授权点。

## 8. Release GO 当前性

Release Authority 必须在签发 `GO` 的同一事务中 current-tuple revalidate：

- exact `ReportReadyCertificate@3`；
- 完整 material Claim/Support 与同一 Schema Frontier；
- current Semantic/Schema/Data/Policy/Identity Frontier；
- `CurrentReadiness=CURRENT`；
- `current_report_readiness` 内嵌的 revocation seq/receipt（不是独立表/锁行）；
- 绑定同一 exact Certificate 的不可变 `READY/RUN_READY` Domain Terminal；
- ReleaseManifest、ScoreCard、Benchmark/Sandbox/Model Certification 等 U7–U9 证据。

任一 historical tuple、REVOKED、Schema Frontier 漂移、只完成历史
`resolveReadyCertificate` 或缺少任一
签名 Outcome 时不得 GO。每次调用（包含同幂等键重放）必须先重验上述 current 条件；
GO 后撤权再重放只能返回 `CURRENT_READINESS_REVOKED`，历史 GO 只供审计。
U6 完成后的预期 Release 仍为 `HOLD`。

## 9. 持久化、恢复与迁移

- U6 只能一次性落在
  `infra/supabase/apps/data-agent/migrations/20260725010590_app_data_agent_u6_research_authority.sql`。
  它须在首次提交时包含 Platform/Artifact/Capability/Resource/Invocation/Crypto/
  Lifecycle 的全部表、约束、索引、RPC、Owner/GRANT、RLS 与 DML 隔离；不得先落残缺
  `10590` 再改同名 Hash。
- 维护窗口 Manifest、existing relation 的 `ACCESS EXCLUSIVE NOWAIT`、rows/bytes/data
  preflight、DDL/VALIDATE、整事务回滚与 Hosted/Docker 对等唯一取
  `u6-research-migration-safety@1.0.0`。
- 不得在 `packages/platform/migrations/`、
  `infra/supabase/platform/migrations/` 或应用代码目录建立第二条 U6 迁移链。
- 维护 `u6-schema-inventory@1.0.0`；clean install 后必须与 `pg_catalog` 的表、列、
  约束、索引、函数、Owner/GRANT/RLS 精确相等。Migration Name+SHA-256 同名异 Hash
  失败，并验证中断前缀恢复。
- Invocation terminal cross-reference、Preparation/Result/Blob/Receipt 的 candidate
  key/FK 与 Audit 五组 nullable terminal FK 唯一取
  `u6-terminal-reference-graph@1.0.0`；禁止 active/predicate、literal-kind 或
  conditional FK，亦禁止 MATCH FULL。
- DELETE_PENDING App/Environment 只能经
  `cleanup_u6_delete_pending_environment(jsonb)` 的 Job-only lifecycle cleanup。它须在
  lifecycle-exclusive lock 后只经 Platform Lock Owner 的 internal helper 锁定并重验
  epoch、Resource Manifest、Export Boundary、Export/Backup Operation evidence；
  Cleanup Owner 无 Platform 表 ACL，五张 evidence 表必须保持 RLS disabled。随后重验
  Legal Hold，只延迟 Terminal Graph 明列的内部 FK，并使 U6_JOB
  residual=0；control operation/batch receipt 按合同保留且不计入 residual。
- 18 个 U6 current tuple 中 17 个只能经 `commit_current_l2_artifact`，Revocation
  tuple 只能经 internal Revocation Writer；所有 historical tuple 在 Writer 均只读拒绝。通用
  TypeScript Repository 必须报
  `L2_WIRE_VERSION_WRITE_UNSUPPORTED`；Backend 通用 INSERT/UPDATE/deactivate/RLS
  必须排除这些类型，专用 security-definer 是唯一写入/CAS current 路径。
- AgentDataProjection 只经外层
  `authorize_agent_data_projection(envelope_json jsonb)`；它验证
  `AGENT_DATA_PROJECTION_AUTHORITY` 后内部调用
  `commit_research_system_artifact`，后者不 GRANT。
- PostgreSQL 是 Event、Artifact、Attempt、Fence、Receipt、CurrentReadiness 与
  Revocation 的事实源；Redis/Upstash 只做通知和可丢弃缓存。
- `current_backend_authority` 只产 candidate；public/Provisioner 随后只经受信 Platform
  helper 取得 lifecycle shared advisory，并按 Deployment→Lifecycle→Membership
  `FOR SHARE NOWAIT` 重验，再取 absent-Head assignment advisory→Head→Capability。
  任一 `55P03` 整事务回滚并以同 envelope/idempotency key 有界重试，禁止 catch 后
  继续或形成反序等待环。
- RPC Owner 对 FORCE-RLS `runs/outbox/run_attempts` 的锁只取 Database Surface 冻结的
  column grant、六条 SELECT/UPDATE policy 与 exact predicate EXECUTE；READ 仅能锁
  exact Run，Outbox/Attempt 需要 write，三表实际 UPDATE 恒拒绝。
- public replay boundary 在 Zod/hash/replay 前执行双维资源预检：唯一逻辑节点
  `1024`（ordinary object identity + strict Artifact Identity；Array 不计），container
  occurrence `32768`，total-value occurrence `262144`，单 Document unique container
  `1024`/深度 `32`/`1MiB`，resolved closure `16MiB`。共享 DAG 仍按 occurrence
  累计工作量与字节；伪 Document strict parse 失败后回补普通 identity 与真实深度。
  Wire/collector 在读取 discriminator 前只接受 own enumerable data descriptor；
  Array 必须精确继承 `Array.prototype`，并在 `Reflect.ownKeys` 前先以 inert `length`
  descriptor 检查 entry 上限，拒绝 getter、symbol、custom prototype、cycle 与 Proxy
  等非 inert JSON 输入。
  各上限同时生效，不保证最大 cardinality 的笛卡尔积；Platform 后续按规范 Reference
  Graph 延迟解析，不能直接抬高纯内核预算。
- 性能优化只允许使用单次受控请求内的 `REQUEST_LOCAL_VERIFIED_REPLAY`：组合器先递归
  拒绝 accessor/cycle，再冻结并登记自建闭包；缓存键只能是同一 Context 中的对象身份，
  只能缓存完整校验成功结果。clone、caller-claimed hash、canonical JSON、失败结果和异常
  都不能命中，Context 也不能跨请求复用。无 Context 的公开 API 继续执行完整校验。
  Controlled 两查询回归预算固定为摘要调用 `<=750`、Research Document 首验 `27`、
  L2 Document 首验 `8`、单次内核 `<=2000ms`、最大 RSS `<=400MiB`；这是合成夹具的
  防退化 Gate，不是生产 SLA 或真实业务性能证据。
- Crash-after-SQL-receipt：Attempt A 提交 Q1/Q2 后崩溃，Attempt B 使用更高 Fence，
  精确复用 Receipt，SQL 总执行次数仍为 2；Domain Semantic Hash 稳定，Envelope Hash
  可随 Attempt 改变，旧 Fence 提交失败。
- Invocation 固定为 `ABSENT→AUTHORIZED→STARTED→COMPLETED|FAILED`，AUTHORIZED
  还允许 zero-I/O `→FAILED`，STARTED 还可进入
  `OUTCOME_UNKNOWN→COMPLETED|FAILED`；Begin 由 `RESOURCE_AUTHORITY` 原子创建
  AUTHORIZED，matching Kind Invocation Authority 必须在真实 I/O 前提交 STARTED。COMPLETED/
  FAILED 吸收；OUTCOME_UNKNOWN 不释放预算；无 ABORTED TERMINAL_LATE 时 late
  Terminal 只允许原 Binding 单次 CAS 后结算，LATE abort 后永久失败关闭。
- Tool Permit 固定 `ABSENT→ACTIVE→REVOKED|EXPIRED`；Result Blob 固定
  `ABSENT→AVAILABLE→TOMBSTONED`。Expiry/Retention 使用独立窄 Owner 和 DB time；
  调度未及时运行也不能让过期 Permit 通过 resolver 或让已删正文伪装可重放。
- MODEL/SQL/TOOL terminal 的 `body_base64url` 只存在于进程内 Candidate。strict
  decode/digest/size/DLP/Retention 后先用无明文
  `prepare_invocation_terminal` 取得 DB claim/AAD/Blob Seed；只有 claim winner 才按
  Crypto 分册以含完整 `S` 的 HKDF salt、AES-256-GCM 随机 nonce 加密，再把密文 Command
  交给 `commit_invocation_terminal`。DLP 在 claim 前允许重算，已提交重放不再派生/
  加密；只有仍持 live Candidate 的 expired claimant 可重加密。真正进程崩溃丢失正文时
  INITIAL 原子 ABORTED+OUTCOME_UNKNOWN；LATE 原子 ABORTED、保持 OUTCOME_UNKNOWN 并
  永久关闭 U6 v1 Terminal path；两者都零外部重调。DB、日志、Audit、Checkpoint 禁止明文、
  claim token 与 key；
  Tombstone 原子清空 ciphertext/nonce/tag/HMAC 与 Result/Preparation 的 structured
  AAD/seed/terminal commitment，保留 hash、两类 key version/FK 与非敏感身份 metadata。

## 10. 实施工作包

1. 完成 Planning/Downstream Wire strict Schema、Registry、版本矩阵、上限与
   Reference closure。
2. 实现 Research planning/evidence/coverage/reporting/readiness 纯 Kernel。
3. 实现 server-only Registrar、Brand、Committer 与 Candidate/clone/parse 反例。
4. 一次性实现完整 `10590`、schema inventory、Research/Readiness/Resource 持久化，
   并关闭通用 Repository 与 Backend DML 旁路。
5. 永久退役通用 READY API；实现 current-tuple Release revalidation。
6. 实现 material Claim/Schema Frontier 闭包与完整性检查。
7. 实现 Stop 六分支、Partial 三前提和预算可执行配对反例。
8. 实现 Grant Issue/Consume/Response/Expire 与 READY 前后撤权竞态。
9. 接入 Resource/Invocation/System Record、密文 Result Blob 与 Projection 外层 RPC；
   内部 Artifact Writer、明文 terminal RPC 和底层 DML 均不可达。
10. 在 Worker 组合 Mastra、Research、Text2SQL、Sandbox 和 PostgreSQL Authority；
    Checkpoint 只保存执行位置与精确引用。
11. 跑 Controlled、Mutation、Crash-Recovery、Resource、Historical Tuple、Bypass、Schema、
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
- Writer/Supervisor/Schema Parse/clone/historical tuple 不能获得 Authority；
- 通用 `authorizeRunTerminal(READY)` 固定拒绝；
- READY 前撤权无 READY/Grant；READY 后撤权保留历史 READY、当前 REVOKED；
- Grant Issue 后、Response CAS 前撤权（含 Consume 后/Response 前）均零字节；
  Response CAS 先胜出后本次可完成，撤权只阻止后续读取；
- Release GO 拒绝 before-READY、historical tuple、REVOKED、历史-only Certificate 与 Schema
  漂移；`GO -> revoke -> same-key replay` 不得返回历史 GO；
- Crash-Recovery SQL 次数为 2，旧 Fence/伪造 Checkpoint 失败；
- Tenant Burst、Provider Cost、SQL Result Amplification 与 Cancel Reservation Leak
  失败关闭。
- Invocation Start-before-I/O、非法状态跳转、三类 COMPLETED 零计数与
  OUTCOME_UNKNOWN late
  CAS 全部通过。
- Permit expiry/revoke 不可复活，Result tombstone 原子删 ciphertext 且保留 metadata。
- matching subject 的 Result Erasure 可在 retention 到期前清除正文；跨 Principal/S、
  伪造 request hash、Retention Authority 冒充与 current Legal Hold 均零写失败。
- 仅 Job 可在 lifecycle-exclusive lock 后执行 DELETE_PENDING cleanup；错误 epoch/
  Manifest/Export/Backup/Inventory、Legal Hold 或跨 environment 在首条 destructive DML 前
  失败。多 batch operation hash 稳定、batch request hash 独立，commit 后响应丢失可精确
  重放；U6_JOB residual=0 时两张无 PII control receipt 保留，且外层
  Database/Storage/Redis/verifier 未闭合仍为 HOLD。
- Terminal `T` 内 FK 集合与 constraint-name allowlist exact：四条 runtime reciprocal
  INITIALLY DEFERRED，其余 cleanup-only INITIALLY IMMEDIATE；普通 RPC 不可 defer，
  cleanup 漏删 aggregate 任一行则 commit 失败且零孤儿。
- 根包/通用 Repository 对全部 U6 元组失败关闭；Backend 直接
  INSERT/UPDATE/deactivate 失败，专用 Committer 成功且锁序无 TOCTOU。
- `authorize_agent_data_projection` 可成功提交 Receipt，Backend 直调
  `commit_research_system_artifact` 被拒。
- sentinel 明文在 DB/日志/Audit/Checkpoint 中不存在；nonce/tag/AAD/hash/key version
  任一篡改失败；active claim 只有一个加密 winner，已提交重放不二次加密；
  crash-before-commit 无孤儿 Blob；live Candidate takeover 最多一个 Blob，Candidate
  丢失时 INITIAL abort 进入 OUTCOME_UNKNOWN、LATE abort 永久关闭 Terminal path，均零
  Provider/SQL/Tool 重调；
  到期但 Job 未运行及 TOMBSTONED 都不可回放。
- `u6-schema-inventory@1.0.0` 与 clean-install `pg_catalog` 精确一致，且 hosted
  Supabase、Docker PostgreSQL 共用相同 DML/密码/并发 Oracle。
- `10590` 只接受 PostgreSQL 17；维护窗口同时有 statement/lock/transaction timeout。
  多条各自未超时但总事务跨窗时必须由 `transaction_timeout` 或 ledger 前 DB-time
  复验整体回滚；prepared transaction、PG16/18、窗口后换绑均零残留失败。

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
- 完整 `10590`、schema inventory、Projection wrapper、DML fail-close 与密文 Result
  Oracle 全部通过前，`NOT_IMPLEMENTED` 不得改成完成，也不得把合同文本当交付证据。
- U6 只标记自己的 Research Authority 工程单元完成，不冒充 U5–U9 完整纵向切片。
- Release 保持 `HOLD`，直到 U7–U9 和签名 Outcome Evidence 闭合。
