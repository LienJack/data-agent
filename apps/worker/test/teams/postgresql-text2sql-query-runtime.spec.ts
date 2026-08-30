import {
  buildSemanticQueryContext,
  type Text2SqlQueryCandidate,
  type WorkspaceDatasource,
} from "@data-agent/contracts";
import { createPhysicalSchemaSnapshot } from "@data-agent/platform/catalog";
import { describe, expect, it, vi } from "vitest";
import {
  createPostgresqlText2SqlQueryRuntime,
  postgresqlText2SqlQueryRuntimeInternals,
} from "../../src/teams/postgresql-text2sql-query-runtime.js";
import { buildWorkerEffectiveConfigFixture } from "../runs/support/effective-config-fixture.js";

const id = (suffix: number) => `94000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

function column(name: string, ordinal: number, type = "text") {
  return {
    column_name: name,
    ordinal_position: ordinal,
    formatted_type: type,
    type_identity: {
      type_schema: "pg_catalog",
      type_name: type === "integer" ? "int4" : "text",
      type_kind: "BASE" as const,
      array_dimensions: 0,
    },
    nullable: false,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

async function fixture() {
  const baseConfig = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: id(3),
    run_id: id(4),
  });
  const snapshot = await createPhysicalSchemaSnapshot({
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: baseConfig.schema_snapshot.resource_id,
    scan_run_id: id(5),
    captured_at: "2026-08-25T00:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: baseConfig.datasource.resource_id,
      datasource_fingerprint: hash("a"),
      engine: "postgresql",
      engine_version: { major: 17, minor: 0 },
      database_identity: { database_name: "falcon", database_oid: 24 },
      included_schemas: ["falcon_db_24"],
      relations: [
        {
          identity: { schema_name: "falcon_db_24", relation_name: "orders" },
          relation_kind: "TABLE",
          comment: "Orders",
          columns: [
            column("customer_id", 1),
            column("amount", 2, "integer"),
            column("created_at", 3),
          ],
          primary_key: null,
          foreign_keys: [],
          unique_constraints: [],
          check_constraints: [],
          indexes: [],
        },
      ],
    },
  });
  const datasource: WorkspaceDatasource = {
    schema_version: "workspace-datasource@1.0.0",
    workspace_id: scope.tenant_id,
    datasource_id: baseConfig.datasource.resource_id,
    resource_version: baseConfig.datasource.resource_revision,
    name: "Falcon 24",
    type: "postgresql",
    host: "managed-postgres",
    port: 5432,
    database: "falcon",
    username: "falcon_demo_reader",
    credential_ref: {
      schema_version: "datasource-credential-ref@1.0.0",
      ...scope,
      credential_ref_id: id(6),
      secret_ref_id: id(7),
      secret_version: 1,
      rotation_state: "ACTIVE",
    },
    ssl: "disable",
    path: null,
    catalog: null,
    schema: "falcon_db_24",
    status: "ACTIVE",
    last_tested_at: "2026-08-25T00:00:00.000Z",
    created_by_principal_id: id(3),
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  };
  const config = {
    ...baseConfig,
    datasource: {
      ...baseConfig.datasource,
      resource_hash: await postgresqlText2SqlQueryRuntimeInternals.datasourceHash(datasource),
    },
    schema_snapshot: {
      ...baseConfig.schema_snapshot,
      resource_hash: snapshot.snapshot_content_hash,
    },
  };
  const semanticContextPackage = {
    package_id: id(8),
    package_hash: hash("b"),
    scope,
    semantic_domain: "falcon24",
    schema_snapshot: config.schema_snapshot,
    semantic_release: config.semantic_release,
    retrieval_receipt: {
      selected_object_ids: ["dimension.customer-id", "metric.order-count"],
      receipt_hash: hash("c"),
    },
    inference_receipt: {
      mandatory_object_ids: [],
      mandatory_relationship_ids: [],
      receipt_hash: hash("d"),
    },
    route_decision: {
      state: "READY",
      route: "METRIC",
      selected_metric_id: "metric.order-count",
      selected_ontology_ids: ["dimension.customer-id"],
    },
    mandatory_closure: {
      object_ids: ["dimension.customer-id", "metric.order-count"],
      relationship_ids: [],
    },
    evidence: [],
  } as never;
  const selectedMetric = {
    metric_id: "metric.order-count",
    name: "Order count",
    aliases: ["orders"],
    table_id: "orders",
    column_id: "orders.amount",
    aggregation: "count" as const,
    formula: {
      formula_id: "formula.order-count",
      expression: "COUNT(orders.amount)",
      dialect: "text2sql" as const,
    },
    grain: { grain_id: "grain.order", granularity: "atomic" as const },
    unit: null,
    time_domain: null,
    time_column_id: null,
    additivity: "additive" as const,
    null_policy: "preserve" as const,
    fanout_policy: "reject" as const,
    dependency_column_ids: ["orders.amount"],
    tags: [],
    analysis: {
      primary: true,
      priority: 1,
      missing_period_policy: "NULL" as const,
      seasonality: null,
      allowed_dimension_ids: ["dimension.customer-id"],
      capabilities: ["DATA_PROFILE" as const],
      causal_role: "OUTCOME" as const,
    },
  };
  const selectedFormula = {
    node_id: "formula.order-count",
    node_version: 1,
    node_type: "FORMULA" as const,
    name: "Order count formula",
    aliases: [],
    owner_ref: "semantic.owner",
    lifecycle: "ACTIVE" as const,
    evidence_refs: [],
    tags: [],
    formula_type: "non_additive_aggregate" as const,
    return_type: "numeric" as const,
    language: "semantic-ast" as const,
    language_version: "semantic-formula-ast@1" as const,
    expression: {
      kind: "AGGREGATE" as const,
      function: "COUNT" as const,
      input: { kind: "SLOT" as const, slot_id: "orders.amount" },
      distinct: false,
      filter: null,
    },
  };
  const selectedBinding = {
    logical_object_id: "metric.order-count",
    logical_object_type: "metric" as const,
    datasource_id: config.datasource.resource_id,
    schema_name: "falcon_db_24",
    table_name: "orders",
    column_name: "amount",
    binding_lifecycle: "active" as const,
    valid_from: null,
    valid_until: null,
  };
  const semanticCatalog = {
    release_identity: {
      semantic_domain: "falcon24",
      release_id: config.semantic_release.resource_id,
      release_digest: config.semantic_release.resource_hash,
      release_generation: config.semantic_release.semantic_generation,
      datasource_id: config.datasource.resource_id,
    },
    executable: {
      metrics: [
        selectedMetric,
        {
          metric_id: "metric.hidden",
          table_id: "orders",
          dependency_column_ids: ["orders.secret"],
          formula: null,
        },
      ],
      dimensions: [
        {
          dimension_id: "dimension.customer-id",
          table_id: "orders",
          column_id: "customer_id",
        },
        {
          dimension_id: "dimension.hidden",
          table_id: "orders",
          column_id: "secret",
        },
      ],
      formulas: [selectedFormula, { node_id: "formula.hidden" }],
      physical_bindings: [
        selectedBinding,
        { logical_object_id: "column.orders.amount" },
        { logical_object_id: "column.orders.customer_id" },
        { logical_object_id: "column.orders.secret" },
      ],
    },
    relationships: { schema_version: "semantic-relationship-projection@1.0.0", relationships: [] },
    restrictions: {
      schema_version: "semantic-runtime-restriction-projection@1.0.0",
      quality_constraints: [],
      time_semantics: [],
    },
  } as never;
  const semanticContext = {
    package: semanticContextPackage,
    receipt: { receipt_id: id(9), receipt_hash: hash("e") },
  } as never;
  const semanticQueryContext = await buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    scope,
    run_id: config.run_id,
    semantic_domain: "falcon24",
    semantic_release: config.semantic_release,
    schema_snapshot: config.schema_snapshot,
    datasource: config.datasource,
    semantic_context_ref: {
      package_id: id(8),
      package_hash: hash("b"),
      receipt_id: id(9),
      receipt_hash: hash("e"),
      retrieval_receipt_hash: hash("c"),
      inference_receipt_hash: hash("d"),
    },
    requested_object_ids: ["metric.order-count"],
    metrics: [selectedMetric],
    dimensions: [],
    formulas: [selectedFormula],
    relationships: [],
    physical_bindings: [selectedBinding],
    time_semantics: [],
    quality_constraints: [],
    unresolved_ambiguities: [],
  });
  return {
    config,
    datasource,
    semanticCatalog,
    semanticContext,
    semanticContextPackage,
    semanticQueryContext,
    snapshot,
  };
}

const candidate = (sql: string): Text2SqlQueryCandidate => ({
  schema_version: "text2sql-query-candidate@1.0.0",
  sql,
  parameters: [],
  result_columns: [
    {
      name: "customer_id",
      semantic_type: "STRING",
      label: "客户",
      semantic_binding: { object_kind: "DIMENSION", object_id: "customer-id" },
    },
    {
      name: "order_count",
      semantic_type: "NUMBER",
      label: "订单数",
      semantic_binding: { object_kind: "METRIC", object_id: "order-count" },
    },
  ],
  time_window: null,
  presentation: {
    title: "客户订单数",
    summary: "按客户聚合订单。",
    visualization: "TABLE",
    x_key: null,
    y_keys: [],
  },
});

describe("PostgreSQL Text2SQL query runtime", () => {
  it("projects PostgreSQL SQLSTATE into bounded repair diagnostics", () => {
    expect(
      postgresqlText2SqlQueryRuntimeInternals.classifiedPostgresqlExecutionError({
        code: "42601",
        message: "private provider detail",
      }),
    ).toMatchObject({ code: "DATASOURCE_ADAPTER_SQL_REJECTED" });
    expect(
      postgresqlText2SqlQueryRuntimeInternals.classifiedPostgresqlExecutionError({
        code: "42883",
        message: "private provider detail",
      }),
    ).toMatchObject({ code: "DATASOURCE_ADAPTER_SQL_TYPE_ERROR" });
    expect(
      postgresqlText2SqlQueryRuntimeInternals.classifiedPostgresqlExecutionError({ code: "42803" }),
    ).toMatchObject({ code: "DATASOURCE_ADAPTER_SQL_GROUPING_ERROR" });
    expect(
      postgresqlText2SqlQueryRuntimeInternals.classifiedPostgresqlExecutionError({ code: "42703" }),
    ).toMatchObject({ code: "DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND" });
    expect(
      postgresqlText2SqlQueryRuntimeInternals.classifiedPostgresqlExecutionError({ code: "42501" }),
    ).toBeNull();
  });

  it.each(["exact", "eleven-months", "beyond-frontier", "omitted"] as const)(
    "enforces the Host-resolved request window before query I/O: %s",
    async (variant) => {
      const connect = vi.fn();
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect } as never,
        capability: {},
        schema_snapshots: {} as never,
        datasources: {} as never,
        secrets: {} as never,
      });
      const requested = {
        dimension_id: "dimension.order_month",
        start: "2023-11-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        semantics: "HALF_OPEN" as const,
        timezone: "Asia/Shanghai",
        period_count: 12,
        period_unit: "MONTH" as const,
      };
      const prepared = {
        context_text: "{}",
        datasource_id: id(30),
        schema_snapshot_id: id(31),
        schema_snapshot_hash: hash("d"),
        allowed_relations: ["falcon_db_24.orders"],
        target_capability_hash: hash("e"),
        reader_role: "falcon_demo_reader",
        semantic_query_context_hash: null,
        requested_time_window: requested,
      };
      const query = {
        ...candidate(
          "select count(o.amount) as order_count from falcon_db_24.orders as o where o.created_at >= $1::timestamp and o.created_at < $2::timestamp",
        ),
        parameters: [
          variant === "eleven-months" ? "2023-12-01" : "2023-11-01",
          variant === "beyond-frontier" ? "2024-12-01" : "2024-11-01",
        ],
        time_window:
          variant === "omitted"
            ? null
            : {
                dimension_id: "dimension.order_month",
                start_parameter: 1,
                end_parameter: 2,
                semantics: "HALF_OPEN" as const,
              },
      };
      const result = runtime.compileCandidate({ prepared, candidate: query });
      if (variant === "exact") await expect(result).resolves.toBeDefined();
      else
        await expect(result).rejects.toMatchObject({
          code: "TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH",
        });
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it.each(["clipped", "outside-coverage"] as const)(
    "checks published comparison source coverage before query I/O: %s",
    async (variant) => {
      const connect = vi.fn();
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect } as never,
        capability: {},
        schema_snapshots: {} as never,
        datasources: {} as never,
        secrets: {} as never,
      });
      const prepared = {
        context_text: "{}",
        datasource_id: id(30),
        schema_snapshot_id: id(31),
        schema_snapshot_hash: hash("d"),
        allowed_relations: ["falcon_db_24.orders"],
        target_capability_hash: hash("e"),
        reader_role: "falcon_demo_reader",
        semantic_query_context_hash: null,
        published_time_coverage: [
          {
            schema_name: "falcon_db_24",
            relation_name: "orders",
            column_name: "created_at",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-01T00:00:00.000Z",
          },
        ],
      };
      const result = runtime.compileCandidate({
        prepared,
        candidate: {
          ...candidate(
            "select o.customer_id as customer_id, count(o.amount) as order_count from falcon_db_24.orders as o where o.created_at::timestamp >= $1::timestamp and o.created_at::timestamp < $2::timestamp group by o.customer_id",
          ),
          parameters: [variant === "clipped" ? "2023-05-01" : "2023-03-01", "2023-11-01"],
        },
      });
      if (variant === "clipped") await expect(result).resolves.toBeDefined();
      else
        await expect(result).rejects.toMatchObject({
          diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED",
        });
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it("compiles model literals into parameters before committing a candidate", async () => {
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: {} as never,
      capability: {},
      schema_snapshots: {} as never,
      datasources: {} as never,
      secrets: {} as never,
    });
    const prepared = {
      context_text: "{}",
      datasource_id: id(30),
      schema_snapshot_id: id(31),
      schema_snapshot_hash: hash("d"),
      allowed_relations: ["falcon_db_24.orders"],
      target_capability_hash: hash("e"),
      reader_role: "falcon_demo_reader",
      semantic_query_context_hash: null,
    };
    const compiled = await runtime.compileCandidate({
      prepared,
      candidate: {
        ...candidate(
          "select o.customer_id as customer_id, round(sum(o.amount), 2) as order_count from falcon_db_24.orders as o group by o.customer_id",
        ),
      },
    });

    expect(compiled.parameters).toEqual([2]);
    expect(compiled.sql).toContain("$1");
  });

  it("freezes exact datasource, SecretRef, schema and semantic bindings before I/O", async () => {
    const { config, datasource, semanticCatalog, semanticContext, snapshot } = await fixture();
    const connect = vi.fn();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
      capability: {},
      schema_snapshots: {
        getSnapshot: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      },
      datasources: {
        getDatasource: vi.fn(async () => ({ ok: true as const, value: datasource })),
      },
      secrets: {
        get: vi.fn(async () => ({
          ok: true as const,
          value: {
            ref: `secretref:${id(7)}` as const,
            name: "falcon-reader",
            version: 1,
            status: "ACTIVE" as const,
          },
        })),
      },
    });

    const prepared = await runtime.prepare({
      effective_config: config as never,
      semantic_context: semanticContext,
      semantic_catalog: semanticCatalog,
      max_context_bytes: 32_000,
    });

    expect(prepared.allowed_relations).toEqual(["falcon_db_24.orders"]);
    expect(JSON.parse(prepared.context_text)).toMatchObject({
      schema_snapshot: { snapshot_id: snapshot.snapshot_id },
      semantic_context: {
        package_id: id(8),
        executable: {
          metrics: [{ metric_id: "metric.order-count" }],
          dimensions: [{ dimension_id: "dimension.customer-id" }],
          formulas: [{ node_id: "formula.order-count" }],
          physical_bindings: [
            { logical_object_id: "metric.order-count" },
            { logical_object_id: "column.orders.amount" },
            { logical_object_id: "column.orders.customer_id" },
          ],
        },
      },
    });
    expect(prepared.context_text).not.toContain("metric.hidden");
    expect(prepared.context_text).not.toContain("dimension.hidden");
    expect(prepared.context_text).not.toContain("managed-postgres");
    expect(prepared.context_text).not.toContain("secretref:");
    expect(connect).not.toHaveBeenCalled();
  });

  it("narrows compiler and firewall context to an accepted SemanticQueryContext", async () => {
    const { config, datasource, semanticCatalog, semanticContext, semanticQueryContext, snapshot } =
      await fixture();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect: vi.fn() } as never,
      capability: {},
      schema_snapshots: {
        getSnapshot: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      },
      datasources: {
        getDatasource: vi.fn(async () => ({ ok: true as const, value: datasource })),
      },
      secrets: {
        get: vi.fn(async () => ({
          ok: true as const,
          value: {
            ref: `secretref:${id(7)}` as const,
            name: "falcon-reader",
            version: 1,
            status: "ACTIVE" as const,
          },
        })),
      },
    });

    const prepared = await runtime.prepare({
      effective_config: config as never,
      semantic_context: semanticContext,
      semantic_catalog: semanticCatalog,
      semantic_query_context: semanticQueryContext,
      max_context_bytes: 32_000,
    });

    const projected = JSON.parse(prepared.context_text) as {
      semantic_context: { executable: { metrics: unknown[]; dimensions: unknown[] } };
    };
    expect(prepared.semantic_query_context_hash).toBe(semanticQueryContext.context_hash);
    expect(prepared.allowed_relations).toEqual(["falcon_db_24.orders"]);
    expect(projected.semantic_context.executable.metrics).toEqual([
      expect.objectContaining({ metric_id: "metric.order-count" }),
    ]);
    expect(projected.semantic_context.executable.dimensions).toEqual([]);
    expect(prepared.context_text).not.toContain("metric.hidden");

    const narrowedCandidate = {
      ...candidate("select count(o.amount) as order_count from falcon_db_24.orders as o"),
      result_columns: [
        {
          name: "order_count",
          semantic_type: "NUMBER" as const,
          label: "订单数",
          semantic_binding: {
            object_kind: "METRIC" as const,
            object_id: "metric.order-count",
          },
        },
      ],
    };
    await expect(
      runtime.compileCandidate({ prepared, candidate: narrowedCandidate }),
    ).resolves.toMatchObject({
      result_columns: [
        { semantic_binding: { object_kind: "METRIC", object_id: "metric.order-count" } },
      ],
    });
    await expect(
      runtime.compileCandidate({
        prepared,
        candidate: {
          ...narrowedCandidate,
          result_columns: [
            {
              name: "order_count",
              semantic_type: "NUMBER",
              label: "订单数",
              semantic_binding: { object_kind: "METRIC", object_id: "metric.hidden" },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE" });
  });

  it.each(["exact", "missing-binding", "missing-physical-column"] as const)(
    "binds published time coverage to a retrieved metric: %s",
    async (variant) => {
      const {
        config,
        datasource,
        semanticCatalog,
        semanticContext,
        semanticQueryContext,
        snapshot,
      } = await fixture();
      const catalog = semanticCatalog as unknown as {
        readonly executable: {
          readonly metrics: readonly Readonly<Record<string, unknown>>[];
          readonly physical_bindings: readonly Readonly<Record<string, unknown>>[];
        };
        readonly restrictions: Readonly<Record<string, unknown>>;
      };
      const timeDomain = {
        time_domain_id: "time.order-month",
        calendar: "gregorian" as const,
        timezone: "Asia/Shanghai",
        min_time: "2023-01-01T00:00:00.000Z",
        max_time: "2024-11-01T00:00:00.000Z",
      };
      const timeDimension = {
        dimension_id: "dimension.customer-id",
        name: "Selected calendar month",
        aliases: ["calendar month"],
        table_id: "orders",
        column_id: "orders.created_at",
        grain: { grain_id: "grain.month", granularity: "month" },
        data_type: "timestamp",
        sensitivity: "PUBLIC",
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        analysis: { groupable: true, pivotable: false, causal_role: null },
      };
      const selectedMetric = {
        ...catalog.executable.metrics[0],
        time_domain: timeDomain,
        time_column_id: "orders.created_at",
      };
      const timeBinding = {
        ...semanticQueryContext.physical_bindings[0],
        logical_object_id: timeDimension.dimension_id,
        logical_object_type: "dimension" as const,
        column_name: variant === "missing-physical-column" ? "missing_date" : "created_at",
      };
      const catalogWithTimeDependency = {
        ...catalog,
        executable: {
          ...catalog.executable,
          metrics: [selectedMetric, ...catalog.executable.metrics.slice(1)],
          dimensions: [timeDimension],
          physical_bindings: [
            ...catalog.executable.physical_bindings,
            ...(variant === "missing-binding" ? [] : [timeBinding]),
          ],
        },
        restrictions: {
          ...catalog.restrictions,
          time_semantics: [timeDomain],
        },
      };
      const { context_hash: _contextHash, ...draft } = semanticQueryContext;
      const contextWithTimeDependency = await buildSemanticQueryContext({
        ...draft,
        requested_object_ids: ["dimension.customer-id", "metric.order-count", "time.order-month"],
        metrics: [selectedMetric],
        dimensions: [timeDimension],
        time_semantics: [timeDomain],
        physical_bindings: [
          ...(variant === "missing-binding" ? [] : [timeBinding]),
          ...draft.physical_bindings,
        ],
        request_scoped_interpretations: [
          {
            interpretation_id: "request-scoped.calendar",
            requested_term: "最近12个完整月",
            scope: "REQUEST_ONLY",
            source_object_ids: ["dimension.customer-id", "metric.order-count"],
            operator: {
              kind: "RECENT_COMPLETE_PERIODS",
              metric_id: "metric.order-count",
              time_dimension_id: "dimension.customer-id",
              period_count: 12,
              period_unit: "MONTH",
              anchor: "PUBLISHED_COMPLETE_FRONTIER",
            },
            user_explanation: "由发布边界计算完整月份。",
            publication_effect: "NONE",
          },
          {
            interpretation_id: "request-scoped.yoy",
            requested_term: "同比",
            scope: "REQUEST_ONLY",
            source_object_ids: ["dimension.customer-id", "metric.order-count"],
            operator: {
              kind: "PERIOD_COMPARISON_RATE",
              metric_id: "metric.order-count",
              time_dimension_id: "dimension.customer-id",
              comparison_offset: { unit: "YEAR", value: 1 },
              formula: "(current_value - comparison_value) / NULLIF(comparison_value, 0)",
            },
            user_explanation: "同一发布指标的年度比较。",
            publication_effect: "NONE",
          },
        ],
      });
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect: vi.fn() } as never,
        capability: {},
        schema_snapshots: {
          getSnapshot: vi.fn(async () => ({ ok: true as const, value: snapshot })),
        },
        datasources: {
          getDatasource: vi.fn(async () => ({ ok: true as const, value: datasource })),
        },
        secrets: {
          get: vi.fn(async () => ({
            ok: true as const,
            value: {
              ref: `secretref:${id(7)}` as const,
              name: "falcon-reader",
              version: 1,
              status: "ACTIVE" as const,
            },
          })),
        },
      });

      const preparation = runtime.prepare({
        effective_config: config as never,
        semantic_context: semanticContext,
        semantic_catalog: catalogWithTimeDependency as never,
        semantic_query_context: contextWithTimeDependency,
        max_context_bytes: 32_000,
      });
      if (variant !== "exact") {
        await expect(preparation).rejects.toMatchObject({
          code: "TEXT2SQL_SEMANTIC_TIME_COVERAGE_UNAVAILABLE",
        });
        return;
      }
      const prepared = await preparation;
      expect(prepared).toMatchObject({
        semantic_query_context_hash: contextWithTimeDependency.context_hash,
        published_time_coverage: [
          {
            schema_name: "falcon_db_24",
            relation_name: "orders",
            column_name: "created_at",
            min_time: timeDomain.min_time,
            max_time: timeDomain.max_time,
          },
        ],
        requested_time_window: {
          dimension_id: "dimension.customer-id",
          start: "2023-11-01T00:00:00.000Z",
          end: "2024-11-01T00:00:00.000Z",
          period_count: 12,
        },
      });
      expect(JSON.parse(prepared.context_text).semantic_context.resolved_time_window).toEqual(
        prepared.requested_time_window,
      );
      expect(
        JSON.parse(prepared.context_text).semantic_context.resolved_comparison_time_windows,
      ).toEqual([
        {
          metric_id: "metric.order-count",
          dimension_id: "dimension.customer-id",
          start: "2023-01-01T00:00:00.000Z",
          end: "2023-11-01T00:00:00.000Z",
          empty: false,
          requested_start: "2022-11-01T00:00:00.000Z",
          requested_end: "2023-11-01T00:00:00.000Z",
          semantics: "HALF_OPEN",
          timezone: "Asia/Shanghai",
          comparison_offset: { unit: "YEAR", value: 1 },
        },
      ]);
    },
  );

  it.each(["run", "release", "schema", "datasource", "out-of-range"] as const)(
    "rejects %s SemanticQueryContext drift before schema/datasource or target I/O",
    async (variant) => {
      const { config, semanticCatalog, semanticContext, semanticQueryContext } = await fixture();
      const { context_hash: _contextHash, ...draft } = semanticQueryContext;
      const invalidContext = await buildSemanticQueryContext({
        ...draft,
        ...(variant === "run" ? { run_id: id(90) } : {}),
        semantic_release: {
          ...draft.semantic_release,
          ...(variant === "release" ? { resource_hash: hash("9") } : {}),
        },
        schema_snapshot: {
          ...draft.schema_snapshot,
          ...(variant === "schema" ? { resource_hash: hash("8") } : {}),
        },
        datasource: {
          ...draft.datasource,
          ...(variant === "datasource" ? { resource_hash: hash("7") } : {}),
        },
        requested_object_ids:
          variant === "out-of-range"
            ? ["formula.order-count", "metric.order-count"]
            : draft.requested_object_ids,
      });
      const getSnapshot = vi.fn();
      const getDatasource = vi.fn();
      const getSecret = vi.fn();
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect: vi.fn() } as never,
        capability: {},
        schema_snapshots: { getSnapshot } as never,
        datasources: { getDatasource } as never,
        secrets: { get: getSecret } as never,
      });

      await expect(
        runtime.prepare({
          effective_config: config as never,
          semantic_context: semanticContext,
          semantic_catalog: semanticCatalog,
          semantic_query_context: invalidContext,
          max_context_bytes: 32_000,
        }),
      ).rejects.toBeDefined();
      expect(getSnapshot).not.toHaveBeenCalled();
      expect(getDatasource).not.toHaveBeenCalled();
      expect(getSecret).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale SecretRef before opening a database connection", async () => {
    const { config, datasource, semanticCatalog, semanticContext, snapshot } = await fixture();
    const connect = vi.fn();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
      capability: {},
      schema_snapshots: { getSnapshot: async () => ({ ok: true as const, value: snapshot }) },
      datasources: { getDatasource: async () => ({ ok: true as const, value: datasource }) },
      secrets: {
        get: async () => ({
          ok: true as const,
          value: {
            ref: `secretref:${id(7)}` as const,
            name: "falcon-reader",
            version: 2,
            status: "ACTIVE" as const,
          },
        }),
      },
    });

    await expect(
      runtime.prepare({
        effective_config: config as never,
        semantic_context: semanticContext,
        semantic_catalog: semanticCatalog,
        max_context_bytes: 32_000,
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_SECRET_REF_STALE" });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    "delete from falcon_db_24.orders",
    "select pg_sleep(30) as customer_id, 1 as order_count from falcon_db_24.orders",
    "select customer_id, count(*) as order_count from private.orders group by customer_id",
  ])("rejects unsafe SQL before database I/O: %s", async (sql) => {
    const { config } = await fixture();
    const connect = vi.fn();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
      capability: {},
      schema_snapshots: {} as never,
      datasources: {} as never,
      secrets: {} as never,
    });

    await expect(
      runtime.execute({
        effective_config: config as never,
        prepared: {
          context_text: "{}",
          datasource_id: config.datasource.resource_id,
          schema_snapshot_id: config.schema_snapshot.resource_id,
          schema_snapshot_hash: config.schema_snapshot.resource_hash,
          allowed_relations: ["falcon_db_24.orders"],
          target_capability_hash: hash("c"),
          reader_role: "falcon_demo_reader",
          semantic_query_context_hash: null,
        },
        candidate: candidate(sql),
        timeout_ms: 5_000,
        max_rows: 100,
        max_bytes: 64_000,
      }),
    ).rejects.toBeDefined();
    expect(connect).not.toHaveBeenCalled();
  });

  it("executes a generic aggregation through EXPLAIN and read-only transactions", async () => {
    const { config, semanticCatalog, semanticContext, snapshot } = await fixture();
    const queries: string[] = [];
    const client = {
      async query(input: string | { text: string }) {
        const text = typeof input === "string" ? input : input.text;
        queries.push(text);
        if (text.startsWith("select * from (")) {
          return {
            fields: [
              { name: "customer_id", dataTypeID: 25 },
              { name: "order_count", dataTypeID: 20 },
            ],
            rows: [{ customer_id: "customer-1", order_count: 2n }],
            rowCount: 1,
          };
        }
        return { fields: [], rows: [], rowCount: 0 };
      },
      release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
      capability: {},
      schema_snapshots: {} as never,
      datasources: {} as never,
      secrets: {} as never,
      bind_query_evidence: vi.fn(async () => ({ binding_hash: hash("f") }) as never),
      now: () => 0,
    });
    const result = await runtime.execute({
      effective_config: config as never,
      prepared: {
        context_text: "{}",
        datasource_id: config.datasource.resource_id,
        schema_snapshot_id: config.schema_snapshot.resource_id,
        schema_snapshot_hash: config.schema_snapshot.resource_hash,
        allowed_relations: ["falcon_db_24.orders"],
        target_capability_hash: hash("c"),
        reader_role: "falcon_demo_reader",
        semantic_query_context_hash: null,
        binding_authority: {
          physical_snapshot: snapshot,
          semantic_context: semanticContext,
          semantic_catalog: semanticCatalog,
          datasource_ref: config.datasource,
        },
      },
      candidate: candidate(
        "select o.customer_id as customer_id, count(*) as order_count from falcon_db_24.orders as o group by o.customer_id order by o.customer_id",
      ),
      timeout_ms: 5_000,
      max_rows: 100,
      max_bytes: 64_000,
    });

    expect(result.result.rows).toEqual([{ customer_id: "customer-1", order_count: "2" }]);
    expect(queries.filter((query) => query === "begin read only")).toHaveLength(2);
    expect(queries.some((query) => query.startsWith("explain (format json)"))).toBe(true);
    expect(queries.some((query) => query.startsWith("select * from ("))).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("preserves PostgreSQL DATE cells without a local-timezone day shift", async () => {
    const { config, semanticCatalog, semanticContext, snapshot } = await fixture();
    const databaseDate = new Date(2025, 7, 1);
    const client = {
      async query(input: string | { text: string }) {
        const text = typeof input === "string" ? input : input.text;
        if (text.startsWith("select * from (")) {
          return {
            fields: [
              { name: "order_month", dataTypeID: 1082 },
              { name: "customer_id", dataTypeID: 25 },
              { name: "order_count", dataTypeID: 20 },
            ],
            rows: [{ order_month: databaseDate, customer_id: "customer-1", order_count: 2n }],
            rowCount: 1,
          };
        }
        return { fields: [], rows: [], rowCount: 0 };
      },
      release: vi.fn(),
    };
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect: vi.fn(async () => client) } as never,
      capability: {},
      schema_snapshots: {} as never,
      datasources: {} as never,
      secrets: {} as never,
      bind_query_evidence: vi.fn(async () => ({ binding_hash: hash("f") }) as never),
      now: () => 0,
    });
    const baseCandidate = candidate(
      "select o.customer_id::date as order_month, o.customer_id as customer_id, count(*) as order_count from falcon_db_24.orders as o group by o.customer_id::date, o.customer_id order by order_month",
    );
    const result = await runtime.execute({
      effective_config: config as never,
      prepared: {
        context_text: "{}",
        datasource_id: config.datasource.resource_id,
        schema_snapshot_id: config.schema_snapshot.resource_id,
        schema_snapshot_hash: config.schema_snapshot.resource_hash,
        allowed_relations: ["falcon_db_24.orders"],
        target_capability_hash: hash("c"),
        reader_role: "falcon_demo_reader",
        semantic_query_context_hash: null,
        binding_authority: {
          physical_snapshot: snapshot,
          semantic_context: semanticContext,
          semantic_catalog: semanticCatalog,
          datasource_ref: config.datasource,
        },
      },
      candidate: {
        ...baseCandidate,
        result_columns: [
          {
            name: "order_month",
            semantic_type: "DATE",
            label: "月份",
            semantic_binding: { object_kind: "DIMENSION", object_id: "order-month" },
          },
          ...baseCandidate.result_columns,
        ],
      },
      timeout_ms: 5_000,
      max_rows: 100,
      max_bytes: 64_000,
    });

    expect(result.result.rows).toEqual([
      { order_month: "2025-08-01", customer_id: "customer-1", order_count: "2" },
    ]);
  });
});
