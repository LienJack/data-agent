# 轨迹字段内容化清单

> 原则：内容在前，ID/revision/hash 只放“身份与来源”；没有冻结历史名称时明确 unavailable，禁止回查当前 Catalog 冒充历史事实。

| 对象 | 旧展示 | 应展示的内容 | 权威来源 | 不可用处理 |
| --- | --- | --- | --- | --- |
| Run | Run ID | 用户问题、权威状态、创建/更新时间、active attempt、worker fence | `runs` + latest `run_projections` | 没有 active attempt 时明确说明 |
| Conversation | Conversation ID | 对话标题与返回原会话入口 | immutable `workspace_run_bindings` + owner `qa_conversations` | 无 binding/标题分别说明 |
| Effective Config | Config ID/hash | Provider、model、profile version、提交时间、各资源 exact revision | `effective_run_config_receipts.effective_config_json` | 未冻结资源显示名时 `HISTORICAL_DISPLAY_NAME_UNAVAILABLE` |
| Lifecycle | event ID | 生命周期名称、用户问题、权威 Run 状态、公共事件说明 | verified Public Run Event + Run authority | 无公共说明时 `PUBLIC_CONTENT_UNAVAILABLE` |
| Progress | event ID | 阶段、标题、公开摘要 | verified Public Run Event | 禁止 provider reasoning/raw context |
| Reasoning | block ID | 公共标题、DELTA 摘要、END 总结与耗时 | 同 Run exact `block_id` 事件组 | 未结束显示 incomplete，不伪造完成 |
| Tool | call ID | tool 名、公开输入、公开输出/错误、Agent/Task 归属、耗时、Artifact 内容入口 | 同 Run exact `call_id` 事件组 | 没有结果时显示稳定非成功状态 |
| Agent | profile/task ID | Agent 名、公开 phase/title/summary/error、起止时间与结果摘要 | 同 Run exact `profile_id + task_id` 事件组 | `task_id=null` 不绑定“最近任务” |
| Answer | event ID | 公开答案正文增量 | verified Public Run Event | 不暴露生成内部状态 |
| Terminal | event ID | 最终状态、公共总结、错误码 | verified Public Run Event + Run authority | 与断线状态分离 |
| Artifact | Artifact ID/hash | 安全 preview 正文；列表摘要显示 SQL、报告标题、行列、图表标题或 verifier 摘要 | exact `ArtifactReference` + verified committed document + `ArtifactPreviewPanel` | denied/unsupported/stale/hash mismatch 均禁止 raw fallback |
| SQL | SQL Artifact ID | SQL 正文、dialect、Compiler、执行/证据/结果 preview、原会话入口 | exact Artifact refs + SQL history receipt | 参数、未授权 rows、连接信息不进入历史列表 |
| Team Task | task/profile/hash | goal revision、执行 bounds、required outputs、输入 Artifact refs、context epoch、完成输出、验收结论 | hash-verified `agent_team_tasks.task_json` + completion/acceptance receipts | v1 历史投影显示内容 unavailable |
| Handoff | handoff/request hash | 父子 Agent 关系、子任务 required outputs、收窄后的 bounds、时间 | verified `handoff_json.child_task` | 不展示 capability、完整 command、prompt |
| Context Epoch | epoch/build hash | phase、revision、obligation total/open/unknown/resolved | verified `epoch_json.proposed_obligations` | 不展示 raw context body/subject material |
| Verifier | decision hash | 七项 PASS/FAIL/UNVERIFIED、semantic status、decided time | verified `decision_json` | 不以“已提交决定”代替决定内容 |
| Acceptance | acceptance hash | ACCEPTED/REJECTED、reason、accepted time | verified acceptance receipt | `completed` 不映射为 `accepted` |
| Schema Snapshot | resource ID/hash | 通过 exact Artifact preview 显示表/字段/版本；没有 Artifact ref 时仅说明不可用 | Effective Config binding + exact Artifact | 禁止按 ID 查询 latest snapshot |
| Resolved Context | receipt/hash | 公共 coverage/obligation 摘要或 exact 可预览 Artifact | audited public projection / exact Artifact | 当前没有安全公共投影时 `FORBIDDEN/UNAVAILABLE`，禁止直读 authority JSON |

## 已落地的本轮变化

- `resolution-trace-detail@2.0.0` 给每个节点增加内容优先 Run/Conversation/Frozen Model 上下文。
- Artifact 派生节点的行内摘要由“type + revision”升级为经过验证的 SQL、报告、表格、图表或验证内容摘要；Inspector 仍使用 exact preview。
- `agent-team-public-trace@2.0.0` 增加 Task/Handoff/Epoch/Verifier/Acceptance 的公共内容 allowlist，并保留 v1 解析兼容。
- 新 owner-only RPC 先调用 v1 完成关系/文档/hash 校验，再投影 v2；public 无执行权限。

## 明确禁止内容

chain-of-thought、`reasoning_content`、system prompt、raw resolved context、Provider 原始请求/响应、SecretRef、Bearer material、连接串、未授权 SQL 参数/rows、Team capability 与完整 command。
