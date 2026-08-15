# AgenticDataBench E-commerce PostgreSQL Production Demo v1 — Implementation Plan

## Execution Contract

- Do not start until the user approves the final PRD/design/implementation summary and `task.py start` succeeds.
- Preserve all unrelated dirty-tree changes. Before every phase, snapshot `git status --short` and edit only the phase allowlist.
- Use test-first or characterization-first development for contracts, database state, security boundaries and runners.
- All external JSON, model output, bundle manifests and database JSON are parsed as `unknown` through strict schemas.
- Implementation proceeds in gates. A failed gate blocks later phases; do not hide a failed import, Oracle or infrastructure condition behind a Demo fallback.

## Phase 0. Baseline and Collision Check

### Work

- Re-read PRD/design and the curated Trellis contexts.
- Record the dirty-tree baseline and classify unrelated files.
- Re-run `rg --files infra/supabase/apps/data-agent/migrations | sort | tail` to confirm the next migration number; renumber the provisional `10636` if another task has claimed it.
- Record current target-package unit/contract status before changes.
- Confirm fixed upstream commit/revision and local source cache without retaining credentials.

### Gate

- No overlap with unrelated user edits is unresolved.
- Migration number and bundle paths are unique.
- Baseline failures are recorded and not attributed to this task.

## Phase 1. Deterministic Source Audit and Seed Bundle

### Tests first

- Add manifest contract tests for unknown fields, wrong revision, duplicate paths, path traversal, size overflow, hash mismatch, row-count mismatch and non-deterministic slice order.
- Add generator reproducibility test: two builds from the same fixed inputs produce identical manifests and chunk hashes.

### Work

- Add source/bundle schemas to `packages/contracts` or a leaf importer module if they are not public API contracts.
- Add developer-only generator and verifier scripts under `scripts/`.
- Materialize `infra/agenticdatabench/ecommerce-v1/` with LICENSE/LEGAL, manifests, compressed seed chunks, public cases, sealed Oracle files and semantic source bundle.
- Enforce full Olist/eBay plus first 10,000 physical JSON lines for both Amazon inputs.
- Generate PostgreSQL `COPY`-oriented chunks with stable ordering, encoding, null and numeric rules.
- Add `pnpm benchmark:ecommerce:verify`; downloading/generation remains an explicit maintainer command and is never called by startup.

### Likely files

- `packages/contracts/src/evals/*` or `packages/evals/src/test-center/agenticdatabench-source.ts`
- `scripts/build-agenticdatabench-ecommerce-bundle.ts`
- `scripts/verify-agenticdatabench-ecommerce-bundle.ts`
- `infra/agenticdatabench/ecommerce-v1/**`
- `package.json`

### Gate

- Every chunk ≤50 MiB and combined compressed bundle ≤200 MiB, or implementation returns to planning with measured evidence.
- Bundle verification works without network.
- Fixed source, license, counts, slices and hashes match the research audit.

## Phase 2. Database Migration, Raw/Mart Import and Read-only Role

### Tests first

- Add rendered-migration closure/checksum test.
- Add PostgreSQL assertions for schema/table closure, grants, immutability of receipts, idempotency and allowlisted cleanup.
- Add malicious role tests proving control-plane/other-schema/DDL/DML denial.

### Work

- Create provisional `10636` source segments, renderer and rendered migration.
- Create `demo_adb_ecommerce_raw` with 12 tables and `demo_adb_ecommerce_mart` with 14 tables plus five views.
- Create dataset/workspace receipt and benchmark case-run binding authority needed by later phases.
- Create the `data_agent_ecommerce_readonly` group role and safe LOGIN rotation function/CLI boundary.
- Add an importer that verifies the committed bundle, loads staging/raw, builds mart, validates quality/parity, atomically activates the digest and emits a structured result.
- Mount the repository bundle read-only into the one-shot migration container and invoke the importer after ledger migrations.
- Extend `dev:check`/Docker check to distinguish migration readiness from Demo dataset readiness.

