# Implementation plan: ontology-grounded deterministic analysis

The canonical execution specification is
`docs/plans/2026-08-22-003-feat-ontology-grounded-deterministic-analysis-plan.md`. Execute the units in dependency order and do not treat a
green sub-slice as completion of the full task.

## Ordered checklist

- [x] Baseline audit: inspect existing implementations, active HOLD gates, package specs, test commands, and file overlap before editing.
- [x] U1 Versioned Analysis Contracts: add versioned refs/payloads/wire/public events, preserve @2 semantics, and add strict/hash/scope tests.
- [x] U2 Semantic Context and Applicability: publish explicit analysis semantics, compile deterministic context/transform witnesses, and add
  fail-closed applicability tests.
- [x] U3 Attested Python Runtime and Programs: close existing sandbox HOLD gates first, then add Core/ML/Causal locks, standard programs,
  admission policy, independent oracles, malicious fixtures, replay/cancel/resource tests, and attestation evidence.
- [x] U4 Planner and Worker: register server-owned descriptors/tools, controlled import, bounded DAG planning, governed query reuse, sandbox
  execution, idempotent artifact submission, repair/fence semantics, and integration coverage.
- [x] U8 Root Cause and L5: implement bounded ontology-grounded discovery, reuse Attribution authority, add identification/estimate/certificate
  payloads and gates, and keep insufficient evidence HOLD.
- [x] U5 Projection and Workbench: add safe platform projections, chart protocol evolution, evidence-grounded insight selection, replay-stable
  report UI, evidence drawer, and disclosure/sensitivity tests.
- [x] U6 Independent Evaluation: add deterministic/generated/causal oracles, semantic e-commerce fixtures, cross-layer acceptance, adversarial
  cases, and hard-fail scoring.
- [ ] U7 Rollout: add per-skill staged registration, probes, release verification, runbook, kill switches, and rollback checks.
- [ ] Full completion audit: map every R1-R17, Verification Matrix row, failure/recovery row, Slice 1-8 deliverable, and Definition of Done item to
  direct current evidence. Continue implementation for every missing item.
- [ ] Run scoped and full validation, review the complete diff, update specs when new durable conventions were learned, stage explicit owned
  paths, run `git diff --cached --check`, and create scoped commit(s).

## Validation matrix

- Contracts: `pnpm --filter @data-agent/contracts test:unit`
- Semantic: `pnpm --filter @data-agent/semantic test:unit`
- Research: `pnpm --filter @data-agent/research test:unit`
- Sandbox: attestation plus Python unit/container/cancel/malicious-program suites defined by the implementation.
- Worker/Platform/Web: targeted workspace Vitest commands; do not run root Vitest because it may scan `.next/standalone`.
- Causal: dedicated SCM, identification, overlap, refutation, sensitivity, certificate, and expiry suite.
- Cross-layer: e-commerce governed SQL -> Python -> Oracle -> root-cause ladder -> report acceptance CLI.
- Release: updated capability probe and release verifier with build/typecheck/security evidence.
- Git: explicit path staging and `git diff --cached --check` before every logical commit.

## Risk and rollback points

- Commit only coherent, passing capability slices; never commit failing or WIP state.
- Do not flip L4/L5 executable or release status before payload, verifier, runtime, projection, Oracle, and release gates all pass.
- Runtime lock/image changes are high risk and require attestation plus independent numeric/security verification before Worker exposure.
- Protocol evolution must retain cross-version fixtures before any runtime consumer is enabled.
- Public projections are allowlists; raw artifacts, source, diagnostics, and private reasoning remain behind separate authorization.

## Execution evidence

### U1 Versioned Analysis Contracts

- Added strict, bounded contracts for tabular import, data profile, analysis plan/program/evidence/completion, claim/report evolution, evidence
  checking, and redacted public analysis events while preserving historical @2 readers.
