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


## Session 15: U11 semantic induction maintenance

**Date**: 2026-08-17
**Task**: U11 semantic induction maintenance
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Added deterministic schema/document/foundational/metric induction, impact planning, U10 job handling, 10662 PostgreSQL authority, and review-only U5 Candidate commits; verified all package gates and fresh PG17 assertions with import hooks disabled.

### Git Commits

| Hash | Message |
|------|---------|
| `f4f5d9f` | (see git log) |

### Status

[OK] **Completed**


## Session 16: 外部开源项目源码阅读规范

**Date**: 2026-08-21
**Task**: 外部开源项目源码阅读规范
**Branch**: `feat/datafoundry-platform-modules`

### Summary

新增跨包源码阅读指南：优先使用 Understand Anything 图谱导航，按固定提交检查新鲜度，并以源码、测试和运行证据核验；补充许可证、只读与敏感信息边界。

### Git Commits

| Hash | Message |
|------|---------|
| `f41de7f` | (see git log) |

### Status

[OK] **Completed**


## Session 17: Public Team Agent event contract

**Date**: 2026-08-21
**Task**: Public Team Agent event contract
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Added strict v2 Agent/Tool/Artifact runtime and public events, PostgreSQL 17 validation, durable SSE/headless projection, trajectory decoding, v1 compatibility, and focused cross-layer tests.

### Git Commits

| Hash | Message |
|------|---------|
| `38c6cff` | (see git log) |

### Status

[OK] **Completed**


## Session 18: Production Q&A Team Runtime

**Date**: 2026-08-21
**Task**: Production Q&A Team Runtime
**Branch**: `feat/datafoundry-platform-modules`

### Summary

接通真实 Semantic/Text2SQL/Report Team Runtime、DeepSeek Provider、Compiler、PostgreSQL Sandbox、Artifact/Acceptance authority，并以真实 Web SSE 完成重连与去重验收。

### Git Commits

| Hash | Message |
|------|---------|
| `89751b3` | (see git log) |

### Status

[OK] **Completed**


## Session 19: 完成 Q&A Team Agent 状态、Inspector 与纵向验收

**Date**: 2026-08-21
**Task**: 完成 Q&A Team Agent 状态、Inspector 与纵向验收
**Branch**: `feat/datafoundry-platform-modules`

### Summary

交付按 sequence 穿插的公开 Think/Tool/Subagent/正文、Codex 风格 Artifact/Subagent Inspector、SSE cursor 恢复、移动端布局与 Resolution Trace Product Team Artifact 严格校验；四个 Trellis 任务均已验证并归档。

### Git Commits

| Hash | Message |
|------|---------|
| `aa781dc` | (see git log) |
| `afa377b` | (see git log) |

### Status

[OK] **Completed**


## Session 20: Adaptive Agent Dispatch Runtime

**Date**: 2026-08-22
**Task**: Adaptive Agent Dispatch Runtime
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Delivered versioned DIRECT/TEAM/DEFERRED admission, PostgreSQL 10674 authority, selective Worker execution, rollout CAS, and real Web/Worker/PostgreSQL evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `c174d4b` | (see git log) |

### Status

[OK] **Completed**


## Session 21: Q&A Activity Stream and Safe Rich Text

**Date**: 2026-08-22
**Task**: Q&A Activity Stream and Safe Rich Text
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Delivered sequence-stable actual-agent activity rendering, sanitized rich Markdown with exact prior Artifact authorization, verified DEFERRED BLOCKED UX, responsive browser proof, and Harness provenance; full Web lint remains held only by two unchanged committed formatting issues.

### Git Commits

| Hash | Message |
|------|---------|
| `fc0cd2a` | (see git log) |

### Status

[OK] **Completed**


## Session 22: Governed Table and VChart Answers

**Date**: 2026-08-22
**Task**: Governed Table and VChart Answers
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Added deterministic visualization intent, committed QueryEvidence chart companions, shared Inline/Inspector previews, controlled VChart rendering, responsive evidence, and full validation.

### Git Commits

| Hash | Message |
|------|---------|
| `a328269` | (see git log) |

### Status

[OK] **Completed**


## Session 23: Private conversation directory and 30-day trash

**Date**: 2026-08-22
**Task**: Private conversation directory and 30-day trash
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Delivered exact-owner one-level conversation folders, lifecycle commands, 30-day PostgreSQL retention, desktop/mobile directory UI, and direct Run/SSE/Artifact trash denial with real browser evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `65d49ec` | (see git log) |

### Status

[OK] **Completed**


## Session 24: Audited admin conversation plane

