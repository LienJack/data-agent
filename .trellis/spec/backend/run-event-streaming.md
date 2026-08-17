# Run 公开事件流

> Q&A 对话过程与轨迹必须由同一条 PostgreSQL `run_events` 追加日志派生。交互职责明确参考
> `deepseek-harness` 的 `ReasoningRow`、`ToolRow` 与 `TrajectorySnapshotBuilder`，但不复制其
> 源码、样式资产、依赖或另建一套客户端状态机。

## 场景：对话实时过程与对话级轨迹

### 1. Scope / Trigger

- Worker 新增用户可见的阶段进度、工具边界或回答增量时适用。
- Web 新增 Run SSE 消费者或按 Conversation 聚合轨迹时适用。
- “Think”只表示可审计的阶段摘要；隐藏模型推理、System Prompt 与 Raw Memory 不属于公开事件。

### 2. Signatures

```ts
type PublicRunEvent =
  | { type: "lifecycle"; run_id: string; sequence: number; payload: LifecyclePayload }
  | { type: "progress"; run_id: string; sequence: number; payload: ProgressPayload }
  | { type: "reasoning"; run_id: string; sequence: number; payload: ReasoningSummaryPayload }
  | { type: "tool"; run_id: string; sequence: number; payload: ToolPayload }
  | { type: "answer"; run_id: string; sequence: number; payload: { delta: string } }
  | { type: "terminal"; run_id: string; sequence: number; payload: TerminalPayload };

GET /api/workspaces/:workspaceId/runs/:runId/events/stream?cursor=:sequence
Last-Event-ID: :sequence

GET /api/workspaces/:workspaceId/qa/conversations/:conversationId/trajectory
-> { data: ConversationTrajectory }
```

- `RunEventStorePort.listEvents({ scope, run_id, after_sequence, limit })` 是两条读取路径的共同来源。
- `PostgresWorkspaceDataRepository.listRunBindingsForConversation(...)` 只在 Workspace `READ`
  capability 下返回当前 Conversation 绑定的 Run。

### 3. Contracts

- `sequence` 是单 Run 唯一恢复游标；SSE `id` 必须等于公开事件 `sequence`。
- 合法 `Last-Event-ID` 优先于 query cursor；非法值回退到合法 query cursor，再回退到 `0`。
- SSE 逐页补发后持续轮询；发送 `terminal` 后关闭。游标已越过终态时通过 Projection 兜底关闭。
- `PublicRunEvent` 与 `ConversationTrajectory` 必须由 `@data-agent/contracts` 的 Zod Schema 解析。
- display event 只允许严格、扁平、定长字段；写 `run_events` 前清理 Credential、Authorization、
  Connection Userinfo、Token 形态及 System Prompt 标记。
- 前端以 `(run_id, sequence)` 去重。Chat 的 Process Row 和 Trajectory 必须共享同一事件数组。
- 工具开始与完成通过 `call_id` 合并；安全 Input 来自 Start，Output/Duration/Status 来自终结事件。
- 公开思考摘要通过 `block_id` 合并，固定 `START -> DELTA* -> END`。这些文本只能由应用根据已验证阶段生成，
  不接受 Provider `reasoning_content`、raw chain-of-thought 或 System Prompt。
- `run.reasoning_*`、`run.tool_*`、`run.progress` 与 `run.answer_delta` 只能在活动 Lease/Fence 下追加；数据库
  exact-key 校验载荷，并只推进 Projection version/event cursor，不能改变 `RUNNING` Authority 状态。
- 最终 Agent Message 使用 `run_id` 作为确定性 `message_id`，终态后只执行一次持久化。
- 所有 Workspace `READ` 成员可查看完整的非敏感、已策展 Input/Output；未知嵌套 Provider 对象、
  SQL Result Row、Prompt 全文和 Credential 不得作为 display event 输入。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 未知 event type / 未知 payload 字段 | Zod Parse 失败，不进入 UI |
| reasoning payload 含 `reasoning_content` 或其他未知字段 | Contract/数据库 exact-key 校验失败 |
| display event 不在 `RUNNING` 或 Fence 过期 | `RUN_EVENT_TRANSITION_INVALID` 或 Fence Error |
| 同幂等键对应不同 payload | `RUN_DISPLAY_EVENT_REPLAY_MISMATCH` |
| 输入含已知 Secret 形态 | 写库前替换为 `[REDACTED]` |
| Run / Conversation 不属于当前 Workspace | `WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED`，不泄露存在性 |
| SSE 断线 | 客户端从最后 sequence 重连并去重 |
| SSE 异常但 Run 已终态 | GET Projection 兜底生成最终非问题复述文案 |
| Run 取消且工具未完成 | UI 派生 `INTERRUPTED`，不伪造 Tool Result |
| Run 失败/取消且思考块未 END | UI 派生 `FAILED/INTERRUPTED`，不伪造完整摘要 |

### 5. Good / Base / Bad Cases

- Good：Worker 在真实操作前后追加 `tool_started/tool_completed`，同一事件链同时驱动折叠行和轨迹。
- Base：旧 Run 只有 lifecycle/terminal；轨迹仍可回放，对话不显示空工具卡。
- Bad：组件接收 `unknown` 后使用类型断言，或另建一个仅存在内存中的“轨迹状态”。
- Bad：把 Chain-of-Thought、Provider Request、SQL Rows 或原始工具对象序列化进 `run_events`。

### 6. Tests Required

