# M3 Agent-maintained Semantic Candidates — Implementation Plan

## Ordered Work

1. Add failing contract fixtures for CompileRequest, FeaturePacket, EvidenceRef, typed operations,
   ChangeProposal and CompileRun; cover unknown fields and forbidden action/target combinations.
2. Implement canonical snapshot feature extraction and content hashing in `packages/semantic`; add
   stable-order, duplicate identity, FK boundary and drift stale-impact fixtures.
3. Implement proposal validation and selected-operation reducer to existing `SemanticSourceBundle`,
   `SemanticDiff` and `SemanticCandidateDraft`; reuse current compiler/validator and impact analyzer.
4. Implement a fail-closed server Agent adapter over authorized `ModelProviderPort` with strict
   structured output, no tools and stable public terminals; cover valid, timeout, unavailable and
   invalid-output fake provider traces.
5. Add migration source/rendered migration `10626`, platform adapter and PostgreSQL tests for immutable
   CompileRun, scope, replay/conflict, stale base and exact Candidate binding.
6. Add preview/submit Web routes and server runtime composition; derive Authority and all source/base/
   Agent identities server-side.
7. Extend Physical Schema Studio with generation, operation selection/edit, evidence/assumption/impact
   preview and Candidate submission while preserving the evidence-only warning.
8. Run full cross-layer verification and confirm active Explorer/Query Grounding cannot observe an
   unapproved proposal or Candidate.

## Owned Files

Prefer new files under:

```text
packages/contracts/src/artifacts/semantic-candidate-generation.ts
packages/contracts/test/semantic-candidate-generation.spec.ts
packages/semantic/src/candidate-generation/**
packages/semantic/test/semantic-candidate-generation.spec.ts
packages/platform/src/semantic/postgres-semantic-candidate-generation.ts
packages/platform/test/semantic/semantic-candidate-generation*.spec.ts
apps/web/src/lib/semantic-candidate-generation-*.ts
apps/web/src/app/api/semantic/proposals/**
apps/web/src/components/semantic/schema-candidate-builder.tsx
apps/web/test/semantic-candidate-generation*.spec.ts
infra/supabase/apps/data-agent/migration-sources/10626/**
infra/supabase/apps/data-agent/migrations/20260725010626_app_data_agent_semantic_candidate_generation.sql
infra/supabase/test-support/31-semantic-candidate-generation-authority-assertions.sql
scripts/render-10626-migration.ts
```

Existing export indexes, `physical-schema-browser.tsx`, migration runners and package integration
scripts may receive narrow reviewed edits. Do not edit dirty Test Center/model-binding files or
absorb unrelated Web/DataFoundry changes.

## Validation

Focused loop:

```bash
pnpm --filter @data-agent/contracts test:unit -- semantic-candidate-generation
pnpm --filter @data-agent/semantic test:unit -- semantic-candidate-generation
pnpm --filter @data-agent/platform test:unit -- semantic-candidate-generation
pnpm --filter @data-agent/web exec vitest run test/semantic-candidate-generation*.spec.ts --exclude '.next/**' --testTimeout=15000
pnpm tsx scripts/render-10626-migration.ts --verify
```

Milestone gate:

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:tenancy
pnpm test:security
```

Also run the PostgreSQL 17 clean-install/migration chain with 10626 assertions and a vertical Web route
fixture. Full lint failures outside the owned file set must be reported separately; all owned files
must pass scoped Biome.

## Rollback Points

- Contract/kernel failure: remove only new versioned surfaces before 10626 is deployed.
- Agent/provider failure: disable generation composition; deterministic physical preview remains.
- Migration deployed: disable write RPC grants/routes, retain immutable CompileRun evidence, and do
  not execute a destructive down migration.
- UI regression: hide the M3 capability; M1 Physical Schema and M2 Explorer remain available.

## Pre-start Gate

- PRD/design/implementation plan reviewed and approved after this summary.
- `implement.jsonl` and `check.jsonl` contain real spec/research context.
- Current dirty paths are snapshotted; task-owned commit scope remains explicit.

## Implementation Evidence (2026-08-11)

### Delivered

- Added strict versioned contracts for compile requests, deterministic schema feature packets,
  structured evidence, typed candidate operations, Agent receipts, proposals and compile terminals.
- Added deterministic snapshot/drift feature extraction, content digests, proposal validation and a
  reducer into the existing `SemanticCandidateDraft` governance path. `MARK_STALE` is reduced to a
  visible modification and never to a delete.
- Added an authorized `ModelProviderPort` adapter with zero tools, bounded structured output and
  stable `TIMEOUT`, `INVALID_OUTPUT`, `VALIDATION_FAILED` and `AGENT_UNAVAILABLE` terminals.
- Added PostgreSQL migration `10626` with immutable feature/compile/proposal authority tables,
  scoped drift-evidence/read/begin/finish/attach RPCs, RLS, exact grants, replay fencing and stale
  base checks. No bytes changed in migrations `10610` through `10625`.
- Added Web compile/get/submit routes and runtime composition. All Authority, snapshot/drift digest,
  active release identity, model certification identity and Agent receipt fields are resolved on the
  server. Human edits preserve the immutable original proposal digest.
- Extended Physical Schema Studio with unpublished proposal preview, per-operation selection/edit,
  confidence, evidence, assumptions, open questions, impact and governed Candidate submission.

### Verification

- Contracts: typecheck; 33 files / 564 unit tests passed.
- Semantic: typecheck; 10 files / 103 unit tests passed, including valid structured output,
  forbidden tools, invalid JSON, provider timeout and redacted provider failure.
- Platform: typecheck; 30 files / 236 unit tests passed.
- Web: typecheck; 3 relevant test files / 14 tests passed.
- Scoped Biome, `git diff --check`, and migration renderer verification passed.
- PostgreSQL 17 clean migration chain through `10626` passed; Platform integration 13 passed / 1
  skipped, root integration 1 passed, and Worker integration 9 passed.

### Deliberate Boundaries

- M3 compiles schema-derived candidates only. Formula clarification/AST is M4, while document
  chunking/vector retrieval/knowledge extraction remains a later milestone using the same Source,
  Evidence, CompileRun and Candidate contracts.
- The Agent creates proposals only. Review, approval, publish and rollback remain exclusively in the
  existing PostgreSQL governance authority.
- The task is not archived because the implementation has not been committed and the shared
  worktree contains unrelated user changes. Archiving before a scoped commit would violate the
  Trellis finish-work contract.