**Date**: 2026-08-22
**Task**: Audited admin conversation plane
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Implemented the read-only Workspace Admin and Super Admin conversation audit plane with immutable PostgreSQL receipts, scoped routes, SSE replay, safe Artifact inspection, desktop/mobile UI, and vertical browser/SQL acceptance evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `6def992` | (see git log) |

### Status

[OK] **Completed**


## Session 25: Accessible Apple Glass Q&A presentation

**Date**: 2026-08-22
**Task**: Accessible Apple Glass Q&A presentation
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Added centralized accessible glass material tokens and fallbacks, mapped Q&A chrome without changing authority or geometry, preserved opaque data reading surfaces, and validated desktop/tablet/mobile layouts with full Web tests and browser evidence.

### Git Commits

| Hash | Message |
|------|---------|
| `320b8f3` | (see git log) |

### Status

[OK] **Completed**


## Session 26: Retire legacy attribution surface

**Date**: 2026-08-22
**Task**: Retire legacy attribution surface
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Removed the legacy Attribution Analysis product entry and root workbench fallback, added authorization-first workspace redirect, verified stable deferred attribution admission across rollout modes, and preserved shared eval/audit assets with a read-only cleanup inventory. Historical deletion remains HOLD for the separate destructive task.

### Git Commits

| Hash | Message |
|------|---------|
| `16f2734` | (see git log) |

### Status

[OK] **Completed**


## Session 27: Legacy Attribution Cleanup

**Date**: 2026-08-22
**Task**: Legacy Attribution Cleanup
**Branch**: `feat/datafoundry-platform-modules`

### Summary

Installed guarded 10678 cleanup authority and 10679 app/environment scope repair; created and fully restored a PostgreSQL custom backup; executed a persisted truthful NOOP receipt because all 12 attribution-only tables were empty; preserved generic data and live services.

### Git Commits

| Hash | Message |
|------|---------|
| `6841506` | (see git log) |

### Status

[OK] **Completed**


## Session 28: 完成知识库驱动语义层闭环

**Date**: 2026-08-22
**Task**: 完成知识库驱动语义层闭环
**Branch**: `codex/knowledge-driven-semantic-layer`

### Summary

跑通 Markdown 知识文档、精确段落证据、真实 Provider Agent 安全失败、可视化 ChangeSet、显式 Revision、创建者自审发布及 generation 3 Resolved Context/Text2SQL 消费，并补齐投影复用、权限护栏及并行迁移渲染路径消歧。

### Git Commits

| Hash | Message |
|------|---------|
| `0c3dcc6` | (see git log) |
| `432a199` | (see git log) |
| `c56466c` | (see git log) |

### Status

[OK] **Completed**


## Session 29: 交付内容优先的运行轨迹工作台

**Date**: 2026-08-22
**Task**: 交付内容优先的运行轨迹工作台
**Branch**: `feat/datafoundry-platform-modules`

### Summary

新增四泳道时间轴、搜索与虚拟列表、五页签公共详情 Inspector、exact Artifact/SQL 内容预览、Team 内容化展示、严格详情合同和 owner API；完成万级投影、管理员审计复用、1440/390 浏览器与三包构建验证。

### Git Commits

| Hash | Message |
|------|---------|
| `37d103d` | (see git log) |

### Status

[OK] **Completed**


## Session 30: 完成内容优先运行轨迹工作台

**Date**: 2026-08-22
**Task**: 完成内容优先运行轨迹工作台
**Branch**: `feat/datafoundry-platform-modules`

### Summary

交付 Resolution Trace Detail v2、Agent Team Public Trace v2、内容优先 Artifact/Run/Conversation/Config 投影、四泳道时间轴交互、10k 有界虚拟化与完整跨层/浏览器验收。

### Git Commits

| Hash | Message |
|------|---------|
| `08dbf89` | (see git log) |

### Status

[OK] **Completed**


## Session 31: Apple OpenAI 蓝色全站前端重构

**Date**: 2026-08-22
**Task**: Apple OpenAI 蓝色全站前端重构
**Branch**: `feat/datafoundry-platform-modules`

### Summary

建立 Data Agent Blue 设计系统，重构入口、工作空间、QA、分析、Semantic Studio、数据源与管理控制面，并补齐 system/light/dark 外观。

### Main Changes

- 统一 #3f63e8 蓝色 palette、Apple/OpenAI 材质、字体、圆角、动效与响应式 shell
- 重构登录、工作空间、QA、测试、任务、语义、数据源、成员和设置页面层级
- 新增持久化 system/light/dark 外观控制与暗色 token

### Git Commits

| Hash | Message |
|------|---------|
| `2b91f47` | (see git log) |
| `0209f0c` | (see git log) |
| `9eb86bc` | (see git log) |
| `b914e37` | (see git log) |
| `36a6354` | (see git log) |

