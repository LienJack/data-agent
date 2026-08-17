# U15 Knowledge Base 文档索引与检索证据

## Goal

在已提交的 U6 Workspace File 与 U10 Job Center 上建立可审计 Knowledge Base：管理员选择 exact READY
File Revision，后台 Job 执行确定性解析、切片、敏感数据投影与 Embedding，PostgreSQL 冻结 Chunk、ACL、
Generation、Embedding 与检索证据，Neo4j 只保存可删除重建的向量投影。Web 提供列表、重建与检索调试，
新 Run 只能选择 exact READY Knowledge Generation，检索命中只能作为 Evidence，不能直接发布语义权威。

## Requirements

1. Knowledge Base Revision 必须绑定同 Scope 的 exact U6 `READY`、未删除 File Revision；调用方不能提交 storage key、raw bytes、scan verdict、chunk、vector、generation hash 或 readiness。
2. PostgreSQL 是 Knowledge Base、Source Revision、Chunk、Embedding Profile、Generation、Checkpoint、ACL、Retrieval Receipt 与 Job 输出的唯一 Authority。Neo4j 属性、Provider 输出或 Zod parse 不能授予 READY。
3. U15 通过 successor migration `10661` 新增 U10 `KNOWLEDGE_INDEX` Job Kind、真实 `knowledge-index-handler@1.0.0` 与 readiness；不修改 10659/10660，不创建旁路队列。
4. `EmbeddingProfileRevision` 冻结 API Provider、Model、dimension、normalization、parser/chunker/policy version、projection policy 与 technical readiness。Profile、source revision、ACL 或 parser/chunker 变化必须创建新 Generation。
5. Embedding 前必须先生成 sensitivity-aware `KnowledgeDataProjectionReceipt`：只允许 PUBLIC/INTERNAL、无 credential/PII、已归一化的 chunk；RESTRICTED/SECRET、DLP 命中、prompt-injection policy block 或 provider 不允许均零网络失败。
6. `EmbeddingProviderPort` 只接收投影后的文本和 exact profile，返回 dimension 闭合的有限 number vector；未知字段、NaN/Infinity、维度不符、Provider/Model 换绑、usage/raw response 泄漏均失败关闭。测试只用 fake transport。
7. 文档解析 v1 只支持 U6 已允许且 READY 的 UTF-8 text/markdown/json/csv；parser 按版本确定性规范化，chunker 使用固定 UTF-8 byte budget/overlap，Chunk ID 与 hash 由 source revision + offsets + normalized text hash 派生。
8. PostgreSQL 保存受保护 normalized chunk text、vector 与完整 hash；Neo4j 仅保存 scope/generation/chunk key/vector。索引丢失可从 PostgreSQL 重建，不重新读用户文件或重新调用 Embedding Provider。
9. Worker 固定顺序：U10 claim/start/heartbeat → exact target/file bytes → parse/chunk → per-chunk projection gate → fake/production embedding port → PostgreSQL stage generation → Neo4j stage/verify/seal → PostgreSQL READY checkpoint → U10 success receipt。Fence、source、ACL、profile 或 projection 漂移时不能 READY。
10. Neo4j disabled/unconfigured/unhealthy、checkpoint missing/stale、dimension mismatch、ACL downpush 无法证明或 indexer heartbeat unhealthy时返回稳定 `NOT_READY/STALE`；不得静默切换到 lexical/PostgreSQL 检索语义。
11. 检索先从 PostgreSQL读取 exact READY snapshot/checkpoint，再由 Neo4j 返回 candidate chunk keys，最后重新读取 PostgreSQL exact snapshot并做 ACL、source status 与 generation hash复核；任何漂移均零命中失败关闭。
12. `KnowledgeEvidenceHit` 必须绑定 Knowledge/Generation/Chunk/File Revision、score、query projection/hash、ACL decision、checkpoint 与 receipt hash；它是 Research/A02/R05 可引用 Evidence，不是 Published Semantic Release。
13. U2 Defaults/Run optional `KNOWLEDGE` binding 必须解析 exact READY Knowledge Base Revision 与 active Generation；deleted/stale/index not ready/cross-scope 返回 truthful unavailable，新 Run 不得选择，历史 Config 仍保留 exact hash。
14. Web 只暴露已解析 DTO：list/create/rebuild、debug search、status/reason、source citations 和 generation metadata；不暴露 raw vector、完整 chunk text、Provider body、credential、storage key、Neo4j/Cypher 或跨 Workspace 对象存在性。
15. 所有边界 strict schema、canonical hash、UTC ms、safe integer、lowercase UUID；所有 mutation idempotent，同键异 intent冲突。
16. 中间验证不导入或运行 Falcon，不调用真实 Provider，不新增 Billing/Credit/Price，不使用 Claude/Anthropic。

## Acceptance Criteria

- [x] Contracts 覆盖 Knowledge Base/Profile/Generation/Chunk/Projection/Checkpoint/Search/Evidence/Job strict wire 与 hash/tamper。
- [x] 10661 建立 PostgreSQL Authority、FORCE RLS、NOLOGIN owner、窄 backend/job RPC、U10 successor 与 U2 Knowledge resolver。
- [x] Platform Registry/Index/Neo4j/API Embedding/Projection adapter逐项校验 scope/ref/hash/dimension/ACL，错误稳定且去敏。
- [x] Worker `KNOWLEDGE_INDEX` Handler 在 exact U10 Lease/Fence 下完成 staging→seal→READY，失败不产生 READY。
- [x] Web list/create/rebuild/debug routes 与 Knowledge Bases panel 接线完成；debug hit有引用但不泄漏 raw chunk/vector。
- [x] Run selection/Effective Config 冻结 exact READY Knowledge generation；stale/deleted/cross-scope fail closed。
- [x] Happy、source revision stale、delete、embedding failure、DLP/injection、Neo4j lag、dimension、ACL、indexer unhealthy、idempotent replay、cross-workspace 和 rebuild tests 全部通过。
- [x] Contracts/Platform/Worker/Web tests、typecheck/build、Biome、renderer/static、fresh PG17 assertions、diff/forbidden scan全绿。
- [x] Trellis check 无 U15-owned P0/P1，创建单一 scoped commit；Falcon继续保留到U1–U20最终门禁。

## Non-goals

- 不在 U15 发布 Semantic Candidate/Release；A02 仅消费 Knowledge Evidence Hit。
- 不实现图片 OCR、Office/PDF 高级解析或网页爬取；unsupported MIME 明确失败关闭。
- 不把 PostgreSQL lexical search作为Neo4j向量检索 fallback。
- 不运行 Falcon、导入数据或调用真实 Embedding/Model Provider。
