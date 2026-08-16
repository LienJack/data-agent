# U1 Implementation Plan

1. Add failing tests for exact 58-ID manifest coverage, missing/duplicate/cycle failures and forbidden commercial Evidence Kinds.
2. Implement strict capability descriptors and DAG validation; export through the capability barrel.
3. Add failing Bootstrap/Falcon boundary tests, then implement Greenfield strict schemas.
4. Add coverage-floor happy/error tests, then implement deterministic policy validation.
5. Add signer registry and route authorization tests, then implement role-separated public key and action contracts.
6. Write the architecture ledger mapping all 58 IDs to U-ID and Evidence Kind.
7. Run focused Vitest, contracts build/typecheck and root Greenfield integration test.
8. Audit diff against U1 owned paths, stage only those paths and create the U1 scoped commit.

## Owned Paths

- `packages/contracts/src/capabilities/platform-capabilities.ts`
- `packages/contracts/src/capabilities/index.ts`
- `packages/contracts/src/semantic/greenfield-bootstrap.ts`
- `packages/contracts/src/semantic/semantic-coverage-policy.ts`
- `packages/contracts/src/authz/signer-key-registry.ts`
- `packages/contracts/src/workspaces/route-authorization-matrix.ts`
- `docs/architecture/datafoundry-coa-capability-ledger.md`
- U1 tests named in the frozen plan.

## Validation

- `pnpm --filter @data-agent/contracts test:unit -- platform-capability.spec.ts greenfield-semantic-bootstrap.spec.ts semantic-coverage-policy.spec.ts`
- `pnpm --filter @data-agent/contracts typecheck`
- `pnpm --filter @data-agent/contracts build`
- `pnpm exec vitest run tests/datafoundry-coa-greenfield-bootstrap.spec.ts`
