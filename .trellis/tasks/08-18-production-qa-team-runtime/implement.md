# Implementation Plan

- [ ] 建立 Harness runtime 来源映射，优先移植 persistence/checkpoint/replay/subagent lifecycle 与 crash-recovery test 结构，保留 MIT notice。
- [ ] 写 production runtime wiring 失败测试，证明 stub 被移除且无 legacy fallback。
- [ ] 实现 deterministic root/child task 与 Team Store authority adapter。
- [ ] 实现 Semantic readiness/skip decision 和 status emission。
- [ ] 接通 Text2SQL Provider/Compiler/Sandbox/QueryEvidence adapters。
- [ ] 接通 Report Provider/Projector/AnalysisReport adapters。
- [ ] 将已提交 Artifact 的 exact refs 写入 Tool terminal events，并验证 scope/revision/hash 后才公开。
- [ ] 实现 completion/verifier/acceptance、retry/recovery/reconcile。
- [ ] 在 run-worker-cli 注入真实 runtime，启动本地 Worker 做 E-commerce integration。
- [ ] 真实 SSE 中验证按 `profile_id/task_id` 可重放 Subagent feed，断线不重复 Tool/Provider side effect。
- [ ] 运行 Agent Runtime/Worker/Platform tests、typecheck、Biome 和数据库断言，更新 specs 并提交。
