# Bug Analysis: interval parameterization broke grouped expressions

## 1. Root Cause Category

- B (compiler/database contract), D (missing regression), E (incorrect equivalence assumption).
- Independent canary `f92c6633-0606-81a6-9634-d956e234e3d1` in new zero-message Conversation
  `fdaa50f3-5faf-4c42-bb08-bb00c51c19ba`, build `d66f8ed3`, failed at event 78 with Root budget exhaustion.
  Events 70/73 had the same compiled candidate hash and `DATASOURCE_ADAPTER_SQL_GROUPING_ERROR`.
- NAS scratch PostgreSQL logs at `2026-08-30T13:27:57.047Z` and `13:28:01.229Z` preserve the actual EXPLAIN statements:
  prior-month SELECT used `date_trunc($5, order_date::timestamp) + CAST($6 AS interval)` while GROUP BY used the same expression
  with `$7`. PostgreSQL rejected both with `42803`.
- A read-only reproduction proves that valid SQL repeating `interval '1 year'` becomes invalid after Host parameterization. Existing
  rewriting shared the date-trunc unit but allocated a fresh interval parameter at each occurrence.

## 2. Why Fixes Failed

- Generic grouping repair guidance cannot prevent the Host from reintroducing a mismatch into equivalent literal expressions.
- The earlier monthly self-join regression shifted a pre-parameterized value outside GROUP BY and did not exercise this case.
- The original precompile provider candidates are not preserved. Database logs prove the actual compiled statement shape, not the
  original syntax or values of `$6/$7`; the synthetic reproduction is explicitly separate from historical provider output.
- The same canary also observed the new coverage guard reject events 49/52. This patch does not claim the independent window or alias
  generation failures are solved.

## 3. Prevention Mechanisms

- Reuse newly generated string parameters only within the explicit interval-cast context. Existing explicit parameter indices remain
  unchanged; numeric/text/other casts are not globally merged.
- Two new tests failed before the fix. Regression covers both interval literal and qualified CAST syntax, different interval values,
  unrelated text literals, and the unchanged policy validation chain.
- Real PostgreSQL comparison: original SQL PASS, old parameterized SQL FAIL/42803; after repair both PASS under read-only transactions.

## 4. Systematic Expansion

- Stable parameter identity is part of compiler semantic preservation, not merely SQL-injection hygiene. Equal values at different
  parameter positions are not structurally interchangeable to the PostgreSQL planner.
- Do not relax GROUP BY, relation permissions, column admission, bounds, or Root retry limits. Do not import failed canary evidence
  as formal PASS. Rebuild cleanly and use a new independent canary after validation.
- The unrelated root-package import gate failure was fixed separately in `d66f8ed3`; the full unit gate then passed 15/15 tasks,
  3302 tests with one configured skip. It is not evidence that the canary business result passed.

## 5. Knowledge Capture

- Updated the resolved-context Text2SQL spec with grouped-expression preservation and real database regression requirements.
- No template counterpart exists in this application checkout. The next canary remains required before restarting formal gate work.