### Likely files

- `infra/supabase/apps/data-agent/migration-sources/10636/**`
- `infra/supabase/apps/data-agent/migrations/20260725010636_*.sql`
- `scripts/render-10636-migration.ts`
- `infra/docker/init-db.sh`
- `infra/docker/import-agenticdatabench-ecommerce.sh`
- `compose.yaml`
- `scripts/local-dev-runtime.ts`
- `infra/supabase/test-support/*ecommerce*`

### Gate

- `pnpm dev:migrate` succeeds offline on a clean PostgreSQL volume.
- Re-running migrate/import is a no-op with identical digest and counts.
- Exactly 12 raw and 14 mart physical tables exist; five views resolve.
- Reader can query both Demo schemas and cannot enumerate/read shared control schemas.
- Import failure leaves no `READY` pointer and the prior active digest remains usable.

## Phase 3. Workspace Datasource and Bootstrap Receipt

### Tests first

- Add repository/API tests for deterministic idempotent datasource attachment, wrong Workspace, stale SecretRef, missing env secret and existing Workspace enablement.
- Add a two-Workspace test proving shared public tables do not imply shared Run/Artifact/Score access.

### Work

- Add an environment-backed Demo SecretRef resolver with production fail-closed behavior.
- Add an idempotent E-commerce bootstrap service that verifies database facts before creating the receipt.
- Invoke it after successful explicit superadmin bootstrap for the newly created Workspace.
- Add an explicit admin CLI for enabling the Demo in an existing Workspace.
- Trigger and persist a physical schema snapshot for the datasource.
- Return only identifiers, status and masked credential state in CLI/API results.

### Likely files

- `apps/web/src/cli/bootstrap-superadmin.ts`
- `apps/web/src/cli/bootstrap-ecommerce-demo.ts`
- `apps/web/src/lib/datasource-secret.ts`
- `apps/web/src/lib/schema-discovery-*`
- `packages/platform/src/persistence/workspace-data-repository.ts`
- `packages/platform/src/secrets/*`
- Workspace/data-source integration tests

### Gate

- Clean bootstrap produces one datasource, one active receipt and one schema snapshot.
- Repeated Demo enablement is idempotent.
- Missing/default production password fails before datasource creation.
- No credential appears in stdout, API, database JSON, logs or browser state.

## Phase 4. Curated Semantic Source Bundle

### Tests first

- Add source-bundle tests for minimum entity/dimension/metric/term counts, ID uniqueness, formula/grain/unit/null/time semantics, join closure and lineage completeness.
- Add invalid fanout, missing relationship and unsupported formula fixtures.

### Work

- Build the reviewed E-commerce bundle against the actual schema snapshot digest.
- Submit Candidate, validate/compile, review and publish through existing semantic services during explicit admin bootstrap.
- Add `ecommerce` to allowed semantic domains for local/deploy runtime.
- Project the release through the existing relationship indexer.
- Add graph summary/category filtering while preserving node/edge response limits.

### Likely files

- `infra/agenticdatabench/ecommerce-v1/semantic/ecommerce-source-bundle.json`
- `packages/contracts/src/artifacts/semantic-*` only if existing contract lacks required field
- `packages/semantic/src/**`
- `apps/worker/src/semantic/**`
- `apps/web/src/components/semantic/explorer/**`
- `compose.yaml`

### Gate

- Published release has ≥12 entities/dimensions, ≥30 metrics and ≥40 terms with complete source lineage.
- Report actual node/edge totals; expected 300–450/800–1,300 without synthetic padding.
- Neo4j projection digest equals PostgreSQL release digest.
- Stopping Neo4j preserves PostgreSQL Explorer fallback and governance.

## Phase 5. Test Center Contracts and Dataset Adapters

### Tests first

