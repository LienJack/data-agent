# Technical Design

## 1. Architecture Outcome

本任务扩展现有 Workspace File、Knowledge Authority、Graph v2 Authoring、Semantic Governance 和 Text2SQL Resolved Context，不创建平行存储或发布链路。

```text
Workspace Markdown File (PostgreSQL + immutable blob)
  -> Markdown Parse Job
  -> Knowledge Document Revision + selectable Blocks
  -> Knowledge Generation / search projection
  -> Evidence Selection
  -> Agent or Manual typed operations
  -> authoring Working ChangeSet (durable run state, not a governance revision)
  -> explicit Save Draft
  -> Candidate Revision + SemanticGraphPatch chain
  -> deterministic Validation Receipt
  -> Review Decision
  -> Publish Receipt + active Semantic Release
  -> exact Resolved Context
  -> Text2SQL compile / gate / PostgreSQL execute
```

PostgreSQL 保持文件、Knowledge Revision、Block、Selection、durable authoring run/tool receipts、Candidate Revision、Review、Release 与消费绑定的唯一权威。Neo4j/向量索引只保存可重建的检索投影。

## 2. Package and Ownership Boundaries

### `packages/contracts`

新增或版本化以下 strict DTO：

- `KnowledgeDocumentRevision`
- `KnowledgeDocumentBlock`
- `KnowledgeCorrectionAnnotation`
- `KnowledgeUsageProjection`
- `KnowledgeEvidenceSelection`
- `SemanticAuthoringOperationOrigin`
- `SemanticWorkingChangeSet`
- `SemanticCandidateRevisionSaveCommand`
- `SemanticReviewAndPublishCommand/Result`

所有引用使用完整 scope、immutable id、revision 与 content hash。Public DTO 不返回 raw vector、storage key、Provider body 或不可见段落正文。

### `apps/worker`

- Markdown parser 将 UTF-8/NFC/LF 内容转换为标题、段落、列表、代码块和表格等稳定 block。
- Parser 只解析 exact READY File Revision；同一输入、parser version 与 policy version 生成同一 block identity/hash。
- Knowledge index 继续使用现有 chunk/vector authority，但 selectable block 与 search chunk 分离：block 是用户引用单位，chunk 是检索投影单位。
- 段落 Agent 只接收用户提交的 exact Evidence Selection、Schema Snapshot 与 active Release；不执行全文隐式扩展。

### `packages/platform`

- PostgreSQL repositories/RPC 负责 Knowledge Revision、Blocks、Annotations、Usage、Evidence Selection 与 Candidate save。
- 所有 mutation 在 `withAppTransaction` 中重新授权 Workspace/semantic scope。
- Save Draft 以 expected working revision/base digest 执行 CAS；一次保存原子提交整组 operations、patch、revision 和 audit event。
- “审核并发布”服务在一个服务端命令和数据库事务中顺序执行 review decision 与 publish；两类事实和审计记录独立，但只在全部门禁成功后共同提交，失败不伪造批准或 active Release。

### `packages/semantic`

- 复用 Graph v2 `SemanticGraphPatchOperation` 和 reducer。
- Agent、Knowledge Agent 与 Manual Editor 只负责产生 typed operations；同一 reducer 计算 next graph 和 patch digest。
- Validation 扩展字段存在性、formula return type、grain/unit/time、mapping ambiguity、cycle、endpoint policy、stale base 和 exact evidence closure。
- system-managed Node/Edge mutation 在 operation reducer 前失败关闭。

### `apps/web`

- 新增 workspace-scoped Knowledge Base 资产列表、详情、Revision/usage/ACL 视图和 Markdown block selector。
- Semantic Studio 增加三种入口与共享 Working ChangeSet store。
- Direct Editor 使用判别联合表单，不接受任意 JSON/JSON Patch。
- Agent 产生的未保存 Working ChangeSet 继续使用现有 durable authoring run/tool receipt 机制以支持 Worker 恢复；Manual 未保存操作可属于当前浏览器会话。两者都只有在显式 Save Draft 后才成为可审核、可恢复的 governance Candidate Revision。
- Review UI 支持“审核并发布”，但分别展示 review 与 publish 结果。

### `packages/text2sql`

