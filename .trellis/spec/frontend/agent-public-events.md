# Agent Public Event Surfaces

## 1. Scope / Trigger

任何新增或修改 Agent 对话、执行轨迹、Team Trace、Semantic Agent、SSE 消费组件或未来 Desktop/TUI adapter
时使用本规范。目标是让用户看到可恢复的公开过程，同时禁止任何 surface 获得私有推理、原始上下文和凭据。

## 2. Signatures

```typescript
type PublicReasoning = {
  phase: "START" | "DELTA" | "END";
  block_id: string;
  title: string;
  summary: string | null;
};

type PublicTool = {
  call_id: string;
  tool_name: string;
  profile_id: AgentSpecialistProfileId | null;
  task_id: string | null;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  summary: string;
  error_code: string | null;
  artifact_refs: ArtifactReference[];
};

type PublicAgentStatus = {
  profile_id: AgentSpecialistProfileId;
  task_id: string | null; // null only while PENDING and not Inspector-addressable
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" |
    "INTERRUPTED" | "SKIPPED" | "BLOCKED";
  phase: string;
  title: string;
  summary: string;
  duration_ms: number | null;
  error_code: string | null;
};

type QAInspectorTarget =
  | { kind: "subagent"; runId: string; profileId: AgentSpecialistProfileId; taskId: string; anchorSequence: number }
  | { kind: "artifact"; runId: string; reference: ArtifactReference; anchorSequence: number };

type SemanticThinkingStage = {
  type: "stage";
  payload: {
    phase: `semantic-turn-${number}`;
    status: "RUNNING" | "COMPLETED";
    summary: string;
  };
};

function assembleProcessRows(events: readonly PublicRunEvent[], runId: string): ProcessRow[];
function assembleSubagentInspector(
  events: readonly PublicRunEvent[],
  target: Extract<QAInspectorTarget, { kind: "subagent" }>,
): SubagentInspectorSnapshot;
function assembleSemanticAuthoringProcessEvents(
  events: readonly SemanticAuthoringPublicEvent[],
): readonly SemanticAuthoringPublicEvent[];
```

QA 使用 `/api/workspaces/:workspaceId/runs/:runId/events/stream`，并采用 `START/DELTA/END + block_id`；Semantic Authoring 使用 `/api/workspaces/:workspaceId/semantic/studio/authoring-runs/:runId/feed/events`，为兼容 PostgreSQL Authority 保留 `stage` 类型并用 `semantic-turn-* + RUNNING/COMPLETED` 表达同一公开思考折叠语义。两者都必须先由 Workspace 服务端边界鉴权。

这些 REST/SSE endpoint 是当前 Web transport，不是 Public Run Protocol 本身。Protocol core 是严格 DTO、稳定
identity、replay/cursor/terminal 和 Inspector addressing；未来 surface 可用不同 transport，但必须保持这些语义。

## 3. Contracts

- QA reasoning 按 `block_id` 合并，Semantic thinking stage 按 `phase` 合并，tool 按 `call_id` 合并；SSE 重连后的 durable replay 必须得到同一展示结果。
- reasoning 只允许公开 `title/summary`。禁止 `reasoning_content`、private chain-of-thought、system prompt 和 raw context。
- tool 只显示公共输入/结果投影、状态、耗时和错误码；SecretRef、Bearer Material、Provider 原始请求/响应不得进入事件。
- Team tool 和 Agent status 以 exact `profile_id/task_id` 归属；Web 禁止从 input/output JSON 恢复 Agent identity。
- Inline disclosure 与 Inspector entity link 必须是兄弟控件：前者展开就地详情，后者选择 Subagent/Artifact；禁止 nested button。
- QA Inspector 只持有 `QAInspectorTarget` selection。Subagent material 从同一 Public Run Event replay 派生；
  Artifact material 从 Workspace Preview API 派生，禁止第二份 Agent lifecycle store。
- `task_id=null` 的 PENDING Agent 只允许 Inline disclosure；没有 durable task identity 时禁用 Inspector action，
  禁止按 profile 选择“最近任务”或自动绑定未来 task。
- Subagent Inspector 的 connection state 与 Agent authority 分离；断线只显示 reconnecting 并从最后 sequence
  续接，不得把 RUNNING 改为失败/完成。
- 只有完整 `ArtifactReference` 可渲染 file preview action；裸路径和 Tool output 中的 path-like 文本只作摘要。
- desktop 空间不足时先收起 Inspector，移动端 Inspector 不得遮挡 Composer；关闭后焦点返回触发项。
- UI 实现以 DeepSeek Harness 固定 commit `47f943859bef60e4160492346772ded9b24f765a` 为主要源码基线，
  优先移植 assembler/snapshot、ReasoningRow/ToolRow、AppFrame/details、Subagent baseline/live 与测试；
  替换 Cordis/SessionEvent/host openFile/品牌 token 为 Data Agent 边界，并保留 MIT 来源/修改记录。
