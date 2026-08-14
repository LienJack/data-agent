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
- 最终 Agent Message 使用 `run_id` 作为确定性 `message_id`，终态后只执行一次持久化。
- 所有 Workspace `READ` 成员可查看完整的非敏感、已策展 Input/Output；未知嵌套 Provider 对象、
  SQL Result Row、Prompt 全文和 Credential 不得作为 display event 输入。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 未知 event type / 未知 payload 字段 | Zod Parse 失败，不进入 UI |
| display event 不在 `RUNNING` 或 Fence 过期 | `RUN_EVENT_TRANSITION_INVALID` 或 Fence Error |
| 同幂等键对应不同 payload | `RUN_DISPLAY_EVENT_REPLAY_MISMATCH` |
| 输入含已知 Secret 形态 | 写库前替换为 `[REDACTED]` |
| Run / Conversation 不属于当前 Workspace | `WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED`，不泄露存在性 |
| SSE 断线 | 客户端从最后 sequence 重连并去重 |
| SSE 异常但 Run 已终态 | GET Projection 兜底生成最终非问题复述文案 |
| Run 取消且工具未完成 | UI 派生 `INTERRUPTED`，不伪造 Tool Result |

### 5. Good / Base / Bad Cases

- Good：Worker 在真实操作前后追加 `tool_started/tool_completed`，同一事件链同时驱动折叠行和轨迹。
- Base：旧 Run 只有 lifecycle/terminal；轨迹仍可回放，对话不显示空工具卡。
- Bad：组件接收 `unknown` 后使用类型断言，或另建一个仅存在内存中的“轨迹状态”。
- Bad：把 Chain-of-Thought、Provider Request、SQL Rows 或原始工具对象序列化进 `run_events`。

### 6. Tests Required

- Contract：新增事件合法 Parse、未知事件失败、非法状态迁移和 Secret Fixture。
- Worker：成功/失败 display event、写前脱敏、同 Attempt 幂等重放。
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
