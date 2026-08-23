# Data Agent 彻底重置重构规划

## 目标

以空仓库为起点，设计一个能够替代现有 `text2sql` 项目的新 Data Agent。新系统不再停留在受治理的数据问答，而是沿可验证的能力阶梯，逐步交付多步研究分析、可执行数据科学、主动分析观察与因果决策；同时降低多模型接入、评测迭代和部署运维成本。

## 背景与已确认事实

- 当前仓库是彻底重置后的绿地仓库，实时 Git HEAD 为初始提交，除 `LICENSE` 和本轮初始化的规划基础设施外没有产品代码。
- 旧 `text2sql` 项目及 `research/data-agent-system-design` 是迁移输入和设计证据，不是要直接复制的实现模板。
- 指定研究课题已经覆盖 Text2SQL Artifact 链、L2–L6 能力阶梯、L3 实验 DAG、L4 主动发现、L5 因果识别和分层评测；本轮需要把这些结论收敛为新仓库可执行的架构与路线图。
- 用户已于 2026-07-25 选择执行方案 2，并批准原主计划 U1–U9；该批准已支持 U1–U6 的
  历史实施，不自动覆盖 2026-07-30 的语义控制平面或 2026-08-02 的 Ontology/贡献扩面。
- 当前待审权威是
  `docs/plans/2026-07-30-001-refactor-governed-semantic-control-plane-plan.md`；它保留历史
  证据并新增 R9、U10–U11 与 U13。用户再次明确批准前，不实施这些新增单元，也不恢复
  被本次兼容门禁暂停的 C2a。

## 需求

### R1. 绿地重置

- 新系统按绿地架构规划，不承担旧 LangGraph 图结构或旧目录组织的兼容义务。
- 旧项目仅用于提取可复用的领域语义、SQL 校验、测试夹具和迁移边界。

### R2. Agent 运行时与模型生态

- Agent 内核以 Mastra 类型的现代 Agent Framework 为中心，支持动态 Agent、Workflow、Tool、Memory、Eval 与多 Agent Team。
- 通过显式 Provider/Model Capability Contract 接入 OpenAI、Anthropic/Claude、DeepSeek、GLM、Kimi、Grok、Gemini 等模型。
- 将“模型提供方接入”和“Claude Code 等外部编码 Agent 作为受控执行者接入”分开设计，避免把 CLI Agent 误当成普通推理模型。

### R3. 能力阶梯

- 产品能力覆盖多步研究分析师、可执行数据科学家、主动分析观察者和因果决策科学家。
- 每一级必须有独立 Artifact、状态、权限边界、失败终态、Oracle 和 Release Gate，不能只靠增加 Prompt 或 Agent 数量宣称升级。
- 首个可发布版本采用纵向切片：交付 L2 多步研究分析师、强 Text2SQL 和评测闭环；L3–L5 只交付稳定扩展合同与后续路线，不进入首版实现范围。

### R4. Text2SQL 质量

- Text2SQL 从“多步骤生成 SQL”重构为业务语义与数据语义共同约束的查询编译链。
- 正确性覆盖意图、语义、结构、权限、资源、执行和结果，不以“可解析、可执行、非空”作为成功判据。
- 测试驱动的迭代必须能够定位失败发生在问题理解、Grounding、规划、生成、验证、执行或结果解释中的哪一层。

### R5. 部署与租户隔离

- 支持 Vercel 前端、Supabase 数据库、Upstash Redis 的托管部署组合。
- 支持一条命令启动的 Docker 自托管部署。
- 多个个人项目可共享一个 Supabase Project，但必须通过应用级命名空间、数据库 Schema、RLS、存储路径、迁移账本和密钥边界防止项目之间的数据或迁移串扰。

### R6. 将评测作为产品能力

- 设计统一 Benchmark Adapter，能够接入 InsightBench、DAB、RCAEval 和自建可控归因数据集。
- 评测题目既能用于开发期回归、成对基线与 Release Gate，也能以经过许可和脱敏的演示题集进入产品体验。
- 题目、参考答案、评分器、数据快照、运行轨迹和模型/Prompt/语义版本必须可追踪，不能只保存一个总分。

### R7. 调研来源与可追溯性

- 本轮新增调研全部写入 `research/data-agent-system-design`，使用 `research-to-article` 的 Question、ResearchRun、Evidence、Claim、Reflection 和 Answer Runtime 约束。
- 复用已有结论时必须重新检查其适用范围和时效；目标设计、合成验证、源码审计和真实生产证据必须明确分层。

### R8. 规划流程

