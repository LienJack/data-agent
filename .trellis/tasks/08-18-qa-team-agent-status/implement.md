# Parent Integration Plan

- [ ] 完成并提交 `08-18-team-agent-status-contract`。
- [ ] 完成并提交 `08-18-production-qa-team-runtime`。
- [ ] 完成并提交 `08-18-qa-team-agent-status-ui`。
- [ ] 启动 Web + Worker，在当前 E-commerce workspace 发起真实 Q&A。
- [ ] 验证 activity stream 中 Semantic SKIPPED、Text2SQL RUNNING->COMPLETED、Report RUNNING->COMPLETED、
      Tool rows 与 answer text 按 sequence 穿插。
- [ ] 点击 Text2SQL/Report Subagent 名称，验证 Inspector 先重放 baseline、再接同一 Run SSE 增量，且可定位 trajectory。
- [ ] 点击 SqlArtifact/AnalysisReport file link，验证右栏使用 exact ArtifactReference 安全预览；unsupported/denied/hash mismatch 无 raw fallback。
- [ ] 验证 SSE 断开重连、页面刷新、Inspector URL restore、Conversation/Run 切换、trajectory deep-link 后三处状态一致。
- [ ] 使用浏览器截图验证 1440x1000、390x844、Inspector open/closed、reduced motion、Composer 可操作且无横向溢出。
- [ ] 运行跨层 Contracts/Platform/Worker/Web/PostgreSQL checks，更新 specs 并提交父任务收口。

## Integration Gates

- 不接受 Worker stub、fake Artifact、legacy Research fallback 或仅前端 mock 状态。
- 任一 Agent/Tool durable identity 与 Public event identity 不一致即 HOLD。
- 任一 Artifact preview 不可证明 exact scope/run/revision/hash，或使用裸路径/raw Tool output，即 HOLD。
- Subagent Inspector 若依赖旁路 callback/SSE 或用连接状态推进权威状态，即 HOLD。
- 最终回答只来自 accepted `AnalysisReport`；Text2SQL/Report failure 不得显示成功。
