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

## 完成证据

- [x] `AgentTurnPort` 只接受服务端精确授权的 Scope、candidate、policy 与工具闭集。
- [x] Worker 多轮循环在 provider dispatch 前持久化 request prefix；tool receipt 与 patch 原子提交。
- [x] Node/Edge 写工具执行 search/read-before-write、版本/摘要 CAS 和 system-managed 拒绝策略。
- [x] clarification 可暂停/恢复；provider retry 与 complete-tool crash 可从同一 checkpoint 恢复。
- [x] 只有 exact valid validation receipt + `complete_authoring_run` 才进入 `READY_FOR_REVIEW`。
- [x] PostgreSQL 10639 保存 fenced run、turn、receipt、patch 和 typed event，并物化新 candidate revision。
- [x] PostgreSQL 17 独立验证库通过 migration checksum、RLS、ACL、request checkpoint 与物理节点拒绝断言。
- [x] Contracts 612、Semantic 121、Agent Runtime 208、Worker 52 个相关测试通过；Platform 新增测试 2 个通过。
- [x] 全量 Platform 测试仅被并行工作未同步的 ecommerce benchmark public-surface 期望阻断；与本任务无关。
- [x] 全量 migration static-check 到 10635 通过，随后被并行 10636 双 checksum literal 阻断；10639 renderer 自验证通过。