- 使用 Compound Engineering 形成统一的实施级技术计划和文档审查门禁。
- 使用 Trellis 保存 `prd.md`、`design.md`、`implement.md`、研究索引和后续任务状态。
- 规划阶段不得运行 `task.py start`；用户明确批准后，必须先通过计划审查与 Trellis 清单
  验证，再进入产品代码实现。原 U1–U9 批准门已通过；R9/U10–U13 的新增范围批准门当前
  重新打开。

### R9. 可治理语义控制平面与 Ontology-guided 描述性贡献

- R9a：以 additive compatibility 补齐 production U5 materializer，并从同一
  `SemanticSourceBundle@1` 编译 current-U5-compatible semantic、relationship 和
  runtime-restriction projection；不改 U5/U6 wire。
- R9b：版本化治理 `BusinessOntology`、`AnalyticalSemantics`、
  `RelationshipRegistry`、`PhysicalBinding`、`CatalogGovernance` 和
  `RuntimeAuthorization`；Agent proposal、人工 exact review 与确定性 PostgreSQL
  publish/rollback 分权。
- R9c：PostgreSQL 是唯一 Source/Review/Release Authority，production v1 只准同库
  Catalog fence；共享 Supabase、Docker、RLS/role、rollback、benchmark Lane 和
  activation 必须有可重放证据。Neo4j 仅为 `U12 / DEFERRED` 可重建投影。
- R9d：Ontology 只定义业务意义和有界候选，不替代 Formula、Join、Binding、DQ、Policy
  或 causal graph。通过治理的 Profile 必须编译为可寻址、内容寻址的
  `DescriptiveContributionProfileProjection@1`；projection ref/hash、Source Release 与
  active pointer 必须在同一 PostgreSQL 发布事务中绑定，运行时不得按名称或“最新版本”
  猜测 Profile。Profile 必须为 outcome、每个 driver 和 independently observed residual
  固定 baseline/follow-up 静态 `EndpointExecutionTemplate`，每次 Run 再以
  `EndpointExecutionBinding` 绑定 QueryContract instance、principal/scope、snapshot/
  PolicyReceipt 和 U6 五轴；运行时 binding 不得混入静态 profile digest。Profile 判别
  `ROW_PARTITION |
  FORMULA_IDENTITY`：前者以 `SameMeasureWitness` 证明同一 canonical measure AST/
  aggregation/grain/unit/null policy/universe，后者证明 canonical FormulaAST 的 signed
  equivalence；每端还要由独立 verifier 签发 AST→QueryContract→LogicalPlan/SqlArtifact→
  QueryEvidence 的 `EndpointLoweringCertificate@1`，并以 `SameFrontierWitness` 固定 U6
  五轴。预算证明拆为两层：`StaticDriverCapacityProof@1` 只证明 Profile 在 U6
  obligation/DIAGNOSTIC binding/artifact-input 静态上限内可编译；每次执行前另由
  `RunDriverBudgetAdmission@1` 按当前 Run 剩余 SQL/资源预算准入，二者都通过才可执行
  （当前 16 SQL 最宽前提下绝对上限为 6），超限 typed refusal。Runtime admission 还必须
  绑定 run fence、question/profile hash、reservation id、idempotency key、sequence/expiry，
  并与 U4 lease/fence、Budget Ledger 同事务维护 `RESERVED | CONSUMED | RELEASED | EXPIRED`；
  crash/retry 不得跨 fence 复用、双扣或永久占额。Kernel 只从 U5→U6
  两端 QueryEvidence 计算 delta，并由 U13-owned
  `DerivedDeltaObservationSet@1` 无损承载每个 outcome/driver/observed-residual 的两窗
  level、signed delta、endpoint/evidence ref 与 derivation metadata；closure verifier 消费该
  Set 后另生成 closure。`AtomicClaim@2` 只保留 U6 可表达的摘要断言，不再声称无损承载
  U13 delta。若 U6 报表段展示 U13 权威结论，必须由 sidecar
  `ConclusionProjectionBinding@1` 把 exact U13 conclusion/receipt 绑定到 exact report
  segment，并绑定同时重验 Receipt/Conclusion status、完整六轴、Run/segment/route/purpose/
  audience/expiry 的非 bearer `AttributionConclusionUseDecision@1`；原生 F9 response 也绑定
  exact response hash。`computed_closure_error` 不得回写 residual。U13 的 property owner、lowering
  规则与生产结论签名分别由版本化 `U13PropertyOwnerMapRelease`、
  `EndpointLoweringRuleSet`、`ConclusionSignatureAuthority` 持有。M1 Fixture 只用 checked-in
  `FixtureConclusionPolicyManifest@1` + 后置 U7 的内容寻址 `FixtureConclusionDecisionSeal@1`，
  不实现 key/nonce/rotation 或消费授权；M1 的 U13.1 只输出
  `KERNEL_CANDIDATE_ONLY/HOLD + AttributionKernelEvidence@1`，后置 U7 Eval 才可签发
  `AttributionFeasibilityVerdict`；U10.3 后的 U13.2 才可注册
  F9 和最高为 `CONTRIBUTION` 的产品结论。grouped/dynamic/ratio/PVM/LMDI/Shapley/RCA/
  因果升级在当前 IR 下拒绝或延后。Attribution Verdict 只控制 F9 分支，不阻断已闭合的
  “L2 多步研究 + 强 Text2SQL + 评测”Core Release。
