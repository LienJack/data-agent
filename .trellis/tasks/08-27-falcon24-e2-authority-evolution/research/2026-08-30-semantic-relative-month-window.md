# Bug Analysis: requested month count was not a runtime contract

## 1. Root Cause Category

- B (Semantic/Text2SQL contract gap), D (missing duration assertions), E (assuming prompt arithmetic is deterministic).
- Clean-build canary `7fd38f6e-f858-8150-b704-71bbad170070`, Conversation `b3a8c2c8-5f0f-445d-99b5-2e1a39f06681`,
  build `8b3f66b4`, succeeded with 37 events and no SQL rejection. QueryEvidence `98e308e4-3f56-800e-adac-824cae14836d` held only
  eleven rows and `[2023-12-01, 2024-11-01)`, although the request required twelve complete months. Business FAIL; QA/Trace not run.
- Published-bound validation correctly kept the result inside coverage, but the requested period count existed only in prose.

## 2. Why Fixes Failed

- Exclusive-frontier guidance and range guards cannot distinguish an in-range eleven-month query from the requested twelve-month query.
- Interval parameterization was a separate proven defect and is fixed; it does not establish duration correctness.
- Initial new contract/runtime/prompt tests failed nine assertions. A follow-up reversed-operation-order test exposed that two independent
  semantic declarations were unnecessarily treated as an ordered sequence. Committed interpretation order remains Host-canonical.

## 3. Prevention Mechanisms

- Reuse the existing request-scoped operator extension point for typed metric, month dimension and count. Host performs calendar
  subtraction against published boundaries; Semantic and Text2SQL cannot author the resolved dates.
- Validate closure, timezone, month-aligned frontier, count and coverage. Expose the resolved window in the frozen Text2SQL context and
  reject omitted, shortened or expanded candidate windows before query I/O. Existing bounded repair receives the exact safe mismatch code.
- Keep request-only semantics, old payload hashes, duplicate rejection and canonical committed interpretation ordering. No migration,
  new release authority, Semantic Candidate, fixed SQL template or keyword route is introduced.

## 4. Systematic Expansion

- Tests cover twelve/one months, leap-year and offset boundaries, invalid counts, missing/non-aligned frontier, insufficient coverage,
  mismatched time-column binding, input-order independence, duplicate declarations and old context verification.
- Worker tests cover actual prepare-to-provider projection, pre-I/O wrong/omitted windows, request-only explanations and safe diagnostics.
- This does not make natural-language interpretation infallible or prove every SQL expression correct. Actual month count, source values,
  prior-year availability and ratio treatment remain independent business checks. No prior failed Run becomes PASS.

## 5. Knowledge Capture

- Updated the resolved-context Text2SQL spec. There is no application template counterpart to synchronize.
- A clean rebuild and fresh independent canary remain mandatory; formal activation/gates are still incomplete.
- Final focused validation: 140/140 tests across seven files; Contracts and Worker typechecks; eight-file Biome check; diff whitespace and
  Trellis context validation passed. Existing oversize context-injection warnings remain; the main session reads needed specs directly.
