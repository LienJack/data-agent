# M3 Agent-maintained Semantic Candidates

## Goal

在已交付的 PostgreSQL `PhysicalSchemaSnapshot`、活动 `SemanticRelease` 和 Candidate
治理控制面之间，交付一条可重放的 Agent 语义编译链：用户从物理快照或 drift 发起“生成
语义建议”，系统保留原始输入，冻结编译身份，生成带逐字段证据的结构化 Node/Edge
候选操作，并且只通过现有 Candidate/Review/Publish 链路影响活动语义层。

用户价值是能把数据库结构转化为可审查的业务对象、维度、指标、关系与物理绑定建议，
同时明确区分物理事实、Agent 推断和已发布业务事实。

## Confirmed Baseline

- M0 已交付 fail-closed PostgreSQL Candidate/Review/Publish Authority 和内容寻址 Candidate
  Draft RPC；Agent/UI 无发布权。
- M1 已交付内容寻址 `PhysicalSchemaSnapshot`、`SchemaDriftEvent`、只读扫描与 PostgreSQL
  持久化。
- M2 已交付活动 release 的 Explorer、candidate comparison、diff 与 lineage 读取面。
- `SemanticSourceBundle` 已定义业务本体、指标、维度、物理/业务/分析关系和 PhysicalBinding；
  U5 compiler 与 source bundle validator 是后续确定性 Gate，不新建第二套语义模型。
- 现有 Candidate Draft 接受 `SCHEMA_DISCOVERY` source payload 和 deterministic semantic diff，
  但缺少 CompileRun、逐字段 Evidence、结构化 Agent 输出和 snapshot/current-release 绑定。
- 工作区存在其他任务的未提交修改；本任务只拥有新增 M3 文件及审定的窄导出/接线修改。

## Requirements

### R1 — Immutable source and compile identity

每次编译必须绑定服务器读取的 exact snapshot content hash、可选 drift event、当前活动
release identity、source revision、发起 principal、compiler/validator 版本、model profile、
prompt/tool/policy digest 和 idempotency key。调用方不能自报 App/Tenant/Environment、
principal、snapshot hash、release digest 或 Agent 身份。

### R2 — Typed candidate operations

Agent 输出必须解析为版本化、严格且有界的 `SemanticCandidateOperation`。首版 target type
限定 `BUSINESS_ENTITY_TYPE | DIMENSION | METRIC | RELATIONSHIP | PHYSICAL_BINDING`，action
限定 `CREATE | UPDATE | MARK_STALE`。不接受任意 JSON Patch、任意 SQL、直接删除、发布、
审批、回滚或权限变更操作。

### R3 — Evidence and uncertainty

每个 operation 和可修改字段必须引用 exact physical relation/column/constraint evidence，
包含 confidence、assumptions、open questions 和 impact。FK 只能产生 physical relationship
evidence；在没有 cardinality/row-preservation proof 时不能标记为安全 analytical join。
表列删除或变化只生成 `MARK_STALE`/impact，不自动删除已发布语义对象。

### R4 — Deterministic features before Agent

系统必须先从 snapshot/drift 生成稳定排序、内容寻址的确定性 feature packet，再交给 Agent
解释和组合。重复输入必须生成相同 feature digest；重名、相似名和 rename 不得由启发式
自动合并 identity。

### R5 — Agent boundary

Agent 使用已有受权 `ModelProviderPort` 的 structured output 路径，只读取有界 feature
packet 和已发布 public read model。它没有 Candidate、Review、Publish、Rollback、Secret
或 datasource 写工具。模型不可用、超时、越界输出或 schema 解析失败时返回稳定失败终态，
仍允许用户查看 deterministic feature preview。

### R6 — Governed candidate submission

通过验证的 proposal 必须被确定性编译为现有 `SemanticCandidateDraft`、`SourceRevision` 和
`CandidateRevision`，保留 exact CompileRun、snapshot、base release、operations、evidence
和 model/prompt identity。提交 Candidate 使用现有 PostgreSQL Authority；未审批 proposal
和 candidate 不得出现在 active Explorer 或 Query Grounding。

### R7 — Studio workflow

Physical Schema 页面提供“生成语义建议”入口，并展示 operation、confidence、evidence、
assumption、open question 和 impact。用户可以逐项接受/拒绝/编辑后提交 Candidate；页面
持续显示“候选未发布，不影响查询”，且不提供 Agent 自动审批或发布动作。

### R8 — Replay, security and observability

相同 input identity 和 idempotency key 必须重放同一 CompileRun/Candidate material；payload
变化必须稳定冲突。公共错误、日志和审计不得包含 prompt 中未授权字段、原始凭据、DSN、
业务样本行或 provider 原始异常。Compile terminal 至少区分 compiled、agent unavailable、
timeout、invalid output、validation failed、stale base 和 idempotency conflict。

## Acceptance Criteria

- [x] 同一 snapshot、base release、compiler/model/prompt/policy identity 得到相同 feature、
      proposal 和 compile input digest；任一输入变化都会改变 digest。
- [x] strict contract 拒绝未知字段、无 evidence operation、越界 target/action、任意 SQL、
      自报 Authority 和直接删除/审批/发布操作。
- [x] Golden schema fixture 生成稳定的 entity/dimension/relationship/binding 建议；低置信度
      metric 只能以带 open question 的候选出现。
- [x] FK 只生成 physical evidence；缺少 proof 时 analytical relationship 验证失败关闭。
- [x] schema removal/type drift 只生成 `MARK_STALE` 和 impact，不删除 active semantic object。
- [x] fake ModelProvider 的合法 structured output 进入现有 Candidate Draft；timeout、invalid
      output 和 provider failure 返回稳定终态且零 Candidate 写入。
- [x] PostgreSQL 10626 纵向测试证明 CompileRun/operation evidence 不可变、scope 隔离、
      replay/conflict 正确，Candidate/Source/Revision 与 CompileRun exact 绑定。
- [x] Studio 可从 snapshot 发起、预览、逐项选择并提交 Candidate；未提交/未审批内容不进入
      active Explorer 和 Query Grounding。
- [x] Contracts、Semantic、Platform、Web、PostgreSQL integration、tenancy 和 security 测试
      覆盖正常 trace 与全部稳定失败终态。
- [x] 只提交本任务文件，不吸收工作区既有 DataFoundry、Test Center 或模型配置改动。

## Out of Scope

- M4 指标公式澄清、Formula AST、任意 SQL/Python 和复杂多事实表公式。
- 文档上传、Chunk/Embedding/BM25 和知识库图抽取；后续独立里程碑复用本次 Source、
  Evidence、CompileRun 和 CandidateOperation 合同。
- AI 审批、发布、回滚、修改 reviewer policy、读取凭据、扫描业务数据行或执行 datasource SQL。
- Neo4j 写 Authority、实例级时态事实图、通用 OWL/SHACL reasoner 和自动 identity merge。

## Technical Notes

- `SemanticSourceBundle` 仍是发布编译输入，`SemanticCandidateOperation` 是审查友好的变更
  表达；提交前由一个确定性 reducer 生成完整 bundle/diff，不形成第二套发布模型。
- M3 使用下一条 additive migration `10626`；不修改已应用的 10610–10625 bytes。
- M3 完成后，M4 Metric Authoring 和知识库双通道分别作为后续 child task 接入同一控制面。