- 用户可在 M2 产品中体验“为什么华南净收入下降”受控题：查看 exact metric/profile、
  Ontology path、两端 QueryEvidence、signed `ContributionItemSet`、observed residual、
  closure error、alternatives 和 `描述性贡献 / 非因果结论` badge。M1 只展示 Fixture
  feasibility 与 Oracle；状态明确为 `Core L2=HOLD`、`Attribution F9=NOT_REGISTERED`、
  `Fixture Evidence=HOLD`，不提供 F9 Route。

## 验收标准

- [x] 指定研究课题中存在一条可恢复的本轮 ResearchRun，覆盖 Agent/Provider、Text2SQL、能力阶梯、部署/共享 Supabase 和 Benchmark 接入。
- [x] 关键外部事实来自当前的一手文档、论文/Benchmark 仓库或固定提交源码，并建立 Claim–Evidence 映射。
- [x] `prd.md` 明确产品目标、范围、非目标、可观察验收条件和已解决的产品决策。
- [x] `design.md` 明确架构边界、Artifact/状态流、共享 Supabase 隔离、评测接口、部署拓扑、迁移与回滚策略。
- [x] `implement.md` 给出依赖有序的实施阶段、验证命令、风险点、回滚点和每阶段 Release Gate。
- [x] Compound Engineering 计划包含需求追踪、稳定 U-ID、具体测试文件路径和可判定测试场景。
- [x] 主计划、Trellis PRD、架构设计与实施路线以中文为主，只保留必要的技术标识、命令和标准英文术语。
- [x] 原 U1–U9 计划经过置信度检查和文档审查，用户已批准其历史实施，Trellis 任务状态
  已切换为 `in_progress`；该事实不代表 R9/U10–U13 修订已批准。
- [x] RQ310 已建立独立 Question/Run/Claim/Evidence/Answer Runtime，并以 OWL 2、SHACL、
  PROV、MetricFlow、贡献方法、RCAEval/PyRCA 与当前 HEAD 证据修订 Roadmap。
- [x] R9/U10–U13 修订已完成三轮 GPT-5.6 xhigh 对抗上限和 Codex 文档审查；第三轮
  `needs_learning` 的缺口已修补并由 Codex 最终复核确认无 P1/P2，学习循环诚实记为
  `loop_capped`，不宣称 GPT PASS。
- [ ] 用户审核并重新批准 R9/U10–U13 修订；批准前保持 `PLANNED / NOT_AUTHORIZED`。
- [ ] U13.1 仅在 U5/U6 schema/hash zero diff、完整 endpoint templates/runtime bindings、kind-specific
  template/runtime binding 分离、accounting witness、逐端 lowering certificate、
  SameFrontierWitness、`StaticDriverCapacityProof@1 + RunDriverBudgetAdmission@1`、
  origin-discriminated
  Receipt subject/currentness、同 snapshot baseline/follow-up evidence、
  U13-owned `DerivedDeltaObservationSet@1`、observed residual/closure error 分离、exact
  closure、typed refusal 和 typed conclusion Authority 及可验签 Conclusion Decision
  lifecycle 通过时，进入 U7 后置 Fixture Eval；F9 Route 仍必须不存在，状态保持
  `Core L2=HOLD`、`Attribution F9=NOT_REGISTERED`、`Fixture Evidence=HOLD`。
- [ ] M1 attribution 的判定顺序固定为 `U7 前置 Truth Oracle → U13.1 Fixture Run → U7
  后置 Eval Verdict → U8 Evidence Demo`：Truth Oracle 在看到 Kernel 输出前冻结且与实现
  角色隔离，U13.1 不自签正确性，U8 只消费后置 Verdict 与其绑定的 exact
  `AttributionKernelEvidence@1`/Receipt，不参与生成真值。
