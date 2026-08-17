# U19 Implementation Plan

## Ordered Work

1. Freeze PRD/design/wire boundaries and add red tests for fixed profiles, strict v2 task/capability/context/verification contracts and public-surface Mastra isolation.
2. Implement versioned profiles, workflow registry, deterministic context compiler, coverage/omission/obligation records, dispatch envelope and stable error taxonomy.
3. Extend handoff with a v2 depth-1 delegation contract, fresh child isolation, strict narrowing and expected-revision/fence checks; preserve v1 compatibility tests.
4. Implement task completion/verifier/acceptance separation and a no-network `MastraTeamRuntime` adapter that rehydrates from PostgreSQL-authoritative records rather than memory.
5. Add strict SensitiveExecutionArtifact contracts plus an injected private encrypted blob port and PostgreSQL metadata authority.
6. Add Platform `PostgresTeamRunStore`, result verifiers and exact withAppTransaction capability/scope/lease mapping.
7. Add 10658 renderer, tables/RLS/NOLOGIN/grants/CAS RPCs/static assertions and rollback-only authority fixtures; bind existing U4 attempts/fence/outbox instead of adding a queue.
8. Add the early `Text2SQL -> Verifier -> Report` and `Semantic -> Candidate` no-network slice, context epoch kill-point/recovery and 100-task projection tests.
9. Run package tests/typecheck/build, renderer/static, fresh PostgreSQL 17 with all import hooks `/dev/null`, Biome, diff-check and forbidden scans.
10. Run Trellis check, repair all U19-owned P0/P1, update evidence, stage exact owned paths/hunks and create one scoped commit; then automatically start U10.

## Owned Paths

- `.trellis/tasks/08-16-u19-agent-team-v2/**`
- `packages/agent-runtime/src/teams/{roles,contracts,handoff,context-projection,index}.ts` U19 hunks
- `packages/agent-runtime/src/teams/{agent-profiles,workflow-registry,team-orchestrator,task-completion}.ts`
- `packages/agent-runtime/src/mastra/{mastra-team-runtime,context-compiler,context-epoch-adapter,subagent-controller,provider-dispatch-envelope}.ts`
- `packages/agent-runtime/src/mastra/index.ts` and package root U19 export hunks only
- `packages/agent-runtime/test/{agent-profiles,team-orchestrator,team-handoff,task-completion,mastra-team-runtime,context-compiler,context-epoch-recovery,provider-dispatch-envelope,public-surface}.spec.ts`
- `packages/contracts/src/artifacts/sensitive-execution-artifact.ts`
- `packages/contracts/src/artifacts/{index,types}.ts` U19 exact hunks only
- `packages/contracts/test/sensitive-execution-artifact.spec.ts`
- `packages/platform/src/agents/postgres-team-run-store.ts`
- `packages/platform/src/storage/sensitive-execution-artifact-authority.ts`
- `packages/platform/src/authz/postgres-privileged-grant-authority.ts` U19 exact hunk only
- `packages/platform/src/index.ts` U19 exact export hunks only
- `packages/platform/test/agents/postgres-team-run-store.spec.ts`
- `packages/platform/test/storage/sensitive-execution-artifact-authority.spec.ts`
- `infra/supabase/apps/data-agent/migration-sources/10658/**`
- `infra/supabase/apps/data-agent/migrations/20260725010658_app_data_agent_agent_team_authority.sql`
- `infra/supabase/test-support/36-agent-team-authority-assertions.sql`
- `infra/supabase/test-support/static-check.sh` 10658 exact hunk only
- `scripts/render-10658-migration.ts`
- `docs/architecture/data-agent-team-profiles.md`

## Validation

```text
pnpm --filter @data-agent/contracts exec vitest run test/sensitive-execution-artifact.spec.ts
pnpm --filter @data-agent/agent-runtime exec vitest run test/agent-profiles.spec.ts test/team-orchestrator.spec.ts test/team-handoff.spec.ts test/task-completion.spec.ts test/mastra-team-runtime.spec.ts test/context-compiler.spec.ts test/context-epoch-recovery.spec.ts test/provider-dispatch-envelope.spec.ts test/public-surface.spec.ts
pnpm --filter @data-agent/platform exec vitest run test/agents/postgres-team-run-store.spec.ts test/storage/sensitive-execution-artifact-authority.spec.ts
pnpm --filter @data-agent/contracts typecheck && pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/agent-runtime typecheck && pnpm --filter @data-agent/agent-runtime build
pnpm --filter @data-agent/platform typecheck && pnpm --filter @data-agent/platform build
pnpm exec tsx scripts/render-10658-migration.ts --verify
sh infra/supabase/test-support/static-check.sh
```

Fresh PostgreSQL 17 maps ecommerce/Falcon import hooks to `/dev/null`, installs migrations, then runs only assertion 36. It does not import data, run Falcon or call a Provider.

## Risks

- The repository is heavily dirty from parallel work; shared barrels, static-check and privileged grant files require exact hunk staging.
- U19 is not allowed to create a second Run queue or provider store; all task writes must correlate existing U2/U3/U4 authority.
- Capability candidates, Mastra snapshots and process memory are not authority. Tests must use persisted resolvers or explicit non-authoritative labels.
- Context/obligation canonicalization must be identical in TypeScript and PostgreSQL; fixed cross-language vectors are mandatory.
- Object storage/KMS is injected and fake in tests; only PostgreSQL metadata and lifecycle are release authority in U19.
- U20 product integration remains out of scope; a deterministic early slice is evidence of contract viability, not user-facing completion.
