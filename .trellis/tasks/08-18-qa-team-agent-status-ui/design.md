# Q&A Team Agent Status UI Design

## Component Model

```ts
type ConversationActivityBlock =
  | { kind: "text"; id: string; sequence: number; content: string }
  | { kind: "reasoning"; id: string; sequence: number; row: ProcessRow }
  | { kind: "tool"; id: string; sequence: number; row: ProcessRow }
  | { kind: "agent"; id: string; sequence: number; agent: TeamAgentView };

type QAInspectorTarget =
  | {
      kind: "subagent";
      runId: string;
      profileId: AgentSpecialistProfileId;
      taskId: string;
      anchorSequence: number;
    }
  | {
      kind: "artifact";
      runId: string;
      reference: ArtifactReference;
      anchorSequence: number;
    };
```

`ConversationActivityStream` 只接收解析后的 blocks；Subagent block 展开后渲染其归属 Tool rows；正文 text block
使用现有 answer typography。`QAInspector` 只持有 target selection，详情从 QA store 中的 parsed events 或 Artifact
Preview API 派生，不维护第二份 Agent lifecycle 状态。

Assembler/snapshot 作为 surface-neutral projection core：输入严格 Public Run DTO，输出稳定 block/snapshot，不读取
React context、DOM、浏览器 `EventSource`、Wails 或终端状态。Web hook/store 负责把 REST/SSE transport 适配成该输入。

## Layout

- Think row：Brain icon + `Think` + truncated public summary。
- Tool row：工具 icon + tool name + artifact/path/result summary。
- Subagent row：Agent/Profile icon + specialist label + current phase/status；children 使用单层缩进线。
- Artifact/file：只渲染有 exact `ArtifactReference` 的可点击文本；路径状摘要没有 preview affordance。
- 状态色：pending neutral、running amber/accent、completed emerald、skipped muted、failed/blocked red、interrupted orange。
- 状态仍靠文字和 `aria-live`，不只靠颜色；390px 摘要换行且 status 不挤出容器。

## Interaction Model

- 每个 activity row 使用兄弟控件，避免 nested interactive：Disclosure control 负责展开，Entity link 负责 Inspector selection。
- PENDING row 若尚无 durable `task_id`，Entity link 为不可用说明态；不得让 Inspector 自动跟随同 profile 的“最近任务”。
- 点击/Enter 激活 Subagent 名称或 Artifact link 后打开 Inspector；Space 遵循原生 button/link 语义。关闭后焦点回到触发控件。
- Inspector header 显示类型、稳定 identity、权威状态、耗时和关闭按钮；提供“在轨迹中查看” deep-link。
- Subagent tab 显示 `Overview / Live events / Artifacts`：baseline 来自已加载 replay，live events 只追加更大 sequence 并显示独立连接状态“实时/重连中/已结束”。连接状态不得覆盖 Agent authority status。
- Artifact tab 复用 `ArtifactWorkspace` 的 REPORT/SQL/TABLE/CHART/MARKDOWN 安全 renderer，不展示 raw object 或 filesystem access。
- desktop 默认 360px、可调 320–520px；center 小于 640px 时自动收起右栏但保留 selection。mobile 在主内容区打开 sheet，不遮挡 Composer。

## Motion

只对 RUNNING 状态点使用 opacity pulse，对 disclosure caret 和 Inspector track 使用 transform；reduced motion 全部关闭。Inspector 打开不得重置中心文档滚动位置。

## Primary Code Reuse: DeepSeek Harness

DeepSeek Harness 固定 commit `47f943859bef60e4160492346772ded9b24f765a` 是 UI 实现的主要源码基线。
实现时优先复制/裁剪/改造以下代码与测试结构，不以“保持项目独立”为由全部重写：

- `AppFrame.tsx`、`columns.ts`、`stores.ts`：移植 sidebar/center/details 让步链、resize、selection preference。
- `DetailsPanel.tsx`、`tool-node-reader.ts`：移植“selection in store、material from snapshot”边界。
- `conversation-assembler.ts`、`chat-snapshot-builder.ts`、`trajectory-snapshot-builder.ts`：移植 keyed incremental projection。
- `ReasoningRow.tsx`、`ToolRow.tsx`、Disclosure primitives：移植折叠、状态、键盘、reduced-motion 结构。
- `SessionManager/Session`、`SubagentCatalogAction.tsx`：移植 durable baseline + live increment、状态/耗时/诊断。
- 对应 client specs 与 Web E2E：优先改写 fixture/断言，不从零发明另一套测试语义。

移植后替换 Cordis/plugin shares、SessionEvent、host `openFile`、品牌 token、多级 lineage 和私有 payload；接入
Data Agent 的 `PublicRunEvent`、QA store、Workspace RBAC、Artifact Preview、Phosphor icons 与一层 Team depth。
实质性复制保留 DeepSeek MIT notice 和 modified-source 记录。

## Secondary Architecture Reference: Reasonix

Reasonix 固定 commit `668cdee703680530901c67ff3908a95b720ad0d2` 展示了同一个 control/event core 如何由
TUI、HTTP/SSE、Wails Desktop 与 ACP 分别适配。这里只采用两点：projection core 不依赖 surface，以及布局/连接
状态留在 surface-local store。HTTP/SSE、ACP、Wails 并不是同一种 wire protocol；本任务也不复制 Reasonix UI、
不创建 Desktop/TUI，只用 headless fixture 验证 Harness-derived assembler 可在 Web 之外消费同一 DTO。

## Codex Desktop Functional Target

Codex 桌面端是黑盒行为基准。目标不是外观截图近似，而是操作结果尽可能一致：事件插入正文、默认折叠、
点击文件/Artifact 打开右侧预览、点击 Subagent 打开持续更新的右栏、selection 切换、关闭/调宽、刷新恢复、
错误/中断/耗时、键盘和焦点返回。无法适用的本地文件系统与私有推理明确标为 ADAPTED/OUT_OF_SCOPE。

## Error Matrix

| Condition | UI behavior |
| --- | --- |
| SSE disconnected, Agent still RUNNING | Keep RUNNING authority; show separate reconnecting badge and resume from last sequence |
| Agent target absent after replay | Show stale target with close/trajectory actions; do not pick another Agent |
| PENDING Agent has `task_id=null` | Keep Inline disclosure; disable Inspector action with accessible reason |
| Artifact ref missing/unsupported | Non-success empty/error state; never parse Tool output as a file |
| Artifact scope/hash denied | Show public error code; never reveal existence or fallback body |
| Conversation/Run changed | Close stale Inspector and restore focus safely |
| desktop width cannot keep center >= 640px | Auto-collapse Inspector without deleting selection |
| surface adapter reconnects or changes envelope | Preserve Run/sequence authority; only adapter connection state may change |
