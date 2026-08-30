# Bug Analysis: accepted time window exceeded the published frontier

## 1. Root Cause Category

- B (cross-layer contract), D (test coverage gap), E (implicit assumption).
- Fresh non-formal canary `09ccd967-cd64-85fb-ae27-c7583e9657e1` on clean build `aff7d354` succeeded technically but failed business review.
  It requested the most recent twelve complete months. Published coverage ended exclusively at `2024-11-01T00:00:00.000Z`; accepted
  QueryEvidence `a3f15d98-e064-8455-b6c4-40b0fbf4cb02` instead declared `[2023-12-01, 2024-12-01)`.
- Result buckets included incomplete November 2024 (source sum 68157.65) and omitted November 2023 (567783.74). Correct current buckets
  are November 2023 through October 2024. The audit is preserved under `f6-yoy-canary-aff7d354`; no QA/Trace PASS was recorded.
- The binding builder validated parameter order and half-open predicate syntax but never compared against published coverage.

## 2. Why Fixes Failed

- Precise relation diagnostics solved a distinct visibility gap, not time semantics. The new canary had no relation rejection, repaired
  one grouping error and then accepted the wrong month window. Its success status is not evidence of business correctness.
- Existing tests used null time bounds, so even strong parameter/predicate tests missed published coverage overflow.
- New regressions first produced nine failures across the binder, repair propagation and provider guidance.

## 3. Prevention Mechanisms

- Enforce non-null published bounds before QueryEvidence acceptance; permit equality and compare timestamp instants.
- Route only candidate overflow into the existing bounded repair. Malformed/reversed authority remains non-repairable by the model.
- Explain exclusive frontier arithmetic generically in Text2SQL guidance, without hard-coded Falcon dates or question routing.
- Focused binder/provider/tool/runtime tests pass 71/71, including accepted and rejected repair paths; retain typecheck and owned-file
  validation before the scoped commit. A clean-build fresh canary is still required for business proof.

## 4. Systematic Expansion

- This patch governs the declared current window at result acceptance. It does not claim pre-I/O rejection or complete validation of
  every comparison-period CTE. Prior-year availability, output month labels and values require independent canary review.
- Null optional windows remain legal for unbounded row-level requests; this patch does not add keyword-driven request classification.
- The failed canary and earlier gate attempts remain immutable. No old PASS is imported into a new build or attempt.

## 5. Knowledge Capture

- Updated `.trellis/spec/backend/text2sql-resolved-context.md` with bounds, error ownership, negative vectors and proof limitations.
- No `src/templates/markdown/spec/` exists in this application checkout; no second template system is introduced.
