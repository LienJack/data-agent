# U15 Technical Design

## End-to-end authority flow

```text
U6 READY File Revision + bytes
  -> Knowledge Base Revision (PostgreSQL)
  -> U10 KNOWLEDGE_INDEX Job / exact Lease+Fence
  -> deterministic parser/chunker
  -> KnowledgeDataProjectionReceipt per chunk
  -> EmbeddingProviderPort
  -> PostgreSQL staged Chunk + vector Generation
  -> Neo4j staged generation / verify / seal
  -> PostgreSQL READY checkpoint + generation receipt
  -> U10 success output
  -> debug/query exact snapshot -> Neo4j candidate keys -> PostgreSQL ACL hydration
  -> KnowledgeRetrievalReceipt + Evidence Hits
  -> U2 exact KNOWLEDGE binding / Research context
```

No arrow may be inferred from “the prior call returned successfully”. Every transition consumes exact persisted identities.

## Contracts

`packages/contracts/src/knowledge/knowledge-base.ts` owns:

- `EmbeddingProfileRevision`: profile identity, provider/model, dimension, normalization, parser/chunker/projection policy, technical status and canonical revision hash.
- `KnowledgeBaseRevision`: scope, ACL, source File Revision refs, embedding profile ref, active generation ref/status and hash.
- `KnowledgeChunk`: deterministic source range, text hash, protected text material hash, projection receipt, embedding hash/vector dimension and chunk hash. Public variants omit text/vector.
- `KnowledgeIndexGeneration`: source/profile/ACL manifests, staged/ready/stale/failed state, chunk count, manifest digest, Neo4j checkpoint and generation hash.
- `KnowledgeDataProjectionReceipt`: classification, DLP/injection findings, provider eligibility, payload hash and decision.
- create/rebuild command and worker stage/commit commands, exact U10 job input/output references.
- debug search request/result, checkpoint and `KnowledgeEvidenceHit`/`KnowledgeRetrievalReceipt`.

`packages/contracts/src/ports/embedding-provider.ts` owns a narrow transport-neutral port. Requests contain no AppCapability, credential locator, URL or raw file; adapters receive an already authorized projection, exact profile and bounded inputs.

## PostgreSQL 10661

New NOLOGIN owner `data_agent_u15_knowledge_owner` and append/immutable tables:

- `knowledge_embedding_profile_revisions`
- `knowledge_bases` current pointer + immutable `knowledge_base_revisions`（source refs/ACL 冻结在 revision JSON）
- `knowledge_index_generations`
- `knowledge_chunks` (protected normalized text and vector JSONB, not browser-readable)
- `knowledge_projection_receipts`
- `knowledge_retrieval_receipts`
- `knowledge_idempotency`

Backend RPCs create/list/load/rebuild and search snapshot/hydrate/commit retrieval receipt. Job RPCs load target, commit blocked projection, stage generation and commit READY under exact U10 lease. Handler failure is finalized by U10 while the generation remains non-ready; Browser/backend/job roles receive only required EXECUTE and no direct DML.

10661 is a successor to U10 and U2:

- add `KNOWLEDGE_INDEX` to Job kind/handler manifest constraints and readiness.
- extend Job input validation with exact `knowledge_base_id/revision/revision_hash/generation_id` parameters and domain output ref.
- redefine optional resource binding helpers so KNOWLEDGE RESOURCE_IDS/DEFAULT resolves exact READY active generation. FILE behavior remains U6.
- defaults update accepts Knowledge selection only after resolving server-owned revision/hash.

## Parsing, projection and embeddings

The Worker obtains bytes through the U6 content authority and revalidates hash/size. Parser v1 normalizes Unicode NFC and LF, rejects binary/invalid UTF-8/unsupported MIME, and derives source byte ranges. Chunker v1 has fixed maximum and overlap; no model decides boundaries.

`model-egress-projection.ts` produces a strict receipt before the adapter can be called. It performs credential/PII patterns, prompt-injection policy and classification/provider checks. Denied content is committed through the exact U10 Lease as a policy-blocked PostgreSQL projection receipt; no embedding request is emitted.

`api-embedding-provider.ts` is injected with a private transport. It validates the bound provider/model and finite vector/dimension. Tests use deterministic fake vectors. Production credentials remain environment/Secret Authority inputs outside contracts/logs.

## Neo4j projection

`KnowledgeIndex` defines initialize/stage/verifyAndSeal/search/cleanup/close. Neo4j nodes are namespaced by scope + generation + chunk and contain only vector and identifiers. Staging is invisible; a managed transaction seals one generation. Search requires the exact READY checkpoint and returns only chunk keys/scores.

Unlike semantic relationship search, U15 has no PostgreSQL semantic fallback. Disabled/unhealthy/not-ready returns an explicit reason. The service reads PostgreSQL before and after search; changed generation/checkpoint/ACL/source status invalidates all hits.

## Worker and Job Center

`knowledge-index-handler@1.0.0` is a real U10 Handler. It never owns leases or retry state. It loads the exact target, reads U6 bytes, parses/projects/embeds, stages in PostgreSQL, seals Neo4j, and commits READY through worker-only RPC. A failed Neo4j seal keeps the generation non-ready; a successful seal followed by stale fence cannot authorize PostgreSQL READY and is safe to clean/rebuild.

## Web and U2 context

Routes use existing Workspace route authorization and PostgreSQL capability transactions. Create/rebuild enqueues U10 jobs, list is metadata-only, debug search returns bounded evidence hits. The component renders strict status states and citations.

U2 KNOWLEDGE requested/effective resource both refer to the exact READY Knowledge Base Revision because the shared optional-resource Contract requires requested/effective identity equality. That revision hash transitively freezes `active_generation_ref`; downstream context and Evidence must match that embedded Generation and never perform a “latest” lookup.

## Security and rollback

No raw file/chunk/vector/provider response in public DTO, logs or Neo4j hydration. Retrieval ACL is checked in PostgreSQL both before and after Neo4j. Application rollback leaves PostgreSQL authority and U10 jobs intact; generations remain PENDING/STALE rather than pretending READY. Feature-off disables indexing/search but does not affect U6 files, U10 jobs or Web health.
