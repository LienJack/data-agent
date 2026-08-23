# Knowledge Base Authority

> U15 建立的 Workspace Knowledge 文档索引、向量投影与检索证据约定。

## Authority 边界

- PostgreSQL 冻结 Knowledge Base Revision、U6 File Revision、Embedding Profile、Generation、
  protected Chunk/Vector、Projection Receipt、Retrieval Receipt 与 U10 Job 输出。
- Neo4j 只保存 `scope + generation + chunk_id + vector` 的可删除投影；未 seal、丢失、漂移或
  不可用时返回稳定 NOT_READY，禁止改走 PostgreSQL lexical fallback。
- U2 `KNOWLEDGE` requested/effective ref 指向 READY Knowledge Base Revision；该 revision hash
  内冻结 active Generation ref。历史 Effective Config 不做 latest lookup。

## 索引顺序

```text
U10 exact lease/fence
  -> load exact U6 READY bytes
  -> UTF-8/NFC/LF parser
  -> 4000 byte chunk + 256 byte overlap
  -> deterministic chunk/projection/build IDs
  -> Projection Receipt
  -> Embedding port
  -> PostgreSQL stage
  -> Neo4j stage/verify/seal
  -> PostgreSQL READY
  -> U10 domain output
```

- Chunk ID 由 source revision、byte offsets 与 normalized text hash 派生；重试不得生成新身份。
- BLOCKED Projection Receipt 先在 PostgreSQL 以 exact Lease 提交，随后零 Embedding 网络失败。
- Stage 与 READY 都支持同命令 exact replay；同 generation 的不同 chunk/projection/manifest/
  checkpoint 稳定冲突。
- READY Generation 的 Chunk/Projection/Checkpoint 不可更新；重建必须产生新 Base Revision 与
  Generation。

## 检索顺序

1. PostgreSQL 读取 exact READY Base/Generation/Profile/Checkpoint，并复核 principal 与 ACL。
2. Query 先经过 projection gate，再调用 exact Embedding Profile。
3. Neo4j 只返回当前 generation 的 candidate chunk IDs 与 score。
4. PostgreSQL 重新读取 Chunk、U6 current File Revision、ACL 与 Generation hash，提交
   `KnowledgeRetrievalReceipt`。
5. Public DTO 只返回 Evidence ref、citation offsets/hash 与 score；禁止 raw chunk/vector、
   storage key、Provider body、credential 或 Cypher。

## 必需门禁

- Contracts：nested hash、target/stage closure、tamper 与 public redaction。
- Platform：DB result request correlation、dimension/provider/profile mismatch、Neo4j no-fallback。
- Worker：deterministic overlap、blocked projection zero-network、embedding/index failure no READY、replay。
- PostgreSQL：10661 renderer header/Ledger checksum exact、FORCE RLS/NOLOGIN owner、U10/U2 successor、
  fresh PG17 assertion 39。
- 中间单元不得导入或运行 Falcon，不得调用真实 Provider；Falcon 仅作为 U1-U20 最终门禁。

## Markdown Document 与语义创作边界

- Markdown MVP 在 READY Workspace File 与 Knowledge Base Revision 之上提交不可变
  `KnowledgeDocumentRevision`。可选择 Block 与检索 Chunk 分离：Block 是带 byte/line locator、标题祖先、
  normalized text hash 和 parser version 的引用 Authority；Chunk/Vector 仍只是可重建搜索投影。
- 用户发起语义生成前必须冻结 exact Evidence Selection。Agent 只能读取该 Selection 中已授权的 Block
  正文；搜索建议或未选择段落不能静默进入 proposal evidence。
- Knowledge Revision、Block 和已被引用的原文不可原地覆盖。纠错通过新 Revision 或绑定 exact Block 的
  Annotation 表达；新 Knowledge Revision 只计算影响，不自动创建 Candidate 或切换 Published Release。
- Chat Agent、Evidence-bound Agent 与 Manual Editor 统一产生 Graph v2 typed operations。Agent working
  revision/tool receipt 是可恢复创作状态，不是治理 Candidate Revision；只有用户显式点击保存，服务端以
  exact base/digest CAS 重放 reducer 后才能创建 Source/Candidate Revision。
- 创建者自审发布仍要求 Workspace OWNER、exact saved Revision、确定性 compiler/validation 和当前 active
  base。Review 与 Publish 是独立事实和审计记录，但一步命令在同一 PostgreSQL 事务内提交；失败不得留下
  伪 Approved 或部分激活 Release。
