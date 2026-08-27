# 修复持续对话 Root Harness

## Goal

把当前一次性 Root Router 恢复为真正的持续对话 Agent Harness。在同一个 Conversation 中，一条用户消息仍对应一个可恢复、可审计的 Run；Root 能看到该 Run admission 时冻结的历史文本，并在当前 Run 内自主完成最多四轮 Tool/Subagent 调用后给出 Artifact-backed 最终回答。

本任务是 `08-27-falcon24-e2-authority-evolution` 的 P0 阻断子任务。W2/10783 现场保持冻结；本任务验收后恢复父任务，不替代 generation 2/E4 工作。

## Requirements

### R1 Conversation、Run 与 Artifact 边界

- Conversation 是同一窗口的长期文本上下文；Run 是单条用户消息的执行、恢复与审计边界；Artifact 是数据、语义、SQL、分析和图表证据。
- Run admission 冻结 `conversation_id + conversation_resource_version`，之后新增消息不得污染已冻结 Run。
- 当前消息必须是可见历史中的最后一条 user message；消息按 `created_at + message_id` 稳定排序。
- 历史 user/agent 文本只帮助理解省略、指代、筛选和展示偏好，不作为数据库或语义事实证据。
- 首期不放宽 current-Run Artifact 约束；追问所需事实必须在当前 Run 重新验证。

### R2 Root 是唯一自然语言决策者

- Root 每轮只自主选择当前下一步：直接回答、调用一个能力、调用多个互不依赖的能力、澄清或结束。后续能力只能在前一轮 Tool Result 返回后再决定。
- 禁止关键词/正则 Router、固定业务 workflow、`query_kind`、业务 case resolver 或 Host 自行选择 Profile。
- 禁止 Root 预声明完整调用链、同轮消费者依赖生产者，或 Host 根据业务依赖调度后续能力。
- Host 只验证当前 Tool Call 的冻结 Agent Card、权限、预算、已验收输入 Artifact、exact Release/Schema/Datasource binding、SQL/Sandbox 安全、幂等恢复和 Artifact commit。

### R3 ProviderTaskArtifact v2 与 Provider messages

- v2 必须包含 conversation identity/version、current message、ordered visible messages、可选 summary ref 和 `context_selection_hash`。
- Root Provider messages 必须按 `system/context -> historical user/assistant -> current user -> current-Run assistant/tool observations` 构造。
- 历史 prompt injection 保持 user data 身份，不能提升为 system。

### R4 有界 Root Tool Loop

- 每个 Run 最多四个正常 Root turns；该预算与 provider retry、SQL repair 分离。
- 每个 turn 只决定当前下一步；Subagent 结果作为 Tool Result 返回 Root 后，Root 下一轮基于真实结果继续判断。
- 跨 turn 输入只使用普通 `input_artifact_refs`；同一 turn 的多个调用必须相互独立，可并行执行但不能互相消费输出。
- 每次 Subagent terminal 都生成严格、安全的 `RootToolObservation` 并反馈给下一 Root turn。
- Final answer verifier 拒绝时以结构化反馈进入下一 turn；删除专用 `DIRECT_ANSWER_REVIEW` 状态。
- 每轮 checkpoint；恢复时不得重复已持久化的 Provider、SQL、Sandbox 或 Artifact side effect。
- 重复 logical call、catalog/Profile/hash 漂移和 Artifact correlation 不一致 fail closed。

### R5 SemanticQueryContext

- Semantic Agent 可以产出同 Run 的结构化 `semantic-query-context@1.0.0`，绑定 exact semantic release、datasource、schema snapshot、metric/dimension/relationship/time/restriction closure 和 unresolved ambiguities。
- 模型只选择语义对象和解释目标；Host 从 frozen Release/Graph 构造字段，模型不能提交自定义公式、Join 或物理绑定。
- Semantic-only 问题可由 Root 基于该 Artifact 回答。

### R6 可选 Semantic → Text2SQL

- Text2SQL 无需 SemanticQueryContext 也可处理无歧义查询。
- 有输入时，在数据库 I/O 前验证 current Run、release id/generation/digest、schema snapshot、datasource 和 metric/dimension/join 范围完全一致。
- 越界、stale 或跨 Run 输入必须 fail closed。

### R7 Analysis、表格与图表

- Root 可在 QueryEvidence 后自主调用 Analysis/Python/Chart，而不是进入固定后继。
- 最终回答、表格、AnalysisReport 和 Chart 只能引用 current-Run accepted Artifacts。
- Chart 必须由已验收 QueryEvidence 派生并保持 same-source binding。

### R8 长对话压缩

- 当前消息和最近完整 user/assistant 对永远优先；更早历史在预算外时生成 `conversation-context-summary@1.0.0`。
- Summary 绑定覆盖的 message IDs/hashes，只服务语境理解，不是数据证据；使用现有 Artifact Store，不新增业务表。

### R9 安全、持久化与范围

- 不向模型或公开 Trace 暴露密钥、连接信息、原始 provider payload、system prompt、chain-of-thought 或未验收 raw rows。
- 跨 Tenant/Principal/Conversation、无权/删除 Conversation、未验收 Artifact 均拒绝。
- 最多允许一条前向 migration 演进既有 ProviderTask/Root lease RPC；不新增业务表、发布 authority、Epoch 或诊断 authority。
- 首期不重构 Web UI，只验证同 Conversation 提交、消息/Run/Artifact refs 回写和连续展示。

## Acceptance Criteria

- [ ] Root 收到冻结 Conversation 的真实有序历史，冻结版本后的消息不可见，新 Conversation 完全隔离。
- [ ] Root 在 current Run 内完成 direct、单 Tool、多轮串行 Tool、同轮独立 calls、verifier feedback 和四轮耗尽路径。
- [ ] crash/replay 不重复 Provider、SQL、Sandbox 或已提交 Artifact。
- [ ] SemanticQueryContext 真实提交并可用于 Semantic-only 回答。
- [ ] Root 可直接调用 Text2SQL，也可在 Semantic Tool Result 返回后的下一轮将其已验收 Artifact 作为 `input_artifact_refs` 交给 Text2SQL；exact binding 负例在 I/O 前拒绝。
- [ ] Root 可继续调用 Analysis/Python/Chart，最终 answer/table/chart 全部有同 Run evidence。
- [ ] 80+ 消息触发安全摘要，近期追问仍正确，摘要不能授权数据事实。
- [ ] 同一窗口真实执行固定五轮追问：趋势+折线图、华东筛选、11 月下降解释、改表格、关系语义问题。
- [ ] 精确 Run 的 Trace UI 能看到完整 Tool/Artifact 链；新窗口“只看华东呢？”必须要求澄清。
- [ ] 没有新增关键词路由、固定业务流程、跨 Run Artifact 复用、业务表、Epoch 或发布机制。
- [ ] 每个 C0-C7 包完成聚焦验证并形成 scoped commit；不得吸收 W2/10783 脏文件。
- [ ] C7 通过后恢复父 Trellis 任务并继续原 Falcon24 W2。

## Out of Scope

- generation 2/E4 发布实现与 Falcon 正式 16/16、30/30 门禁（修复完成后恢复父任务）。
- 跨 Conversation 用户记忆、跨 Run Artifact 直接复用、新向量记忆、新 Router/planner/case template、预编排业务调用链、UI 整体重构。