### Testing

- [OK] Biome scoped check passed
- [OK] Focused Web tests: 24 passed
- [OK] Web typecheck and production build passed
- [OK] Browser verified desktop dark theme and 390x844 overflow

### Status

[OK] **Completed**

### Next Steps

- 修复并行语义/knowledge 改动导致的两项旧断言漂移后恢复全套 Web unit 全绿


## Session 32: 白蓝主题收口

**Date**: 2026-08-22
**Task**: 白蓝主题收口
**Branch**: `feat/datafoundry-platform-modules`

### Summary

删除 system/dark 主题与持久化入口，将登录身份区和全站外观固定为白色、冷浅灰与 Data Agent Blue。

### Main Changes

- 移除暗色 token、prefers-color-scheme dark 和主题启动脚本
- 删除设置页外观切换，登录页改为浅蓝白材质
- 同步前端规范和主题回归测试

### Git Commits

| Hash | Message |
|------|---------|
| `2271e92` | (see git log) |

### Testing

- [OK] Biome scoped check passed
- [OK] Focused design tests: 11 passed
- [OK] Web typecheck and production build passed
- [OK] Browser verified 1280 desktop and 390x844 mobile light-only rendering

### Status

[OK] **Completed**


## Session 33: 修复 Q&A 持久化事务失败

**Date**: 2026-08-22
**Task**: 修复 Q&A 持久化事务失败
**Branch**: `feat/datafoundry-platform-modules`

### Summary

恢复 10696 不可变 checksum，新增 10698 前向权限与 Root Harness 修复，并改用 ACTIVE run_attempt 权威读取轨迹。

### Main Changes

- 应用 10697/10698 并修复 validator 最小 ACL
- Resolution Trace 不再读取不存在的 runs.active_attempt_id

### Git Commits

| Hash | Message |
|------|---------|
| `d55e67f` | (see git log) |

### Testing

- [OK] Focused Vitest 11/11、Platform typecheck、Biome、renderer verify 通过
- [OK] 目标 workspace 前后计数一致，零数据删除

### Status

[OK] **Completed**

### Next Steps

- 用户可在现有已登录 Q&A 页面重新提交问题做现场 UI 确认


## Session 34: 修复新建业务问题对话导航

**Date**: 2026-08-22
**Task**: 修复新建业务问题对话导航
**Branch**: `feat/datafoundry-platform-modules`

### Summary

将 Q&A 侧边栏新建入口从同路由链接改为真实创建动作；创建成功后进入带 conversation ID 的可刷新 URL，创建期间防止重复提交，并补充成功、失败和并发点击回归测试。

### Git Commits

| Hash | Message |
|------|---------|
| `e443e1f` | (see git log) |

### Status

[OK] **Completed**


## Session 35: 修复 Knowledge usage 重复 React key

**Date**: 2026-08-22
**Task**: 修复 Knowledge usage 重复 React key
**Branch**: `feat/datafoundry-platform-modules`

### Summary

确认 usage 投影按 evidence block 展开；以 semantic subject 加 exact evidence reference 生成稳定行身份，添加回归测试并通过 Web typecheck、Biome 与相关测试。

### Git Commits

| Hash | Message |
|------|---------|
| `8bd3409` | (see git log) |

### Status

[OK] **Completed**


## Session 36: Workspace 构建新鲜度防复发

**Date**: 2026-08-22
**Task**: Workspace 构建新鲜度防复发
**Branch**: `feat/datafoundry-platform-modules`

### Summary

完成 Workspace build attestation、fail-closed 本地协调器、运行时 build identity、安全持久化诊断及 Docker/Release gate，并通过真实镜像与发布验证。

### Git Commits

| Hash | Message |
|------|---------|
| `bcbe95b` | (see git log) |
| `e75ab13` | (see git log) |
| `e9f9cba` | (see git log) |
| `fc63e99` | (see git log) |
| `2dc27ea` | (see git log) |

### Status

[OK] **Completed**


## Session 37: Semantic V2 refactor U1 guards

**Date**: 2026-08-23
**Task**: Semantic V2 refactor U1 guards
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

Added executable semantic and billing retirement ledger, dependency guards, migration identity inventory with exact historical exceptions, and active route characterization. Architecture and typecheck pass; full lint remains blocked by pre-existing unrelated errors.

### Git Commits

| Hash | Message |
|------|---------|
| `1ebaba6` | (see git log) |

### Status

[OK] **Completed**


## Session 38: Semantic refactor U2 Model Control extraction

**Date**: 2026-08-23
**Task**: Semantic refactor U2 Model Control extraction
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