- 不接受 Candidate 或 Knowledge block 作为 runtime semantic authority。
- 只通过现有 Resolved Context 获取 exact active Release。
- MVP 验收记录 release binding、compiler/AST/SQL hash、gate receipts、execution receipt 与 result summary。

## 3. Knowledge Data Model

### 3.1 Document Revision

`KnowledgeBaseRevision` 继续表达资产配置和 active Generation。新增 `KnowledgeDocumentRevision` 表达一个源文件经过特定 parser 后的不可变结构化文档：

- scope
- knowledge base ref
- file ref
- document revision/hash
- parser/policy version
- canonical markdown hash
- block manifest hash/count
- parent document ref（新文件版本或纠错派生）
- status/reason code

### 3.2 Selectable Block

Block identity 不依赖显示序号，使用：

```text
document ref
+ block kind
+ canonical heading ancestry
+ source byte start/end
+ normalized text hash
+ parser version
```

Block 至少包含：

- `HEADING | PARAGRAPH | LIST | TABLE | CODE`
- source byte range
- line start/end（仅用于 UI 辅助）
- heading ancestry
- normalized text hash
- display excerpt（授权后返回）
- ordinal（仅排序，不参与跨 Revision 身份复用）

表格 MVP 以完整 Markdown table block 作为选择单位；不支持单元格编辑。

### 3.3 Correction Annotation

纠错不改写原 Block。Annotation 引用 exact block，保存 correction text、reason、author、created_at 与 new Knowledge Revision。消费方显示原文和修正；只有用户选择新 Revision 下的 corrected evidence 时才进入 Agent。

### 3.4 Usage Projection

Usage 由权威引用反向投影生成：

- Candidate revision refs
- Review packet refs
- Published release/object refs
- last Text2SQL consumption refs（可选摘要）

投影可重建，不能决定发布状态。

## 4. Evidence Selection Contract

用户选择 block 后提交 `KnowledgeEvidenceSelection`：

- exact Knowledge Base/Document/File refs
- canonical sorted block refs
- selection hash
- selected by principal / selected at
- intended semantic domain

Agent Input 中只包含所选 block 的授权文本，以及：

- exact Schema Feature Packet
- exact active Semantic Graph projection
- allowed authoring tool catalog

Agent 可返回“建议补充证据”引用，但该引用只能来自独立 search response，不能进入当前 proposal 的 `evidence_refs`，直到用户显式追加并产生新 Selection hash。

## 5. Unified Authoring and Save Model

### 5.1 Working ChangeSet

Working ChangeSet 是 authoring 会话状态，不是 governance Candidate Revision。Agent 工具调用仍按现有 PostgreSQL authoring run/tool/patch/event Authority 持久化以支持 lease、replay 与 crash recovery；这类 `working_revision` 不得出现在 Review Inbox 中。Manual 未保存操作可以只在浏览器 dirty state 中累积。两者共享：

- candidate/base release identity
- base working revision/digest
- ordered typed operations
- per-operation origin: `CHAT_AGENT | KNOWLEDGE_AGENT | MANUAL`
- exact evidence refs
- dirty flag

Agent 每次 tool mutation 通过现有 durable authoring store 提交并重放，Manual 表单操作先在当前会话应用；两者都使用相同 reducer，立即显示 overlay 和 provisional validation。UI 必须明确区分 `authoring working revision` 与 `governance candidate revision`。

### 5.2 Explicit Save Draft

用户点击保存时：

1. Web 提交 expected candidate/base/working revision/digest、operations、origin/evidence closure 和 idempotency key。
2. 服务端重新读取 exact base graph。
3. 服务端重新运行 reducer，逐字匹配客户端 after digest。
4. PostgreSQL 原子提交 Candidate Revision、patch、operation origin、evidence refs 和 audit event。
5. 返回新 working revision/digest。

字段失焦、Agent 完成一轮、页面定时器都不得调用 Save Draft。

### 5.3 Submit Review

只接受已保存 Revision。提交后冻结 revision/digest 与 validation receipt。继续编辑从已保存 Revision 创建 successor；旧 Review 不随 latest candidate 漂移。

## 6. Manual Editor

- Node 表单按 node type 分支；只显示固有属性与 evidence refs。
- Edge 表单先选择 registry type，再由 endpoint policy 过滤 source/target；attributes 用该类型的 strict schema 渲染。
- system-managed Node/Edge 显示锁定原因和刷新 Schema 入口。
- Delete 统一为 retire；不提供 hard delete。
- 新 Edge Type 使用独立 proposal flow，不混入普通 instance editor。