- Kept L4/L5 deferred artifacts `CONTRACT_ONLY/executable=false`; no release capability was promoted.
- Validation:
  - `pnpm --filter @data-agent/contracts build`
  - `pnpm --filter @data-agent/contracts typecheck`
  - `pnpm --filter @data-agent/contracts exec vitest run test --testTimeout=30000 --maxWorkers=2` with
    `NODE_OPTIONS=--max-old-space-size=8192`: 81 files / 855 tests passed before the final contract-hardening additions.
  - Final targeted contract, wire, sandbox, dependency-boundary, and compatibility suites: 5 files / 64 tests passed.

### U2 Semantic Context and Applicability

- Added published-only `SemanticSourceBundle@2` analysis semantics, content-addressed Ontology analysis binding, Run receipt-bound
  `AnalysisContext@1`, deterministic applicability decisions, and bounded Filter/GroupBy/Join/Pivot/Window/Derived/Chart transforms.
- Kept `SemanticSourceBundle@1` strict and hash semantics unchanged; compiler projects @2 through the existing @1 invariant and Contribution
  Profile lowering before admitting contribution capabilities.
- Fail-closed coverage includes release/source hash drift, unresolved metrics, candidate material, missing time/seasonality, non-additive and
  ratio metrics, grain/unit/timezone/null conflicts, sensitive dimensions, fanout, and L5 role/DAG/policy/adjustment closure.
- Validation:
  - Contracts build/typecheck and full suite: 81 files / 855 tests passed.
  - Semantic build/typecheck and full suite: 18 files / 149 tests passed.

### U3 Attested Python Runtime and Standard Analysis Programs

- Added independently attested `CORE_ANALYSIS`, `ML_DIAGNOSTIC`, and `CAUSAL_L5` dependency locks, runtime/image digests, explicit import
  profiles, and profile-specific images. The causal image compiles ARM64-only native wheels in a builder stage and leaves the final image
  with runtime libraries only.
- Added server-owned Data Profile plus trend, contribution/concentration, robust anomaly, association/quality, and forecast/backtest programs
  on the production SDK/Input/Output/Receipt path. Generated-program admission now closes AST/import/profile/source-size/output/seed/runtime/
  lock policy, and Research independently verifies result invariants, metamorphism, references, policy and derivation hashes.
- Added exact-scope process-group cancellation, threaded control IPC, zero-output failure handling, a single execution slot per sandbox replica,
  and per-idempotency-key in-flight coordination so concurrent retries execute once and hash conflicts fail closed.
- Validation:
  - Attestation verifier: all three profiles `VERIFIED`.
  - Core, ML, and Causal Docker images built. Hardened no-network/read-only/no-new-privileges container execution passed for all three; Core
    success/malicious/timeout/cancel terminals were respectively `SUCCEEDED`, `PYTHON_POLICY_REJECTED`, `PYTHON_TIMEOUT`, and
    `PYTHON_CANCELLED`, with zero outputs for every non-success terminal.
  - Sandbox Ruff format/lint passed; full Python suite: 94 passed / 17 PostgreSQL-configured integration tests skipped.
  - Contracts typecheck and full suite: 81 files / 855 tests passed.
  - Research typecheck, unit suite (19 files / 136 tests), and architecture suite (1 file / 10 tests) passed.

### U4 Analysis Planner, Query Compilation and Worker Orchestration

- Added a strict server-owned executable tool registry and a frozen ten-skill catalog; caller payloads cannot select unregistered executors,
  override runtime/lock/output contracts, or pass undeclared fields.
- Added deterministic primary-metric/approved-dimension planning, plan hash/scope/budget/applicability gates, dependency-wave execution,
  synchronous Run budget reservation, governed QueryEvidence materialization, one bounded generated-program repair, pre/post fence checks, and
  `READY`/`PARTIAL`/`HOLD` completion semantics.
- Added controlled CSV/XLSX import admission, governed DataProfile construction, and evidence-grounded chart-story selection. Zip expansion,
  macros, external links, formulas, sheet/row/column/cell limits, ambiguous encodings, timeouts, cross-scope references, and narrated numbers are
  rejected with no imported outputs.
