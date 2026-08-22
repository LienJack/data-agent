# Ontology-grounded deterministic analysis

## Goal

Complete every requirement, implementation unit, verification gate, recovery behavior, delivery slice, and Definition of Done item in
`docs/plans/2026-08-22-003-feat-ontology-grounded-deterministic-analysis-plan.md` without narrowing its scope.

The user outcome is a production-governed analysis pipeline that compiles a frozen Published Semantic Release into a bounded analysis plan,
executes governed SQL and attested Python programs, accepts only independently verified derived evidence, and projects evidence-grounded
reports that distinguish descriptive findings, root-cause candidates, and certified causal estimates.

## Source of Truth

- Canonical product and technical plan: `docs/plans/2026-08-22-003-feat-ontology-grounded-deterministic-analysis-plan.md`.
- Requirements R1-R17, implementation units U1-U8, the Verification Matrix, Failure and Recovery Semantics, Recommended Delivery Slices,
  and Definition of Done in that document are normative.
- This task artifact is an execution index. If wording differs, the canonical plan controls.

## Requirements

- R1-R3: Bind every analysis to frozen PostgreSQL-backed semantic/context/policy authority and server-owned skill descriptors; fail closed on
  formula, unit, grain, time, additivity, null, join, sensitivity, and budget incompatibility.
- R4-R7: Keep QueryEvidence distinct from deterministic statistical derivations; produce replayable DerivedAnalysisEvidence and prevent
  contribution, association, importance, anomaly, or forecast evidence from being promoted to unsupported causal claims.
- R8-R12: Execute a globally bounded DAG, evolve claim/report protocols without changing historical @2 semantics, expose full method and
  limitation provenance, and restrict broad analysis to configured primary metrics and approved dimensions.
- R13-R15: Keep candidates, sensitive rows, provider payloads, private reasoning, parameters, credentials, and execution diagnostics out of
  public projections; verify each skill with independent gates; run Python only in the attested no-network sandbox with zero partial commit.
- R16-R17: Enforce the Candidate -> Diagnostic Support -> Certified Causal Estimate state machine and make every data-understanding,
  transform, chart, insight, and recommendation step a replayable plan node or accepted artifact projection.

## Scope

### In Scope

- All plan implementation units U1-U8 and all eight recommended delivery slices.
- Versioned contracts, semantic compiler, controlled tabular import, attested Core/ML/Causal Python profiles, standard and generated programs,
  Worker DAG execution, root-cause/causal evidence ladder, platform/web projections, independent evals, and staged release controls.
- Compatibility fixtures for historical protocol readers and fail-closed states for anything not yet releasable.

### Out of Scope

- The plan's explicit Out of Scope section remains unchanged: no automatic semantic publication or business actions, no arbitrary package or
  network access, no macro/external-link execution, no online training/streaming anomaly system, and no unsupported datasource expansion.

## Constraints and Decisions

- PostgreSQL Published Semantic Release and Resolved Context remain authority; graph/index/model views are projections.
- SQL must traverse the existing compile/policy/permit/QueryEvidence path. Python receives only committed bounded artifacts.
- Standard templates and model-generated programs use the same sandbox, receipt, fence, output contract, and Oracle chain.
- Historical @2 wire semantics and hashes remain readable and unchanged; new capabilities use explicit versions.
- L4 root-cause discovery can ship independently. L5/F9 remains HOLD/NOT_REGISTERED until its complete certificate and release gates pass.
- Repository changes are implemented in `codex/ontology-grounded-deterministic-analysis`, validated by owned scope, and committed explicitly.

## Acceptance Criteria

- [ ] U1-U8 are implemented with every named owned artifact or an evidence-backed owner adjustment that preserves the same contract boundary.
- [ ] Every row of the plan Verification Matrix has current command/runtime evidence at the stated scope.
- [ ] Identical frozen inputs replay deterministically under the declared runtime/architecture contract; drift and non-determinism HOLD.
- [ ] Golden, metamorphic, malicious-program, cancellation, resource, replay, RBAC, sensitive-projection, and cross-version tests pass.
- [ ] E-commerce acceptance traverses semantic context -> governed SQL -> Python sandbox -> Oracle -> derived evidence -> root-cause ladder ->
  report projection, with unsupported causal paths remaining HOLD.
- [ ] UI renders only accepted projections and preserves identical state across live events, refresh, and replay.
- [ ] Capability probes and release evidence distinguish Fixture, Shadow, Internal, GA, HOLD, and NOT_REGISTERED accurately with per-skill kill
  switches and rollback safety.
- [ ] Every item in the canonical Definition of Done has direct authoritative evidence; missing or indirect evidence counts as incomplete.
- [ ] Relevant validation passes, `git diff --cached --check` passes, and all task-owned repository changes are committed without unrelated files.

## Blocking Questions

None. The user explicitly requested completion of the full canonical plan in the isolated worktree.