- Contract：新增事件合法 Parse、未知事件失败、非法状态迁移和 Secret Fixture。
- Worker：成功/失败 display event、写前脱敏、同 Attempt 幂等重放。
- PostgreSQL 17：display payload exact-key、活动 Lease/Fence、Reducer 保持 `RUNNING`、私有推理字段拒绝。
- Platform/API：Conversation Run binding 的 READ/越权；`after_sequence` 缺口回放上限。
- Web：SSE Schema Parse、`Last-Event-ID` 优先级、sequence 去重、回答增量排序。
- UI：Reasoning/Tool 默认折叠、原生 Button 键盘语义、失败/中断、长输出滚动。
- Trajectory：按用户问题与 Run 分组、Duration/Turns/Calls、`runId + sequence` 双向定位。

### 7. Wrong vs Correct

#### Wrong

```ts
onEvent(JSON.parse(frame) as RunEvent);
setTrajectory(buildSeparateInMemoryTrace(providerCallbacks));
```

#### Correct

```ts
const event = publicRunEventSchema.parse(JSON.parse(frame));
setEvents((current) => mergePublicRunEvents(current, [event]));

const processRows = assembleProcessRows(events, runId);
const trajectory = groupTrajectoryEvents(events);
```

## 场景：Semantic Authoring 独立公开轨迹

### 1. Scope / Trigger

- Semantic Studio 创建 Authoring Run 后进入独立 Run 页面时适用。
- 内部 `SemanticAuthoringState` 含 working graph、checkpoint、provider request 和 tool result；这些
  字段不得作为浏览器响应。服务端必须先构建严格、脱敏的 public feed。

### 2. Signatures

```text
GET /api/workspaces/:workspaceId/semantic/studio/authoring-runs/:runId/feed
  ?semanticDomain=:domain&after=:sequence

GET /api/workspaces/:workspaceId/semantic/studio/authoring-runs/:runId/feed/events
Last-Event-ID: :sequence

POST /api/workspaces/:workspaceId/semantic/studio/authoring-runs/:runId/resume
```

```ts
type SemanticAuthoringPublicFeed = {
  schema_version: "semantic-authoring-public-feed@1.0.0";
  run: PublicRunMetadata;
  messages: Array<{ message_id: string; role: "user" | "assistant"; content: string }>;
  pending_tools: Array<{ call_id: string; tool_name: string }>;
  events: SemanticAuthoringPublicEvent[];
};
```

### 3. Contracts

- `buildSemanticAuthoringPublicFeed` 只能在服务端接收内部 State；Tool message、Tool arguments、完整
  working graph 和 pending provider request 必须丢弃。
- 用户首条消息只保留 `用户原始意图` 后的内容；选区上下文是内部定位信息，不进入 Feed。
- USER/ASSISTANT 文本经过 `redactPublicDisplayText`；Tool 只输出 `call_id/tool_name` 与已持久化的安全
  event summary，不输出 checkpoint tool JSON。
- `QUEUED` 只在 PostgreSQL `event_sequence === 0` 且 Run 仍为 `RUNNING` 时派生；不能根据一次增量
  查询返回空 events 判定，否则 SSE cursor 前进后会错误回退到排队状态。
- 初始 GET 回放完整 feed；SSE 只增量返回 `after` 之后的事件。前端合并时以 sequence 去重，同时使用
  最新 Run metadata/messages/pending tools。
- Run 终态后服务端和浏览器都关闭 EventSource。10 秒无事件只显示“等待执行器”提示，不修改权威状态。
- Parent Semantic Studio 和独立轨迹页的浏览器 DTO 都只保留公开 Run metadata；服务端可继续使用内部
  working graph 构建既有 Candidate read projection。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 非法 `workspaceId/runId/domain/after` | 稳定输入错误，不执行 Store 查询 |
| Run 不存在、越权或 domain 不匹配 | `SEMANTIC_STUDIO_RUN_NOT_FOUND_OR_DENIED`，不泄露对象存在性 |
| Feed/Event 未通过严格 Zod Parse | 客户端显示错误/重连，不使用类型断言继续渲染 |
| SSE 断线 | 从最后 event sequence 重连并去重 |
| 当前无新增 event | 保留最新 Run 状态；不得从 RUNNING 回退为 QUEUED |
| 文本命中 Credential/System Prompt 模式 | public feed 中替换为 `[REDACTED]` |
| Worker 尚未领取 | 页面显示排队，阈值后显示非权威等待提示 |
| Run terminal | 关闭 SSE，保留完整回放与 Candidate-only 文案 |

### 5. Good / Base / Bad Cases

- Good：服务端从权威 Store 加载 State 和 events，投影为 public feed，独立页面用同一 Feed 渲染对话、
  pending tool 和执行事件。
- Base：旧 Run 没有公开 assistant 文本；页面仍显示用户意图、状态和已有事件，不构造私有推理。
- Bad：把 `SemanticAuthoringState` 或 `checkpoint.messages` 直接作为 Route JSON 返回浏览器。
- Bad：SSE 每次增量 events 为空时把 Run 重新标记为 QUEUED。

### 6. Tests Required

- Projection unit：剥离选区上下文，保留 USER/ASSISTANT，排除 Tool JSON/arguments，并验证 Secret fixture。
- Route：`semanticDomain/after/runId` 绑定到 scoped service；SSE 恢复和 terminal close。
- Client：public feed 严格 parse，按 sequence 去重，terminal 主动关闭 EventSource。
- UI：排队、等待执行器、运行、澄清、完成、失败、重连；桌面双栏与窄屏侧栏折叠。
- Build：Next production build 必须收录 Run page、Feed GET 和 Feed SSE route。

### 7. Wrong vs Correct

#### Wrong

```ts
return NextResponse.json({ data: semanticAuthoringState });
const queued = incrementalEvents.length === 0;
```

#### Correct

```ts
const feed = buildSemanticAuthoringPublicFeed(state, incrementalEvents);
return NextResponse.json({ data: semanticAuthoringPublicFeedSchema.parse(feed) });

const queued = state.run.status === "RUNNING" && state.event_sequence === 0;
```