- Add contract tests for the two new suite IDs and prevent collision with existing `dab`.
- Add Public/Sealed serialization tests proving Gold/output validators cannot cross public routes.
- Add artifact-bundle answer and failure-taxonomy exhaustive tests.

### Work

- Add `agenticdatabench-ecommerce` and `ecommerce-production` suite IDs.
- Add bundled installation-state/readiness adapters that verify Workspace receipt and database digest rather than expose an install button.
- Load exactly three official-compatible cases and 24 Production cases with fixed registry/difficulty splits.
- Add generic sealed Data Agent case and artifact output contracts.
- Keep existing suite contracts and runners compatible.

### Likely files

- `packages/contracts/src/evals/test-center.ts`
- `packages/evals/src/test-center/agenticdatabench-*.ts`
- `packages/evals/src/test-center/ecommerce-production-*.ts`
- `packages/evals/src/test-center/catalog.ts`
- `packages/evals/src/test-center/index.ts`
- `apps/web/src/lib/test-center-runtime.ts`
- Test Center contract/unit tests

### Gate

- Catalog exposes both suites as `READY` only with a valid Workspace receipt.
- Official suite reports 3 cases; Production reports 24 with exact 8/10/6 registry and 6/10/8 difficulty counts.
- Existing benchmark suites remain unchanged in characterization tests.
- Public APIs contain no sealed fields or filesystem/database paths.

## Phase 6. SQL and Python Sandbox Tools

### Tests first

- SQL: add relation-manifest, search-path, DDL/DML/multi-statement, timeout, row/byte and cancellation tests for raw and mart snapshots.
- Python script: add request/receipt contract tests; source/input/output size tests; deterministic replay; fresh-process state isolation; cancel/crash/timeout; address-space/container memory/CPU/PID/open-file/output limits; and malicious network/socket, host path, env, subprocess, multiprocessing, dynamic import/code loading, native loading, path traversal, IPC probing, `pickle`/`marshal` and cross-Run fixtures.

### Work

- Reuse existing SQL Sandbox Authority with raw-only or mart-only `CONTROLLED_REVISION` grants.
- Define `PythonExecutionRequest@1.0.0`, `PythonSandboxReceipt@1.0.0`, stable failure taxonomy, budgets and content-addressed source/input/output contracts.
- Add a versioned `data_agent_sandbox_sdk` with frozen, deterministic Arrow/CSV/JSON input plus table/statistics/chart/report output APIs and no raw database, arbitrary file, network, process or dynamic-loader capability.
- Extend `services/sandbox` with a dedicated Python analysis supervisor/runner mode that creates a fresh `python -I` child and job directory, applies AST/import policy, process limits and output contracts, and seals receipts. Do not execute arbitrary source in the existing SQL executor process.
- Build a lockfile-pinned offline runtime with CPython 3.12, `pandas`, `numpy`, `scipy`, `matplotlib` and `pyarrow`; prohibit runtime `pip`/Conda/download and record the image/package-lock digest.
- Add the hardened `python-sandbox` image/service: no network namespace, read-only root, no host project/data/Secret mount, separate supervisor/executor identities, ephemeral tmpfs, dropped capabilities, `no-new-privileges`, seccomp/AppArmor profile, one execution per replica, bounded CPU/memory/PID and a dedicated authenticated Unix-socket directory whose control socket is unreadable by the executor identity.
- Add the Worker IPC client/authority adapter and register a server-owned Python script tool. Worker materializes only authorized content-addressed Artifacts and never passes datasource credentials, application env or host paths.
- Keep the existing PostgreSQL topology unchanged; the added service is execution-only and has no database connection.

### Likely files

- `packages/contracts/src/ports/sandbox.ts` and/or new Python sandbox contract
- `packages/platform/src/sandbox/**`
- `services/sandbox/pyproject.toml`, lockfile and `src/data_agent_sandbox/python_runtime/**`
- `packages/agent-runtime/src/tools/**`
- `infra/docker/Dockerfile.python-sandbox`
- `compose.yaml` and local/deploy runtime specifications
- sandbox unit/integration/security tests

