# Implementation Plan

1. 在 contracts 中定义公开执行事件判别联合、清理函数和解析测试。
2. 扩展事件存储的公开回放能力与 Workspace 对话轨迹查询；改造 SSE 为 cursor 恢复的持续流。
3. 在 Worker 运行边界追加真实 progress/tool/answer 事件，同时保持现有权威 Run 生命周期约束。
4. 增加前端事件 assembler，重构 Q&A store 为增量状态并保证最终消息只写一次。
5. 实现参考 DeepSeek 交互的折叠行、对话/轨迹标签、统计与双向定位。
6. 增加 contracts/platform/worker/web 测试，运行 scoped lint、typecheck、build 和浏览器验收。
7. 审查敏感字段、事件恢复与当前基线兼容性；仅提交到 `codex/qa-sse-trajectory`。

## Validation

- `pnpm --filter @data-agent/contracts test`
- `pnpm --filter @data-agent/platform test`
- `pnpm --filter @data-agent/worker test`
- `pnpm --filter @data-agent/web test`
- `pnpm --filter @data-agent/web typecheck`
- `pnpm --filter @data-agent/web build`

## Rollback Points

- 公共事件类型保持 additive，旧 Run 可仅显示生命周期。
- SSE 失败时可退回最终投影 GET，不允许 UI 假成功。
- 不改数据库表，因此回滚不需要数据迁移。