- [ ] U13.2 只在 U10.3 published-only bridge 后消费 PostgreSQL active exact release，并
  证明 published Profile 是与 release/active pointer 同事务绑定的可寻址 content-addressed
  projection，且 `ContributionItemSet` 与 `InvestigationCandidateSet` 分型、Hosted/Docker parity 和
  `PublishedAttributionSafetyVerdict` 后，再通过独立 `ATTRIBUTION_USER_VALUE` 盲测与
  Capability/Fallback Gate，才进入 `M2-F9` 并注册 F9；失败只令 F9 `HOLD`，不阻断 M2-Core。
- [ ] Design Lens 产品 Gate 逐项覆盖
  `AttributionCapabilityDirectory@1 → AttributionEligibilityDecision@1`
  两阶段入口、principal/app/tenant/environment/domain/datasource/policy 防枚举过滤、
  Eligibility 对未授权/不存在对象返回无 object ref 的外部等价
  `UNAVAILABLE_FOR_PRINCIPAL`、仅 `SUPPORTED` 可达 F9、Core/F9
  独立状态、ProfileRequest 全生命周期与原问题重放，以及每个公开 reason code 的稳定
  `next_actions`；Web/API/Agent 对同一 Decision 必须等价。

## 规划产物不包含的范围

- 规划阶段本身不实现产品代码、不迁移生产数据、不部署云资源；获批后的新增实施范围由
  主计划 U10–U11/U13 约束，U12 和 U13.3 保持 `DEFERRED/HOLD`。
- 不把 L6 受控数据操作员或自动写入生产系统作为首个版本的默认能力；其接口边界可预留，但需要独立的安全计划。
- 不承诺未经 Benchmark 实测的准确率、成本、时延或业务收益。
- 不生成正式研究文章或 HTML；本轮交付研究答案和工程规划产物。

## 关键产品决策

- 首版采用“L2 多步研究分析师 + 强 Text2SQL + 评测闭环”的纵向切片，并为 L3–L5 预留 Artifact、状态和能力接口；该选择优先于首版同时交付 L2–L5，以便更快形成可演示、可量化、可迭代的完整闭环。
- 简单贡献度是该纵向切片上的独立 F9 增量，不是 Core L2 的单点前置；只有
  Attribution Feasibility、Safety、Hosted/Docker parity 和 User Value 都通过才注册。
  入口拆为两阶段：提问前的 `AttributionCapabilityDirectory@1` 只返回当前
  principal/app/tenant/environment/domain/datasource/policy 已授权且不可用于枚举他人对象的支持面；
  冻结原问题后由 `AttributionEligibilityDecision` 对 exact metric/profile/window/grain/
  freshness 判定；Decision 必须重新绑定同一六轴和 Directory digest，猜测 ref、未授权、
  不存在或 policy 不确定统一返回不含 object ref/name/count 的外部等价
  `UNAVAILABLE_FOR_PRINCIPAL`。只有 `SUPPORTED` 可进入 F9 execution；`F9_NOT_REGISTERED | NO_PROFILE |
  NOT_LOWERABLE | STALE | UNAVAILABLE_FOR_PRINCIPAL` 必须保留原问题，并通过稳定
  `reason_code → next_actions` 提供
  `CONTINUE_L2 | REFRESH_ELIGIBILITY | NARROW_SCOPE | REQUEST_PROFILE |
  REPLAY_ORIGINAL_QUESTION | VIEW_EVIDENCE | VIEW_REQUEST_STATUS |
  WITHDRAW_OWN_REQUEST | WITHDRAW_SUBSCRIPTION | ABANDON` 的允许子集，Web/API/Agent 不得静默降级或枚举
  未授权对象。
  F9 发布前的 Safety/User Value/Hosted-Docker 验证只能由不属于产品 scope 的
  `attribution_release_candidate_evaluator` 对 hash-pinned candidate 执行；它只写 Release
  Evidence，不能注册产品 Route。目标用户只通过邀请制、participant-scoped、短 TTL 的
  `AttributionEvaluationSession@1` 查看带 `NON_AUTHORITATIVE_EVALUATION_ONLY` 标记的不可导出
  preview；Session 不得调用产品 Tool 或写 U6 权威 Report。全部 Gate 通过并将 F9 状态切为 `GO` 后，产品 Route 才
  接受 current `SUPPORTED` Decision，避免“必须先 GO 才能测试是否可 GO”的循环。
