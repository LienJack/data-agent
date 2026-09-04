import {
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticInferenceReceipt,
  buildSemanticQueryContext,
  buildSemanticRetrievalReceipt,
  type SemanticContextCommitResult,
  type Text2SqlQueryCandidate,
  type WorkspaceDatasource,
} from "@data-agent/contracts";
import { createPhysicalSchemaSnapshot } from "@data-agent/platform/catalog";
import { describe, expect, it, vi } from "vitest";
import type { FrozenSemanticReleaseCatalog } from "../../src/semantic/semantic-release-read-port.js";
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
      type_name: type === "integer" ? "int4" : type === "bigint" ? "int8" : "text",
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

async function fixture(
  includeFormulaSelection = false,
  includeTimeColumn = false,
  periodSource = false,
  evidenceSummaryBytes = 0,
) {
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
            column("amount", 2, periodSource ? "bigint" : "integer"),
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
      selected_object_ids: [
        "dimension.customer-id",
        ...(includeFormulaSelection ? ["formula.order-count"] : []),
        "metric.order-count",
      ],
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
      object_ids: [
        "dimension.customer-id",
        ...(includeFormulaSelection ? ["formula.order-count"] : []),
        "metric.order-count",
      ],
      relationship_ids: [],
    },
    evidence:
      evidenceSummaryBytes === 0
        ? []
        : [
            {
              evidence_kind: "GRAPH",
              evidence_id: "lineage.orders.audit",
              evidence_hash: hash("f"),
              summary: "x".repeat(evidenceSummaryBytes),
            },
          ],
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
    time_column_id: includeTimeColumn ? "created_at" : null,
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

