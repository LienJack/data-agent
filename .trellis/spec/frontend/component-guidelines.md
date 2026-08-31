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

- 一个 Assistant answer 使用一个语义化 `article`；执行活动与正文 section 按 Public Event sequence 穿插。
- Native button 是 disclosure 的键盘基线，必须暴露 `aria-expanded/aria-controls`；Inspector action 与 disclosure
  action 保持兄弟关系，禁止 nested button。
- 流式正文只对容器设置节流后的 `aria-busy`；不得把每个 token 作为 live-region 更新播报。
- 用户消息始终是纯文本；legacy Assistant、Report、Hypothesis 仍经过同一安全 Markdown renderer。
- Canvas 图表必须有可访问标题/说明和原生等价表；`summary`、分页按钮与 Inspector action 保持键盘可达。
- Artifact 表格与图表横轴复用 Contracts 的 `formatArtifactTableCell`，仅消费 server 派生并解析的 column display；月份按显式时区/粒度展示，NULL 保留为空，原值不改写且表格保留原值提示。不得从字符串/列名猜测日期、金额币种或百分比，也不使用浏览器默认时区解释业务月份。
- 多 measure LINE/BAR（含横向/贡献图）按 `y_keys` 逐项渲染命名分图，显式说明独立纵轴；不能把多 measure 数组作为 VChart 单条曲线的 yField，也不能把金额与比率静默放在同一数轴。仅真正的 `series_key` 启用系列图例，不展示内部默认 `line_N`。组件必须统一释放所有图实例，任一分图失败时不得声称整体 READY。
- 图表运行时是动态 client leaf；loading/error/empty 均有文本状态，`prefers-reduced-motion` 下不得依赖动画传递信息，effect 必须释放第三方实例。
- V3显式`facet_key`按原始分类值分面，再逐measure分图；保留原series、行序和NULL，不拼接或修改源列。面板名显示原分类标签/值，
  JSON tuple仅作稳定UI key；完整等价表不筛掉其他组。新分面须由`derived-analysis-chart@1.2.0`边界校验，不能从列名猜维度。
- 答案入口 Trace 验证必须在滚动后等待真实点击命中目标按钮；异步 Artifact 渲染和返回答案时的平滑定位可能再次改变位置。桌面、Run 切换和窄屏 smoke 共用同一可点击等待，持续遮挡失败关闭；禁止隐藏 Composer、强制点击或直接用 Trace URL 绕过入口。
- Q&A 活动身份必须区分 Root/Analysis/Semantic/Text2SQL/Report；未知 Profile 显示原标识，不得默认成 Report。Run 完成后遗留的非终态任务不得显示为运行中或伪造完成：有同任务失败 Tool 时保留失败，否则展示缺少完成证据的中断状态。QA gate 同时核验可见 Agent 标签、角色、终态和必需的已完成 Profile，不能仅检查 spinner。

---

## Common Mistakes

- 不要因空 children 显示“无工具”的 Agent placeholder；没有公开 Agent event 时不得出现 Agent DOM/target。
- 不要把 HTTP 409 一律当失败 Run。经过 schema/hash 校验的 adaptive `DEFERRED` receipt 显示 BLOCKED、
  public reason code 和 required capabilities，且不建立 SSE 或假 Subagent。
