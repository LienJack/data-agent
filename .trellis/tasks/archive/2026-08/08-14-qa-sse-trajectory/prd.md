# 对话 SSE 与轨迹视图

## Goal

让 Q&A 用户在回答生成期间实时看到可审计的阶段进度、工具调用和回答增量，并能在整个对话范围内回放执行轨迹。交互明确参考 `deepseek-harness` 的 ReasoningRow、ToolRow 与 Trajectory 事件装配方式，但不复制代码或依赖。

## Background

- 当前 Run 事件存储具有持久化 sequence、幂等追加和工作区授权，但公开 SSE 每次只返回单个投影后关闭。
- 当前 Q&A store 等待 Run 结束后才追加 Agent 消息，无法显示中间过程。
- 对话、消息和 Run 已通过 `workspace_run_bindings.conversation_id` 关联，具备按对话聚合轨迹的基础。

## Requirements

- SSE 必须持续输出公开事件，支持 sequence/`Last-Event-ID` 恢复、去重和终态关闭。
- 公开事件必须覆盖回答增量、结构化进度、工具开始/成功/失败和 Run 终态；不得展示或伪造隐藏模型推理。
- Think 与工具行默认折叠，展开状态只属于前端视图；摘要显示状态、名称、耗时和进度，长输出内部滚动。
- 同一持久化事件序列同时驱动对话过程卡和轨迹视图，不允许两个页面分别猜测运行状态。
- 轨迹覆盖当前对话全部 Run，按轮次分组，并支持 `runId + sequence` 双向定位。
- 所有 Workspace READ 成员可查看完整非敏感工具内容；凭据、连接串、授权头和内部系统提示必须在持久化前剔除。
- 所有实现、验证和提交只发生在 `/Users/lienli/Documents/GitHub/data-agent-worktrees/qa-sse-trajectory` 的 `codex/qa-sse-trajectory` 分支。

## Out of Scope

- 不修改模型配置、数据源配置或工作区权限模型。
- 不复制或引入 deepseek-harness 的代码、样式资产和包。
- 不自动合并、变基或改写当前 `feat/datafoundry-platform-modules` 工作目录。

## Acceptance Criteria

- [x] 发送消息后，回答增量、进度和工具事件可在同一消息流中实时出现。
- [x] Think/工具卡默认折叠，支持鼠标和键盘展开，失败/中断状态可识别。
- [x] SSE 断线后从已确认 sequence 恢复，不重复渲染或重复持久化最终消息。
- [x] 刷新页面后可从持久化事件恢复已完成 Run 的过程卡和对话级轨迹。
- [x] 轨迹按用户轮次和 Run 分组，展示时长、轮次、调用数并支持双向定位。
- [x] 敏感字段不会进入公开事件或数据库事件 payload。
- [ ] 目标契约、平台、Worker、Web 测试、类型检查与构建通过；浏览器完成核心交互验收。
