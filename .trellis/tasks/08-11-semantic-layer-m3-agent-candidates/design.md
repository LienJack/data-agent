# M3 Agent-maintained Semantic Candidates — Design

## Boundary

```text
PostgreSQL PhysicalSchemaSnapshot / SchemaDriftEvent
  -> deterministic SchemaFeaturePacket
  -> authorized structured-output Agent
  -> strict SemanticChangeProposal
  -> deterministic proposal validation + impact
  -> immutable SemanticCompileRun
  -> selected operations reduced to SemanticCandidateDraft
  -> existing PostgreSQL SourceRevision / CandidateRevision
  -> existing Human Review / Publish
```

`PhysicalSchemaSnapshot` is evidence. `SemanticChangeProposal` is an Agent-authored candidate.
`CandidateRevision` is governed review material. Only an active `SemanticRelease` is runtime truth.

## Contracts

Add `packages/contracts/src/artifacts/semantic-candidate-generation.ts` as the single JSON boundary.
It owns:

- `SemanticCompileRequest`: snapshot ID, optional drift ID, semantic domain and idempotency key only;
  all authority and content identities are server-resolved.
- `SchemaFeaturePacket`: exact snapshot/drift/base-release refs, canonical relation/column/constraint
  facts, stable feature IDs and digest.
- `SemanticEvidenceRef`: source kind, exact source identity, structured locator, excerpt/observation,
  source digest and confidence. Initial source kind is `PHYSICAL_SCHEMA`; the discriminant reserves
  `METRIC_INPUT` and `DOCUMENT_CHUNK` for later milestones without accepting those inputs in M3.
- `SemanticCandidateOperation`: discriminated action/target union with stable operation ID, target
  semantic identity, typed payload, field evidence map, confidence, assumptions, open questions and
  impact.
- `SemanticChangeProposal`: exact CompileInput identity plus bounded operation set and Agent receipt.
- `SemanticCompileRun`: immutable terminal receipt with input/output digests, model/profile/prompt/tool/
  compiler/validator/policy identity and optional Candidate binding.

The contract rejects dynamic paths and free-form patch operations. Typed operation payloads reuse
`BusinessEntity`, `SemanticDimension`, `SemanticMetric`, `SemanticRelationship` and
`PhysicalBindingEntry` from `SemanticSourceBundle`.

## Deterministic kernel

`packages/semantic/src/candidate-generation/` owns pure behavior:

1. normalize snapshot/drift/current public semantic material;
2. extract stable schema features and evidence locators;
3. validate Agent operations against the feature packet and active release;
4. classify physical relationship proof separately from analytical safety;
5. compute impact/stale operations for removed or changed physical assets;
6. reduce user-selected operations into a full `SemanticSourceBundle` and existing `SemanticDiff`;
7. produce the exact `SemanticCandidateDraft` source payload consumed by governance.

No model SDK, PostgreSQL, Next.js or mutable cache is imported by this package.

## Agent adapter

The Web server composition builds a `SemanticCandidateAgentPort` over the existing authorized
`ModelProviderPort`. The request uses a registered strict response schema, bounded token budget,
`tool_allowlist=[]`, `maxSteps=1` and server-selected model profile. The adapter records exact model
and prompt identity and maps provider failures to public semantic compile terminals. A fake port is
used for contract tests; production configuration fails closed when no certified model/profile is
available.

Agent output is never written directly. The pure semantic kernel parses and validates it first.

## PostgreSQL Authority

Additive migration `10626` introduces:

- immutable `semantic_compile_run` material keyed by full semantic scope and compile run ID;
- immutable operation/evidence material bound to its compile input/output digests;
- narrow RPCs to commit failed compile receipts and to atomically bind a successful CompileRun to the
  existing Candidate Draft material;
- RLS, exact grants, audit/outbox references, canonical JSON hashes and scoped idempotency conflict.

One backend transaction revalidates Authority and current snapshot/base release before Candidate
creation. A stale base commits a failed CompileRun receipt and writes no Candidate. CompileRun rows
cannot be updated or deleted by application roles.

## Web flow

`POST /api/semantic/proposals/from-schema` receives only `SemanticCompileRequest`. The route resolves
server Authority, reads exact snapshot/drift and active release, builds features, invokes the Agent,
validates the proposal and commits the CompileRun. Candidate creation occurs only after the user sends
selected/edited operations to `POST /api/semantic/proposals/:compileRunId/submit`; this second call
revalidates the exact compile material and calls the existing governance Candidate path.

The Physical Schema UI shows deterministic features even when the Agent terminal is unavailable and
never labels proposed objects as published.

## Compatibility and rollback

- Reuse existing semantic source and governance contracts; additions are versioned and strict.
- Do not alter migrations 10610–10625 or Candidate/Review/Publish state meanings.
- Disable M3 routes/UI to roll back. Immutable CompileRun evidence remains readable; active release and
  existing Candidate governance remain unchanged.
- A later knowledge ingestion task may add `DocumentRevision/Chunk` persistence and implement the
  reserved `DOCUMENT_CHUNK` evidence source without changing M3 physical evidence semantics.

## Trade-offs

- M3 uses typed domain operations instead of generic JSON Patch. This adds schemas but prevents Agent
  paths from becoming a second semantic language.
- Compile and Candidate submission are separate user actions. This preserves human selection before
  governance and avoids creating large numbers of unusable Candidate drafts.
- No rename inference or automatic merge is performed. False negatives are cheaper than silent
  identity corruption in the published graph.
