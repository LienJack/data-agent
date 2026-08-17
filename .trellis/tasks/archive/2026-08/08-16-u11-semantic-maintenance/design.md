# U11 Semantic Maintenance Design

## Authority flow

```text
Workspace-scoped enqueue request
  -> U10 Job Center command + exact target reference
  -> Worker exact lease/fence
  -> source loader (Schema snapshot / Knowledge document / Metric exchange)
  -> source-specific parser + taint guard
  -> deterministic Stable Object Resolver
  -> Proposal Envelope + Evidence Set
  -> Impact Planner / Metric Dry-run
  -> U5 Candidate Plane commit (review-only)
  -> U11 immutable Job Receipt
  -> U10 terminal + successor
```

PostgreSQL owns persisted authority. Contracts own the canonical wire and hashes. The Semantic package owns pure deterministic kernels. Platform owns transaction-scoped RPC adapters. Worker composes a job lease with the kernels and the U5 candidate commit port. Web only enqueues and reads.

## Contracts

Add `artifacts/semantic-induction.ts` with strict, versioned schemas for:

- source descriptors and taint classification;
- evidence locators and normalized induction facts;
- stable object identity material/result;
- proposal envelope and candidate tier;
- metric exchange/dry-run/diff;
- impact graph input and impact plan;
- induction job request/receipt and hash builders/verifiers.

Extend `semantic-candidate-generation.ts` only where the existing M3 candidate compiler needs a new evidence/source discriminator. Preserve existing wire versions and reject unknown fields.

## Deterministic semantic kernels

`stable-object-resolver.ts` canonicalizes namespace, role, normalized name and sorted mapping/evidence identities, then derives a UUID-shaped identifier from a SHA-256 digest. Alias resolution is explicit; a conflicting identity produces a conflict result.

`impact-planner.ts` accepts prior/current object hashes and a typed dependency graph. It computes the transitive affected closure in stable order. Nodes outside the closure retain their previous hash and are reported as unchanged.

Metric import is a pure dry-run first: parse the bounded exchange schema, lower supported expressions to internal AST, report unsupported/conflicting entries, and produce a Candidate Patch only for a successful dry-run.

## Persistence and jobs

Migration `10662` is greenfield and immutable. It adds append-only U11 induction/metric dry-run/impact receipts, FORCE RLS, NOLOGIN owner, backend/job grants, and narrow SECURITY DEFINER RPCs. It does not alter U5 candidate rows or introduce a second candidate truth.

Worker adds bindings for both pre-registered Job Center kinds:

- `SEMANTIC_INDUCTION`: loads exact source, validates taint/evidence, resolves stable IDs, plans impact, commits one U5 Candidate, commits U11 receipt.
- `METRIC_IMPORT`: performs dry-run; invalid/conflicting inputs end with a stable non-retryable failure and no Candidate; successful inputs commit one U5 Candidate plus dry-run receipt.

All commits revalidate the current job attempt/fence. Replay returns the original receipt. Cancellation is checked before source load, before Candidate commit, and before terminal transition.

## Web/API

Add a workspace-scoped induction-jobs route with strict input and existing AppCapability resolution. It only creates a Job Center command; it never performs synchronous induction, publishes a Candidate, or accepts caller-authored hashes/evidence verdicts.

## Security and privacy

- Only `SemanticBootstrapCorpus` is admissible for bootstrap learning.
- Holdout/TEST questions, gold SQL/answers, expected outputs, benchmark labels and Oracle-derived feedback are rejected before persistence.
- Raw document bodies and prompts are not stored in Job/Impact receipts; receipts retain content-addressed evidence refs and redacted diagnostics.
- No provider credential, URL, pricing/billing material, raw model response or private reasoning enters the U11 wire.

## Verification

Use red-first focused tests for canonical identity, evidence/taint rejection, drift closure, metric dry-run and job fencing. Then run package type/build/Biome/diff gates. Render and verify 10662; install on fresh PG17 with both import hooks mapped to `/dev/null`, run only U11 assertions, and remove the container.
