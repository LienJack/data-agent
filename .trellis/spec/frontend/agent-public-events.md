# Agent Public Event Surfaces

## 1. Scope / Trigger

任何新增或修改 Agent 对话、执行轨迹、Team Trace、Semantic Agent 或 SSE 消费组件时使用本规范。目标是让用户看到可恢复的公开过程，同时禁止浏览器获得私有推理、原始上下文和凭据。

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
  status: "RUNNING" | "COMPLETED" | "FAILED";
  summary: string;
  error_code: string | null;
};

type SemanticThinkingStage = {
  type: "stage";
  payload: {
    phase: `semantic-turn-${number}`;
    status: "RUNNING" | "COMPLETED";
    summary: string;
  };
};

function assembleProcessRows(events: readonly PublicRunEvent[], runId: string): ProcessRow[];
function assembleSemanticAuthoringProcessEvents(
  events: readonly SemanticAuthoringPublicEvent[],
): readonly SemanticAuthoringPublicEvent[];
```

QA 使用 `/api/workspaces/:workspaceId/runs/:runId/events/stream`，并采用 `START/DELTA/END + block_id`；Semantic Authoring 使用 `/api/workspaces/:workspaceId/semantic/studio/authoring-runs/:runId/feed/events`，为兼容 PostgreSQL Authority 保留 `stage` 类型并用 `semantic-turn-* + RUNNING/COMPLETED` 表达同一公开思考折叠语义。两者都必须先由 Workspace 服务端边界鉴权。

## 3. Contracts

- QA reasoning 按 `block_id` 合并，Semantic thinking stage 按 `phase` 合并，tool 按 `call_id` 合并；SSE 重连后的 durable replay 必须得到同一展示结果。
- reasoning 只允许公开 `title/summary`。禁止 `reasoning_content`、private chain-of-thought、system prompt 和 raw context。
- tool 只显示公共输入/结果投影、状态、耗时和错误码；SecretRef、Bearer Material、Provider 原始请求/响应不得进入事件。
- reasoning 与 tool 默认折叠，按钮或原生 `summary` 必须可键盘操作并暴露 expanded state。
- `WorkspaceJourneyEvidenceArtifact` 是 Goal/CI proof，不是 Authority Receipt；只有 required checkpoint 全 PASS 且 artifact hash 有效时才是 `GO`。

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown event type or unknown payload field | Strict schema rejects the event |
| `reasoning_content`, raw context, system prompt or SecretRef present | Reject before browser projection |
| START without END when Run fails | Render the reasoning block as failed/incomplete, never completed |
| Tool RUNNING without terminal boundary | Keep one running disclosure after replay |
| Projection API fails | Render explicit alert/error code, not a successful empty state |
| `OUTCOME_UNKNOWN` | Show Reconcile only; no ordinary Retry |
| Journey checkpoint missing, duplicate or failed | Do not issue `GO` artifact |

## 5. Good / Base / Bad Cases

- Good: START + multiple DELTA + END reconstruct one collapsed reasoning disclosure; tool START/END reconstruct one collapsed tool disclosure.
- Base: a Run with no process event shows an explicit empty state and keeps the final answer contract unchanged.
- Bad: rendering model `reasoning_content`, exposing checkpoint tool messages, or treating `completed` as `accepted`.

## 6. Tests Required

- Contracts: strict reasoning schema rejects private fields; Journey Evidence verifies stable hash and required closure.
- Worker/Semantic: every Agent turn emits ordered START/DELTA/END public summaries and never copies provider reasoning.
- Web: replay grouping is deterministic; reasoning/tool controls start collapsed and expose keyboard semantics.
- Web: Chinese/English switching changes display text without pathname/query/hash or Workspace Store mutation.
- Browser: 1440px and 390px have no document horizontal overflow; language and disclosure controls work with Enter.

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
```
