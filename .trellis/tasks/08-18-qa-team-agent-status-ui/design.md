# Q&A Team Agent Status UI Design

## Component Model

```ts
type ConversationActivityBlock =
  | { kind: "text"; id: string; sequence: number; content: string }
  | { kind: "reasoning"; id: string; sequence: number; row: ProcessRow }
  | { kind: "tool"; id: string; sequence: number; row: ProcessRow }
  | { kind: "agent"; id: string; sequence: number; agent: TeamAgentView };
```

`ConversationActivityStream` 只接收解析后的 blocks；`ActivityDisclosureRow` 复用现有 `openTrajectory` 行为。
Subagent block 展开后渲染其归属 Tool rows；正文 text block 使用现有 answer typography。

## Layout

- Think row：Brain icon + `Think` + truncated public summary。
- Tool row：工具 icon + tool name + artifact/path/result summary。
- Subagent row：Agent/Profile icon + specialist label + current phase/status；children 使用单层缩进线。
- 状态色：pending neutral、running amber/accent、completed emerald、skipped muted、failed/blocked red、interrupted orange。
- 状态仍靠文字和 `aria-live`，不只靠颜色；390px 摘要换行且 status 不挤出容器。

## Motion

只对 RUNNING 状态点使用 opacity pulse，对 disclosure caret 使用 transform；reduced motion 全部关闭。

## Harness Adaptation

借鉴参考图的 inline Think/Tool 行，以及 Harness 的 StateDot、二级摘要、耗时和 keyed snapshot；不复制其
336px 浮层、多级 lineage、token metrics，也不展示原始 chain-of-thought。
