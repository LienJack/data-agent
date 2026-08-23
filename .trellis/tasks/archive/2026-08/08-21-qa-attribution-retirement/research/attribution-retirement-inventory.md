# Attribution Retirement Read-Only Inventory

Date: 2026-08-22

本 inventory 仅来自源码与 migration 的只读检索；没有执行 DELETE、purge、migration 或历史数据更新。

## Product-Only Entry And Reachable Runtime

| Surface | Current owner | Retirement action |
| --- | --- | --- |
| Workspace navigation `analysis` item | `apps/web/src/lib/workspace-navigation.ts` | remove |
| Sidebar/Mobile/Home/Topbar labels and icon | `apps/web/src/components/**`, `apps/web/src/i18n/messages.ts` | remove |
| `/w/:workspaceId/analysis` | workspace page re-exporting root Workbench | authorization-first redirect to `/qa` |
| root Workbench page | `apps/web/src/app/page.tsx` | server redirect to `/workspaces` |
| SHADOW legacy executor for ATTRIBUTION | `packages/platform/src/runs/agent-dispatch-planner.ts` | stable deferred before rollout branch |

## Shared And Protected Assets — Retain

- `packages/evals/src/test-center/analysis-agent.ts`, `model-analysis-agent.ts` and
  `insightbench-runner.ts`: generic/controlled evaluation adapters, not the retired product page.
- Attribution/F9 contracts, feasibility/governance tests and published evidence: release/audit assets.
- Generic Run, Run Event, Artifact, usage/billing, identity, authorization and security audit rows/contracts.
- Workspace Q&A conversation/message/directory data and Artifact preview/export authorities.
- Historical migration files and migration ledger checksums, including 10619–10622.

## Attribution Authority — Later Exact Cleanup Candidate Only

The 10620/10621 migrations introduced these Attribution-specific authority tables:

- 10620: `attribution_owner_map_release`, `attribution_relationship_promotion_receipt`,
  `attribution_conclusion_policy`, `attribution_signer_assignment`,
  `attribution_verification_key_revision`, `attribution_active_pointer`, `attribution_nonce_ledger`;
- 10621: `attribution_capability_directory`, `attribution_eligibility_decision`,
  `attribution_profile_request`, `attribution_safety_verdict`, `attribution_profile_projection`.

Their rows are candidates for a separately approved operational cleanup only after exact primary-key,
foreign-key, hold and reference inventory plus PITR/backup proof. Table definitions, migration ledger rows,
checksums, functions and contracts are not cleanup targets. This task does not modify these migrations or rows.

## Ambiguous Generic Data — Do Not Delete

Legacy `/analysis` and Q&A use generic Run/Event/Artifact infrastructure. The current durable generic records do not expose
a complete, authoritative `origin=LEGACY_ATTRIBUTION_PRODUCT` discriminator. URL, question text, Artifact type, profile name,
or timestamps are heuristics and cannot authorize deletion. Therefore generic Run/Artifact/usage/audit rows remain protected.

## Cleanup Gate

Later cleanup stays HOLD until an explicit operational command binds and transactionally revalidates:

1. environment/deployment and separate approval;
2. immutable inventory digest;
3. PITR/backup readiness or explicit irrecoverability acceptance;
4. exact table and primary-key set, references and legal/operational holds;
5. before counts, deleted counts, after counts and shared-object survival checks;
6. public cleanup receipt.

Standard migration runners must not contain the destructive DELETE.
