# DeepSeek Harness Agent 状态设计参考

## 研究范围

- 来源：`/Users/lienli/Documents/GitHub/deepseek-harness`
- 固定提交：`47f943859bef60e4160492346772ded9b24f765a`
- 图谱：`.ua/knowledge-graph.json`，`analyzedAt=2026-08-14T10:18:20Z`
- Freshness：graph commit 与 HEAD 一致，committed/staged/unstaged/untracked 源码漂移均为空。
- 模式：窄范围设计参考，不输出完整架构文章或 appendix package。

## 核心结论

Harness 不只是架构灵感，也是本任务的主要源码基线。应优先移植其“事件是真相、assembler 是解释器、
snapshot 是 UI 输入”的三层实现、details 布局和相关测试，再把 identity、权限和 Artifact 边界替换为
Data Agent 合同；不应看完参考后从零重写一套近似状态机。

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

## 优先复用模式

1. **Keyed assembler，而非组件内 if/else**：Data Agent 应以 `profile_id + task_id` 合并 Agent status，
   由纯函数生成固定三 Agent projection。
2. **Running 与 settled 分仓**：运行中步骤、已完成结果和中断终态分别投影，避免刷新后把旧 running 留在 UI。
3. **状态点 + 二级摘要 + metrics**：首层只显示 Agent、状态、当前步骤、耗时；Tool/Artifact 进入展开区。
4. **边界驱动中断**：Run FAILED/CANCELLED 时把未终止 Agent 映射为 FAILED/INTERRUPTED，绝不显示 COMPLETED。
5. **有限层级改造**：可复用 Harness catalog/lineage 的状态、时序和键盘代码，但裁剪为 Data Agent 固定三专职 Agent 与一层 Tool/Artifact。

## 代价与边界

- 新增 UI 之前必须先有公开 Agent identity/status event，否则只能从 Tool input 字符串反解析，属于错误边界。
- Harness 的 `running` summary 有 live mux 来源；相关 merge/diagnostic UI 可以移植，但事件 source adapter 必须替换为 PostgreSQL/SSE authority。
- Token、模型请求详情和通用子会话导航不是本任务需求，加入会稀释 Q&A 主流程。
- 当前 Data Agent production Team runtime 是 unavailable stub。若不补 runtime，UI 必须把三个 Agent 标为
  `BLOCKED` 或未开始，不能用动画伪装执行。

## 对 Data Agent 的建议

新增 strict `run.agent_status` 事件，payload 至少包含 `profile_id`、`task_id|null`、`status`、
`phase`、`summary`、`duration_ms|null`、`error_code|null`。Worker 在任务边界发事件；Contracts 转为
`PublicRunEvent(type="agent")`；Web 通过 keyed assembler 得到 Agent 投影，并与 reasoning/tool/answer 按
sequence 穿插成 Inline activity stream；右侧 Inspector 只从相同 replay 派生更聚焦的 Agent/Artifact 详情。

## 2026-08-21 Understand Chat 复核：右侧 Inspector

本轮按 `understand-anything:understand-chat` 流程重新检查 `.ua/knowledge-graph.json`。图谱提交、当前 HEAD
均为 `47f943859bef60e4160492346772ded9b24f765a`，排除 `.ua/` 生成物后 committed/staged/unstaged/untracked
源码漂移均为空，因此以下结论可作为当前固定提交的设计证据。

### 相关子图

- `packages/client/ui-layout/src/client/AppFrame.tsx` -> `columns.ts` / `stores.ts`：三栏 shell 固定挂载
  sidebar/center/details；空间不足时 details 先缩小再自动归零，selection preference 不被覆盖。
- `packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx` -> `tool-node-reader.ts`：panel 从共享
  store 读取 selection，再从 session snapshot 查找 material；panel 自身不持有第二份 Tool event truth。
- `packages/client/runtime/src/client/sessions/session.ts` -> `conversation-assembler.ts`：Session 安装持久窗口，
  再接收实时事件并构建 snapshot。
- `packages/client/runtime/src/client/sessions/manager.ts` -> `ordered-baseline.ts` / `lineage.ts`：列表和
  subagent catalog 以 baseline 为基础，再应用 live mutation/notification。
- `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx`：只渲染 summary projection、running/done、
  duration 和诊断态，完整 child material 通过稳定 address 导航读取。
- `packages/client/ui-deliverables/src/client/ProducedFiles.tsx`：chip、测宽和可访问交互可以移植；产物 path 点击后
  调用宿主 `openFile` 的部分必须替换为 Data Agent ArtifactReference Preview。

### 对本方案的约束

1. Data Agent Inspector 只保存 `QAInspectorTarget` selection；Subagent 内容从同一组 parsed Public Run Events
   派生，Artifact 内容从已有 Workspace Preview API 派生，禁止建立第二份生命周期状态。
2. Subagent Inspector 使用 durable replay 作为 baseline，再从最后 Run sequence 接 SSE 增量；连接状态只能
   显示“实时/重连中/已结束”，不能推断 Agent authority。
3. 桌面采用可收起 details rail，空间不足时先保护中心回答列；移动端把 Inspector 放在 Composer 之上的内容区。
4. “文件”只指完整、已提交、可校验的 `ArtifactReference`。不复制 Harness `openFile(path)`，不从 Tool output
   或看似路径的字符串恢复 preview locator。

## 许可与来源记录

- 上游根许可证：MIT，`Copyright (c) 2026 DeepSeek`。
- 固定来源 commit：`47f943859bef60e4160492346772ded9b24f765a`。
- 允许复制、修改和合并源码；复制实质性部分时必须保留版权和 MIT permission notice。
- 实施前建立 source-reuse ledger，逐条记录 upstream path、Data Agent target、copied/adapted/reimplemented、
  修改摘要和测试证据。Codex 桌面端只记录黑盒功能对标，不登记为代码来源。
