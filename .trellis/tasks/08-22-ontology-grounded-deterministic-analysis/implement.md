# Implementation plan: ontology-grounded deterministic analysis

The canonical execution specification is
`docs/plans/2026-08-22-003-feat-ontology-grounded-deterministic-analysis-plan.md`. Execute the units in dependency order and do not treat a
green sub-slice as completion of the full task.

## Ordered checklist

- [x] Baseline audit: inspect existing implementations, active HOLD gates, package specs, test commands, and file overlap before editing.
- [x] U1 Versioned Analysis Contracts: add versioned refs/payloads/wire/public events, preserve @2 semantics, and add strict/hash/scope tests.
- [ ] U2 Semantic Context and Applicability: publish explicit analysis semantics, compile deterministic context/transform witnesses, and add
  fail-closed applicability tests.
- [ ] U3 Attested Python Runtime and Programs: close existing sandbox HOLD gates first, then add Core/ML/Causal locks, standard programs,
  admission policy, independent oracles, malicious fixtures, replay/cancel/resource tests, and attestation evidence.
- [ ] U4 Planner and Worker: register server-owned descriptors/tools, controlled import, bounded DAG planning, governed query reuse, sandbox
  execution, idempotent artifact submission, repair/fence semantics, and integration coverage.
- [ ] U8 Root Cause and L5: implement bounded ontology-grounded discovery, reuse Attribution authority, add identification/estimate/certificate
  payloads and gates, and keep insufficient evidence HOLD.
- [ ] U5 Projection and Workbench: add safe platform projections, chart protocol evolution, evidence-grounded insight selection, replay-stable
  report UI, evidence drawer, and disclosure/sensitivity tests.
- [ ] U6 Independent Evaluation: add deterministic/generated/causal oracles, semantic e-commerce fixtures, cross-layer acceptance, adversarial
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
