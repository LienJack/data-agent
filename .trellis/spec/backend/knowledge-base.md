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
