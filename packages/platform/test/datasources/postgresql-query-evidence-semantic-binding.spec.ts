import {
  buildGovernedDatasourceQueryResult,
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
  canonicalizeJson,
  type SemanticContextCommitResult,
  type Text2SqlQueryCandidate,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPhysicalSchemaSnapshot } from "../../src/catalog/physical-schema.js";
import {
  buildPostgresqlQueryEvidenceSemanticBinding,
  PostgresqlQueryEvidenceSemanticBindingError,
  postgresqlQueryEvidenceSemanticBindingInternals,
} from "../../src/datasources/adapters/postgresql-query-evidence-semantic-binding.js";

const id = (suffix: number) => `95000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const releaseId = id(4);
const datasourceId = id(5);
const snapshotId = id(6);
const releaseHash = hash("a");
const targetBindingHash = hash("b");
const datasourceRef = {
  resource_id: datasourceId,
  resource_revision: 4,
  resource_hash: hash("c"),
} as const;

function column(
  name: string,
  ordinal: number,
  formattedType: string,
  typeName: string,
  nullable: boolean,
) {
  return {
    column_name: name,
    ordinal_position: ordinal,
    formatted_type: formattedType,
    type_identity: {
      type_schema: "pg_catalog",
      type_name: typeName,
      type_kind: "BASE" as const,
      array_dimensions: 0,
    },
    nullable,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

async function physicalSnapshot() {
  return createPhysicalSchemaSnapshot({
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: snapshotId,
    scan_run_id: id(7),
    captured_at: "2026-08-26T00:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: datasourceId,
      datasource_fingerprint: hash("d"),
      engine: "postgresql",
      engine_version: { major: 17, minor: 4 },
      database_identity: { database_name: "falcon", database_oid: 24 },
      included_schemas: ["public"],
      relations: [
        {
          identity: { schema_name: "public", relation_name: "orders" },
          relation_kind: "TABLE",
          comment: null,
          columns: [
            column("order_date", 1, "date", "date", false),
            column("amount", 2, "numeric", "numeric", true),
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
}

async function semanticContext(
  snapshot: Awaited<ReturnType<typeof physicalSnapshot>>,
): Promise<SemanticContextCommitResult> {
  const selectedObjectIds = ["dimension.order_month", "metric.order_revenue"];
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: hash("e"),
    release_hash: releaseHash,
    query_hash: hash("f"),
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("1"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: selectedObjectIds,
      excluded_objects: [],
    },
    route_states: {
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: "READY",
      GRAPH: "READY",
    },
    hits: [],
    expansions: [],
    selected_object_ids: selectedObjectIds,
    pruned_object_ids: [],
    fallback_reason_codes: [],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("2"),
    steps: [],
    mandatory_object_ids: selectedObjectIds,
    mandatory_relationship_ids: [],
    closure_complete: true,
    reason_codes: [],
  });
  const packageDocument = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: "falcon24",
    question_hash: hash("f"),
    defaults_ref: { defaults_id: id(8), defaults_revision: 1, defaults_hash: hash("3") },
    semantic_release: {
      resource_id: releaseId,
      resource_revision: 3,
      resource_hash: releaseHash,
      datasource_id: datasourceId,
      semantic_generation: 3,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: snapshot.snapshot_id,
      resource_revision: 2,
      resource_hash: snapshot.snapshot_content_hash,
      datasource_id: datasourceId,
      semantic_release_id: releaseId,
      semantic_generation: 3,
    },
    context_policy: {
      resource_id: id(9),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 4096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(10),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    authority_snapshot_hash: hash("e"),
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "metric.order_revenue",
      selected_ontology_ids: ["dimension.order_month"],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4096,
      max_context_bytes: 4096,
      mandatory_bytes: 128,
      included_bytes: 128,
      cropped_bytes: 0,
      items: selectedObjectIds.map((objectId) => ({
        item_kind: objectId.startsWith("metric.") ? ("METRIC" as const) : ("ONTOLOGY" as const),
        item_id: objectId,
        item_hash: hash("6"),
        byte_size: 64,
        priority: 10_000,
        mandatory: true,
        disposition: "MANDATORY" as const,
        reason_code: "ROUTE_SELECTED" as const,
      })),
    },
    evidence: [],
    knowledge_refs: [],
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: selectedObjectIds,
      relationship_ids: [],
      closure_hash: hash("7"),
    },
    analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
  });
  const receipt = await buildSemanticContextReceipt({
    schema_version: "semantic-context-receipt@1.0.0",
    receipt_id: id(11),
    scope,
    consumer: "RUN",
    request_id: id(12),
    request_hash: hash("8"),
    run_id: runId,
    package_ref: {
      package_id: packageDocument.package_id,
      package_revision: 1,
      package_hash: packageDocument.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: packageDocument.authority_snapshot_hash,
    resolved_at: "2026-08-26T00:00:01.000Z",
  });
  return {
    schema_version: "semantic-context-commit-result@1.0.0",
    disposition: "CREATED",
    package: packageDocument,
    receipt,
  };
}

function semanticCatalog() {
  const grain = { grain_id: "order-month", granularity: "month" as const };
  return {
    release_identity: {
      semantic_domain: "falcon24",
      release_id: releaseId,
      release_digest: releaseHash,
    },
    executable: {
      metrics: [
        {
          metric_id: "metric.order_revenue",
          name: "订单收入",
          aliases: ["收入"],
          table_id: "orders",
          column_id: "amount",
          aggregation: "sum" as const,
          formula: null,
          grain,
          unit: null,
          time_domain: {
            time_domain_id: "order-time",
            calendar: "gregorian" as const,
            timezone: "Asia/Shanghai",
            min_time: null,
            max_time: null,
          },
          time_column_id: "order_date",
          additivity: "additive" as const,
          null_policy: "preserve" as const,
          fanout_policy: "preaggregate" as const,
          dependency_column_ids: ["amount"],
          tags: [],
          analysis: {
            primary: true,
            priority: 10_000,
            missing_period_policy: "NULL" as const,
            seasonality: null,
            allowed_dimension_ids: ["dimension.order_month"],
            capabilities: ["CHART_DATASET" as const],
            causal_role: "OUTCOME" as const,
          },
        },
      ],
      dimensions: [
        {
          dimension_id: "dimension.order_month",
          name: "订单月份",
          aliases: ["月份"],
          table_id: "orders",
          column_id: "order_date",
          grain,
          data_type: "date" as const,
          sensitivity: "PUBLIC" as const,
          hierarchical: false,
          parent_dimension_id: null,
          tags: [],
          analysis: { groupable: true, pivotable: true, causal_role: null },
        },
      ],
      formulas: [],
      physical_bindings: [
        {
          logical_object_id: "column.orders.amount",
          logical_object_type: "column" as const,
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: "amount",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
        },
        {
          logical_object_id: "column.orders.order_date",
          logical_object_type: "column" as const,
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: "order_date",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
        },
      ],
    },
  };
}

const candidate = (): Text2SqlQueryCandidate => ({
  schema_version: "text2sql-query-candidate@1.0.0",
  sql: "select date_trunc('month', o.order_date)::date as order_month, sum(o.amount) as revenue from public.orders o where o.order_date >= $1 and o.order_date < $2 group by 1 order by 1",
  parameters: ["2026-01-01", "2026-03-01"],
  result_columns: [
    {
      name: "order_month",
      semantic_type: "DATE",
      label: "月份",
      semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.order_month" },
    },
    {
      name: "revenue",
      semantic_type: "NUMBER",
      label: "收入",
      semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
    },
  ],
  time_window: {
    dimension_id: "dimension.order_month",
    start_parameter: 1,
    end_parameter: 2,
    semantics: "HALF_OPEN",
  },
  presentation: {
    title: "月度收入",
    summary: "按月汇总收入。",
    visualization: "LINE",
    x_key: "order_month",
    y_keys: ["revenue"],
  },
});

async function queryResult(
  columns = [
    { name: "order_month", type: "1082" },
    { name: "revenue", type: "1700" },
  ],
) {
  const rows = [
    { order_month: "2026-01-01", revenue: "120.50" },
    { order_month: "2026-02-01", revenue: null },
  ];
  return buildGovernedDatasourceQueryResult({
    schema_version: "governed-datasource-query-result@1.0.0",
    query_id: id(13),
    request_hash: hash("9"),
    adapter_ref: {
      adapter_id: "postgresql",
      adapter_revision: 1,
      descriptor_hash: hash("0"),
      dialect: "POSTGRESQL",
    },
    columns,
    rows,
    row_count: rows.length,
    byte_count: new TextEncoder().encode(canonicalizeJson({ columns, rows })).byteLength,
    elapsed_ms: 12,
    truncated: false,
  });
}

async function fixture() {
  const snapshot = await physicalSnapshot();
  return {
    candidate: candidate(),
    result: await queryResult(),
    physical_snapshot: snapshot,
    semantic_context: await semanticContext(snapshot),
    semantic_catalog: semanticCatalog(),
    datasource_ref: datasourceRef,
    target_binding_hash: targetBindingHash,
  };
}

describe("PostgreSQL QueryEvidence semantic binding", () => {
  it("maps PostgreSQL physical and result identities without preview-value inference", () => {
    expect(
      ["int8", "numeric", "bool", "date", "timestamp", "timestamptz", "uuid", "text"].map(
        postgresqlQueryEvidenceSemanticBindingInternals.logicalTypeForPhysicalType,
      ),
    ).toEqual(["NUMBER", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "DATETIME", "STRING", "STRING"]);
    expect(
      ["20", "1700", "16", "1082", "1114", "1184", "2950", "25"].map(
        postgresqlQueryEvidenceSemanticBindingInternals.logicalTypeForOid,
      ),
    ).toEqual(["NUMBER", "NUMBER", "BOOLEAN", "DATE", "DATETIME", "DATETIME", "STRING", "STRING"]);
  });

  it("binds actual PostgreSQL OIDs to the exact published objects and physical snapshot", async () => {
    const input = await fixture();
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);

    expect(binding.columns).toMatchObject([
      {
        output_name: "order_month",
        logical_type: "DATE",
        nullable: false,
        semantic_role: "DIMENSION",
        semantic_object_id: "dimension.order_month",
        aggregate: null,
      },
      {
        output_name: "revenue",
        logical_type: "NUMBER",
        nullable: true,
        semantic_role: "METRIC",
        semantic_object_id: "metric.order_revenue",
        aggregate: "sum",
      },
    ]);
    expect(binding.columns[1]?.formula_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(binding.time_window).toEqual({
      dimension_id: "dimension.order_month",
      start: "2026-01-01",
      end: "2026-03-01",
      semantics: "HALF_OPEN",
      timezone: "Asia/Shanghai",
    });
    expect(binding.schema_snapshot_ref.resource_hash).toBe(
      input.physical_snapshot.snapshot_content_hash,
    );
  });

  it("rejects a result OID that contradicts the declared semantic type", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        result: await queryResult([
          { name: "order_month", type: "25" },
          { name: "revenue", type: "1700" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_AUTHORITY_BINDING_MISMATCH" });
  });

  it("rejects a semantic type that contradicts the exact physical snapshot column", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          result_columns: input.candidate.result_columns.map((resultColumn, index) =>
            index === 0 ? { ...resultColumn, semantic_type: "NUMBER" as const } : resultColumn,
          ),
        },
        result: await queryResult([
          { name: "order_month", type: "23" },
          { name: "revenue", type: "1700" },
        ]),
        semantic_catalog: {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            dimensions: input.semantic_catalog.executable.dimensions.map((dimension) => ({
              ...dimension,
              data_type: "integer" as const,
            })),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_DIMENSION_BINDING_INVALID" });
  });

  it("rejects a semantic object that was not selected by the frozen context", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          result_columns: input.candidate.result_columns.map((resultColumn, index) =>
            index === 0
              ? {
                  ...resultColumn,
                  semantic_binding: {
                    object_kind: "DIMENSION" as const,
                    object_id: "dimension.unselected_month",
                  },
                }
              : resultColumn,
          ),
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED" });
  });

  it("rejects stale physical bindings instead of materializing an ungrounded column", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        semantic_catalog: {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            physical_bindings: input.semantic_catalog.executable.physical_bindings.map((binding) =>
              binding.logical_object_id === "column.orders.amount"
                ? { ...binding, column_name: "removed_amount" }
                : binding,
            ),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID" });
  });

  it("rejects a reversed half-open time window even when its SQL parameters exist", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          parameters: ["2026-03-01", "2026-01-01"],
        },
      }),
    ).rejects.toBeInstanceOf(PostgresqlQueryEvidenceSemanticBindingError);
  });

  it("rejects an inclusive end predicate instead of trusting parameter presence", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          sql: input.candidate.sql.replace("o.order_date < $2", "o.order_date <= $2"),
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_TIME_WINDOW_INVALID" });
  });

  it("recognizes the equivalent parameter-first half-open predicates", () => {
    expect(
      postgresqlQueryEvidenceSemanticBindingInternals.hasHalfOpenPredicate({
        sql: "select 1 from orders where $1::date <= order_date and $2::date > order_date",
        column_name: "order_date",
        start_parameter: 1,
        end_parameter: 2,
      }),
    ).toBe(true);
  });

  it("rejects a different published release identity for otherwise identical rows", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        semantic_catalog: {
          ...input.semantic_catalog,
          release_identity: {
            ...input.semantic_catalog.release_identity,
            release_digest: hash("f"),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_AUTHORITY_BINDING_MISMATCH" });
  });
});
