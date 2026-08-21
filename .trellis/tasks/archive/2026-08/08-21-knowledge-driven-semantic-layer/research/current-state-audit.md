# Current-state Audit

## Purpose

记录 MVP 实现前的当前代码事实、可复用边界和已确认缺口。本文是规划证据，不代表功能已实现。

## 1. Existing Knowledge Authority

### Reusable

- `packages/contracts/src/knowledge/knowledge-base.ts` 已定义 Knowledge Base Revision、Generation、Chunk、Embedding/Projection Receipt、Evidence Hit、Retrieval Receipt、Create/Rebuild Command 与严格 hash verifier。
- Chunk 已绑定 exact Knowledge Base、Generation、Workspace File Revision、byte range、text/embedding/projection hashes。
- Evidence Hit 已绑定 ACL decision、query projection receipt、exact chunk/file/generation 与 citation byte range。
- `packages/platform/src/knowledge/postgres-knowledge-registry.ts` 已通过 `withAppTransaction` 调用 create/rebuild/list/load/stage/commit/search authority RPC。
- `apps/worker/src/knowledge/knowledge-index-job.ts` 已有 deterministic chunk id、projection gate、embedding、Neo4j stage/verify/seal、PostgreSQL READY 顺序。

### Missing for this PRD

- 现有 Chunk 是 4,000-byte retrieval unit，不是用户可选择的 Markdown semantic block。
- 没有 Document Revision、Block Manifest、heading ancestry、block kind、annotation 或 reverse usage contract。
- 当前 `/settings` UI 只创建、重建和调试搜索；没有独立 Knowledge asset pages。
- 没有 update/revise/annotate/usage API；Knowledge Base mutation surface 只有 create/rebuild。
- PDF/DOCX 可通过 file scan，但 Worker knowledge parse 不支持；MVP 已明确只做 Markdown。

## 2. Existing Semantic Authoring

### Reusable

- `SemanticGraphPatchOperation` 已覆盖 Add/Update/Retire Node/Edge 和 Add Edge Type。
- `createSemanticGraphPatch`/`applySemanticGraphPatch` 已实现 graph/candidate/revision/digest closure 与 system-managed mutation protection。
- Authoring tool catalog 已覆盖 search/read/binding/formula/diff/create/update/retire/validate/impact/clarification/complete。
- PostgreSQL authoring store 已有 lease/fence、turn、tool receipt、graph patch、checkpoint、event replay、clarification 和 terminal。
- 每个 Agent tool mutation 已持久化 typed receipt、patch 和 next working graph；这些是 runtime recovery authority，不等同于用户显式保存的治理 Candidate Revision。

### Key Integration Decision

用户“不自动生成可恢复 Revision”的要求不能通过删除 Agent durable tool receipts 实现。Worker crash recovery 仍需要持久化 authoring run/tool/patch/event。正确边界是：

- Agent runtime working state 按现有机制 durable/replayable；
- Manual unsaved operations 可保持浏览器/临时会话状态；
- 只有用户点击“保存草稿”才把当前 exact working graph/patch chain 封装成新的治理 Candidate Revision；
- Agent tool receipt 的每次 working revision 不应在 Review Inbox 中表现为一个可审核 Candidate Revision。

设计/实现时需要在术语和 UI 中区分 `authoring working revision` 与 `governance candidate revision`，避免把两者混为同一版本号。

### Missing for this PRD

- Authoring tool receipts 没有 `CHAT_AGENT | KNOWLEDGE_AGENT | MANUAL` operation origin。
- Agent start/input 没有 exact Knowledge Evidence Selection。
- 现有 Studio 没有 Manual Node/Edge form，也没有 mixed-origin Working ChangeSet。
- 没有“显式保存整个 working state 为 governance Candidate Revision”的统一 adapter。
- 现有 `complete_authoring_run` 直接进入 READY_FOR_REVIEW，需要调整为“完成 Agent 工作，但仍等待用户显式 Save/Submit Review”的产品状态或适配层。

