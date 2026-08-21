# Production Q&A Team Runtime Design

## Execution Flow

```text
lease + effective config + resolved context
  -> persist root task/context epoch
  -> semantic readiness decision (SKIPPED or governed maintenance)
  -> Text2SQL child: provider plan -> compile -> sandbox -> commit QueryEvidence/SqlArtifact
  -> Report child: evidence read -> provider/project -> commit AnalysisReport
  -> completion/verifier/acceptance
  -> Run COMPLETED only for ACCEPTED report
```

## Ports

组合现有 `PostgresTeamRunStore`、`MastraTeamRuntime`、`TeamWorkflowRegistry`、Provider Dispatch、
Resolved Context、Semantic read、Text2SQL compiler/sandbox、Artifact store 和 Report projector。新增组合层，不复制领域逻辑。

控制面实现优先移植/改造 DeepSeek Harness 的 session persistence coordinator、checkpoint-before-dispatch、
append-only/replay、subagent lifecycle 和 crash-recovery 测试结构；Text2SQL/Semantic/Report 领域 ports、PostgreSQL
Team Store、Provider billing、Artifact/Acceptance authority 保持 Data Agent 原实现。这里的“不复制领域逻辑”不表示禁止复制 Harness 通用控制面代码。

Reasonix 的 transport-agnostic Controller 只作为依赖方向参考：组合层向外暴露统一 Run command/event port，Web
REST/SSE 是 adapter；Runtime 不 import Web、Desktop、TUI 或 ACP 包。当前不复制 Reasonix Controller，也不新增一个
覆盖现有 Worker/Team Store 的平行 session authority。

## Reliability

- Persist-before-emit：task transition 成功后才发 Agent event。
- Persist-before-effect：Tool started/dispatch receipt 成功后才调用外部 Provider/Sandbox。
- Commit-before-publish：只有 Artifact Store 已提交并可按 hash 验证后，Tool terminal event 才能发布 `artifact_refs`。
- Replay 先 load Team run/open obligations/effect receipts，再决定继续或 reconcile。
- Runtime 只返回 `ACCEPTED/FAILED/NEEDS_CLARIFICATION`；最终 Run 状态仍由 Worker runner 管理。
- surface 只能选择如何传输命令和显示公开事件，不能选择另一套 Model/provider/profile binding；同一个 Run 在
  headless 与 Web adapter 下必须保持 deterministic task/effect/event identity。

## Scope

首个真实纵向切片覆盖 PostgreSQL datasource 和当前 E-commerce published semantic release；接口保持 adapter 化，
不把 fixture ID/SQL 写入 production runtime。

## Public Inspector Feed Boundary

- Runtime 不创建“Subagent SSE”旁路，也不把 Mastra/Provider callback 直接推给浏览器。
- `run.agent_status`、带 Agent identity 的 `run.tool_*` 和 `artifact_refs` 按 durability 顺序进入同一 `run_events` 日志；Web 以 `profile_id/task_id` 派生某个 Subagent 的实时 feed。
- reconnect 只从 Run `sequence` 继续；Agent terminal status 与 Artifact committed truth 均不可由 connection state 推断。
- 未来 Desktop/TUI adapter 只能接入同一 command/event/preview authority；实际 surface 产品不属于本子任务。
