# Semantic Layer Studio Delivery — Implementation Plan

## Execution Rule

The parent task is not the implementation target. Execute one child milestone at a time and require its
acceptance Gate before creating or activating the next dependent child.

## Ordered Delivery

1. Execute `08-08-semantic-layer-m0-authority-safety`.
2. After M0 is archived with PostgreSQL and security evidence, create M1 Schema Discovery.
3. After M1 snapshot/drift Gate, create M2 Semantic Explorer.
4. After M1/M2 contracts are stable, create M3 Schema-to-Semantic Candidate.
5. After M3 uses the governed Candidate path, create M4 Metric Authoring Agent.
6. After M4 validation/impact is stable, create M5 Runtime Closure.
7. Run parent integration review across all five user flows.
8. Create M6 tasks only from a measured benchmark or additional product decision.

## Parent Integration Gate

- One PostgreSQL fixture can be scanned, displayed, mapped to a candidate, reviewed, published and used
  by a new Query Run while an old Run keeps its old release.
- One user metric/formula request can be clarified, compiled, reviewed and published through the same
  Candidate path.
- Cross-scope, stale approval, candidate leakage, concurrent publish, rollback and secret exposure tests
  all fail closed.
- Documentation states the exact implemented milestone and does not imply M6 or production deployment.

## Validation

Each child defines scoped commands. Final parent validation includes:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:tenancy
pnpm test:security
```

Full commands are cumulative evidence, not substitutes for PostgreSQL migration ledger and physical
runtime verification.
