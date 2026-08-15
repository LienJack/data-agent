# Agent 语义创作 Runtime 执行计划

1. 以 Graph v2 合同冻结为前置，新增 `AgentTurnPort` 和 adapter fixtures。
2. 实现 authoring run command、单 writer lease/fencing、状态、checkpoint、clarification/resume 和
   explicit completion。
3. 实现 read tools、candidate-only mutation tools、typed descriptors/results 和 deny policy。
4. 用 expected revision + idempotency receipt 接入 candidate reducer。
5. 扩展 durable run events/SSE assembler，加入 typed graph patch 和 clarification。
6. 在 Worker 实现 turn loop、budget、cancel、crash recovery 和 terminal handling。
7. 覆盖 multi-tool、stale、clarification、retry/crash、redaction 和 denied capability 测试。
8. 运行验证、scoped commit 并归档 child。

```bash
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/agent-runtime test:contract
pnpm --filter @data-agent/agent-runtime test:security
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/worker test:integration
```

Go/No-Go：任何 provider-side execute、重复 mutation、未 complete 即成功、或 publish/secret capability
可达时停止，不能进入前端集成。
