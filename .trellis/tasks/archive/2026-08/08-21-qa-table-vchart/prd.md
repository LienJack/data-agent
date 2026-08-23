# Governed Table and VChart Answers

## Goal

让对话分析在回答引用受治理结构化结果时，按事件顺序直接展示可分页表格或受控 VChart 图表；刷新、SSE 重连和打开右侧 Inspector 后，用户仍看到同一个已提交 Artifact revision/hash，而不是模型临时拼装的数据或图表配置。

用户价值是：回答既保留 DeepSeek Harness / Reasonix 风格的过程文档流，又具备 Data Foundry 式的数据阅读能力；只有数据形态和问题意图确实适合时才画图。

## Confirmed Baseline

- `ArtifactWorkspaceProjection` 已有 `TABLE` 和旧版 `CHART`，`ArtifactPreviewResult` 已绑定完整 `ArtifactReference`、renderer version、窗口和截断状态。
- 当前 `CHART` UI 只是键值列表；Web 尚未安装 VChart。2026-08-22 查得官方 `@visactor/vchart` 当前版本为 `2.1.6`。真实 React 19 验收中官方 React wrapper 未能建立容器，因此实现锁定 Core 的 `vchart-simple` 入口并显式管理实例生命周期。
- `QueryEvidence` 已作为已提交 Product Team Artifact 保存，Artifact preview API 会重新校验 exact scope/run/revision/hash。
- Worker 当前一次 Tool 调用只返回一个 output ref；Tool public event 也只公开该引用。这不足以同时保留 `QueryEvidence` 为验收输出、再公开一个派生 CHART Artifact。
- 自适应调度 planner 能看到原始问题，Worker 只消费冻结后的 dispatch plan。可视化意图必须在 admission 时确定性分类并进入冻结计划的公开 reason code，不能让 Worker 重新猜测原问题。
- Q&A activity assembler 已按 public event sequence 重放正文、Think、Tool 和真实 Subagent；Inline Artifact 与 Inspector 应复用同一 preview renderer，而不是维护第二套数据状态。
- 现有授权导出链为异步 `ARTIFACT_EXPORT` Job；本任务不得绕过其写权限、receipt 与 output hash。

## Requirements

### R1 — Artifact authority is the only data source

Inline 和 Inspector 只消费通过 strict schema/hash 校验的 `ArtifactPreviewResult`。禁止从模型正文、Tool `output` 字符串、任意 JSON、远程 URL 或客户端临时行生成 TABLE/CHART。

### R2 — Versioned chart contract

保留现有 `artifact-workspace-document@1.0.0`、`artifact-preview-result@1.0.0` 和旧 CHART 解码行为；新增版本化的 V2 Chart document/preview 分支，不在 V1 strict schema 中偷偷加字段。

V2 CHART 至少包含：`LINE | BAR | PIE`、标题、可选说明、单位、受控字段绑定、legend 策略、等价 table、QueryEvidence source ref、确定性 transform version、dataset hash、冻结 Resolved Context package/receipt identity。所有字符串均为纯文本。

### R3 — Deterministic visualization intent

Admission planner 按问题文本产生冻结的可视化 reason code：

- 明确时间变化/趋势意图：`DATA_QUERY_TREND_VISUALIZATION`；
- 排名、类别比较意图：`DATA_QUERY_COMPARISON_VISUALIZATION`；
- 占比、构成意图：`DATA_QUERY_COMPOSITION_VISUALIZATION`；
- 其余问题不产生可视化 reason code。

Reason code 只能建议派生类型，最终仍须由 QueryEvidence 列类型、行数、null、非负值和基数规则批准。模型不能直接提供或批准 VChart spec。

### R4 — Chart eligibility and deterministic fallback

