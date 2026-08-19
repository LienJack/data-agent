# Q&A Team Agent 状态界面

## Goal

在 Q&A Agent answer 文档流中按事件顺序穿插展示公共 Think、Tool、Subagent 状态与回答正文，并支持折叠详情。

## Requirements

- `assembleConversationActivity(events, runId)` 是唯一 projection；相邻 answer delta 合并，reasoning/tool/agent
  分别按 `block_id/call_id/profile_id+task_id` 合并，deterministic replay。
- activity stream 是单列文档流，不嵌套 Card；Think、Tool、Context、Subagent 行和正文按 sequence 穿插。
- 每行显示 icon、类型/名称、单行摘要、状态、耗时；展开显示归属 Tool/Artifact 和轨迹定位。
- Subagent 最多展示一层 children Tool，固定 Team 深度 1；不实现任意递归树。
- 无事件、排队、失败、取消、断线、旧 Run、stale trace 都有明确非成功状态。
- 中英文、键盘、screen reader、focus-visible、reduced motion 完整。
- 内部 role Model profiles 不出现在用户可选模型菜单。

## Acceptance Criteria

- [ ] Think/Tool/Subagent/answer block 及三 Agent 所有状态均有测试，刷新重放顺序一致。
- [ ] active row 有克制动效，terminal row 无动画且布局不跳动。
- [ ] 1440x1000、390x844 截图无溢出，Composer 始终可见可操作。
- [ ] 点击 Tool/Subagent/Artifact 可定位 trajectory，错误状态展示公开 reason code。
