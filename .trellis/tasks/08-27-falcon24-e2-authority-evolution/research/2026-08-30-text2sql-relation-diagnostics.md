# Bug Analysis: relation rejection lost its discriminating reason

## 1. Root Cause Category

- Category: B (cross-layer contract), D (test coverage gap), E (implicit assumption).
- Confirmed cause of the diagnostic gap: five different relation rejection branches emitted one marker. Worker repair and Root received
  no evidence distinguishing missing aliases, unqualified names, denied relations, unsupported AST shape or duplicate Host bindings.
- Scratch attempt `2dc2cfe3-8501-497c-995c-73e60f03d7bf`, L2-01 Run `4616d007-0d00-8632-b9a6-65ab0845cb99`,
  completed Semantic but repeatedly failed Text2SQL COMPILE with `TEXT2SQL_SQL_RELATION_BINDING_REJECTED`.
  The final candidate passed COMPILE but failed EXECUTE binding with `QUERY_EVIDENCE_RESULT_BINDING_MISMATCH`; event 76 terminated
  with `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`. The canary must verify both compilation and result binding, not just one relation predicate.
  L1 5/5 receipts remain immutable; L2 business FAIL skips QA/Trace and higher turns. This is not an overall PASS.
- The historical candidates are available only as hashes and type projections, not saved SQL. The exact historical relation mistake is
  unconfirmed; no synthetic SQL is presented as the original candidate.

## 2. Why Fixes Failed

- Existing generic repair guidance combined unrelated remedies; repeated model candidates could not narrow the reason.
- Before investigation, candidate-name/alias mistakes and policy handling of CTEs were both plausible. The actual parameterization,
  deparse and policy test accepts a month-aggregate CTE self-join; prepare also deduplicates physical bindings. Those observations weaken
  the hypotheses that all CTE joins are unsupported or ordinary multi-object Semantic bindings always duplicate the allowlist.
- Initial diagnostic regressions produced 8 failing assertions. The implementation makes those assertions pass without changing the
  SQL admission conditions. Only a fresh isolated canary can distinguish the remaining historical SQL hypotheses.

## 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime contract | Emit exact safe relation diagnostic through Platform and Worker | DONE |
| P0 | Test coverage | Real compiler round trip plus forbidden relation vectors | DONE |
| P0 | Repair guidance | Separate physical qualification from local CTE names and explicit aliases | DONE |
| P0 | Evidence discipline | No inferred original SQL, no public raw payload, no old Run replay | DONE |
| P1 | Runtime verification | Use one fresh isolated canary before another full gate attempt | PENDING |

## 4. Systematic Expansion

- Similar compound diagnostics must not hide whether the caller or Host owns the repair. Existing generic codes stay supported for history.
- This change does not alter relation permissions, query budgets, Semantic Release, datasource binding or authority epochs.
- Normal Root turn budget remains four; the separate question of multi-agent scheduling is not claimed fixed by this diagnostic change.

## 5. Knowledge Capture

- Updated `.trellis/spec/backend/text2sql-resolved-context.md` with the cross-layer diagnostic matrix and required regressions.
- Template synchronization is not applicable: this application checkout has no `src/templates/markdown/spec/` tree; do not create a second
  unrelated template framework.
- Focused Platform/Worker suite: 75/75 passed. Typechecks and owned-file checks are required before the scoped commit.
