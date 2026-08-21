# Parent Integration Plan

- [ ] 维护 `research/codex-desktop-parity-matrix.md`、`research/deepseek-harness-source-reuse-ledger.md` 与
      `research/reasonix-multi-surface-protocol-design.md`；Harness 是主要代码基线，Reasonix 只约束多端分层。
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
- [ ] 对 Codex parity matrix 逐项给出 `MATCH/ADAPTED/OUT_OF_SCOPE` 证据；对 Harness ledger 逐项确认复用代码、测试和许可 notice。
- [ ] 用同一 fixture 运行 Web REST/SSE adapter 与 headless contract adapter conformance tests，证明协议 core
      不依赖 DOM/React/桌面宿主；不实现新的 TUI/Desktop/ACP surface。
- [ ] 运行跨层 Contracts/Platform/Worker/Web/PostgreSQL checks，更新 specs 并提交父任务收口。

## Integration Gates

- 不接受 Worker stub、fake Artifact、legacy Research fallback 或仅前端 mock 状态。
- 任一 Agent/Tool durable identity 与 Public event identity 不一致即 HOLD。
- 任一 Artifact preview 不可证明 exact scope/run/revision/hash，或使用裸路径/raw Tool output，即 HOLD。
- Subagent Inspector 若依赖旁路 callback/SSE 或用连接状态推进权威状态，即 HOLD。
- 可直接适配的 Harness 实现被无理由重写、实质性复制未记录 MIT 来源，或只做“视觉类似 Codex”而无功能 proof，即 HOLD。
- Runtime 反向依赖 Web/Desktop/TUI、任一 surface 拥有独立 Agent authority/Model binding，或把不同 transport
  错当不同 Run lifecycle，即 HOLD。
- 最终回答只来自 accepted `AnalysisReport`；Text2SQL/Report failure 不得显示成功。