### Gate

- Approved Python source executes with the pinned data-analysis stack, while malicious fixtures cannot affect Worker, PostgreSQL, another Run or the host and return stable policy/isolation results.
- Timeout/cancel/resource/crash tests kill the complete process group, discard partial output and leave the next execution clean; receipts prove hard control enforcement or readiness becomes `HOLD`.
- SQL and Python resource/cancel receipts bind the same Workspace/Run/Attempt/Fence and Artifact hashes.
- `pnpm test:sandbox` and `pnpm test:python-sandbox` pass, including the real hardened container with networking disabled.

## Phase 7. Durable E-commerce Data Agent Workflow

### Tests first

- Add workflow tests for strict model output, semantic join closure, multiple SQL artifacts, optional Python script stage, source Artifact commit, Sandbox Effect reuse, retry eligibility, checkpoint/resume and duplicate effect reuse.
- Add crash windows before/after external effects and stale fence tests.

### Work

- Add benchmark-case Run bindings and an executor dispatcher selected from authoritative dataset/case identity.
- Implement `ecommerce-data-agent@1.0.0` using certified model profiles and server-owned tools.
- Create asynchronous batch orchestration/projection for the two new suites.
- Persist redacted public progress/tool events and content-addressed artifacts.
- Persist Python source as a content-addressed Run Artifact and expose only redacted/capped stdout/stderr; never expose IPC paths, environment, credentials or private reasoning.
- Preserve Attempt 0 and allow one cropped-feedback reflection only for eligible Agent failures.

### Likely files

- `packages/contracts/src/runs/**`
- `packages/agent-runtime/src/**`
- `apps/worker/src/runs/ecommerce-data-agent-executor.ts`
- `apps/worker/src/runs/run-worker-*`
- `packages/platform/src/persistence/**`
- Test Center async API/runtime files

### Gate

- At least one Hard case completes through real PostgreSQL, Worker, certified model and real Python Sandbox; at least four suite cases prove Python source execution.
- Cancel, lease expiry, retry, resume and duplicate effects converge without double SQL/model cost or duplicate artifacts.
- Events are replayable by sequence and contain no private reasoning, secret or sealed Oracle content.

## Phase 8. Deterministic Oracle and ScoreCard

### Tests first

- Add fixtures for ordered/unordered tables, nulls, numeric tolerances, chart specs, evidence references, missing artifacts and invalid cases.
- Add failure-classification and reflection-trigger matrix tests.

### Work

- Implement artifact-bundle Oracle and canonical comparators.
- Use rendered-image/model diagnostics only as non-authoritative evidence.
- Aggregate child Run results into existing-style First-pass/Post-reflection/Recovery/Regression ScoreCards.
- Implement the six-case LOCAL_HOLDOUT gate with at least five valid cases and 80% threshold.
- Persist formal results through PostgreSQL Test Center authority.

### Likely files

- `packages/evals/src/test-center/data-agent-artifact-oracle.ts`
- `packages/evals/src/test-center/ecommerce-production-runner.ts`
- `packages/evals/src/test-center/scorecard.ts`
- `apps/web/src/lib/test-center-runtime.ts`
- Oracle/scorecard tests

### Gate

- Oracle deterministically reproduces the same verdict/digest.
- Infrastructure, bad-case and Oracle failures are excluded from Agent capability denominator and do not trigger reflection.
- A real certified-model acceptance run must select a public E-commerce case, generate a candidate without sealed material, execute Candidate and Gold independently, persist the immutable Oracle receipt, and read the resulting ScoreCard back by batch run ID. Fixture/submitted answers and Gold replay are test aids only and cannot satisfy this gate.
- Holdout material is absent from optimization inputs and public DTOs.

