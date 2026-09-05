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
  `falcon24StableTargetWaitScript(selector, requireHitTarget)` 按动画帧观察同一元素身份及矩形连续120ms不变，上限25秒。
  答案入口先用 `false` 等自然滚动稳定（允许暂时不在可点击区域），再执行原 `block:start` 定位和命中检查，最后用 `true`
  确认稳定且无遮挡后真实点击。搜索后的 Trace 节点同样用 `true` 等布局稳定；检查不写业务/DOM状态，不增加模型调用。
  禁止用单帧 `elementFromPoint`、固定 sleep 或命令的 `Done` 充当交互成功；点击后仍验证 exact Run/node/trace/detail hash。
  回归必须覆盖移动中、元素替换、遮挡消失、持续遮挡、零尺寸、disabled、视口外及有界超时，并检查定位前后两次等待的顺序。
- Q&A 活动身份必须区分 Root/Analysis/Semantic/Text2SQL/Report；未知 Profile 显示原标识，不得默认成 Report。Run 完成后遗留的非终态任务不得显示为运行中或伪造完成：有同任务失败 Tool 时保留失败，否则展示缺少完成证据的中断状态。QA gate 同时核验可见 Agent 标签、角色、终态和必需的已完成 Profile，不能仅检查 spinner。

---

## Common Mistakes

- 不要因空 children 显示“无工具”的 Agent placeholder；没有公开 Agent event 时不得出现 Agent DOM/target。
- 不要把 HTTP 409 一律当失败 Run。经过 schema/hash 校验的 adaptive `DEFERRED` receipt 显示 BLOCKED、
  public reason code 和 required capabilities，且不建立 SSE 或假 Subagent。

## QA Artifact 就绪观察

### 1. Scope / Trigger

终态答案入口与异步 Artifact 表格/图表不是同一个就绪信号。首次打开和刷新后都必须按当前题目的 rubric 等待。

### 2. Signatures

`falcon24QaObservationScript({ run_id, conversation_run_ids, table_required, chart_required }): string`
生成只读浏览器表达式；`observeFalcon24FourLayerQaUi` 的两次观察共用它，不新增提交、模型调用或服务。

### 3. Contracts

只在 `chat-run-${run_id}` 子树读取答案、表、图与 loading。按动画帧观察最多25秒；必需表须有尺寸，必需图须有尺寸且
`data-chart-render-state=READY`，答案有文本且无 active loader。只在观察结束读取一次 `/api/ready`，不逐帧请求服务。

### 4. Validation & Error Matrix

短暂缺失 → 等待；持续缺失/LOADING → 保留最后真实观察，原 QA 判定返回 `FALCON24_QA_UI_OBSERVATION_FAILED`。
已观察到 alert → 不等待其消失。Run、Agent 标签/角色/完成证据、Build、重复提交、横向溢出的原校验保持不变。

### 5. Good / Base / Bad

Good：终态入口先出现，随后当前 Run 的必需表就绪。Base：纯定义题无需表图，立即观察。
Bad：别的 Run 已有表、当前图仅挂载但未 READY、25秒后仍加载；这些不能满足当前题的要求。

### 6. Tests Required

VM 执行真实表达式覆盖延迟表/图、零尺寸、缺失 Run/答案、loader、持续缺失与 alert；门禁测试验证首次/刷新均携带 rubric，
并证明错误身份、Build、重复 Run、标签、溢出仍失败。真实浏览器只读复验不改写已封存 attempt，不能计入正式 PASS。

### 7. Wrong vs Correct

Wrong：`wait exact terminal entry → immediate table assertion`。Correct：`terminal entry → bounded current-Run Artifact readiness → unchanged QA validator`。
禁止固定 sleep、跨 Run 找表、取消 table/chart requirement 或重提业务请求来规避加载时序。