- Text2SQL 只经 Resolved Context 读取 exact active Source Release 的 Graph/U5 projections；Candidate、未保存
  overlay、Knowledge Block 和 Neo4j 投影都不能成为运行时语义 Authority。

## Scenario: Knowledge Evidence 驱动 Semantic Candidate

### 1. Scope / Trigger

- 新增或修改 Markdown Document/Block、Evidence Selection、Manual Working ChangeSet、Candidate Revision
  恢复、自审发布或 Resolved Context 消费时，必须同时遵守本场景。

### 2. Signatures

- API：`POST /api/workspaces/:workspaceId/knowledge-bases/:knowledgeBaseId/evidence-selections`。
- API：`POST /api/workspaces/:workspaceId/semantic/studio/manual-sessions`、`candidate-revisions`、
  `self-publish`。
- DB：`semantic.save_semantic_candidate_revision(jsonb)`、
  `semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)`、
  `semantic.self_review_and_publish_semantic_candidate(jsonb)`。

### 3. Contracts

- Evidence Selection 冻结 `knowledge_base_ref + ordered block_refs + selection_hash + semantic_domain`；
  Agent 输入只能装载这些 exact blocks。
- Explicit Save 绑定 `authoring_run_id + expected_working_revision + expected_graph_digest + manual_edits`
  并返回 `candidate_revision_id + source_revision_id + revision_number + final_graph_digest`。
- Restore 必须同时匹配 App/Tenant/Environment、Principal、Domain、Authoring Run、Candidate 与当前
  `materialized_candidate_revision_id`，不存在时返回 `null`，禁止 latest-by-domain。
- Self Publish 只接受创建者本人当前 saved Revision；OWNER 能力、base pointer 与 compiler digest 必须在同一
  PostgreSQL 事务内重新校验。
- Worker Embedding 需要 `DATA_AGENT_KNOWLEDGE_EMBEDDING_PROVIDER`、`_MODEL_ID`、HTTPS `_BASE_URL`
  与 Secret `_API_KEY`；缺失时保持 NOT_READY，不能伪造向量或 READY Profile。

### 4. Validation & Error Matrix

- Selection 引用未选、越权、hash/domain 不一致 -> `KNOWLEDGE_EVIDENCE_SELECTION_*` 或
  `SEMANTIC_CANDIDATE_EVIDENCE_MISMATCH`。
- Save working revision/digest/base 变化 -> `SEMANTIC_CANDIDATE_SAVE_CONFLICT|STALE_BASE`，不覆盖。
- Restore scope/principal/run 被替换 -> `SEMANTIC_CANDIDATE_RESTORE_*` 或 `null`，不泄露其他 Revision。
- 修改 Physical Node/Edge -> reducer/DB 以 system-managed mutation 拒绝。
- 非 OWNER、自审非本人 Revision、active pointer 变化 -> `SEMANTIC_CANDIDATE_SELF_PUBLISH_*`，零 Review/
  Release 半成品。
- Embedding/Profile/Index 未配置 -> stable NOT_READY/FAILED reason code，Knowledge Revision 不进入 READY。

### 5. Good/Base/Bad Cases

- Good：用户选 exact Markdown blocks，Agent 生成 typed operations，用户连续手工调整，显式保存后刷新恢复，
  OWNER 自审发布，Text2SQL 绑定新 active Release。
- Base：只直接编辑；Manual Session 从 active Graph 创建，零 autosave，显式保存形成第一个 Revision。
- Bad：根据搜索推荐自动扩展未选段落、按 Domain 取 latest Revision、直接更新 Physical fact、让 Agent 或 UI
  绕过 Review/Publish RPC。

### 6. Tests Required

- Contracts：Markdown UTF-8/NFC/LF、Block/hash tamper、strict save/publish request。
- Web：无 POST 不产生 Revision；三 mutation route 严格解析；刷新只恢复 exact run 的 saved Revision。
- PostgreSQL：RLS/grant、cross-scope、save replay/conflict、restore、self-review atomicity、rollback active pointer。
- Text2SQL：读取 exact Published Release，执行真实 PostgreSQL SQL；rollback 后旧指标必须
  `PUBLISHED_METRIC_NOT_FOUND`，不得执行 stale SQL。

### 7. Wrong vs Correct

#### Wrong

```ts
await autosave(manualEdits);
const revision = await getLatestCandidateRevision(semanticDomain);
```

#### Correct

```ts
const saved = await saveExactWorkingChangeSet({
  authoring_run_id,
  expected_working_revision,
  expected_graph_digest,
  manual_edits,
});
await restoreSavedRevision({ semantic_domain, principal_id, authoring_run_id: savedRunId });
```
