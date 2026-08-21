# Implementation Plan

- [x] 建立 Harness runtime 来源映射，优先移植 persistence/checkpoint/replay/subagent lifecycle 与 crash-recovery test 结构，保留 MIT notice。
- [x] 写 production runtime wiring 失败测试，证明 stub 被移除且无 legacy fallback。
- [x] 实现 deterministic root/child task 与 Team Store authority adapter。
- [x] 实现 Semantic readiness/skip decision 和 status emission。
- [x] 接通 Text2SQL Provider/Compiler/Sandbox/QueryEvidence adapters。
- [x] 接通 Report Provider/Projector/AnalysisReport adapters。
- [x] 将已提交 Artifact 的 exact refs 写入 Tool terminal events，并验证 scope/revision/hash 后才公开。
- [x] 实现 completion/verifier/acceptance、retry/recovery/reconcile。
- [x] 在 run-worker-cli 注入真实 runtime；真实 E-commerce integration 证据见本任务最终验证记录。
- [x] 真实 SSE 中验证按 `profile_id/task_id` 可重放 Subagent feed，断线不重复 Tool/Provider side effect。
- [x] 添加 architecture/conformance tests：Runtime 无 surface import，Web 与 headless invocation 对同一 Run 不改变
      Model binding、task ID、effect receipt 或 public event identity。
- [x] 运行 Agent Runtime/Worker/Platform tests、typecheck、Biome 和数据库断言，更新 specs 并提交。

## Verification

- 真实 Web 创建 Run `93d66234-2613-8e81-b0c2-e8e60228e7b2`，真实 Worker 依序调用已认证 DeepSeek、Compiler、E-commerce PostgreSQL Sandbox、Report Provider，并以 sequence 28 `run.completed` 结束。
- 同一 Run 持久化 Semantic `SKIPPED`、Text2SQL/Report task、Tool terminal、Side Effect Receipt、Completion、Verifier、Acceptance 和带 source refs 的 AnalysisReport；客户端只消费 Run/SSE 协议，不参与模型绑定。
- SSE 首次读取严格返回 sequence 1–28，使用 `cursor=14` 重连严格返回 15–28；重放后数据库仍只有 2 个 Provider intent、2 个 COMPLETED outcome、2 个 Side Effect Receipt 和 10 个 Tool lifecycle event。
- `pnpm dev:migrate` 已安装并校验 10672 authority repair；Web、Run Worker、Job Worker、PostgreSQL、Neo4j 均启动，Job Worker 稳定返回 `IDLE`。
- Worker 10 files / 75 tests、Contracts 3 files / 42 focused tests、Platform 4 files / 14 focused tests 通过；Worker、Web、Agent Runtime、Contracts、Platform typecheck 通过；相关变更 Biome 与 `git diff --check` 通过。