## 3. Existing Governance

### Reusable

- PostgreSQL service 已调用 `semantic.create_candidate_draft`、`human_prepare_publish_attempt`、`human_commit_publish_attempt` 和 `human_execute_rollback`。
- Candidate、Review、Publish、Rollback 数据面与 active release pointer 已存在。
- PostgreSQL runtime 可 fail closed；mock 仅显式非生产模式。

### Missing or Changed by PRD

- 当前前端审核数据模型仍有部分 M1/mock-oriented projection，需要核验 exact Graph v2 Candidate Revision/validation receipt 是否已完整贯通。
- PRD 允许 proposer 自审自发，现有 UI hook/policy 中如有 proposer exclusion 必须以 server capability 为准移除；不能仅修改前端。
- “审核并发布”需要服务层组合命令，但数据库仍保留 Review Decision 和 Publish Receipt 两段事实。
- Publish failure after review 必须返回 approved/not-published，而不是 UI 原子假象。

## 4. Existing Text2SQL Boundary

- Text2SQL/Resolved Context 已设计为消费 Published Semantic Release；Candidate 不得进入 runtime。
- MVP 不应新增 Knowledge-to-SQL 快捷通道。Knowledge 只生成 Candidate，发布后由 existing exact Release binding 进入 Text2SQL。
- 最终证明必须选择真实 PostgreSQL fixture/question，捕获 release ref/hash、resolved context、compiler/AST/SQL hashes、gate/execution receipts 和 result summary。

## 5. Highest-risk Compatibility Points

1. **Two version domains**：Agent working revision 与 governance Candidate Revision 必须分离命名、持久化和 UI 状态。
2. **Two content units**：search chunk 与 selectable Markdown block 必须分离；不能用 embedding chunk 假装段落。
3. **One publish truth**：Graph patch、legacy semantic diff 与 induction candidate 只能汇入同一 U5 Candidate/Release Authority，不能各自可发布。
4. **Selected evidence closure**：search suggestions 不得进入 proposal evidence，直到用户产生新的 Selection hash。
5. **Manual editing parity**：Manual Editor 必须调用相同 typed operation/reducer/validator；任意 JSON 输入不符合 PRD。
6. **Physical facts**：Manual/Agent 都不能改 SYSTEM_MANAGED nodes/edges。
7. **Self-publish**：同一 principal 可有 review+publish capability，但每一步仍需 server-side authorization/currentness。
8. **Runtime proof**：Published UI state 不能代替 exact Text2SQL execution evidence。

## 6. Candidate File Map

实现前优先核验并可能修改：

- Contracts：`packages/contracts/src/knowledge/knowledge-base.ts`、`packages/contracts/src/artifacts/semantic-graph-v2.ts`、`semantic-authoring.ts`、`semantic-governance-requests.ts`
- Semantic：`packages/semantic/src/graph-v2/*`、`authoring/*`、`induction/*`
- Platform：`packages/platform/src/knowledge/*`、`semantic/postgres-semantic-authoring.ts`、governance adapters
- Worker：`apps/worker/src/knowledge/knowledge-index-job.ts`、`semantic/authoring-*`
- Web server：workspace knowledge routes/runtime、semantic studio routes/services、governance service
- Web UI：workspace navigation、new knowledge pages/components、Semantic Studio inspector/composer/editor/store
- DB：additive migration after current highest version plus fresh PostgreSQL assertion
- Tests：contracts, semantic, platform, worker, web, browser, tenancy/security, Text2SQL integration

## 7. Planning Consequence

当前代码能显著复用 Knowledge Authority、Graph reducer、durable Agent authoring 和 U5 Governance，但缺少用户可选择的结构化 Markdown asset layer、显式 governance save、manual editor 和 exact evidence-bound Agent。实现应先冻结 contracts/authority，再做 UI；从 UI 开始会迫使后续重写版本与证据边界。
