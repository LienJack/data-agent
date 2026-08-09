# M2 Semantic Explorer — Live Baseline

## Evidence date and state

- Inspected current branch `feat/datafoundry-platform-modules` on 2026-08-09 after M1 feature/archive commits
  `4cee083` and `87c03ea`.
- M1 is physically present under
  `.trellis/tasks/archive/2026-08/08-08-semantic-layer-m1-schema-discovery`.
- The working tree contains unrelated DataFoundry/UI changes; no conclusion below treats them as committed M2 code.

## Reusable authority

- `semantic.semantic_active_pointer` owns current release identity and monotonic `pointer_generation`.
- `semantic.semantic_source_release` binds exact executable, relationship and runtime-restriction projection IDs
  and digests.
- Projection rows are immutable release children; Explorer can rebuild a read view without a graph database.
- 10622 established the narrow Backend RPC pattern and direct-table revocation; 10623 provides a current additive
  migration/renderer/grant/postcondition example.
- Web already has server-owned semantic Authority resolution and redacted route errors that can be reused without
  accepting client scope or credentials.

## Contract gaps that shape M2

- `U5SemanticProjection` currently has metrics, dimensions, formula IDs, source digest and lowerability. Metric rows
  themselves carry formula expression/grain/unit/time/null/fanout details.
- Relationship projection carries executable relationship edges and proof; runtime restriction carries DENY/RESTRICT
  rules that must stay server-only.
- Full BusinessOntology, RelationshipRegistry metadata, formula signatures, PhysicalBinding and CatalogGovernance
  exist in `SemanticSourceBundle` but are not currently copied into the release-bound executable projection.
- A release's `candidate_id` does not by itself bind the candidate's later `current_revision_id`; therefore reading
  generic current candidate/source payload as active truth would permit candidate-to-active leakage.
- Adopted solution: add a deterministic, optional `explorer_sidecar@1.0.0` inside the exact executable projection.
  Existing releases degrade explicitly; no table/FK-to-business-entity inference is permitted.

## Candidate boundary

- Candidate and candidate revision already have immutable identities; source revision records a base release ID and
  generation.
- Candidate comparison can therefore bind exact candidate/revision/source/base identities and determine stale state.
- Candidate diff remains a separate envelope. It cannot change active snapshot objects, counts or graph.

## Ontology research carried forward

- `ontology-learning/RQ014` separates BusinessOntology from AnalyticalSemantics, RelationshipRegistry,
  PhysicalBinding, RuntimeAuthorization, Compiler and ResultOracle. A business relation does not prove an analytical
  join, contribution or causality.
- `ontology-learning/RQ013` requires distinct competency, inference, consistency, negative-validation and migration
  oracles plus Proposal/Review/Validation/Release/Deprecation/Migration/Rollback lifecycle.
- M2 applies these boundaries by preserving typed object/edge kinds, explicit lifecycle, exact release provenance
  and read-only projection semantics. It does not add inference, validation authority or publication actions.

## UI integration boundary

- The current `/semantic` page, Sidebar/AppShell, global CSS and several UI primitives are dirty user-owned files.
- M2 will create `/semantic/explorer` and feature-local components/state using stable existing tokens.
- Sidebar or Review Workspace navigation integration is deferred to a separately reviewed overlap after those user
  changes are committed.

## Performance decision

- Full 10k identity/index data may exist in memory, but table/tree DOM is windowed and graph rendering is a bounded
  selected neighborhood.
- Budgets are frozen in the PRD before implementation and will be enforced by a structured benchmark instead of an
  unmeasured “fast enough” claim.