Extracted provider, model catalog, SecretRef metadata, authentication readiness, and admin routes into a noncommercial Model Control boundary. Removed model-control symbols from Billing contracts and Pricing persistence, added executable architecture guards and updated the backend spec.

### Git Commits

| Hash | Message |
|------|---------|
| `c84f85e` | (see git log) |

### Testing

- [OK] contracts 15, platform 10, web 16, architecture ledger 7, pnpm test:architecture, pnpm typecheck

### Status

[OK] **Completed**


## Session 39: Semantic refactor U3 monetary gate removal

**Date**: 2026-08-23
**Task**: Semantic refactor U3 monetary gate removal
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

Removed pricing constraints, UNBILLABLE, monetary route budgets, Billing provider gates, and cost projections from Model Control, provider routing, Test Center, Eval scorecards, Web, Semantic Candidate, Q&A, and Worker runtime. Provider usage now preserves technical availability and nullable reported tokens.

### Git Commits

| Hash | Message |
|------|---------|
| `965b451` | (see git log) |

### Testing

- [OK] typecheck 16/16; focused contracts 61, agent-runtime 37, evals 28, semantic 9, platform 3, web 29, worker 22, root architecture 11; pnpm test:architecture

### Status

[OK] **Completed**


## Session 40: U4 删除计费产品面与运行时

**Date**: 2026-08-23
**Task**: U4 删除计费产品面与运行时
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

删除计费合同、仓储、Web API/UI 与 Worker 价格同步；运维健康门收敛为身份副作用，Model Control 与直连 Provider 保持非商业边界。通过全量类型检查、Web 生产构建和模型/Q&A/Provider 聚焦测试。

### Git Commits

| Hash | Message |
|------|---------|
| `7806ea7` | (see git log) |

### Status

[OK] **Completed**


## Session 41: U5 商业权威退役与历史数据冻结

**Date**: 2026-08-23
**Task**: U5 商业权威退役与历史数据冻结
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

新增 10703 前向迁移，将 22 张历史价格、积分与账单表冻结为只读归档；删除旧商业 RPC 和 smoke，拆分独立 Model Control operation/audit authority，并以 PostgreSQL 17 验证非空历史行原样保留、拒写和备份恢复。

### Git Commits

| Hash | Message |
|------|---------|
| `c041c21` | (see git log) |

### Status

[OK] **Completed**


## Session 42: U6 Semantic V2-only Runtime

**Date**: 2026-08-23
**Task**: U6 Semantic V2-only Runtime
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

统一 semantic-source-bundle@2 运行时内容与受控子路径，删除 V1 投影、候选自发布和 legacy governance surface，并以 10704 直接退役数据库 V1 authority。

### Git Commits

| Hash | Message |
|------|---------|
| `c69712b` | (see git log) |

### Status

[OK] **Completed**


## Session 43: U7 统一语义应用与生产组合根

**Date**: 2026-08-23
**Task**: U7 统一语义应用与生产组合根
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

将 Candidate compile/save、Governance、Studio、Explorer 用例迁入 Semantic application，Platform 收敛为 Contracts Port adapters；Web/Worker 分别统一到唯一 request/job composition，删除 Mock/default/global runtime 与重复 inbox endpoint，并补齐 conformance、架构与跨层验证。

### Git Commits

| Hash | Message |
|------|---------|
| `f606472` | (see git log) |

### Status

[OK] **Completed**


## Session 44: U8 语义 UI 清理与 V2-only 前端收口

**Date**: 2026-08-23
**Task**: U8 语义 UI 清理与 V2-only 前端收口
**Branch**: `refactor/semantic-v2-billing-retirement`

### Summary

删除遗留 Semantic/Data Link 入口和客户端权威状态，将 Studio/Explorer 收口为显式 Workspace V2 路径。

### Main Changes

- 删除全局 Semantic、Data Link、物理 schema、mock auth 与旧 store/redirect
- 以 reducer 管理 Studio Workspace、SSE、selection、draft、save conflict 与发布生命周期
- Explorer 改为显式 workspace API 身份并向只读角色开放

### Git Commits

| Hash | Message |
|------|---------|
| `858446e` | (see git log) |
| `771b335` | (see git log) |

### Testing

- [OK] Web unit 419 passed / 1 skipped，typecheck 与 production build 通过
- [OK] Semantic unit 132 passed，contracts/platform/worker 定向验证通过
- [OK] 390px 浏览器预览无横向溢出，旧 URL 默认 404

### Status

[OK] **Completed**

### Next Steps

- 按 TIS 定向方案创建 V2-only 词汇解析与绑定影响任务
