# Final completion audit: ontology-grounded deterministic analysis

Canonical plan: `docs/plans/2026-08-22-003-feat-ontology-grounded-deterministic-analysis-plan.md`

Audit date: 2026-08-22, Asia/Shanghai. This audit distinguishes implementation completion from operational promotion. The implementation is
complete through U1-U8/U7; the current release decision is `SHADOW_READY`, while per-skill GA remains `HOLD` because license review and
per-skill promotion reviews are intentionally open. `certified-causal-estimate@1` remains `NOT_REGISTERED` until F9 and the independent,
expiring L5 gate are both valid. These states are required fail-closed outcomes, not claims of GA availability.

## Requirements R1-R17

| Requirement | Status | Direct implementation and verification evidence |
|---|---|---|
| R1 frozen semantic/policy/context authority | PASS | `packages/semantic/src/analysis/context-compiler.ts`, `packages/contracts/src/artifacts/research/analysis.ts`, `apps/worker/src/analysis/plan-gate.ts`; Semantic full suite 18/149. |
| R2 server-owned skills and candidate-only model authority | PASS | `apps/worker/src/analysis/skill-catalog.ts`, `program-admission.ts`, and authoritative Release Manifest catalog factory; untrusted rollout and unknown skill tests. |
| R3 metric/unit/grain/time/null/join/sensitivity/budget applicability | PASS | `packages/semantic/src/analysis/applicability.ts`, `transform-compiler.ts`; deterministic rejection cases in `analysis-context-compiler.spec.ts`. |
| R4 QueryEvidence distinct from derived evidence | PASS | Separate versioned refs/payloads plus `packages/research/src/analysis-evidence/verifier.ts`; contract and cross-layer tests reject broken closure. |
| R5 deterministic source/runtime/lock/seed/hash and drift HOLD | PASS | Platform-bound runtime attestations, program verifier, 100 actual subprocess replays with byte-identical outputs, replay/hash drift tests. |
| R6 skill-specific mathematics and fail-closed reasons | PASS | Six frozen standard programs, independent TypeScript Oracles, hand-computed/property/adversarial fixtures; Evals 10/78. |
| R7 non-causal evidence boundary, forecast backtest, causal certificate | PASS | Claim/report @3 modes, mandatory disclosures, forecast Oracle, L4/L5 ladder and certificate gate; causal/adversarial suites. |
| R8 bounded DAG and global resource budget | PASS | `default-plan.ts`, `plan-gate.ts`, `executor.ts`, sandbox hard limits; cycle, split-budget, row/time, fence and resource tests. |
| R9 explicit Claim/Report evolution preserving @2 | PASS | `packages/contracts/src/artifacts/research/proof.ts`, `reporting.ts`, `wire.ts`; historical @2 and strict @3 tests; Contracts 81/859. |
| R10 UI consumes accepted projections only | PASS | `packages/platform/src/artifacts/derived-analysis-projection.ts`, Web deterministic sections/renderer; projection closure and no-browser-expression tests. |
| R11 public conclusions carry refs/method/parameters/coverage/limitations/disclosures | PASS | Derived evidence/claim/report schemas and public projection builder; incomplete or invented findings rejected. |
| R12 automatic plan only scans primary metrics/approved dimensions | PASS | `createDefaultAnalysisPlan`; direct expanded-context test proves an unrequested metric is not planned and dimensions remain approved. |
| R13 public projection redaction | PASS | Public event/projection allowlists and cross-layer negative regex for source/stdout/stderr/SQL parameters/private reasoning/raw rows. |
| R14 independent Oracle, budgets, shadow metrics, kill switch/release gate | PASS | Deterministic/generated/causal Oracles, content-addressed E-commerce suite, nested rollout contract, per-skill server catalog removal and release verifier. |
| R15 Python only in attested isolated Sandbox, zero failure output | PASS | Core/ML/Causal images, no-network/read-only/no-new-privileges smoke, AST/import policy, exact cancellation and zero-output tests. |
| R16 Candidate → diagnostic → certified causal state machine | PASS | Root-cause payloads/executor/verifier; only a valid certificate authorizes causal Claim; semantic/certificate/expiry drift stays HOLD. |
| R17 bounded/replayable transform/chart/insight/deliverable | PASS | Transform compiler, AnalysisPlan nodes, V3 Chart Document, insight selector, run/report projection and replay-stable Web report. |

