# Bug Analysis: incomplete machine temporal guidance during bounded repair

## 1. Root Cause Category

- B (cross-layer contract), E (delegation prose assumed authoritative).
- Fresh `4f77a8f5` non-formal Run `ea709450-4717-819b-b708-7c4ac8a3c156` ended FAILED with 74 events and
  `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`. Six SQL candidates were rejected before query I/O: coverage, alias and current-window diagnostics.
  No QueryEvidence exists; business FAIL, no QA/Trace acceptance. Audit: `f6-yoy-canary-4f77a8f5`.
- Read-only durable Root ProviderResponseArtifact tool calls prove a repair objective explicitly changed the requested current window to
  `[2023-12-01, 2024-12-01)`, despite the frozen exclusive frontier `2024-11-01`. This conflicting delegation is directly observed, not
  inferred from a fluent answer. Earlier failed specialist SQL/parameter vectors were not durably available; their exact shapes are unknown.

## 2. Why Fixes Failed / Discriminating Evidence

- Source coverage enforcement worked, but the model still had to derive the comparison intersection from prose and raw time-domain fields.
  Current-window derivation alone did not supply exact prior-source bounds or clarify the authority of conflicting Root retry dates.
- Initial hypotheses: unsupported SQL proof shape 50%, incorrect date bounds 30%, conflicting delegation 20%. Read-only provider tool calls
  directly confirm the third hypothesis for the final retry. This does not identify the first rejected SQL's exact defect; do not claim it does.
- Instead of another unchanged run, add machine-derived comparison bounds, an explicit hierarchy rule and no-model proof on the exact failed
  Run's verified SemanticQueryContext. No increase to model repair budgets or weakened SQL guard.

## 3. Prevention Mechanisms

- Host resolves matching typed current/prior windows, subtracts one calendar year once, intersects published coverage and represents an
  all-unavailable prior source explicitly. Text2SQL must copy effective bounds; Root descriptions cannot override them.
- Pure Contracts resolver plus actual Worker prepare/provider projection tests. Historical context documents and hashes remain unchanged.
- RED: seven missing-resolver cases and one missing-runtime-projection case. Focused coverage also retains alias/source-bound and bounded
  repair regression tests. A new clean build and independent conversation remain necessary for business proof.
- Focused suite passes 174/174. Contracts/Worker typechecks, six owned TypeScript files Biome, Trellis context validation and diff check pass.
- On the exact failed Run's verified context, Host resolves current `[2023-11-01, 2024-11-01)` and eligible comparison
  `[2023-05-01, 2023-11-01)`. A read-only scratch query using those derived parameters passes twelve rows, six NULL prior values and six
  independently checked covered values. This no-model proof is not model/business or formal acceptance.

## 4. Systematic Expansion / Boundaries

- The patch does not build business SQL, route by question keywords, inject expected numeric answers or add publishing authority.
- Calendar-month bounds are a restricted supported scope. Partial-month coverage is rejected, explicit offsets are preserved, and the separate
  SQL guard still fails closed on unsupported offset proof. No paired typed intent means no invented comparison window.
- Source coverage, bucket alignment, requested duration, aggregation/rate values and UI/Trace acceptance remain separate obligations.
- Live E11 and all failed attempts remain immutable; the forward-epoch recovery protocol is independent outstanding work, not satisfied here.

## 5. Knowledge Capture

- Updated backend Text2SQL spec with deterministic comparison bounds, empty-source semantics, delegation conflict handling and tests.
- Application has no `src/templates/markdown/spec/`; no framework template authority was invented.