- Added append-only PostgreSQL authority for SandboxProgram/Receipt/Result and routed current DataProfile/AnalysisPlan/DerivedEvidence/
  Completion through a dedicated analysis L2 RPC. The system RPC validates exact U6 command protocol, capability, lease/fence, raw and
  canonical hashes, idempotency, scope, and immutable storage. Analysis L2 types are reserved from the generic artifact bypass.
- Corrected the SandboxProgram closure to bind QueryEvidence refs separately from materialized sandbox input refs; historical wire readers were
  left unchanged after compatibility regression testing.
- Added optional Production Team composition that accepts only committed QueryEvidence and exposes only committed accepted analysis evidence;
  the concrete real-database end-to-end adapter and independent fixture score remain owned by U6 and the final completion gate.
- Validation:
  - Contracts: 81 files / 855 tests passed; Research: 19 files / 136 tests; Semantic: 18 files / 149 tests; Agent Runtime: 25 files / 160 tests.
  - Worker existing unit: 10 files / 74 tests; U4 targeted: 3 files / 19 tests; Python analysis/runtime: 41 tests; all three sandbox profile
    attestations `VERIFIED`.
  - Platform targeted research/chart authority: 2 files / 21 tests; filtered disposable PostgreSQL migration/assertion smoke passed.
  - The new migration has exactly one normalized self-checksum literal and its declared/computed SHA-256 values match.

### U8 Root Cause Evidence Ladder and L5 Causal Identification

- Added versioned, strict payloads for L4 `DiscoveryCandidate`/`DiscoveryReceipt` and L5 `CausalQuestion`, `IdentificationPlan`,
  `CausalEstimate`, and `IdentificationCertificate`. `AtomicClaim@3 CAUSAL_ESTIMATE` now requires an Identification Certificate ref;
  all other Claim modes reject one.
- L4 discovery is a bounded, ontology-path-grounded Universe with deterministic ranking, Bonferroni correction, time precedence,
  competing-explanation and uncovered-boundary closure. Weak, temporally ambiguous, ungrounded, or cross-scope candidates remain HOLD and
  never start the causal sandbox.
- L5 compilation consumes only the published causal policy and rejects reverse paths, mediator/collider adjustment, missing confounder roles,
  unpublished intervention semantics, or stale discovery receipts. Candidate/model DAGs are never promoted into identification authority.
- Causal estimates bind the CAUSAL_L5 Program/Runtime/Lock, Receipt/Result closure, estimand, interval, effective sample, overlap, balance,
  refutation, negative control, and sensitivity outputs. The ten-gate certificate independently rehashes all payloads and invalidates on
  Semantic/Schema/Policy/Program/Runtime/Lock drift.
- Reused Attribution Capability/Eligibility/Safety/Truth/Feasibility as the sole causal authority. Worker resolves this closure through a
  server-owned dependency after freezing the Causal Question; callers cannot provide a GO. The certificate checks question identity, TTL,
  SCM direction/interval, and exact Safety/Feasibility evidence identity.
- Kept causal artifacts `IMPLEMENTING/executable=false` and the executable registry unchanged. U7 owns migration/registration/release gates;
  U6 owns the comprehensive independent positive/negative/zero SCM and adversarial benchmark score.
- Validation:
  - Contracts full unit: 81 files / 855 tests passed.
  - Research full unit: 20 files / 143 tests passed; targeted root-cause suite: 7 tests.
  - Worker typecheck passed; targeted L4/L5 runtime suite: 2 tests, including the complete attested certificate chain and pre-sandbox HOLD.

### U5 Artifact Projection and Analysis Workbench

- Added sealed `ArtifactWorkspaceChartDocumentV3`/preview contracts that bind QueryEvidence plus DerivedAnalysisEvidence, retain V2 readers,
  enforce bounded finite tables and support deterministic trend, interval, relationship, distribution, anomaly, signed-contribution, priority,
  and forecast chart mappings without browser expressions.
- Added server-owned chart and Run Projection builders. They verify exact payload hashes, scope/run, plan/completion/node/evidence closure, accept
  methods and charts only from successful committed nodes, suppress failed forecasts and oversized chart data, downgrade invalid/stale L5
  certificates to HOLD, and sort public output for replay stability.
