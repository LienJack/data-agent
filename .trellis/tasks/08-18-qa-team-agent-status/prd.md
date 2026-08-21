# Q&A Team Run Agent 实时状态展示

## Goal

让用户在 Q&A Agent 回答正文内实时看到 Semantic、Text2SQL、Report 三个专职 Agent 的权威状态、
当前公开步骤、耗时和失败原因；状态必须可从 durable Run events 重放，不能由 React 根据 loading 状态猜测。

## Background

- 当前 `ChatMessage` 只有 `assembleProcessRows` 生成的通用 progress/reasoning/tool disclosure；无事件时仅显示
  “正在生成回答…”。
- `PublicRunEvent` 的 tool 投影会丢弃 Worker 已写入 input 的 `profile_id/task_id`，Web 无法可靠归属到具体 Agent。
- `AgentTeamPublicTrace` 能展示任务/交接/Verifier 的持久结果，但不是实时 SSE 状态源。
- `apps/worker/src/run-worker-cli.ts:332` 的 production Team runtime 目前固定返回
  `DATA_AGENT_TEAM_DOMAIN_RUNTIME_UNAVAILABLE`，即使 Worker 启动也不会真实执行三个 Product Profile workflow。
- DeepSeek Harness 固定参考提交 `47f943859bef60e4160492346772ded9b24f765a` 使用
  durable event -> keyed assembler -> snapshot -> UI 的分层；subagent UI 只读取 summary/lineage projection，
  不直接拼接原始事件或私有推理。
- 2026-08-21 通过 Understand Anything fresh graph 复核：Harness details panel 的选择写入共享 store、内容从 session snapshot 派生；session/subagent 使用 durable baseline + live increment；三栏空间不足时优先收起 details。Harness ProducedFiles 走宿主 `openFile`，该行为不适用于 Data Agent 的多租户 Artifact 权威。

## Requirements

- R1：状态来源必须是严格版本化的 Public Run Event 或 Team Trace projection，禁止组件读取原始 JSON、
  Provider reasoning、prompt、raw context、SecretRef 或 Worker 私有快照。
- R2：固定展示三个规范 Agent：Semantic、Text2SQL、Report；每个 Agent 至少支持
  `PENDING/RUNNING/COMPLETED/FAILED/INTERRUPTED/SKIPPED/BLOCKED`，且终态不可由 SSE 断开推断。
- R3：Agent answer 使用按 event sequence 排序的 inline activity stream；连续 answer delta 合并为正文块，
  Think、Tool、Context、Subagent 行与正文按真实时间顺序穿插，不能统一堆在答案顶部。
- R4：每个活动行显示 icon、类型/名称、单行公共摘要、状态和耗时，默认折叠；展开后显示允许的
  input/output/Artifact/error，并可定位到轨迹详情。Subagent 展开后可显示其归属 Tool 行。
- R5：首次 SSE、断线重放、页面刷新和 terminal closure 必须通过同一个纯 assembler 得到相同状态。
- R6：没有任何 Agent 状态事件时显示明确的排队/运行时不可用状态，而不是伪造三名 Agent 正在工作。
- R7：中英文文案、键盘 disclosure、focus-visible、`prefers-reduced-motion` 和屏幕阅读器状态语义完整。
- R8：继续使用现有冷中性色、墨绿 accent、amber/red 状态色、4-8px radius、Phosphor icons 和
  monospace 状态/耗时，不复制 DeepSeek Harness 的品牌 token 或菜单外观。
- R9：移除 production Worker 的 `DATA_AGENT_TEAM_DOMAIN_RUNTIME_UNAVAILABLE` stub，接通 PostgreSQL Team Store、
  Mastra workflow registry、Resolved Context、Provider/Compiler/Sandbox/Artifact ports 和 Acceptance。
- R10：Q&A 已有可运行 Semantic Release/Schema Snapshot 时，Semantic Agent 以 `SKIPPED` 终态说明无需维护；
  不得为了让 UI 三项都动而写无意义 Candidate。Text2SQL 和 Report 必须真实执行并产生受治理 Artifact。
- R11：Q&A conversation 增加 Codex 风格右侧 Inspector。选择 Subagent 名称时显示从同一 Run public event replay + SSE 派生的实时公开 feed；选择 Artifact/file link 时通过现有 Workspace Artifact Preview API 显示安全预览。
- R12：Inspector selection 使用严格 `subagent`/`artifact` 判别联合并可通过 URL 恢复；连接状态与 Agent authority 分离，切换 Conversation/Run 时不得保留 stale identity。
- R13：只有完整 `ArtifactReference` 才可成为 file preview target；禁止浏览器传任意本地路径、从 Tool output 猜文件、把 raw SSE frame/Provider callback/private reasoning 展示在 Inspector。

## Acceptance Criteria

- [ ] Contracts 严格解析 Agent status event，未知 profile/status/字段以及私有推理字段失败关闭。
- [ ] Worker 发出的每个 Agent START/END/FAIL 在 PostgreSQL、SSE、reload replay 后 identity/status 一致。
- [ ] Web assembler 对乱序禁止、重复事件去重、运行中断和 Run terminal closure 有确定性测试。
- [ ] Q&A answer 按 sequence 穿插显示公共 Think、Tool、Subagent 与正文块；刷新后顺序和折叠 identity 稳定。
- [ ] Tool/Subagent 行可见 RUNNING/COMPLETED/FAILED/BLOCKED 等状态；默认折叠且 Enter/Space 可操作。
- [ ] Subagent Inspector 先加载 durable baseline，再从相同 Run sequence 续接 SSE；刷新、断线重连和 terminal closure 后与 Inline stream/trajectory 字节级 identity 一致。
- [ ] Artifact/file link 只使用 exact reference，预览支持既有 REPORT/SQL/TABLE/CHART/MARKDOWN renderer；unsupported/denied/hash mismatch 不回退 raw output。
- [ ] 1440x1000 和 390x844 浏览器截图无重叠、裁切或横向溢出，reduced motion 下无持续动画。
- [ ] Worker/Web/contracts focused tests、typecheck、Biome、migration renderer/static 与浏览器实际运行验证通过。

## Out of Scope

- 不展示 private chain-of-thought、provider `reasoning_content`、原始 prompt/context 或凭据。
- 不复制 Harness 的通用多级子会话目录、token 计费面板、无限递归 lineage 或品牌视觉。
- 不照搬 Harness 的宿主本地 `openFile`，不允许浏览器预览 Workspace 之外的任意路径。
- 不展示 Screenshot 中可能来自模型的原始 Think 文本；只展示 Data Agent 生成并通过严格合同的公共摘要。
- 不把本地 optimistic 状态、SSE 连接状态或“正在生成回答”当作 Agent authority。
- 不把 `createResearchWorkflowExecutor` 当作 Team runtime fallback，也不把 Falcon benchmark runner 接入生产请求。

## Delivery Map

1. `08-18-team-agent-status-contract`：公开 Agent/Tool identity 事件、PostgreSQL/SSE 合同。
2. `08-18-production-qa-team-runtime`：真实 Team Store/Mastra/domain tool/Artifact/Acceptance 纵向切片。
3. `08-18-qa-team-agent-status-ui`：deterministic assembler、回答内 status rail、右侧 Subagent/Artifact Inspector、轨迹定位与视觉验证。

三个 child 按顺序交付；父任务最后执行跨层浏览器与真实 Provider 集成验收。