## 7. Validation and Failure Model

Validation 分层：

1. Contract：strict schema、canonical order、hash、scope。
2. Graph：identity、endpoint、dangling/cycle、system-managed policy。
3. Formula：parse/AST、return type、dependencies、grain/unit/time/null policy。
4. Physical grounding：table/column exists、snapshot current、mapping cardinality、join proof。
5. Evidence：selected block closure、field evidence、Knowledge Revision currentness。
6. Release：base active release、catalog epoch、dependency generation、permission。

阻断 issue 必须稳定 reason code、subject id、path 和 recovery hint。模型 prose 不能把 FAIL 变为 PASS。

## 8. Review and Publish

创建者可自审自发，但必须拥有对应 capability。Web 的单次动作调用 server orchestration：

1. 重新校验 exact saved Revision 与 validation receipt currentness。
2. 提交 Review Decision。
3. 准备 Publish Attempt。
4. 编译/绑定 executable、relationship、runtime restriction projections。
5. Commit Publish 并变更 active pointer。

Review Decision 与 Publish Receipt 是独立事实和审计记录，但本 MVP 的一步命令在同一数据库事务内提交；任一步失败都会回滚整次命令，不留下伪 Approved、半激活 Release 或 Published UI。

## 9. Knowledge Revision Impact

新 Knowledge Revision 只计算依赖影响并显示“待复核”，不自动创建或修改 Candidate。用户查看新旧 block Diff、重新选择 exact evidence 后，主动要求 Agent 生成更新候选。影响结果属于可重建 read projection，不能成为语义发布 Authority。

Published Release 在知识更新后继续服务；Knowledge 变化本身不能自动让 Text2SQL 切换或中断。若政策需要强制失效，应作为后续独立治理能力设计。

## 10. API Surface

建议新增 workspace-scoped routes：

- `GET/POST /api/workspaces/:workspaceId/knowledge-bases`
- `GET/PATCH /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId`
- `GET /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/revisions`
- `GET /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/documents/:documentRevisionId/blocks`
- `POST /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/annotations`
- `GET /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/usage`
- `POST /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/evidence-selections`
- `POST /api/workspaces/:workspaceId/semantic/studio/candidates/:candidateId/save`
- `POST /api/workspaces/:workspaceId/semantic/studio/candidates/:candidateId/submit-review`
- `POST /api/workspaces/:workspaceId/semantic/studio/candidates/:candidateId/review-and-publish`

实际路由在实现前按现有 route/service 命名对齐；所有 input/output 使用 contracts strict parser。

## 11. Compatibility and Migration

- 新表/RPC 使用后续 migration number，不修改历史 migration。
- 现有 Knowledge Base Revision/Generation 和 search API 保持可读；结构化 Document/Block 是新增 authority。
- 现有 Agent authoring tool calls 继续可用；origin/evidence/save contracts 通过 versioned adapter 接入。
- 现有 `/settings` Knowledge panel 改为摘要与跳转，避免维护两套完整管理 UI。
- 已发布 Semantic Release 与现有 Text2SQL runtime contract 不改写；新 Release 通过既有 active pointer 消费。

## 12. Security, Audit and Privacy

- 所有 Knowledge/Block API 先验 ACL，再返回正文或 excerpt。
- Evidence search 与 suggestion 不泄露无权 block 的存在、数量或相似度。
- Agent 上下文只包含用户确认的 block 内容；系统提示词、凭据、raw model/provider payload 不持久化到公共 trace。
- 原始 Markdown 中的 prompt injection、credential/PII policy 继续使用现有 Projection Receipt 失败关闭。
- Direct Editor 不能提交任意 JSON、SQL、Cypher、authorization 或 publish operation。

## 13. Rollout and Rollback

Feature flags 建议分开：

- Knowledge asset pages/read model
- Markdown structured parse
- Evidence selection
- Knowledge Agent authoring
- Manual editor
- Review-and-publish UX

关闭 flags 时继续服务现有 Knowledge search、Semantic Studio read、active Release 和 Text2SQL。新 Candidate/Revision/Receipt 保留，不做破坏性 down migration。Neo4j/embedding/block read projections均可重建。