- LINE：至少 2 个、最多 100 个稳定排序的时间/有序类别点，至少一个 finite numeric series；
- BAR：2–30 个类别，1–4 个 finite numeric series；
- PIE：2–12 个类别，恰好一个非负 finite numeric series，合计值大于 0；
- 标题最多 160 字，label 最多 200 字，series 最多 4，单序列 points 最多 100，规范 payload 最多 256 KiB；
- 不满足意图与数据形态闭包、空数据、全 null、超限或不支持类型时，不生成 CHART Artifact，仍保留 TABLE；构造/预览伪造或超限的 V2 Chart 时稳定拒绝，公开 `CHART_DATA_LIMIT_EXCEEDED` 或对应 strict contract error；
- 首个真实纵向路径覆盖“月度订单趋势” LINE；BAR/PIE 在相同权威投影内完成合同、投影和 renderer 测试，后续查询模板可以复用。

### R5 — Separate accepted output from public artifacts

Worker Tool 结果区分：

- `output_ref`：专职任务 Completion/Acceptance 消费的唯一输出，例如 `QueryEvidence`；
- `public_artifact_refs`：该 Tool 完成事件可展示的已提交引用列表，例如 `[QueryEvidence, ArtifactWorkspaceDocument(CHART)]`。

公开列表必须唯一、同 scope/run、全部已经提交。可选 CHART 不得替换 QueryEvidence，也不得改变 Report 对 accepted evidence 的依赖。

### R6 — Inline sequence and Inspector parity

Assembler 在产生引用的 Tool COMPLETED sequence 后插入 TABLE/CHART Artifact activity block；不为 user message、未提交引用、未来 sequence 引用或没有 Artifact 的 Run 造占位块。

点击 Inline block 或 Artifact link 打开右侧 Inspector 时，必须解析相同 `artifact_id/type/revision/content_hash`。刷新和 SSE replay 后 block identity、顺序与 Inspector target 不变。

### R7 — Governed table behavior

- 显示列名、声明的数据类型、null、当前窗口、总行数与截断状态；
- 默认窗口不超过 100 行，使用受控 offset/limit 分页，不把最多 10,000 行一次塞进 DOM；
- 宽表只在组件内部横向滚动，390px 不造成 document 级横向溢出；
- 键盘可操作上一页/下一页；翻页请求仍携带同一 exact reference；
- 本任务不新增客户端 CSV/XLSX 合成或下载捷径；现有 Export Authority 与异步 Job route 保持不变并通过回归测试。新的授权导出入口留给 Job Center 工作流单独实施。

### R8 — Controlled VChart renderer

使用并锁定 `@visactor/vchart@2.1.6`，动态加载其 `vchart-simple` 入口。VChart 是最小 `'use client'` leaf，显式创建/释放 Core 实例，SSR/初始加载输出固定尺寸 skeleton。

Web 只从 V2 strict projection 构造本地常量 spec。禁止接受函数 formatter、事件 handler、HTML、任意 theme、外部数据 URL、脚本或模型提供的 raw VChart spec。首批交互仅允许 tooltip、legend 和本地 resize。

### R9 — Accessible equivalent data

每个图表必须有可键盘展开的“查看数据表”，内容与图中点完全一致；tooltip 不是唯一信息源。图表标题、说明、单位、截断状态通过可访问文本关联；空状态为文字。`prefers-reduced-motion` 下关闭非必要动画。

### R10 — Shared renderer and visual language

Inline 与 Inspector 复用 `ArtifactWorkspace` 及同一安全 chart/table leaf。数据阅读面保持近实色高对比度；本任务只为数据块使用克制的边框、层级和现有 token，不提前实施全站 Apple Glass，也不使用紫蓝 AI 渐变、霓虹或卡片堆叠。

### R11 — Deterministic errors and no raw fallback

`denied`、`stale`、`unsupported`、source identity mismatch、hash mismatch、invalid chart、limit exceeded、分页失败与 export failure 均显示公开稳定 code。任何失败都不能回退渲染数据库 document_json、Tool raw output 或模型正文中的数据。

### R12 — Compatibility and performance

- 历史 V1 TABLE/CHART/REPORT 继续可预览；旧 Run 不回填新 Chart Artifact；
- VChart 不进入 Q&A 首屏同步 chunk；无图表回答不下载 chart runtime；
- 图表 rerender 只由 exact preview/容器尺寸/reduced-motion 改变触发，不随整条 SSE token stream 重建；
- 1440x1000、1024x768、390x844 下 Artifact、Inspector 与 Composer 不重叠，无页面级横向溢出。

