# Semantic V2 与 Billing 退役 Surface Ledger

本清单是重构的机器可检查边界，不是兼容路线图。`Action` 只能取
`KEEP_CURRENT`、`MOVE_DIRECT`、`DELETE`、`ARCHIVE_DATA`；不存在双写、别名、redirect、410 或延迟退役。
`Status` 描述当前工作树，后续原子单元完成时必须将已删除项改成 `REMOVED` 并把消费者改成 `none`。

当前迁移 frontier 是 `20260725010703`。Billing 数据库退役已由 `10703` 完成，Semantic V2-only 迁移使用 `10704`。

| Surface | Kind | Current consumers | Action | Atomic switch unit | Final target | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ./billing/billing-gated-model-provider.js | EXPORT | none | DELETE | U3 monetary gates | direct ModelProvider invocation | packages/platform/src/index.ts; tests/model-runtime-noncommercial.spec.ts | REMOVED |
| ./billing/billing-gated-provider.js | EXPORT | none | DELETE | U3 monetary gates | direct provider invocation | packages/platform/src/index.ts; tests/model-runtime-noncommercial.spec.ts | REMOVED |
| ./billing/microcredits.js | EXPORT | none | DELETE | U4 billing code retirement | none | tests/billing-code-retirement.spec.ts | REMOVED |
| ./billing/model-cost.js | EXPORT | none | DELETE | U4 billing code retirement | noncommercial usage facts | tests/billing-code-retirement.spec.ts | REMOVED |
| ./billing/postgres-credit-ledger.js | EXPORT | none | DELETE | U4 billing code retirement | 404 | tests/billing-code-retirement.spec.ts | REMOVED |
| ./billing/postgres-model-billing.js | EXPORT | none | DELETE | U4 billing code retirement | noncommercial invocation facts | tests/billing-code-retirement.spec.ts | REMOVED |
| ./models/postgres-model-control.js | EXPORT | Model Provider, Q&A resource resolution and bootstrap | KEEP_CURRENT | U2 Model Control extraction | unchanged | packages/platform/src/index.ts; packages/platform/test/models/postgres-model-control.spec.ts | CURRENT |
| ./pricing/postgres-pricing-control.js | EXPORT | none | DELETE | U4 billing code retirement | none | tests/billing-code-retirement.spec.ts | REMOVED |
| packages/contracts/src/models/index.ts | EXPORT | Model Provider, Q&A resource and bootstrap contracts | KEEP_CURRENT | U2 Model Control extraction | unchanged | packages/contracts/src/index.ts; packages/contracts/test/model-control.spec.ts | CURRENT |
| ./billing.js | EXPORT | none | DELETE | U4 billing code retirement | none | tests/billing-code-retirement.spec.ts | REMOVED |
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
| Model Provider admin surface | MODEL_CONTROL | Super Admin and runtime provider selection | KEEP_CURRENT | U2 Model Control extraction | unchanged | apps/web/src/app/api/admin/model-providers; apps/web/test/model-provider-routes.spec.ts | CURRENT |
| Billing and Credit API surface | ROUTE | none | DELETE | U4 billing code retirement | 404 | tests/billing-code-retirement.spec.ts | REMOVED |
| Billing and Pricing UI surface | UI | none | DELETE | U4 billing code retirement | removed navigation | tests/billing-code-retirement.spec.ts | REMOVED |
| Worker pricing sync | WORKER | none | DELETE | U4 billing code retirement | none | tests/billing-code-retirement.spec.ts | REMOVED |
| Monetary provider admission and UNBILLABLE | RUNTIME_GATE | none | DELETE | U3 monetary gates | availability and capability only | tests/model-runtime-noncommercial.spec.ts | REMOVED |
| Billing ledger and settlement tables | DATABASE | none | ARCHIVE_DATA | U5 migration 10703 | PostgreSQL read-only historical data | infra/supabase/apps/data-agent/migrations/20260725010703_app_data_agent_commercial_archive_retirement.sql; infra/supabase/test-support/19y-commercial-archive-retirement-assertions.sql | ARCHIVED |
| Pricing tables coupled to Model Control | DATABASE | none | MOVE_DIRECT | U5 migration 10703 | independent model-control tables; pricing history archived | infra/supabase/apps/data-agent/migrations/20260725010703_app_data_agent_commercial_archive_retirement.sql; infra/supabase/test-support/19y-commercial-archive-retirement-assertions.sql | REMOVED |
| Semantic V1 database objects and rows | DATABASE | legacy equivalence, mirror and closure flow | DELETE | U6 migration 10704 | clean V2 authority | infra/supabase/apps/data-agent/migrations/20260725010610_app_data_agent_semantic_control_plane.sql | CURRENT |
| Relationship Index PostgreSQL fallback | RELIABILITY | Semantic Explorer and Semantic Agent reads | KEEP_CURRENT | U7 composition cleanup | unchanged | POSTGRESQL authority; INDEX_DISABLED reason; source and truncation observable; apps/web/test/semantic-explorer-route.spec.ts | CURRENT |
| Neo4j Relationship Index projection | RELIABILITY | relationship indexer and graph search | KEEP_CURRENT | U7 composition cleanup | unchanged | PostgreSQL remains authority; adapter failure is observable; packages/platform/test/semantic/relationship-graph-adapter.spec.ts | CURRENT |
| Server-configured direct Model Provider gateway | RELIABILITY | Web and Worker model calls | KEEP_CURRENT | U2 control extraction | unchanged | server credential authority; command failures observable; apps/web/test/model-provider-routes.spec.ts | CURRENT |

## Grandfathered migration exceptions

- Duplicate 14-digit sequences `10673` through `10679` are frozen as exact stem pairs in `scripts/lib/workspace-migration-inventory.ts`; no new duplicate is permitted.
- Twenty-one historical migrations without a checksum header are frozen by exact stem. They still contain one matching `platform.assert_migration_checksum` declaration; every new migration requires a verifiable header.
- Three historical migrations whose ledger argument still contains the old zero placeholder are frozen by exact stem. Every other checksummed migration, including all new migrations, must match header, ledger declaration and normalized file digest.
- Historical migration files are immutable. Corrections are forward-only from `10703`.
