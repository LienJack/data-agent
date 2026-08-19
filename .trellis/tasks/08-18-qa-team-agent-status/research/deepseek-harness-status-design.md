# DeepSeek Harness Agent 状态设计参考

## 研究范围

- 来源：`/Users/lienli/Documents/GitHub/deepseek-harness`
- 固定提交：`47f943859bef60e4160492346772ded9b24f765a`
- 图谱：`.ua/knowledge-graph.json`，`analyzedAt=2026-08-14T10:18:20Z`
- Freshness：graph commit 与 HEAD 一致，committed/staged/unstaged/untracked 源码漂移均为空。
- 模式：窄范围设计参考，不输出完整架构文章或 appendix package。

## 核心结论

Harness 值得借鉴的不是某个状态组件，而是“事件是真相、assembler 是解释器、snapshot 是 UI 输入”的
三层结构。React 组件不会从分散的 `running`、tool result 或 stream-close 信号自行推断终态。

## 主流程

```text
durable session/tool/subagent events
  -> ConversationNodeDefinition keyed state machines
  -> ConversationNodeAssembler incremental replay
  -> ChatSnapshotBuilder / TrajectorySnapshotBuilder
  -> ReasoningRow / tool tree / SubagentCatalogAction
```

证据：

- `packages/client/runtime/src/client/sessions/conversation-assembler.ts`
  `ConversationNodeAssembler` 按 definition 匹配事件，管理依赖重放与 keyed 增量刷新。
- `packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts`
  把 running contribution、finalized contribution 和 partial assistant 分开索引，避免一个状态覆盖另一种真相。
- `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts`
  以 `callId` 构建 tool/call -> tool/result 状态机；中断由 turn/step durable boundary 投影，不由超时猜测。
- `packages/client/runtime/src/client/sessions/subagent-lineage.ts`
  `indexSubagentDescendants` 是纯投影，只从 retained summaries 计算 descendant/running counts，并处理 orphan/cycle。
- `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx`
  状态树展示 running/done/error、标题、模式、耗时、token；loading/error/diagnostic 是独立可见状态。
- `packages/client/ui-conversation/src/client/chat/ReasoningRow.tsx`
  流式状态只改变公开摘要行的 tail-follow 和状态点；完整内容仍通过 disclosure 展开。

## 可借鉴模式

1. **Keyed assembler，而非组件内 if/else**：Data Agent 应以 `profile_id + task_id` 合并 Agent status，
   由纯函数生成固定三 Agent projection。
2. **Running 与 settled 分仓**：运行中步骤、已完成结果和中断终态分别投影，避免刷新后把旧 running 留在 UI。
3. **状态点 + 二级摘要 + metrics**：首层只显示 Agent、状态、当前步骤、耗时；Tool/Artifact 进入展开区。
4. **边界驱动中断**：Run FAILED/CANCELLED 时把未终止 Agent 映射为 FAILED/INTERRUPTED，绝不显示 COMPLETED。
5. **有限层级**：Data Agent 固定三专职 Agent，没有必要复制 Harness 的递归 child catalog；一层 rail 更符合分析工作台。

## 代价与边界

- 新增 UI 之前必须先有公开 Agent identity/status event，否则只能从 Tool input 字符串反解析，属于错误边界。
- Harness 的 `running` summary 有 live mux 来源；Data Agent 必须坚持 PostgreSQL/SSE authority，不能直接照搬。
- Token、模型请求详情和通用子会话导航不是本任务需求，加入会稀释 Q&A 主流程。
- 当前 Data Agent production Team runtime 是 unavailable stub。若不补 runtime，UI 必须把三个 Agent 标为
  `BLOCKED` 或未开始，不能用动画伪装执行。

## 对 Data Agent 的建议

新增 strict `run.agent_status` 事件，payload 至少包含 `profile_id`、`task_id|null`、`status`、
`phase`、`summary`、`duration_ms|null`、`error_code|null`。Worker 在任务边界发事件；Contracts 转为
`PublicRunEvent(type="agent")`；Web 通过 `assembleAgentStatuses(events, runId)` 得到三项固定投影，并在
Agent answer 顶部渲染紧凑 orchestration rail。现有 `ProcessDisclosure` 继续承载通用 reasoning/tool 细节。
