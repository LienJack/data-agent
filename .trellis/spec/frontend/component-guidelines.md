# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

Data Agent 前端组件只格式化已经在边界解析完成的领域投影。对于运行工作台，报告、Trace、诊断和输出视图共享同一个 `RunProjection`，组件不得从原始事件或局部字符串重新解释交付状态。

### Convention: 单投影多视图

**What**: 一个 Run 的多个可视区域通过 props 或 store selector 读取同一个 `RunProjection`。中栏可以排版为报告，右栏可以派生 Trace DAG，但两者不能维护独立的运行状态。

**Why**: 防止报告显示“成功”而治理控制台仍是 `HOLD`，也避免 SSE 重放后不同区域使用不同游标或旧数据。

```tsx
// Correct: page owns the parsed projection and passes it to both views.
<AnalysisReportDocument projection={projection} />
<TaskConsole projection={projection} />

// Wrong: each component fetches events and locally guesses a terminal state.
<ReportFromRawEvents runId={runId} />
<TraceFromRawEvents runId={runId} />
```

**Authority rule**: `EvalResult.verdict === "PASS"` 只表示评测通过；它不能覆盖 `coreL2Verdict`、`attributionF9Status` 或 `fixtureEvidenceVerdict`。只要治理状态是 `HOLD` / `NOT_REGISTERED`，UI 就不能显示为已发布或可执行结论。

**Required checks**:

- 报告与 Trace 的标题、假设数、报告数来自同一投影。
- 评测 PASS + 治理 HOLD 时，正文和 Console 都保留 HOLD。
- Console 标签、节点展开和面板开合只改变视图状态，不修改 `RunProjection`。
- SVG 图标要么有可访问名称，要么明确 `aria-hidden="true"`。

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
