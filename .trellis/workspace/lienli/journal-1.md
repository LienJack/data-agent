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


## Session 2: Deliver M1 PostgreSQL Schema Discovery

**Date**: 2026-08-09
**Task**: Deliver M1 PostgreSQL Schema Discovery
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Implemented and verified deterministic read-only PostgreSQL catalog snapshots, drift detection, authority persistence, APIs, and the Physical Schema browser; completed headed fail-closed verification and archived M1 without absorbing parallel DataFoundry work.

### Git Commits

| Hash | Message |
|------|---------|
| `4cee083` | (see git log) |

### Status

[OK] **Completed**


## Session 3: 交付 M2 Semantic Explorer

**Date**: 2026-08-09
**Task**: 交付 M2 Semantic Explorer
**Branch**: `feat/datafoundry-platform-modules`

### Summary

完成 PostgreSQL 权威的 exact-release Semantic Explorer，包括严格 contract/read model、10624 只读 RPC、API、tree/table/graph/detail/diff/lineage/candidate UI、10k 基准与有头浏览器验收；Neo4j 关系索引保留为 M2.1。

### Git Commits

| Hash | Message |
|------|---------|
| `3cb4646` | (see git log) |

### Status

[OK] **Completed**


## Session 4: M2.1 Neo4j Relationship Index

**Date**: 2026-08-09
**Task**: M2.1 Neo4j Relationship Index
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Delivered a PostgreSQL-fenced, rebuildable Neo4j relationship index with 10625 authority operations, independent indexer, shared Web and Agent search, rich graph UI, fallback safety, real PG17 and Neo4j proof, Docker health, and 10k benchmark evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `34226d8` | (see git log) |

### Status

[OK] **Completed**


## Session 5: 完成本地开发与 Docker 部署双模式

**Date**: 2026-08-10
**Task**: 完成本地开发与 Docker 部署双模式
**Branch**: `feat/datafoundry-platform-modules`

### Summary

实现开发环境仅容器化 PostgreSQL/Neo4j、Web/Worker/Indexer 本地 watch；生产 deploy profile 启动完整五服务栈；补齐显式迁移、健康门禁、测试、运行手册和物理 smoke 验证。

### Git Commits

| Hash | Message |
|------|---------|
| `9cbf213` | (see git log) |

### Status

[OK] **Completed**


## Session 6: 完成工作空间 RBAC 与模型计费上线

**Date**: 2026-08-15
**Task**: 完成工作空间 RBAC 与模型计费上线
**Branch**: `feat/datafoundry-platform-modules`

### Summary

完成 Phase 7 全量门禁，权威切换本地计费到 ENFORCED epoch 2，归档 Phase 7 与父任务。

### Git Commits

| Hash | Message |
|------|---------|
| `5289cf2` | (see git log) |
| `6e69384` | (see git log) |

### Status

[OK] **Completed**


## Session 7: 完成 Semantic Graph v2 核心

**Date**: 2026-08-15
**Task**: 完成 Semantic Graph v2 核心
**Branch**: `feat/datafoundry-platform-modules`

### Summary

交付独立 Node/Edge/Formula AST 合同、确定性校验编译、PostgreSQL Authority 投影与 RLS/RPC；相关构建、回归测试和 10638 实库断言通过。

### Git Commits

| Hash | Message |
|------|---------|
| `46785d7` | (see git log) |

### Status

[OK] **Completed**


## Session 8: Agent 语义创作 Runtime

**Date**: 2026-08-15
**Task**: Agent 语义创作 Runtime
**Branch**: `feat/datafoundry-platform-modules`

### Summary

完成 Agent 提议、Worker 权威执行的本体图创作 Runtime，含节点/边/公式工具、候选补丁、PostgreSQL RLS 与窄 RPC、幂等续跑、崩溃恢复和测试。

### Git Commits

| Hash | Message |
|------|---------|
| `6530fe7` | (see git log) |

### Status

[OK] **Completed**


## Session 9: 语义图统一读取模型

**Date**: 2026-08-15
**Task**: 语义图统一读取模型
**Branch**: `feat/datafoundry-platform-modules`

### Summary

完成发布与候选统一 Node/Edge 读取模型、列表/邻域/路径/影响、确定性分群与 10k 节点预算验证。

### Git Commits

| Hash | Message |
|------|---------|
| `92d0f75` | (see git log) |

### Status

[OK] **Completed**


## Session 10: 完成 Agent 原生 Semantic Studio 图体验

**Date**: 2026-08-15
**Task**: 完成 Agent 原生 Semantic Studio 图体验
**Branch**: `feat/datafoundry-platform-modules`

### Summary

交付默认 Node List、局部图、cluster-first 全图、统一详情面板、持久 Agent Composer、SSE 候选 overlay，并移除旧物理页 JSON 直改入口；Web 179 tests、Graph 定向 9 tests、10640 migration/SQL authority assertions 通过。

### Git Commits

| Hash | Message |
|------|---------|
| `14bc1f9` | (see git log) |

### Status

[OK] **Completed**


## Session 11: 暂停积分与计费前端功能

**Date**: 2026-08-16
**Task**: 暂停积分与计费前端功能
**Branch**: `feat/datafoundry-platform-modules`

### Summary

默认隐藏工作空间平台设置中的积分、计费、价格和汇率控制面，保留服务端账务与主模型流程；完成 Web 单测、类型、格式、构建和真实浏览器验证。

### Git Commits

| Hash | Message |
|------|---------|
| `515c9b5` | (see git log) |

### Status

[OK] **Completed**


## Session 12: 平台设置模型供应商管理

**Date**: 2026-08-16
**Task**: 平台设置模型供应商管理
**Branch**: `feat/datafoundry-platform-modules`

### Summary

交付三 Tab 平台设置、API 供应商 Card、环境只读投影、服务端模型发现、PostgreSQL 多模型选择与审计归档；迁移、聚焦测试、范围格式及浏览器验收通过，Web 全量 typecheck 仅受并行 QA CLI 文件阻塞。

### Git Commits

| Hash | Message |
|------|---------|
| `37bf5c8` | (see git log) |

### Status

[OK] **Completed**


## Session 13: 暂停计费并恢复模型选择

**Date**: 2026-08-16
**Task**: 暂停计费并恢复模型选择
**Branch**: `feat/datafoundry-platform-modules`

### Summary

将本地计费权威模式切到 SHADOW，安全同步环境模型目录，串行化并发刷新，并验证 DeepSeek 与 Kimi 可绑定到 Q&A Conversation。

### Git Commits

| Hash | Message |
|------|---------|
| `f6e1f69` | (see git log) |

### Status

[OK] **Completed**


## Session 14: U15 governed knowledge base delivery

**Date**: 2026-08-17
**Task**: U15 governed knowledge base delivery
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Delivered Knowledge Base contracts, PostgreSQL 10661 Authority, Platform adapters, Worker KNOWLEDGE_INDEX handler, Web routes/settings, U2 integration, and fresh PG17 verification without Falcon or real Provider calls.

### Git Commits

| Hash | Message |
|------|---------|
| `d84c1e0` | (see git log) |

### Status

[OK] **Completed**
