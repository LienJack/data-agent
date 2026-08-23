# Semantic V2 与 Billing 退役 Surface Ledger

本清单是重构的机器可检查边界，不是兼容路线图。`Action` 只能取
`KEEP_CURRENT`、`MOVE_DIRECT`、`DELETE`、`ARCHIVE_DATA`；不存在双写、别名、redirect、410 或延迟退役。
`Status` 描述当前工作树，后续原子单元完成时必须将已删除项改成 `REMOVED` 并把消费者改成 `none`。

当前迁移 frontier 是 `20260725010702`。原计划占用的 `10700/10701` 已存在，因此本次 Billing 数据库退役与 Semantic V2-only 迁移分别使用 `10703/10704`。

| Surface | Kind | Current consumers | Action | Atomic switch unit | Final target | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ./billing/billing-gated-model-provider.js | EXPORT | Worker audited model provider | DELETE | U3 monetary gates | direct ModelProvider invocation | packages/platform/src/index.ts | CURRENT |
| ./billing/billing-gated-provider.js | EXPORT | Platform billing tests | DELETE | U3 monetary gates | direct provider invocation | packages/platform/src/index.ts | CURRENT |
| ./billing/microcredits.js | EXPORT | billing and pricing repositories | DELETE | U4 billing code retirement | none | packages/platform/src/index.ts | CURRENT |
| ./billing/model-cost.js | EXPORT | model billing repository | DELETE | U4 billing code retirement | noncommercial usage facts | packages/platform/src/index.ts | CURRENT |
| ./billing/postgres-credit-ledger.js | EXPORT | credit admin routes | DELETE | U4 billing code retirement | 404 | packages/platform/src/index.ts | CURRENT |
| ./billing/postgres-model-billing.js | EXPORT | billing admin and worker | DELETE | U4 billing code retirement | noncommercial invocation facts | packages/platform/src/index.ts | CURRENT |
| ./pricing/postgres-pricing-control.js | EXPORT | Model Control and pricing sync | MOVE_DIRECT | U2 Model Control extraction | packages/platform/src/model-control | packages/platform/src/index.ts | CURRENT |
| ./billing.js | EXPORT | Workspace identity, admin and QA resource contracts | MOVE_DIRECT | U2 then U4 contract split | workspaces/model-control.ts | packages/contracts/src/workspaces/index.ts | CURRENT |
| packages/contracts/src/artifacts/semantic-control-plane.ts | SEMANTIC_V1 | governance runtime, Platform stores and SQL RPCs | DELETE | U6 Semantic V2-only | graph-v2 contracts | packages/contracts/src/artifacts/semantic-control-plane.ts | CURRENT |
| packages/semantic/src/compiler/u5-compiler.ts | SEMANTIC_V1 | Graph V2 compatibility projection and candidate compile | DELETE | U6 native V2 compiler | graph-v2/compiler.ts | packages/semantic/src/compiler/u5-compiler.ts | CURRENT |
| apps/web/src/lib/semantic-authoring-public.ts | APP_SCHEMA_COPY | Semantic Studio SSE client and routes | MOVE_DIRECT | U7 application runtime | contracts semantic authoring public schema | apps/web/src/lib/semantic-authoring-public.ts | CURRENT |
| apps/web/src/lib/semantic-store.ts | GLOBAL_STATE | Workspace Semantic page | DELETE | U8 Semantic UI cleanup | page-owned controller reducer | apps/web/src/lib/semantic-store.ts | CURRENT |
| apps/web/src/lib/data-link-store.ts | GLOBAL_STATE | retired Data Link components | DELETE | U8 Semantic UI cleanup | none | apps/web/src/lib/data-link-store.ts | CURRENT |
| /semantic and /data-link | ROUTE | unscoped legacy browser URLs | DELETE | U8 legacy route deletion | 404 | apps/web/next.config.mjs | CURRENT |
| /w/[workspaceId]/data-link/** | ROUTE | old workspace bookmarks | DELETE | U8 legacy route deletion | 404 | apps/web/src/app/w/[workspaceId]/data-link | CURRENT |
| /w/[workspaceId]/semantic | ROUTE | Workspace Semantic users | KEEP_CURRENT | U8 controller split | unchanged | apps/web/src/app/w/[workspaceId]/semantic/page.tsx | CURRENT |
| /api/semantic/** | ROUTE | unscoped Semantic Explorer and governance clients | MOVE_DIRECT | U7 application runtime | workspace-scoped semantic API | apps/web/src/app/api/semantic | CURRENT |
| /api/workspaces/[workspaceId]/semantic/** | ROUTE | Workspace Semantic Studio and jobs | KEEP_CURRENT | U7 application runtime | unchanged | apps/web/src/app/api/workspaces/[workspaceId]/semantic | CURRENT |
| apps/web/src/lib/workspace-semantic-runtime.ts | RUNTIME | schema discovery and semantic services | MOVE_DIRECT | U7 application runtime | explicit composition root | apps/web/src/lib/workspace-semantic-runtime.ts | CURRENT |
| apps/web/src/lib/semantic-*-runtime.ts | RUNTIME | Semantic API route handlers | MOVE_DIRECT | U7 application runtime | semantic application services | apps/web/src/lib | CURRENT |
| Model Provider admin surface | MODEL_CONTROL | Super Admin and runtime provider selection | MOVE_DIRECT | U2 Model Control extraction | /api/admin/model-providers and /api/admin/models | apps/web/src/app/api/admin/model-providers | CURRENT |
| Billing and Credit API surface | ROUTE | settings, admin pricing and billing clients | DELETE | U4 billing code retirement | 404 | apps/web/src/app/api/admin/billing | CURRENT |
| Billing and Pricing UI surface | UI | settings, workspace home and admin | DELETE | U4 billing code retirement | removed navigation | apps/web/src/components/settings/model-billing-panel.tsx | CURRENT |
| Worker pricing sync | WORKER | pricing synchronization cycle | DELETE | U4 billing code retirement | none | apps/worker/src/pricing | CURRENT |
| Monetary provider admission and UNBILLABLE | RUNTIME_GATE | Worker model invocation | DELETE | U3 monetary gates | availability and capability only | apps/worker/src/providers/audited-model-provider.ts | CURRENT |
| Billing ledger and settlement tables | DATABASE | historical billing facts and mutation RPCs | ARCHIVE_DATA | U5 migration 10703 | PostgreSQL read-only historical data | infra/supabase/apps/data-agent/migrations/20260725010630_app_data_agent_credit_ledger.sql | HISTORICAL |
| Pricing tables mixed with model catalog | DATABASE | Model Provider control and pricing sync | MOVE_DIRECT | U5 migration 10703 | model-control tables only | infra/supabase/apps/data-agent/migrations/20260725010629_app_data_agent_model_price_fx_control.sql | CURRENT |
| Semantic V1 database objects and rows | DATABASE | legacy equivalence, mirror and closure flow | DELETE | U6 migration 10704 | clean V2 authority | infra/supabase/apps/data-agent/migrations/20260725010610_app_data_agent_semantic_control_plane.sql | CURRENT |
| Relationship Index PostgreSQL fallback | RELIABILITY | Semantic Explorer and Semantic Agent reads | KEEP_CURRENT | U7 composition cleanup | unchanged | POSTGRESQL authority; INDEX_DISABLED reason; source and truncation observable; apps/web/test/semantic-explorer-route.spec.ts | CURRENT |
| Neo4j Relationship Index projection | RELIABILITY | relationship indexer and graph search | KEEP_CURRENT | U7 composition cleanup | unchanged | PostgreSQL remains authority; adapter failure is observable; packages/platform/test/semantic/relationship-graph-adapter.spec.ts | CURRENT |
| Server-configured direct Model Provider gateway | RELIABILITY | Web and Worker model calls | KEEP_CURRENT | U2 control extraction | unchanged | server credential authority; command failures observable; apps/web/test/model-provider-routes.spec.ts | CURRENT |

## Grandfathered migration exceptions

- Duplicate 14-digit sequences `10673` through `10679` are frozen as exact stem pairs in `scripts/lib/workspace-migration-inventory.ts`; no new duplicate is permitted.
- Twenty-one historical migrations without a checksum header are frozen by exact stem. They still contain one matching `platform.assert_migration_checksum` declaration; every new migration requires a verifiable header.
- Three historical migrations whose ledger argument still contains the old zero placeholder are frozen by exact stem. Every other checksummed migration, including all new migrations, must match header, ledger declaration and normalized file digest.
- Historical migration files are immutable. Corrections are forward-only from `10703`.
