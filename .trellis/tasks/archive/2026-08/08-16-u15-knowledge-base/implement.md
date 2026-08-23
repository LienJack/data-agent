# U15 Implementation Plan

## 1. Contracts first

- [x] Add strict Knowledge/Profile/Generation/Chunk/Projection/Checkpoint/Search/Evidence schemas, builders and verifiers.
- [x] Add narrow EmbeddingProviderPort and extend Job Kind/input/output with KNOWLEDGE_INDEX.
- [x] Add hash, tamper, state/closure, dimension, ACL, canonical ordering and public redaction tests.

## 2. PostgreSQL 10661

- [x] Add migration source/renderer/rendered migration/ledger and assertion 39.
- [x] Add Knowledge/Profile/Generation/Chunk/Projection/Checkpoint/Retrieval/Idempotency Authority with FORCE RLS/NOLOGIN owner.
- [x] Add backend and job RPCs with scope/hash/idempotency/lease/fence validation and stable markers.
- [x] Add U10 KNOWLEDGE_INDEX successor constraints/readiness and U2 exact KNOWLEDGE resolution/defaults support.

## 3. Platform

- [x] Implement PostgreSQL Knowledge Registry with Contracts verification and AppCapability transactions.
- [x] Implement KnowledgeIndex service plus in-memory conformance and Neo4j vector projection adapter.
- [x] Implement private-transport API Embedding adapter and sensitivity-aware model egress projection.
- [x] Cover bad hash, cross-scope, ACL drift, index lag, provider/model/dimension mismatch and no-fallback behavior.

## 4. Worker

- [x] Implement deterministic parser/chunker and KNOWLEDGE_INDEX Job Handler.
- [x] Wire U6 content read, projection, embedding, PostgreSQL stage, Neo4j seal and ready commit in exact order.
- [x] Register real handler in Worker manifest/composition and readiness; cover cancellation, retry and stale fence.

## 5. Web and U2 integration

- [x] Add list/create/rebuild and debug search routes with workspace authorization and stable errors.
- [x] Add Knowledge Bases settings panel with loading/empty/not-ready/stale/error/ready states.
- [x] Prove U2 defaults/run binding freezes exact READY generation and Context/Evidence hits retain that identity.

## 6. Verification and commit

- [x] Run focused/full relevant tests, typecheck/build, Biome and diff-check.
- [x] Run 10661 renderer/static and fresh PG17 + assertion 39 with ecommerce/Falcon import hooks `/dev/null`.
- [x] Run forbidden scans for Falcon/import/real Provider/Billing/Credit/Price/Claude/Anthropic/raw text/vector logs.
- [x] Run Trellis check and fix all U15-owned P0/P1.
- [x] Update task evidence, exact-stage owned files and create one scoped commit.

## Rollback points

1. Contracts/10661 closure must be green before routes or Worker composition.
2. Embedding/Neo4j dependency not ready keeps capability NOT_READY; no alternate retrieval semantics.
3. Neo4j seal without PostgreSQL checkpoint is invisible and rebuildable.
4. Source/ACL/Profile changes create a new generation; never mutate an old READY generation.
5. Falcon remains the final U1–U20 acceptance gate and is never run during U15.

## Verification evidence

- Contracts focused: 2 files / 14 tests; full: 60 files / 755 tests; typecheck and build passed.
- Platform focused: 2 files / 6 tests; full: 65 files / 429 tests; typecheck and build passed.
- Worker Knowledge focused: 2 files / 5 tests; package unit suite passed; typecheck and build passed.
- Web Knowledge routes: 1 file / 3 tests; full unit suite passed; typecheck and production build passed with only pre-existing dynamic-filesystem tracing warnings.
- `scripts/render-10661-migration.ts --verify` and the full Supabase static gate passed with canonical checksum `sha256:b628dcb85fd659327a9fc1a5b931774cb685ea7565281140d7b1452ab1b89887`.
- Fresh PostgreSQL 17 installed the full migration chain with both dataset import hooks mounted to `/dev/null`; Ledger checksum matched and assertion 39 returned `KNOWLEDGE_BASE_AUTHORITY_ASSERTIONS_PASSED`.
- Trellis review repairs include deterministic retry-stable chunk identities, nested Authority verification, cross-request result correlation, exact Defaults/EffectiveConfig generation binding, renderer checksum invariants, and persisted blocked-projection receipts before any network call.
- No Falcon import/evaluation, real Provider call, Billing/Credit/Price integration, Claude/Anthropic integration, raw chunk/vector logging, or Git stage/commit occurred during verification.