## Phase 9. Interview Workspace UX

### Tests first

- Add component/integration tests for suite separation, filters, async terminal states, graph pagination, receipt/readiness display and sealed-field absence.
- Add Python-stage tests for syntax/policy/runtime/timeout/resource/cancel states, read-only source viewer, stdout/stderr truncation, declared Artifacts and Runtime Receipt with no secret or host-path leakage.
- Add accessibility states for loading, failure, partial batch, cancel and Neo4j fallback.

### Work

- Enhance data-source and physical-schema pages with Demo receipt/quality/size summaries.
- Enhance Semantic Explorer with E-commerce counters and bounded navigation.
- Add two Test Center cards, registry/difficulty filters, collapsible SQL/Python tool stages, read-only source viewer, capped stdout/stderr, Artifact viewer and ScoreCard.
- Add the three guided interview scenarios and Production Readiness panel.
- Preserve existing workspace routing and request headers; no global unscoped Demo route.

### Likely files

- `apps/web/src/app/w/[workspaceId]/data-sources/**`
- `apps/web/src/app/semantic/**`
- `apps/web/src/components/semantic/**`
- `apps/web/src/app/tests/page.tsx`
- `apps/web/src/app/api/workspaces/[workspaceId]/tests/**`
- Web unit/integration/browser tests

### Gate

- Browser proof completes: Workspace → 26 tables → semantic graph → Hard case → live stages → artifacts/evidence → ScoreCard/readiness.
- Another Workspace and forged workspace/schema requests cannot read the Run or score.
- UI never displays sealed material, credentials or private reasoning.

## Phase 10. Operations, Documentation and Full Verification

### Work

- Add Chinese runbook for source audit, offline install, receipt verification, bootstrap, semantic publish, single/batch runs, Holdout gate, diagnosis and allowlisted cleanup.
- Add bundle/import/benchmark smoke commands with structured JSON terminal results.
- Record measured clone/bundle/import/database/graph/run cost and latency evidence.
- Document the Python Sandbox threat model, image/dependency/SDK update process, local/deploy hardening, resource sizing, failure codes, security regression suite and emergency feature-off procedure.
- Run cross-layer review against all affected Trellis specs.

### Validation commands

```bash
pnpm benchmark:ecommerce:verify
pnpm exec tsx scripts/render-10636-migration.ts --verify
pnpm test:dev-runtime
pnpm dev:infra
pnpm dev:migrate
pnpm dev:check
pnpm test:sandbox
pnpm test:python-sandbox
./infra/supabase/test-support/run-postgres-smoke.sh
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/contracts test:contract
pnpm --filter @data-agent/evals test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/web test:unit
pnpm typecheck
pnpm exec biome ci <task-owned paths>
pnpm exec tsx scripts/run-workspace-gate.ts test:unit --concurrency=1
pnpm test:contract
pnpm test:integration
pnpm benchmark:smoke
```

If the migration number changes, substitute the final renderer command. Run root `pnpm lint` only after scoped checks; report unrelated pre-existing dirty-tree failures separately and do not repair them without authorization.

### Final release gate

- All 21 PRD acceptance criteria have evidence links or command output.
- Web, PostgreSQL, migration ledger, Worker, Python Sandbox and relationship-indexer health are reported separately.
- Official-compatible and Production suite claims remain clearly separated.
- Dataset, schema, semantic release, model profile, workflow, evaluator and score hashes are replayable.
- Rollback command has been tested against an allowlisted disposable environment.

## Rollback Points

| After phase | Safe rollback |
|---|---|
| 1 | Remove only task-owned generated bundle files; no runtime state exists |
| 2 | Disable importer; use allowlisted cleanup for two Demo schemas; preserve migration ledger/receipts |
| 3 | Disable Workspace datasource and revoke environment-backed SecretRef/login |
| 4 | Disable E-commerce semantic release/projection; PostgreSQL prior releases remain |
| 5 | Feature-off the two new suite IDs; existing suites remain |
| 6 | Remove Python tool from the server allowlist and stop its service; SQL paths remain |
| 7–8 | Stop new batch admission, cancel/finish active Runs, preserve events/artifacts/ScoreCards |
| 9 | Hide guided/readiness UI while API and evidence remain available |

