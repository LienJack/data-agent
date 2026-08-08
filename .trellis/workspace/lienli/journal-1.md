# Journal - lienli (Part 1)

> AI development session journal
> Started: 2026-07-25

---

## 2026-07-26：U5 Unit 3 — PostgreSQL Compiler、七道 Gate 与执行 Authority

- 建立确定性 PostgreSQL Compiler 与不可伪造 LogicalPlan Binding；SqlArtifact 固定
  Compiler Version、AST Hash、参数与 Query Hash，最终列名严格闭合 QueryContract。
- 建立七道 Gate、ExecutionPermit、ValidationReceipt、System Artifact Store 路由和
  ResultOracle/QueryEvidence 闭环；PolicyReceipt 由服务端 Issuer/Store 提交。
- Codex 对抗复审先后关闭真实 PostgreSQL Node Type、63-byte Alias、跨层资源上限、
  Gate 时钟新鲜度、Permit transaction-start 语义、墙钟超时低报、Reference A/Payload B
  换绑、并发幂等重复执行、跨 Principal Key 冲突与 Pending 撤权窗口。
- 服务端组合能力迁移到显式 `@data-agent/contracts/server` 与
  `@data-agent/text2sql/server` 子路径；真实 package specifier 验收证明
  register→bind→compile→gate→seal 与 Sandbox authorize 可组合，普通根入口仍不暴露
  Registrar/Authorizer。
- 验证：Lint 213 files、Build 5/5、Typecheck 8/8、Unit 563/563、Contract 45/45
  全部通过。
- 边界：真实 PostgreSQL Sandbox/EXPLAIN Adapter、Bounded Repair、Metamorphic Oracle、
  首次提交数据库可信时钟、十位以上参数顺序证据和大字段物化前的 Streaming
  Byte/Memory 截断继续留在下一单元；当前发布状态仍为 `HOLD`。

## 2026-07-26：U5 Unit 2 — ACL-first Grounding 与 Typed IR

- 从旧 Text2SQL Characterization 固定 QueryContract 输入与差异边界，新增
  Grounding Authority、ACL Snapshot、Join Closure、SemanticQuery、LogicalPlan 和
  Artifact Projection。
- PostgreSQL Repository 新增 Grounding Authority / L2 Artifact 的内容寻址提交与
  解析；候选文档必须在同一事务内通过服务端 Committer、Scope、Principal、上游与
  语义核验，才允许获取 Run Fence 并替换 Active Revision。
- Codex 对抗复审先后复现并关闭限定列跨表漂移、Metric/Dimension 跨类型同名、公开
  Branch Schema 绕过、重复 Retrieval Hit、重复 Measure 与重复 Policy Predicate
  等反例；所有修复均落在共享 Contract，而不是只修某一个调用点。
- 验证：根级 Lint 195 files、Build 5/5、Typecheck 8/8、Unit 466/466、
  Contract 45/45、Text2SQL Security 5/5 通过；最终三路 Codex 复审均未发现
  剩余 P0/P1。
- 边界：本单元不包含 PostgreSQL Compiler、七道 Gate、Repair、Sandbox，也尚未组合
  面向普通 ANALYST 的受信 PolicyReceipt Issuer。下一步继续 U5 Compiler + Gate。


## Session 1: Semantic Layer Studio M0 authority foundation

**Date**: 2026-08-08
**Task**: Semantic Layer Studio M0 authority foundation
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Committed the Published F9 prerequisite and M0 fail-closed semantic authority, canonical candidate draft, publish and rollback material, datasource SecretRef boundary, verification evidence, and PostgreSQL integration gates.

### Git Commits

| Hash | Message |
|------|---------|
| `2040b3e` | (see git log) |
| `b820f03` | (see git log) |

### Status

[OK] **Completed**