## Verification matrix

| Layer | Current evidence | Result |
|---|---|---|
| Contracts | `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @data-agent/contracts exec vitest run test --testTimeout=30000 --maxWorkers=2` | PASS: 81 files / 859 tests. |
| Semantic | `pnpm --filter @data-agent/semantic test:unit` | PASS: 18 / 149. |
| Research | package unit plus explicit architecture/performance suites | PASS: 21 / 146 and 2 / 11. |
| Python Sandbox | Ruff, 113-test suite, attestation, three images and hardened container smoke | PASS: 96 passed / 17 DB-configured skipped; all three profiles success; malicious/timeout/cancel fail closed. |
| Worker | typecheck plus plan/root-cause/cross-layer integration selection | PASS: cross-layer selection 3 files / 20 tests; final targeted analysis-plan runtime 18 / 18 tests. |
| Platform | `pnpm --filter @data-agent/platform test:unit` | PASS: 89 / 527. |
| Web | deterministic report/projection selection | PASS: 1 / 5. Full Web ran 446 pass / 1 skip with two unrelated pre-existing source-assertion failures in workspace navigation and Semantic Studio. |
| Causal | Evals deterministic/SCM suites plus Research root-cause suite | PASS for implemented L4/L5 gates; operational L5 remains NOT_REGISTERED. |
| Cross-layer | `apps/worker/test/integration/deterministic-analysis-run.spec.ts` in Worker selection | PASS through semantic frontier → program/receipt/result → Oracle → V3 chart → L4/report. |
| Release | attestation, supply-chain verifier, capability probe and deterministic release mode | PASS: `SHADOW_READY`, `ga_decision=HOLD`, zero failed checks. |

The repository PostgreSQL smoke still has the previously recorded unrelated migration-10694 duplicate self-checksum blocker; a separate Platform
integration fixture still supplies a non-UUID schema-discovery id. Neither is in this task's owned paths. The relevant Platform unit authority
suite and the deterministic analysis cross-layer suite pass.

## Failure and recovery rows

| Planned failure | Direct evidence and recovery behavior | Status |
|---|---|---|
| Semantic/Policy drift | Context/plan/projection/certificate hash checks; create a new Run/revision | PASS |
| CSV/XLSX reject/ambiguity | Fixed import policy tests cover archive, macro, external link, formula, dimensions, encoding and timeout; rejected receipt has no outputs | PASS |
| Physical profile without semantic binding | DataProfile `UNRESOLVED` contract requires `UNRESOLVED_SEMANTICS`; no business metric is fabricated | PASS |
| Invalid join/grain/fanout/derived metric | Transform/applicability rejects stable reason; new published semantic material is required | PASS |
| Skill not applicable | Deterministic applicability returns skip/clarification, never swaps algorithms silently | PASS |
| Optional query/program fails | Executor direct test produces PARTIAL; critical counterpart produces HOLD | PASS |
| Program policy rejects | Host and Sandbox policies reject; at most one authority-nonexpanding repair | PASS |
| Timeout/cancel/resource | Hardened container and unit tests return stable failure with zero outputs | PASS |
| Sandbox succeeds but Oracle fails | Research verifier returns candidate/HOLD and does not create accepted Claim | PASS |
| Critical Query/Claim fails | Executor critical path returns HOLD | PASS |
| Derived hash mismatch | Verifier returns HOLD/security diagnostic; release runbook kills the skill version | PASS |
| Forecast loses baseline | Independent forecast Oracle suppresses public forecast and adds disclosure | PASS |
| Root cause not identifiable/refutation fails | L4 Candidate/limitations remain visible; no causal estimate/certificate | PASS |
| Chart/Insight closure fails | Projection withholds the chart/narrative and preserves evidence table/limitations | PASS |
| Causal certificate expires | Certificate and runtime rollout checks revoke execution/readiness at expiry | PASS |
| SSE interruption/replay | Platform and Web duplicate replay tests are byte-stable and perform no statistical recomputation | PASS |
| Budget exhausted | Plan/runtime budget gates produce PARTIAL or HOLD and require narrowed/new authorized run | PASS |

