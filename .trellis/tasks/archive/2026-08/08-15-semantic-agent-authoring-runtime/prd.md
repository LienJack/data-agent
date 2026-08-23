# Agent 语义创作工具循环 PRD

## Goal

让用户输入自然语言或公式后，由 Agent 通过可恢复、可审计的原子工具循环读取语义图并修改
候选 Node/Edge；活动 release 只有在确定性验证和人工审核后才改变。

## Scope

- Additive Agent turn 合同与服务端多轮 orchestrator。
- Graph read、candidate mutation、validation、impact、clarification 和 explicit-complete 工具。
- Authoring run/checkpoint/idempotency receipt、durable public events、SSE replay。
- 与现有 provider、billing、tool policy、Candidate/Review authority 集成。

## Requirements

- Provider/Mastra 只能提出 tool-call candidate，不能执行工具或持有数据库 Authority。
- 每个写工具只改变当前 candidate，一个事务一个原子 Node/Edge 操作。
- 工具调用固定 scope、base release、candidate revision、principal、policy、budget 和 idempotency。
- Agent 必须先搜索/读取再创建；名称相似不能自动 identity merge。
- PhysicalTable/Column 和物理结构 Edge 是 system-managed，Agent 工具只能读取和建立语义绑定。
- 歧义使用 `request_semantic_clarification` 暂停并从同一 checkpoint 恢复。
- 只有显式 `complete_authoring_run` + exact validation receipt 才进入 `READY_FOR_REVIEW`。
- 同一 candidate 只有一个 fenced writer；未物化或仍有 active authoring run 的 Graph v2 candidate
  不能经现有通用 API 提交审核。
- Agent 永远不能 approve、publish、rollback、读 secret、执行任意 SQL/Python 或直接写 active graph。
- 公开事件可显示阶段、工具、patch、证据和错误，但不显示 CoT/system prompt/credential。

## Out of Scope

- 自动审核/发布、业务数据库 DDL/DML、前端图渲染、模型端 autonomous tool execution。

## Acceptance Criteria

- [ ] “新增成交商品数”通过多次 Node/Edge 工具形成同一 candidate 和 live graph patches。
- [ ] “只统计已支付订单”能读取当前 Formula/依赖、更新候选并运行 impact/validation。
- [ ] 澄清回答、页面断线、Worker 崩溃和 provider retry 均不重复 mutation。
- [ ] stale revision、budget、policy、非法 scope 和 publish tool 失败关闭并有稳定 terminal。
- [ ] 模型停止但未调用 complete 时 run 不被错误标记成功。
- [ ] authoring evidence、tool receipts、before/after/patch digest 和 public events 可审计重放。
