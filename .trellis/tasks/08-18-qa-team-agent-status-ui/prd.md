# Q&A Team Agent 状态与 Inspector 界面

## Goal

在 Q&A Agent answer 文档流中按事件顺序穿插展示公共 Think、Tool、Subagent 状态与回答正文；Inline disclosure 承载快速展开，右侧 Inspector 承载 Artifact 预览和 Subagent 实时公开事件。

## Requirements

- `assembleConversationActivity(events, runId)` 是唯一 projection；相邻 answer delta 合并，reasoning/tool/agent
  分别按 `block_id/call_id/profile_id+task_id` 合并，deterministic replay。
- activity stream 是单列文档流，不嵌套 Card；Think、Tool、Context、Subagent 行和正文按 sequence 穿插。
- 每行显示 icon、类型/名称、单行摘要、状态、耗时；展开显示归属 Tool/Artifact 和轨迹定位。
- Subagent 最多展示一层 children Tool，固定 Team 深度 1；不实现任意递归树。
- disclosure 与 inspection 是两个相邻、可独立聚焦的动作：chevron/摘要按钮展开 Inline details；Subagent 名称或 Artifact/file link 选择右侧 Inspector，禁止嵌套 button。
- `QAInspectorTarget` 只允许 `subagent(run_id/profile_id/task_id/anchor_sequence)` 或 `artifact(run_id/reference/anchor_sequence)`；选择写入 QA store 和可恢复 URL，切换 Conversation/Run 时清理 stale selection。
- `task_id=null` 的预分配 PENDING row 可 Inline 展开但不提供 Inspector action；只有 durable task identity 建立后才可选择 Subagent Inspector，禁止按 profile 猜测后续 task。
- Subagent Inspector 先从当前 durable replay 构建 baseline，再消费同一 Run SSE 增量，按 sequence 展示该 Agent 的 status、Tool 与 Artifact；只展示严格 Public Run Event，不显示 raw frame、Provider callback 或 chain-of-thought。
- Artifact Inspector 复用现有 Workspace Artifact Preview API/renderer，支持 loading/unsupported/denied/hash mismatch/stale ref；“文件”必须是 governed ArtifactReference，不读取浏览器给出的任意本地路径。
- 桌面为可关闭/可调整的右栏；空间不足先自动收起 Inspector，不压坏中心 answer。390px 使用内容区 sheet，Composer 仍可见可操作，关闭后焦点返回触发项。
- DeepSeek Harness 是主要代码实现参考：优先移植并改造其 assembler/snapshot、ReasoningRow/ToolRow、
  AppFrame/details rail、selection store、Subagent baseline/live 和 E2E 结构；保留来源与 MIT notice。
- 功能尽可能对标 Codex 桌面端：Inline 顺序、折叠行为、文件/Artifact Inspector、Subagent live Inspector、
  右栏调宽/关闭/恢复、键盘与焦点行为必须逐项验证；视觉继续使用 Data Agent design system。
- 无事件、排队、失败、取消、断线、旧 Run、stale trace 都有明确非成功状态。
- 中英文、键盘、screen reader、focus-visible、reduced motion 完整。
- 内部 role Model profiles 不出现在用户可选模型菜单。

## Acceptance Criteria

- [ ] Think/Tool/Subagent/answer block 及三 Agent 所有状态均有测试，刷新重放顺序一致。
- [ ] active row 有克制动效，terminal row 无动画且布局不跳动。
- [ ] 1440x1000、390x844 截图无溢出，Composer 始终可见可操作。
- [ ] 点击 Subagent 名称打开实时 Inspector；点击 Artifact/file link 打开安全预览；chevron 仍只控制 Inline 折叠，键盘与焦点返回正确。
- [ ] Inspector baseline + SSE、断线重连、刷新 URL 恢复、Conversation/Run 切换和 stale target 都有确定性测试，顺序与 trajectory 一致。
- [ ] Tool/Subagent/Artifact 均可从 Inspector 定位 trajectory，错误状态展示公开 reason code。
- [ ] Codex 桌面功能矩阵逐项达到 MATCH/ADAPTED；DeepSeek Harness source-reuse ledger 覆盖所有移植文件、测试、修改点和 MIT 归属。
