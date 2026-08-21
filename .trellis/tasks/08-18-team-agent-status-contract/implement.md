# Implementation Plan

- [ ] 先写 Contracts strict/tamper/round-trip 失败测试，覆盖 Agent identity、Tool identity 和 `artifact_refs`。
- [ ] 扩展 runtime/public event schemas、display input 和 `toPublicRunEvent`。
- [ ] 新增 PostgreSQL migration/source/renderer 和 assertion vectors。
- [ ] 更新 Worker Event Store mapping、Tool visibility identity 与 terminal Artifact locators。
- [ ] 证明 Subagent Inspector feed 与 trajectory 都从同一 public event replay 派生，不新增旁路 SSE DTO。
- [ ] 运行 contracts/platform/worker tests、typecheck、Biome、renderer/static、PostgreSQL 17 smoke。
- [ ] 更新 Agent Public Event/Team Runtime specs，创建 scoped commit。