- Core 与 F9 使用独立发布状态：`CoreReleaseStatus` 不得被 Attribution Gate 改写；
  `AttributionF9Status=NOT_REGISTERED | HOLD | DEFERRED | GO` 单独展示原因和下一步。
  因此 M2-Core 可以为 `GO` 而 F9 保持 `HOLD/NOT_REGISTERED`，全局 Header 不得再用单一
  Product Release badge 暗示全部能力已发布。
- `AttributionProfileRequest@1` 不是一次性按钮，而是持久用户流：至少覆盖
  `DRAFT | SUBMITTED | DEDUPED | TRIAGED | LINKED | DECLINED | CLOSED | EXPIRED | WITHDRAWN`，
  不复制既有 U10 Candidate/Review/Publish 生命周期。固定合法迁移：requester
  `DRAFT→SUBMITTED`；Request Authority `SUBMITTED→DEDUPED|TRIAGED`；profile owner 只能
  `TRIAGED→DECLINED`；A7 只能通过既有 U10 API `TRIAGED→LINKED`；Request Authority 只在
  消费 U10 terminal receipt 后 `LINKED→CLOSED`。expiry sweeper 可把
  `SUBMITTED/TRIAGED/LINKED` 置为 `EXPIRED`；requester 可把自己的
  `DRAFT/SUBMITTED/TRIAGED/LINKED` 置为 `WITHDRAWN`，但不能撤销已建 Candidate。
  `DEDUPED/DECLINED/CLOSED/EXPIRED/WITHDRAWN` 为终态。DEDUPED 只生成 requester-scoped
  opaque `AttributionProfileSubscription@1`；普通 requester 不能读取 raw canonical ref、他人
  requester/original question/reason 或 Candidate lineage。所有迁移使用 expected-state CAS，
  与 Outbox/notification 原子提交，exact retry 幂等、冲突 retry 拒绝；始终绑定
  `original_question_ref`；FORCE RLS/窄 RPC 与跨 principal 负例强制该边界。
  Profile 发布后必须重新运行 `AttributionEligibilityDecision`，只有新 Decision 为
  `SUPPORTED` 才允许一键重放原问题，Request 本身没有 approve/publish 权限。
- Ontology 是六平面中的 `BusinessOntology` 业务意义骨架，不是完整语义层、图数据库、
  权限引擎或因果图；OWL 推理、SHACL 验证、Catalog/DQ、Policy 和 causal Authority 分离。
- M1 只验证预声明 additive endpoint profile 的 Fixture feasibility，而不是产品归因或
  任意动态维度归因；每项 baseline/follow-up endpoint 继续复用当前 U5 单 metric/time 与
  U6 单行证据合同。Profile 还必须以 `RowPartitionWitness | FormulaEquivalenceWitness`
  证明 accounting identity；逐端 `EndpointLoweringCertificate@1` 证明结构 witness 与实际
  U5 执行一致，`SameFrontierWitness` 防止跨 IDENTITY/principal 拼接；实际双窗 level/
  delta 由 `DerivedDeltaObservationSet@1` 承载，`AtomicClaim@2` 只作 U6 摘要投影，必要时
  由 `ConclusionProjectionBinding@1` 绑定报表段。单一
  `ContributionSubjectManifest@1` digest 对
  template/binding/evidence/proof/image/frontier/principal/scope 形成不可替换 Receipt subject，并在
  消费时重验 exact fixture manifest 或 Published currentness；Fixture 只生成非产品
  `FixtureConclusionCandidate/DecisionSeal`，Published 才看 active profile/release 与 PostgreSQL
  status ledger，并由 `ConclusionSignatureAuthority` 签发权威 Envelope；
  `U13PropertyOwnerMapRelease` 和 `EndpointLoweringRuleSet` 也必须精确绑定。权威结论使用判别联合
  `ASSERT { claim_ast } | ABSTAIN { reason_codes, unresolved_fields } | REFUSE {
  reason_codes, violated_policy }`，只有 ASSERT 的 ClaimAST 拥有 Authority；payload 还必须
  被 `ConclusionSubjectManifest@1 → ConclusionPolicyDecisionEnvelope@1` 与 exact Receipt、
  policy、signer/verifier、key/algorithm/signature、issued-at/expiry/nonce、inputs/result/currentness
  绑定；forged signature、wrong-role、replay 或 expired/rotated key 失败关闭。LLM prose、
  引文、retrieved text、table/code 都不是 Authority。U13.2 才能在 U10.3 后发布描述性
  `ContributionItemSet`；topology/
  event/anomaly/association 属于未来按 kind 独立准入的 `InvestigationCandidateSet`，不得与
  贡献绝对值统一排序或自动升级为根因。