// The period template runs the production semantic receipt proof, so use real
// contract builders here rather than the narrow legacy projection-only fixture.
async function sealedPeriodContext(
  config: Awaited<ReturnType<typeof fixture>>["config"],
): Promise<SemanticContextCommitResult> {
  const ids = ["dimension.customer-id", "metric.order-count"];
  const retrieval = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: hash("a"),
    release_hash: config.semantic_release.resource_hash,
    query_hash: hash("b"),
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("c"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: ids,
      excluded_objects: [],
    },
    route_states: { LEXICON: "READY", SPARSE: "READY", VECTOR: "READY", GRAPH: "READY" },
    hits: [],
    expansions: [],
    selected_object_ids: ids,
    pruned_object_ids: [],
    fallback_reason_codes: [],
  });
  const inference = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrieval.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("d"),
    steps: [],
    mandatory_object_ids: ids,
    mandatory_relationship_ids: [],
    closure_complete: true,
    reason_codes: [],
  });
  const pkg = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: "falcon24",
    question_hash: hash("b"),
    defaults_ref: config.defaults_ref,
    semantic_release: config.semantic_release,
    schema_snapshot: config.schema_snapshot,
    context_policy: config.context_policy,
    egress_policy: config.egress_policy,
    provider: "deepseek",
    authority_snapshot_hash: hash("a"),
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "metric.order-count",
      selected_ontology_ids: [ids[0]],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 32000,
      max_context_bytes: 32000,
      mandatory_bytes: 128,
      included_bytes: 128,
      cropped_bytes: 0,
      items: ids.map((item_id) => ({
        item_kind: item_id.startsWith("metric.") ? ("METRIC" as const) : ("ONTOLOGY" as const),
        item_id,
        item_hash: hash("e"),
        byte_size: 64,
        priority: 10000,
        mandatory: true,
        disposition: "MANDATORY" as const,
        reason_code: "ROUTE_SELECTED" as const,
      })),
    },
    evidence: [],
    knowledge_refs: [],
    retrieval_receipt: retrieval,
    inference_receipt: inference,
    mandatory_closure: { object_ids: ids, relationship_ids: [], closure_hash: hash("f") },
    analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
  });
  const receipt = await buildSemanticContextReceipt({
    schema_version: "semantic-context-receipt@1.0.0",
    receipt_id: id(9),
    scope,
    consumer: "RUN",
    request_id: id(12),
    request_hash: hash("1"),
    run_id: config.run_id,
    package_ref: {
      package_id: pkg.package_id,
      package_revision: 1,
      package_hash: pkg.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: pkg.authority_snapshot_hash,
    resolved_at: "2026-08-26T00:00:00.000Z",
  });
  return {
    schema_version: "semantic-context-commit-result@1.0.0",
    disposition: "CREATED",
    package: pkg,
    receipt,
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
  it("projects a selected containment node through its published physical-column binding", async () => {
    const base = await fixture();
    const packageDocument = structuredClone(
      base.semanticContextPackage,
    ) as SemanticContextCommitResult["package"];
    packageDocument.retrieval_receipt.selected_object_ids.push("contains.column.orders.secret");
    packageDocument.mandatory_closure.object_ids.push("contains.column.orders.secret");

    const projection = postgresqlText2SqlQueryRuntimeInternals.semanticProjection(
      packageDocument,
      base.semanticCatalog,
    );

    expect(projection.executable.physical_bindings).toContainEqual(
      expect.objectContaining({ logical_object_id: "column.orders.secret" }),
    );
    expect(projection.executable.physical_bindings).not.toContainEqual(
      expect.objectContaining({ logical_object_id: "contains.column.orders.secret" }),
    );
  });

  it("projects the exact accepted aggregate-ratio identity into provider and compiler allowlists", async () => {
    const base = await fixture(true);
    const original = base.semanticContext as SemanticContextCommitResult;
    const originalCatalog = base.semanticCatalog as FrozenSemanticReleaseCatalog;
    const metric = base.semanticQueryContext.metrics[0];
    if (!metric) throw new Error("METRIC_FIXTURE_REQUIRED");
    // Projection-only fixture. Actual SUM/grain/source equivalence is proven by the shared Platform boundary.
    const numerator = { ...metric, aggregation: "sum" as const, formula: null };
    const denominator = { ...numerator, metric_id: "metric.order-spend" };
    const metrics = [numerator, denominator];
    const bindings = metrics.map((entry) => ({
      ...base.semanticQueryContext.physical_bindings[0],
      logical_object_id: entry.metric_id,
    }));
    const ids = metrics.map((entry) => entry.metric_id);
    const contextCommit = {
      ...original,
      package: {
        ...original.package,
        retrieval_receipt: { ...original.package.retrieval_receipt, selected_object_ids: ids },
        inference_receipt: { ...original.package.inference_receipt, mandatory_object_ids: ids },
      },
    };
    const catalog = {
      ...originalCatalog,
      executable: {
        ...originalCatalog.executable,
        metrics,
        formulas: [],
        physical_bindings: bindings,
      },
    } as FrozenSemanticReleaseCatalog;
    const { context_hash: _hash, ...draft } = base.semanticQueryContext;
    const context = await buildSemanticQueryContext({
      ...draft,
      metrics,
      formulas: [],
      physical_bindings: bindings,
      requested_object_ids: ids,
      request_scoped_interpretations: [
        {
          interpretation_id: "request-scoped.net-roi",
          requested_term: "净ROI",
          scope: "REQUEST_ONLY",
          source_object_ids: ids,
          operator: {
            kind: "AGGREGATE_RATIO",
            numerator_metric_id: numerator.metric_id,
            denominator_metric_id: denominator.metric_id,
            numerator_adjustment: "SUBTRACT_DENOMINATOR",
            aggregation: "SUM_BEFORE_RATIO",
            zero_denominator: "NULL",
          },
          user_explanation: "按本请求先聚合后计算净回报。",
          publication_effect: "NONE",
        },
      ],
    });
    const connect = vi.fn();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
      capability: {},
      schema_snapshots: {
        getSnapshot: vi.fn(async () => ({ ok: true as const, value: base.snapshot })),
      },
      datasources: {
        getDatasource: vi.fn(async () => ({ ok: true as const, value: base.datasource })),
      },
      secrets: {
        get: vi.fn(async () => ({
          ok: true as const,
          value: {
            ref: `secretref:${id(7)}` as const,
            name: "offline-reader",
            version: 1,
            status: "ACTIVE" as const,
          },
        })),
      },
    });
    const prepared = await runtime.prepare({
      effective_config: base.config as never,
      semantic_context: contextCommit,
      semantic_catalog: catalog,
      semantic_query_context: context,
      max_context_bytes: 32_000,
    });
    expect(JSON.parse(prepared.context_text).semantic_context.request_derived_bindings).toEqual([
      { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.net-roi" },
    ]);
    expect(prepared.semantic_query_context_binding?.request_derivation_ids).toEqual([
      "request-scoped.net-roi",
    ]);
    expect(prepared.semantic_query_context_binding?.formula_ids).toEqual([]);
    expect(prepared.binding_authority?.semantic_query_context).toEqual(context);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(["missing-selection", "selected-without-authority"])(
    "rejects request derivation %s before target I/O",
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
        reader_role: "reader",
        semantic_query_context_hash: hash("f"),
        semantic_query_context_binding: {
          metric_ids: [],
          dimension_ids: [],
          formula_ids: [],
          request_derivation_ids: variant === "missing-selection" ? [] : ["request-scoped.yoy"],
        },
      };
      const query: Text2SqlQueryCandidate = {
        ...candidate("select sum(o.amount) as growth from falcon_db_24.orders as o"),
        result_columns: [
          {
            name: "growth",
            semantic_type: "NUMBER",
            label: "同比",
            semantic_binding: { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.yoy" },
          },
        ],
        presentation: {
          title: "同比",
          summary: "候选",
          visualization: "TABLE",
          x_key: null,
          y_keys: [],
        },
      };
      await expect(runtime.compileCandidate({ prepared, candidate: query })).rejects.toMatchObject(
        variant === "missing-selection"
          ? { diagnostic_code: "TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE" }
          : { code: "TEXT2SQL_BINDING_AUTHORITY_REQUIRED" },
      );
      expect(connect).not.toHaveBeenCalled();
    },
  );
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
    const { config, datasource, semanticCatalog, semanticContext, snapshot } = await fixture(
      false,
      false,
      false,
      40_000,
    );
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
    expect(JSON.parse(prepared.context_text).semantic_context).not.toHaveProperty("evidence");
    expect(Buffer.byteLength(prepared.context_text, "utf8")).toBeLessThanOrEqual(32_000);
    expect(JSON.parse(prepared.context_text)).not.toHaveProperty("period_comparison_candidate");
    await expect(
      runtime.compileCandidate({
        prepared,
        candidate: {
          ...candidate(
            "select count(o.amount) as current_value, count(o.amount) as comparison_value from falcon_db_24.orders as o",
          ),
          result_columns: ["current_value", "comparison_value"].map((name) => ({
            name,
            semantic_type: "NUMBER" as const,
            label: name,
            semantic_binding: {
              object_kind: "METRIC" as const,
              object_id: "metric.order-count",
            },
          })),
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("narrows compiler and firewall context to an accepted SemanticQueryContext", async () => {
    const { config, datasource, semanticCatalog, semanticContext, semanticQueryContext, snapshot } =
      await fixture(true);
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
    expect(projected).not.toHaveProperty("published_formula_references");
    const { context_hash: _contextHash, ...contextDraft } = semanticQueryContext;
    const requestedFormulaContext = await buildSemanticQueryContext({
      ...contextDraft,
      requested_object_ids: ["formula.order-count", "metric.order-count"],
    });
    const formulaPrepared = await runtime.prepare({
      effective_config: config as never,
      semantic_context: semanticContext,
      semantic_catalog: semanticCatalog,
      semantic_query_context: requestedFormulaContext,
      max_context_bytes: 32_000,
    });
    const references = JSON.parse(formulaPrepared.context_text).published_formula_references;
    expect(references).toEqual([
      {
        formula_id: "formula.order-count",
        schema_name: "falcon_db_24",
        relation_name: "orders",
        table_alias: "f",
        expression_sql: 'COUNT(f."amount")',
        parameters: [],
      },
    ]);
    await expect(
      runtime.prepare({
        effective_config: config as never,
        semantic_context: semanticContext,
        semantic_catalog: semanticCatalog,
        semantic_query_context: requestedFormulaContext,
        max_context_bytes: 1,
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_CONTEXT_BUDGET_EXCEEDED" });
    expect(connect).not.toHaveBeenCalled();

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
    const formulaCandidate: Text2SqlQueryCandidate = {
      ...narrowedCandidate,
      result_columns: [
        {
          name: "order_count",
          semantic_type: "NUMBER",
          label: "订单数",
          semantic_binding: { object_kind: "FORMULA", object_id: "formula.order-count" },
        },
      ],
    };
    expect(prepared.semantic_query_context_binding?.formula_ids).toEqual(["formula.order-count"]);
    await expect(
      runtime.compileCandidate({ prepared, candidate: formulaCandidate }),
    ).resolves.toMatchObject({
      result_columns: [
        { semantic_binding: { object_kind: "FORMULA", object_id: "formula.order-count" } },
      ],
    });
    await expect(
      runtime.compileCandidate({
        prepared,
        candidate: {
          ...formulaCandidate,
          sql: formulaCandidate.sql.replace("count", "sum"),
        },
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH" });
    await expect(
      runtime.compileCandidate({
        prepared,
        candidate: {
          ...formulaCandidate,
          result_columns: [
            {
              ...formulaCandidate.result_columns[0],
              name: "order_count",
              semantic_type: "NUMBER",
              label: "fake",
              semantic_binding: { object_kind: "FORMULA", object_id: "formula.hidden" },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE" });
    expect(connect).not.toHaveBeenCalled();
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
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE",
      diagnostic_code: "TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE",
    });
    await expect(
      runtime.compileCandidate({
        prepared,
        candidate: {
          ...narrowedCandidate,
          sql: "select count(o.amount) as order_count from falcon_db_24.orders as o where o.created_at >= $1::pg_catalog.timestamp and o.created_at < $2::pg_catalog.timestamp",
          parameters: ["2024-01-01", "2024-02-01"],
          time_window: {
            dimension_id: "dimension.unselected-time",
            start_parameter: 1,
            end_parameter: 2,
            semantics: "HALF_OPEN",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE",
      diagnostic_code: "TEXT2SQL_SEMANTIC_TIME_BINDING_OUT_OF_RANGE",
    });
  });

  it.each(["exact", "missing-binding", "missing-physical-column"] as const)(
    "binds published time coverage to a retrieved metric: %s",
    async (variant) => {
      const {
        config,
        datasource,
        semanticCatalog,
        semanticContext: _legacyContext,
        semanticQueryContext,
        snapshot,
      } = await fixture(false, false, true);
      const semanticContext = await sealedPeriodContext(config);
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
        aggregation: "sum",
        formula: null,
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
        formulas: [],
        semantic_context_ref: {
          package_id: semanticContext.package.package_id,
          package_hash: semanticContext.package.package_hash,
          receipt_id: semanticContext.receipt.receipt_id,
          receipt_hash: semanticContext.receipt.receipt_hash,
          retrieval_receipt_hash: semanticContext.package.retrieval_receipt.receipt_hash,
          inference_receipt_hash: semanticContext.package.inference_receipt.receipt_hash,
        },
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
      const compiledCandidate = JSON.parse(prepared.context_text).period_comparison_candidate;
      expect(compiledCandidate).toMatchObject({
        schema_version: "text2sql-query-candidate@1.0.0",
        time_window: { start_parameter: 2, end_parameter: 3 },
      });
      await expect(
        runtime.compileCandidate({ prepared, candidate: compiledCandidate }),
      ).resolves.toMatchObject({
        parameters: compiledCandidate.parameters,
        result_columns: compiledCandidate.result_columns,
        time_window: compiledCandidate.time_window,
      });
      // Canonical interpretation ids can place either operator first. The order
      // must not change SQL or dates; the derived result retains its exact new id.
      const { context_hash: _forwardHash, ...forwardContext } = contextWithTimeDependency;
      const reversedPrepared = await runtime.prepare({
        effective_config: config as never,
        semantic_context: semanticContext,
        semantic_catalog: catalogWithTimeDependency as never,
        semantic_query_context: await buildSemanticQueryContext({
          ...forwardContext,
          request_scoped_interpretations: (forwardContext.request_scoped_interpretations ?? [])
            .map((interpretation) => ({
              ...interpretation,
              interpretation_id:
                interpretation.operator.kind === "PERIOD_COMPARISON_RATE"
                  ? "request-scoped.a-yoy"
                  : interpretation.interpretation_id,
            }))
            .sort((a, b) => a.interpretation_id.localeCompare(b.interpretation_id)),
        }),
        max_context_bytes: 32_000,
      });
      const reversedCandidate = JSON.parse(
        reversedPrepared.context_text,
      ).period_comparison_candidate;
      expect(reversedCandidate).toEqual({
        ...compiledCandidate,
        result_columns: compiledCandidate.result_columns.map(
          (column: { semantic_binding: { object_kind: string; object_id: string } }) =>
            column.semantic_binding.object_kind === "REQUEST_DERIVED"
              ? {
                  ...column,
                  semantic_binding: {
                    ...column.semantic_binding,
                    object_id: "request-scoped.a-yoy",
                  },
                }
              : column,
        ),
      });
      expect(reversedPrepared.requested_time_window).toEqual(prepared.requested_time_window);
      await expect(
        runtime.compileCandidate({ prepared: reversedPrepared, candidate: reversedCandidate }),
      ).resolves.toMatchObject({ time_window: compiledCandidate.time_window });
      const narrowedToRankedPeriods = structuredClone(compiledCandidate);
      narrowedToRankedPeriods.parameters[1] = "2024-08-01T00:00:00.000Z";
      await expect(
        runtime.compileCandidate({ prepared, candidate: narrowedToRankedPeriods }),
      ).rejects.toMatchObject({ code: "TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH" });
      const drifted = structuredClone(compiledCandidate);
      drifted.parameters[3] = "2022-11-01T00:00:00.000Z";
      await expect(runtime.compileCandidate({ prepared, candidate: drifted })).rejects.toThrow();
      expect(() =>
        postgresqlText2SqlQueryRuntimeInternals.text2sqlContext({
          snapshot,
          semantic_context_package: semanticContext.package,
          semantic_catalog: catalogWithTimeDependency as never,
          semantic_query_context: contextWithTimeDependency,
          period_comparison_candidate: compiledCandidate,
          allowed_relations: prepared.allowed_relations,
          max_context_bytes: 256,
        }),
      ).toThrow("TEXT2SQL_CONTEXT_BUDGET_EXCEEDED");
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
      expect(JSON.parse(prepared.context_text).semantic_context.request_derived_bindings).toEqual([
        { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.yoy" },
      ]);
      expect(prepared.semantic_query_context_binding?.request_derivation_ids).toEqual([
        "request-scoped.yoy",
      ]);
      expect(prepared.binding_authority?.semantic_query_context).toEqual(contextWithTimeDependency);
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

  it("rejects an unresolved zero-candidate mapping before all schema, credential and target I/O", async () => {
    const { config, semanticCatalog, semanticContext, semanticQueryContext } = await fixture();
    const { context_hash: _contextHash, ...draft } = semanticQueryContext;
    const unresolvedContext = await buildSemanticQueryContext({
      ...draft,
      unresolved_ambiguities: [{ object_kind: "DIMENSION", candidate_ids: [] }],
    });
    const getSnapshot = vi.fn();
    const getDatasource = vi.fn();
    const getSecret = vi.fn();
    const connect = vi.fn();
    const runtime = createPostgresqlText2SqlQueryRuntime({
      pool: { connect } as never,
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
        semantic_query_context: unresolvedContext,
        max_context_bytes: 32_000,
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_SEMANTIC_CONTEXT_AMBIGUOUS" });
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(getDatasource).not.toHaveBeenCalled();
    expect(getSecret).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

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

  it("compiles recent rows with cross-table Metric time metadata but still rejects hidden filters before I/O", async () => {
    const { config, semanticCatalog, semanticContext, snapshot } = await fixture(false, true);
    const catalog: FrozenSemanticReleaseCatalog = semanticCatalog;
    const metric = catalog.executable.metrics[0];
    if (!metric) throw new Error("METRIC_FIXTURE_REQUIRED");
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
        semantic_catalog: {
          ...catalog,
          executable: {
            ...catalog.executable,
            metrics: [{ ...metric, table_id: "deliveries", time_column_id: "orders.created_at" }],
            dimensions: [],
            physical_bindings: [
              {
                logical_object_id: "column.orders.created_at",
                logical_object_type: "column" as const,
                datasource_id: config.datasource.resource_id,
                schema_name: "falcon_db_24",
                table_name: "orders",
                column_name: "created_at",
                binding_lifecycle: "active" as const,
                valid_from: null,
                valid_until: null,
              },
            ],
          },
        },
        datasource_ref: config.datasource,
      },
    };
    const query: Text2SqlQueryCandidate = {
      ...candidate(
        "select o.customer_id as customer_id from falcon_db_24.orders as o order by o.created_at::pg_catalog.date desc limit $1",
      ),
      parameters: [10],
      result_columns: [
        {
          name: "customer_id",
          semantic_type: "STRING",
          label: "客户",
          semantic_binding: {
            object_kind: "PHYSICAL_COLUMN",
            object_id: "column.orders.customer_id",
          },
        },
      ],
    };
    const compiled = await runtime.compileCandidate({ prepared, candidate: query });
    expect(compiled.parameters).toEqual([10]);
    expect(compiled.time_window).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    const restricted = {
      ...query,
      sql: "select o.customer_id as customer_id from falcon_db_24.orders as o where o.created_at >= $1",
      parameters: ["2026-01-01"],
    };
    await expect(
      runtime.compileCandidate({ prepared, candidate: restricted }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" });
    await expect(
      runtime.execute({
        effective_config: config as never,
        prepared,
        candidate: restricted,
        timeout_ms: 5000,
        max_rows: 100,
        max_bytes: 64000,
      }),
    ).rejects.toMatchObject({ code: "DATASOURCE_ADAPTER_SQL_REJECTED" });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(["compile", "execute"] as const)(
    "rejects an undeclared text-backed time filter before %s query I/O",
    async (phase) => {
      const { config, semanticCatalog, semanticContext, snapshot } = await fixture(false, true);
      const connect = vi.fn();
      const bind = vi.fn();
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect } as never,
        capability: {},
        schema_snapshots: {} as never,
        datasources: {} as never,
        secrets: {} as never,
        bind_query_evidence: bind,
      });
      const prepared = {
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
      };
      const query = {
        ...candidate(
          "select o.customer_id as customer_id, count(o.amount) as order_count from falcon_db_24.orders o where o.created_at >= $1 and o.created_at < $2 group by o.customer_id",
        ),
        parameters: ["2023-05-01", "2024-11-01"],
      };
      await expect(
        phase === "compile"
          ? runtime.compileCandidate({ prepared, candidate: query })
          : runtime.execute({
              effective_config: config as never,
              prepared,
              candidate: query,
              timeout_ms: 5_000,
              max_rows: 100,
              max_bytes: 64_000,
            }),
      ).rejects.toMatchObject(
        phase === "compile"
          ? { diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" }
          : { code: "DATASOURCE_ADAPTER_SQL_REJECTED" },
      );
      expect(connect).not.toHaveBeenCalled();
      expect(bind).not.toHaveBeenCalled();
    },
  );

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