- Added evidence-grounded Fact/Pattern/Driver/Interpretation/Recommendation Candidate selection. Statements must be exact accepted Claim content;
  invented numbers, entities, causes, duplicate findings, non-diagnostic drivers, and recommendations without a published playbook are rejected.
- Added the deterministic workbench section and VChart V3 renderer with READY/PARTIAL/HOLD, L2/L4/L5 labels, Candidate disclosure, table fallback,
  root-cause ladder, methods/Evidence Drawer, runtime/lock/program/receipt hashes, and unified limitations. A live Next.js render was inspected at
  desktop and narrow layout; the information hierarchy, disclosures, fallback structure, and accessibility tree were coherent.
- Validation:
  - Contracts full unit: 81 files / 855 tests passed; Contracts/Platform/Research/Web typechecks passed.
  - Research full unit: 23 files / 157 tests passed; Platform artifact suites: 4 files / 12 tests.
  - U5 targeted Web/Platform/Research: 6 files / 27 tests passed after final chart allowlist update.
  - Web full suite: 116 files / 444 tests passed, 1 skipped, with two unrelated pre-existing failures in workspace-navigation and
    semantic-studio-agent-only source assertions; all U5 Web suites passed.

### U6 Program Oracle, Semantic/Causal Fixtures and End-to-End Evaluation

- Added independent TypeScript math Oracles for all five standard skills, including missing-period, signed contribution closure, robust MAD,
  rank correlation/outlier sensitivity, and expanding-window forecast backtest. Oracle receipts bind algorithm/result hashes, and the aggregate
  gate requires every declared case to score 100; Golden changes without an algorithm-version change hard-fail.
- Added a generated-program gate that independently rehashes source, rejects environment/process/network/native/dynamic/non-deterministic code,
  verifies runtime/lock/replay, permits at most one repair, and commits zero output on failure or unavailable Sandbox. The historical CSV
  deterministic profile is explicitly marked benchmark-only and production-ineligible.
- Added a separate SCM Oracle for known positive, negative, and zero effects. L5 requires correct direction/interval, sample/overlap,
  mediator/collider-free adjustment, four refuters, negative control, sensitivity, Attribution authority, certificate, and public-level closure;
  nine causal adversarial families fail closed at L4/HOLD.
- Added a content-addressed eight-case E-commerce suite with Published Semantic/Schema/Policy frontier, sealed QueryEvidence/Golden truth,
  score-100 hard gate, and explicit adversarial coverage for missing zero-fill, net cancellation, outlier sensitivity, seasonal leakage,
  permission-dimension induction, Simpson/reverse/collider-confounder mistakes, post-treatment leakage, small samples, MNAR, multiple testing,
  and public source/stdout disclosure. The suite remains `HOLD` until U7.
- Added Worker cross-layer acceptance from semantic frontier and QueryEvidence through attested program refs, independent Oracle, V3 chart,
  L4 sales-return candidate disclosure, replay-stable report projection, and hard-fail output suppression. The existing live acceptance CLI now
  reports the suite version/hash/case threshold/readiness under its explicit execution confirmation.
- Validation:
  - Evals typecheck and full package tests passed; deterministic/generated/causal/suite targeted suite: 24 tests.
  - Contracts build and full unit: 81 files / 855 tests; Platform full unit: 89 files / 527 tests.
  - Worker U4/U8/U6 integration selection: 3 files / 18 tests; Web typecheck passed.
  - All three Python runtime attestations `VERIFIED`; Python Sandbox full suite: 111 tests; Platform Python process integration: 1 test.
  - Repository PostgreSQL smoke is independently blocked by a pre-existing duplicate self-checksum literal in migration 10694. The subsequent
    Platform integration passed 13 tests with 1 skipped, then its unrelated schema-discovery fixture failed because it supplies the non-UUID
    string `schema-discovery-integration` to a UUID column. Neither failure touches the U6 owned paths.