### R13 — Real vertical proof

至少以真实 Web + Worker + PostgreSQL + e-commerce sandbox 执行一次明确月度趋势问题，证明：planner 冻结趋势意图、Text2SQL 单 Subagent 执行、QueryEvidence 与派生 CHART 均提交、public event 按序公开两个引用、Inline 显示真实折线图与等价表、Inspector 打开同一 hash、刷新/replay 顺序不变。

## Acceptance Criteria

- [x] **AC1 / V2 authority**：V1 文档保持可解码；V2 Chart hash 覆盖 source ref、transform、dataset、resolved-context identity 和 projection。篡改任一字段都会失败。
- [x] **AC2 / Selection**：趋势/比较/构成 reason code 由 planner 确定性冻结；同一问题与 profile snapshot 重放得到同一 plan hash。无适用意图时不生成图表。
- [x] **AC3 / Shape gates**：LINE/BAR/PIE 的行数、series、值域、null、label、payload 上限均有正反测试；超限公开 `CHART_DATA_LIMIT_EXCEEDED`。
- [x] **AC4 / Accepted output**：Text2SQL Completion 仍验收 QueryEvidence；Chart Artifact 只是同 Tool 的附加公开已提交引用，Report 依赖链不变。
- [x] **AC5 / Sequence**：Artifact block 只出现在产生它的 Tool COMPLETED sequence 之后；SSE 重放、重复 frame、刷新不会改变顺序或重复 block。
- [x] **AC6 / Table**：真实 QueryEvidence 显示列、类型、null、总行数、窗口、截断和分页；宽表在 390px 仅局部滚动；翻页保持 exact reference。
- [x] **AC7 / Export boundary**：现有异步 Export Authority/route 回归通过；本任务没有新增客户端文件合成、未授权下载入口或虚假成功态。
- [x] **AC8 / VChart**：V2 LINE/BAR/PIE 由受控本地映射渲染；raw spec、函数、HTML、外部 URL 和未知 chart type 被 schema 或 mapper 拒绝。
- [x] **AC9 / Accessibility**：每个图表有等价“查看数据表”、明确标题/单位/空状态，键盘可达，reduced motion 关闭动画。
- [x] **AC10 / Parity**：Inline 与 Inspector 对同一 reference 渲染相同数据、dataset hash、revision、content hash、窗口和截断状态。
- [x] **AC11 / Failure closure**：denied/stale/unsupported/hash mismatch/limit exceeded/pagination/export error 均显示稳定公开状态且没有 raw fallback。
- [x] **AC12 / Bundle and responsive**：VChart Core 依赖锁定为 2.1.6；无 chart 页面不加载 VChart chunk；1440/1024/390 无 document 横向溢出或 Composer 遮挡。
- [x] **AC13 / Real vertical**：真实月度订单趋势 Run 产生 QueryEvidence + committed V2 Chart，Inline/Inspector/refresh/replay 证据和桌面/移动截图齐全。
- [x] **AC14 / Regression**：Contracts、Platform、Worker、Web focused tests、Web full unit/typecheck/build、相关 contract/migration gates 通过；不修改或纳入并行任务文件。

## Out of Scope

- 不实现任意拖拽 BI dashboard、用户自定义 chart builder、任意 SQL 或任意 VChart spec 执行。
- 不在本任务增加面积图、散点图、地图、3D、动画叙事或跨图联动。
- 不把旧 Run 回填为新 Chart Artifact，不迁移历史 V1 document。
- 不实现语义知识库、Conversation Folder、旧归因清理或全站 Apple Glass；它们属于其他已拆分子任务。
- 不扩展 Desktop/TUI 客户端；本任务保持协议与 headless projection 可复用。

## Blocking Open Questions

无。父任务已确定 VChart、按需图表、权威 Artifact、等价表格和 Inline/Inspector 一致性；当前仓库证据足以确定首版边界。
