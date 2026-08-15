# Agent 语义创作 Runtime 设计

## Architecture

新增 `AgentTurnPort@1`，每次只调用模型一轮并支持脱敏的 tool-call/tool-result history；现有
`ModelProviderPort` 保持兼容。Worker 持有循环和 Authority：model turn → policy → candidate tool →
receipt/revision/event → next turn。

## Tool Surface

- Read：list types、search/read Node/Edge、neighborhood、schema/binding、formula dependencies、diff、impact。
- Write candidate only：create/update/retire Node/Edge、propose edge type、validate、clarify、complete。
- unlink/rebind 由退役/创建 Edge 的显式组合实现；没有隐藏批量副作用或 hard delete。

## Transaction and Recovery

- Tool receipt key 绑定 run/turn/tool/idempotency；expected revision 用 CAS。
- 单事务追加 working graph patch、receipt、overlay cache 和 event/outbox；不为每个原子工具复制
  完整 Graph source。
- 崩溃恢复先查 receipt；terminal 存在则返回原结果并补齐事件，不重复 reducer。
- clarification 是持久 suspended 状态，用户 reply 作为新 evidence 追加。
- explicit complete 重放 patches，物化完整 Graph v2 source/candidate revision，并校验物化 digest 与
  working graph digest 一致后才运行全量 Gate。

## Events

扩展现有 durable run event，不创建第二套 SSE：stage、tool terminal、typed graph patch、validation、
clarification、authoring terminal。继续使用 sequence cursor、Last-Event-ID、dedupe 和 heartbeat。

## Security

Server-owned descriptors；scope/principal 来自认证上下文；无 network/raw SQL/Neo4j/publish 工具。
审计内容经过 redaction，provider 原始异常映射为稳定 public error。

## Rollback

关闭 authoring flag、停止新 run；在途 run 可 cancel/保留候选。已提交 revisions/receipts 不删除，
active release 不受影响。
