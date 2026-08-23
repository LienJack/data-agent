# U9 Task Console Resolution Trace 与 SQL 历史证据面

## Goal

把 Run 配置、公开事件、Context 决策、Tool、SQL、Evidence 和 Artifact 组织成可刷新重放的 Resolution Trace，
并提供 workspace-scoped SQL History 与原会话返回路径；所有展示只消费服务端脱敏投影。

## Background

- U7 已提供内容寻址 Artifact 预览/导出，U8 已提供 durable Event、Checkpoint、Interruption 与 Branch。
- 当前 TaskConsole 从客户端 `RunProjection` 猜测六个节点，明确不是后端 DAG；不能作为 U9 Authority。
- 当前 trajectory assembler 已按 `(run_id, sequence)` 去重并合并 Tool call，但没有统一 Trace DTO/边合同。

## Requirements

- 新增 strict `ResolutionTrace`：Run scope/config summary、按 sequence 的公开节点、typed edges、Artifact/Evidence
  references、duration/status 与 source event IDs；不含 Prompt、私有推理、raw Context、credential 或 raw row data。
- Trace 节点只引用已持久 Run Event/Artifact/Context/SQL Authority；客户端不得自造 node ID、状态或 success。
- SSE live 与历史 reload 使用同一 reducer/decoder；相同 `(run_id, sequence)` 只能产生一个节点，长输出只保留
  bounded summary + Artifact ref。
- SQL History 条目固定 SqlArtifact ref、parameter/schema snapshot/compiler hash、execution/query evidence/result refs、
  terminal/status/occurred_at 与 conversation deep link；禁止 raw SQL 参数值、Result rows 和 Provider body。
- Platform 读接口在同事务重新验证 Workspace/Run principal、Artifact scope/hash/type 和事件连续性；坏引用整项失败关闭。
- 新增 workspace-scoped `/sql-history` 和 Run `/resolution-trace` 路由；未授权查询返回 not-found-or-denied，不能枚举。
- TaskConsole/TrajectoryView 消费同一 DTO，支持 overview/trace/sql/artifacts、节点展开、原会话跳转与空/loading/error。
- 本单元不运行 Falcon、不调用 Provider/MCP、不修改业务执行状态。

## Acceptance Criteria

- [x] Contracts 覆盖节点/边/SQL entry hash、排序、去重、scope/ref splice、redaction 和未知字段失败关闭。
- [x] Platform 从 Event/Artifact Authority 生成同一 hash 的 Trace/SQL History；坏 event gap/hash/type/scope 拒绝。
- [x] SSE 重连与完整 reload 对相同 Run 产生相同节点/边，重复 Event 不重复节点。
- [x] SQL History 可按 Run/Conversation/时间过滤并 deep-link，响应无 raw parameter/result/prompt/context 字段。
- [x] TaskConsole 与 TrajectoryView 只接收已解析 DTO，覆盖空/部分/WAITING/terminal/stale/error。
- [x] 桌面/移动端、键盘展开/Tab/焦点与长摘要无重叠或横向溢出。
- [x] Contracts/Platform/Web scoped/full relevant tests、typecheck/build、Biome 和 forbidden scan 全绿。

## Out Of Scope

- 不实现 U17 全 Workspace IA、U20 Team Profile 注册或 U18 Falcon Gate。
- 不把私有 Worker/Model payload 持久为公开 Trace，也不提供 raw SQL/Result 下载旁路。
- 不修改 Artifact、Run 或 Effect Authority；本单元只做只读投影。

## Notes

- 对应 G9、M05、M10、R07；依赖 U7、U8。Blocking Questions 为空。
- 并行 TaskConsole/Trajectory UI 改动保留，仅以 U9 DTO 替换其客户端猜测数据源。
