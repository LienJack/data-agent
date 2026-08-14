# Technical Design

## Architecture

`run_events` 继续作为单 Run 的持久化顺序日志。新增可显示的公开执行事件，并由服务端投影为统一 `PublicRunEvent`。单 Run SSE 和对话轨迹 API 都读取这条事件链，前端 assembler 以 `(runId, sequence)` 幂等合并后分别派生 Chat 与 Trajectory 视图。

## Contracts and Data Flow

1. Worker 在阶段边界、工具边界和回答输出处生成受控事件。
2. 服务端在追加前递归清理敏感键和值；清理失败时拒绝公开事件而不是原样落库。
3. 单 Run SSE 从 cursor 后回放，继续轮询持久化事件，发送带 `id` 的帧，终态后结束。
4. Q&A store 增量装配一条运行中的 Agent 消息；终态时固化最终正文并只追加一次数据库消息。
5. 对话轨迹 API 根据 `workspace_run_bindings.conversation_id` 查询关联 Run，再按 Run sequence 返回公开事件。

## UI Reference Mapping

- DeepSeek `ReasoningRow` -> Data Agent `ProcessDisclosure` 的 progress 变体。
- DeepSeek `ToolRow` -> tool 变体，保留状态、摘要、IN/OUT 和内部滚动。
- DeepSeek `TrajectorySnapshotBuilder` -> 纯函数 assembler，Chat/Trajectory 共享输入事件。
- DeepSeek Trajectory -> Data Agent 的对话级统计、轮次分组、时间线和定位；视觉样式服从现有 Data Agent token。

## Compatibility and Failure Handling

- 现有生命周期事件继续有效；公开映射为 lifecycle/terminal 行。
- SSE 支持 query cursor，并以合法 `Last-Event-ID` 优先；重复事件由客户端键去重。
- 网络错误进入 reconnecting；达到终态或明确取消后关闭。最终投影 GET 是流异常时的兜底。
- 未产生工具事件的 Run 不显示空工具卡；无增量回答时终态投影仍生成最终回答。
- 不新增数据库表；复用现有 JSONB event payload 和 Run binding 索引。

## Security

公开 payload 使用递归 allow/deny 清理：敏感键、Bearer/Basic 头、常见连接串和密钥形态替换为 `[REDACTED]`。系统提示、原始凭据与 Provider 请求对象不进入事件构造参数。