- Codex 桌面端是黑盒功能基准；Inline 顺序、折叠、文件/Agent Inspector、面板生命周期、键盘和焦点必须进入
  `MATCH/ADAPTED/OUT_OF_SCOPE` 验收矩阵，禁止用静态视觉相似替代功能 proof。
- Reasonix 固定 commit `668cdee703680530901c67ff3908a95b720ad0d2` 只作为次级架构参考：共享 controller/event
  core 后接 TUI、HTTP/SSE、Wails、ACP adapter。它们不是同一 wire protocol；Web 仍是本任务唯一交付 surface。
- assembler/snapshot core 必须无 React、DOM、`EventSource` 或 host 依赖；Web hook/store 只负责 transport、selection、
  layout 和 connection state，不得推进 Agent/Run authority 或重选 Model/provider。
- reasoning 与 tool 默认折叠，按钮或原生 `summary` 必须可键盘操作并暴露 expanded state。
- `WorkspaceJourneyEvidenceArtifact` 是 Goal/CI proof，不是 Authority Receipt；只有 required checkpoint 全 PASS 且 artifact hash 有效时才是 `GO`。

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown event type or unknown payload field | Strict schema rejects the event |
| `reasoning_content`, raw context, system prompt or SecretRef present | Reject before browser projection |
| START without END when Run fails | Render the reasoning block as failed/incomplete, never completed |
| Tool RUNNING without terminal boundary | Keep one running disclosure after replay |
| Inspector SSE disconnects while Agent RUNNING | Keep RUNNING authority and show reconnecting separately |
| Subagent target is absent after replay | Show stale target; never select a different Agent |
| PENDING Agent has `task_id=null` | Keep Inline row and disable Inspector action with accessible reason |
| Artifact ref is absent, unsupported, denied or hash-mismatched | No raw output/path fallback; show explicit non-success state |
| Conversation or Run changes | Clear stale Inspector target and restore focus safely |
| Projection API fails | Render explicit alert/error code, not a successful empty state |
| `OUTCOME_UNKNOWN` | Show Reconcile only; no ordinary Retry |
| Journey checkpoint missing, duplicate or failed | Do not issue `GO` artifact |

## 5. Good / Base / Bad Cases

- Good: START + multiple DELTA + END reconstruct one collapsed reasoning disclosure; tool START/END reconstruct one collapsed tool disclosure.
- Good: selecting a Subagent derives baseline and live rows from the same event array used by Inline/trajectory.
- Good: selecting a committed Artifact ref opens the existing safe preview renderer for the same revision/hash.
- Base: a Run with no process event shows an explicit empty state and keeps the final answer contract unchanged.
- Base: a legacy Run without Artifact refs remains readable but has no synthetic file preview action.
- Bad: rendering model `reasoning_content`, exposing checkpoint tool messages, treating `completed` as `accepted`,
  or opening a path parsed from Tool output.
- Bad: rebuilding a parallel UI state machine when the pinned Harness implementation can be adapted, or copying it
  without upstream path/commit/MIT/modified-source records.
- Bad: tying the projection core to browser `EventSource`, or creating separate lifecycle truth for Web/Desktop/TUI.

## 6. Tests Required

- Contracts: strict reasoning schema rejects private fields; Journey Evidence verifies stable hash and required closure.
- Worker/Semantic: every Agent turn emits ordered START/DELTA/END public summaries and never copies provider reasoning.
- Web: replay grouping is deterministic; reasoning/tool controls start collapsed and expose keyboard semantics.
- Web: Inspector target schema/URL restore, baseline + SSE merge, stale target, cross-Run cleanup and focus return.
- Web/API: Artifact Preview exact Workspace/scope/run/revision/hash, unsupported/denied/hash mismatch and no raw fallback.
- Web: Chinese/English switching changes display text without pathname/query/hash or Workspace Store mutation.
- Browser: 1440px and 390px have no document horizontal overflow; language and disclosure controls work with Enter.
- Browser: Codex parity matrix covers Inspector open/switch/resize/close/restore and Subagent live updates with proof.
- Provenance: every copied/adapted Harness source and test has an upstream/target mapping plus retained MIT notice.
- Multi-surface conformance: the Web adapter and a headless adapter process the same fixture into identical block/Inspector
  identity, cursor and terminal state; actual Desktop/TUI/ACP delivery remains out of scope.

## 7. Wrong vs Correct

```typescript
// Wrong: forwards provider internals and makes transient stream state authoritative.
emit({ type: "reasoning", reasoning_content: provider.reasoning });
setCompleted(streamClosed);

// Correct: emits a bounded public summary and rebuilds from durable events.
emit({
  type: "reasoning",
  payload: {
    phase: "DELTA",
    block_id: `semantic-turn-${turn}`,
    title: `Planning turn ${turn}`,
    summary: `Selected ${toolCalls.length} governed tool calls.`,
  },
});
const rows = assembleProcessRows(replayedEvents, runId);
const inspector = assembleSubagentInspector(replayedEvents, selectedAgent);
const preview = await fetchArtifactPreview(selectedArtifact.reference);
```
