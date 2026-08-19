# Parent Integration Plan

- [ ] 完成并提交 `08-18-team-agent-status-contract`。
- [ ] 完成并提交 `08-18-production-qa-team-runtime`。
- [ ] 完成并提交 `08-18-qa-team-agent-status-ui`。
- [ ] 启动 Web + Worker，在当前 E-commerce workspace 发起真实 Q&A。
- [ ] 验证 activity stream 中 Semantic SKIPPED、Text2SQL RUNNING->COMPLETED、Report RUNNING->COMPLETED、
      Tool rows 与 answer text 按 sequence 穿插。
- [ ] 验证 SSE 断开重连、页面刷新、trajectory deep-link 后三 Agent 状态一致。
- [ ] 使用浏览器截图验证 1440x1000、390x844、reduced motion、无横向溢出。
- [ ] 运行跨层 Contracts/Platform/Worker/Web/PostgreSQL checks，更新 specs 并提交父任务收口。

## Integration Gates

- 不接受 Worker stub、fake Artifact、legacy Research fallback 或仅前端 mock 状态。
- 任一 Agent/Tool durable identity 与 Public event identity 不一致即 HOLD。
- 最终回答只来自 accepted `AnalysisReport`；Text2SQL/Report failure 不得显示成功。