No rollback step may drop the database, shared volume, shared schemas, unrelated roles or user-owned artifacts.

## Implementation Evidence — 2026-08-15

Completed and verified in the current working tree:

- Fixed, offline E-commerce bundle with 12 compressed chunks and immutable source/bundle digests.
- Migrations `10636` and `10637`: two Demo schemas, 12 raw tables, 14 mart tables, five views, read-only role, immutable dataset/workspace receipts and idempotent Workspace attachment.
- Curated semantic Draft: 32 metrics, 15 dimensions, eight relationships, 14 entities, 46 Chinese terms and five events. It is intentionally not auto-published.
- Production suite assets: 24 cases split DEMO/TUNING/HOLDOUT `8/10/6`, difficulty `6/10/8`, eight Python cases and six chart/report cases.
- Public-only Test Center preview loader with manifest/set/per-case digest checks and real PostgreSQL column schemas. `previewable=true`, `runnable=false` keeps the suite visible without bypassing HOLD.
- CPython 3.12 isolated execution service, strict IPC contracts, pinned data-analysis dependencies, fresh executor process, declared Artifact I/O and hardened container controls.
- Worker UDS client tests cover successful strict decoding, malformed/oversized protocol responses and unavailable socket behavior.
- Sandbox attestation verifier binds runtime source, CPython/SDK/Policy, dependency locks and the declared hardened image profile. Current runtime/image attestation digests are `sha256:fb87dca4ebb60441f626c11504270c1fce2e30dc3f9ab52f0443c81024766841` and `sha256:c71118b58f7778eaca279ab89805b8dbb58430472005e308ba89ecebf7836957`.
- Compose Sandbox is healthy with network `none`, read-only root, bounded memory/PIDs, no-new-privileges and only `KILL/SETGID/SETUID`; a non-root UDS client completed the real CPython smoke with all hard controls true.
- The Web OCI image contains only the Production manifest and public cases; `sealed/` is absent. Direct run requests for the preview-only suite fail with `TEST_CENTER_SUITE_NOT_READY` before persistence.
- Server-only E-commerce SQL acceptance now loads digest-bound Sealed Cases, executes Candidate and Gold independently through `data_agent_ecommerce_reader`, applies a fixed mart relation allowlist/read-only transaction/time and row budgets, and persists/read-backs the authoritative ScoreCard.
- A real certified DeepSeek model solved the four-table DEMO Case `ec100000-0000-4000-8000-000000000004` on PostgreSQL: batch `1171af04-16df-4b80-a83e-9ae30bb60294`, first-pass `PASS`, Candidate/Gold rows `4/4`, Oracle Receipt `sha256:981aaa6c86c9ee5b7e01acf788b20f7705bb8d450f4dc88643dd1927a7f9cbc8`, ScoreCard `sha256:8360d51e76fee286355483314e3b7b2eb93ab45c8ba138e72bf867cca1964a31`.
- Chinese operations guide: `docs/runbooks/agenticdatabench-ecommerce-demo.md`.

Remaining release gates:

- Human semantic review/publish and Neo4j projection receipt.
- Python cancel protocol plus full resource-exhaustion/container adversarial regression suite.
- Server-owned Worker Python tool and durable E-commerce Agent workflow.
- Hard SQL+Python Artifact Oracle, durable Worker integration and end-to-end certified hard-case/browser evidence. The SQL-only acceptance seam is evidence, not a READY bypass.

The task remains `in_progress`; neither suite nor semantic release may be promoted to READY based on asset presence alone.