The fixed tabular import authority performs no silent cleaning. Raw and materialized sheet hashes are both retained; because no cleaning operation
is performed in this slice, there is no fabricated cleaning receipt. Any future repair/cleaning must be an explicit bounded transform with a new
before/after artifact closure rather than mutating the imported artifact.

## Delivery slices

| Slice | Delivered state |
|---|---|
| 1 Data Understanding/minimum loop | Import admission/receipt, DataProfile, semantic binding/transforms, plan/program/receipt/result/derived evidence/report/evidence drawer and hardened E2E are implemented. |
| 2 Automatic EDA/visual story | Frozen summary/trend/quality evidence, deterministic chart policy/V3 documents and Fact/Pattern projection are implemented. |
| 3 Contribution/drill-down | Contribution lowering, Top-K/Other/closure/concentration/priority projection and E-commerce return scenario are implemented. |
| 4 Generated Python | `open-python-analysis@1` now uses attested `ML_DIAGNOSTIC`, allowing governed pandas/scipy/statsmodels/scikit-learn; one repair and independent generated Oracle are Shadow-gated. |
| 5 Detect/relate | Robust anomaly, outlier/completeness and Pearson/Spearman boundaries/disclosure are implemented and independently evaluated. |
| 6 Forecast honestly | Frozen baseline/backtest program and leakage Oracle are implemented; capability is Shadow and intentionally promoted last. |
| 7 Root Cause Discovery | Bounded ontology-grounded L4 universe/ranking/mechanism checks and candidate UI ladder are implemented for internal rollout. |
| 8 Certified Causal | Versioned L5 contracts, causal Sandbox port, DoWhy/EconML runtime, SCM Oracle, identification/refutation/sensitivity/certificate/expiry gates are implemented; F9/L5 registration remains fail-closed. |

Each registered analysis skill has an independent server-owned kill switch. Disabling one removes only that descriptor; ordinary Text2SQL and
other skills remain registered.

## Definition of Done

1. Standard skills: PASS — versioned applicability, frozen programs, Golden/Metamorphic Oracles, budgets and limitations.
2. Data/Profile/Transform/Chart/Insight contracts: PASS — strict versions, hashes, refs, budgets and rejection tests.
3. Scientific supply chain: PASS for attestation/SBOM/CVE; license metadata is explicitly REVIEW_REQUIRED and therefore blocks GA.
4. Generated pandas/SQL closure: PASS — Program/Input/Output/Runtime/Lock/Policy/Fence/Receipt/Oracle.
5. Bounded explainable broad plan: PASS — direct primary/approved-only test plus per-node status/reason projection.
6. Six-stage user flow: PASS for governed and exploratory projections; unresolved semantics never become governed business identity.
7. Visible evidence traceability: PASS — semantic/query/program/receipt/result/oracle closure and projection tests.
8. Replay/version immutability: PASS — 100 real executions byte-match; new platform/version changes create new digests/artifacts.
9. Automatic rejection cases: PASS — non-additive contribution, universal zero-fill, unbacktested forecast, unverified generated code and
   uncertified causality are adversarial cases.
10. Causal ladder: PASS — L4 Candidate is available; complete L5 certificate alone can authorize causal Claim; all missing gates HOLD.
11. UI evidence levels: PASS — trend/anomaly/contribution/quality/forecast/program/runtime/root-cause ladder and READY/PARTIAL/HOLD render.
12. Ready/RBAC/sensitivity/budget/replay/projection: PASS in task-relevant suites; full Web unrelated failures are recorded above.
13. Capability Matrix truthfulness: PASS — per-skill Shadow/Internal/NOT_REGISTERED states, GA HOLD, F9/L5 boundary and kill switches are observable.

## Audit fixes discovered and closed

- Upgraded vulnerable PyArrow 20.0.0 to 23.0.1 and re-attested/rebuilt/scanned all profiles.
- Bound Runtime digest and container startup to `linux/arm64`; cross-architecture execution can no longer masquerade under the same Runtime.
- Bound generated Open Python to `ML_DIAGNOSTIC` so the declared statsmodels/scikit-learn slice is actually executable under policy.
- Replaced a two-call replay check with 100 real subprocess executions and byte-identical output verification.
- Added direct automatic-plan primary/approved-only and optional-PARTIAL versus critical-HOLD tests.
