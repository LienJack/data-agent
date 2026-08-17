# U9 Implementation Plan

## Phase 1 - Public contracts

- [x] Add ResolutionTrace node/edge/trace and SqlHistory contracts with canonical hashes.
- [x] Add ordering, endpoint closure, scope/reference and redaction tests.
- [x] Preserve PublicRunEvent wire compatibility.

## Phase 2 - Platform projection

- [x] Implement read-only PostgreSQL Resolution Trace/SQL History projector using existing verified event/artifact paths.
- [x] Correlate Run, Conversation, Effective Config, SqlArtifact and QueryEvidence refs; fail closed on gaps/substitution.
- [x] Add focused Platform tests for reload parity, filters, no-enumeration and redaction.

## Phase 3 - Routes and UI

- [x] Add workspace Run trace and SQL History routes.
- [x] Route the QA trajectory surface to the parsed ResolutionTrace workspace with trace/SQL/artifact tabs and deep links; preserve the untracked parallel TaskConsole without staging it.
- [x] Consume the same server-authored nodes/refs and retain existing `(run_id, sequence)` SSE dedupe before reload.
- [x] Run desktop/mobile/keyboard/focus browser proof.

## Phase 4 - Finish

- [x] Run Contracts/Platform/Web focused/full relevant gates, build, Biome and forbidden scan. Platform retains one unrelated U11 foundational-source fixture failure; U9 focused and surface tests pass.
- [x] Run Trellis check/spec update, scoped commit/archive, then activate U20.

## Guardrails

- No raw prompt/context/result rows/parameter values/private reasoning in public DTO or logs.
- No new persistence authority or denormalized Trace table.
- Stage only U9 hunks from shared TaskConsole/Trajectory files.
