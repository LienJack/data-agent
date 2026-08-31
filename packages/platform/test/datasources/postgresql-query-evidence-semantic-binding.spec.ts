import {
  buildGovernedDatasourceQueryResult,
  buildQueryEvidenceSemanticBinding,
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticInferenceReceipt,
  buildSemanticQueryContext,
  buildSemanticRetrievalReceipt,
  canonicalizeJson,
  formulaNodeSchema,
  type SemanticContextCommitResult,
  type SemanticDimension,
  type SemanticFormulaExpression,
  type SemanticRelationship,
  type Text2SqlQueryCandidate,
  verifyQueryEvidenceSemanticBinding,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPhysicalSchemaSnapshot } from "../../src/catalog/physical-schema.js";
import {
  assertPostgresqlQueryTemporalSelection,
  buildPostgresqlQueryEvidenceSemanticBinding,
  PostgresqlQueryEvidenceSemanticBindingError,
  postgresqlQueryEvidenceSemanticBindingInternals,
  type QueryEvidenceSemanticCatalog,
  resolvePostgresqlPublishedFormulaBindings,
  resolvePostgresqlRequestDerivedBindings,
} from "../../src/datasources/adapters/postgresql-query-evidence-semantic-binding.js";
import { groupedPeriodComparisonFixture } from "../support/grouped-period-comparison-fixture.js";
import { periodComparisonFixture } from "../support/period-comparison-fixture.js";

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

async function physicalSnapshot(
  orderDateType: "date" | "text" = "date",
  includeSpend = false,
  measuresNullable = true,
) {
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
            column("order_id", 1, "text", "text", false),
            column("order_date", 2, orderDateType, orderDateType, false),
            column("amount", 3, "numeric", "numeric", measuresNullable),
            ...(includeSpend ? [column("spend", 4, "numeric", "numeric", measuresNullable)] : []),
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
  additionalIds: readonly string[] = [],
  mandatoryRelationshipIds: readonly string[] = [],
): Promise<SemanticContextCommitResult> {
  const selectedObjectIds = [
    "column.orders.order_id",
    "dimension.order_month",
    "metric.order_revenue",
    ...additionalIds,
  ].sort();
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
    mandatory_relationship_ids: mandatoryRelationshipIds,
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
      mandatory_bytes: selectedObjectIds.length * 64,
      included_bytes: selectedObjectIds.length * 64,
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
      relationship_ids: mandatoryRelationshipIds,
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
          logical_object_id: "column.orders.order_id",
          logical_object_type: "column" as const,
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: "order_id",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
        },
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
  rows: Record<string, string | null>[] = [
    { order_month: "2026-01-01", revenue: "120.50" },
    { order_month: "2026-02-01", revenue: null },
  ],
) {
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

async function fixture(orderDateType: "date" | "text" = "date") {
  const snapshot = await physicalSnapshot(orderDateType);
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

async function requestDerivationFixture() {
  const base = await fixture("text");
  const metric = base.semantic_catalog.executable.metrics[0];
  if (!metric) throw new Error("missing metric fixture");
  const domain = {
    ...metric.time_domain,
    min_time: "2023-05-01T00:00:00.000Z",
    max_time: "2024-11-01T00:00:00.000Z",
  };
  const catalog = {
    ...base.semantic_catalog,
    executable: {
      ...base.semantic_catalog.executable,
      metrics: base.semantic_catalog.executable.metrics.map((metric) => ({
        ...metric,
        time_domain: domain,
      })),
    },
  };
  const pkg = base.semantic_context.package;
  const sources = ["dimension.order_month", "metric.order_revenue"];
  const context = await buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    answer_scope: "DATA_RESULT_REQUIRED",
    scope,
    run_id: runId,
    semantic_domain: pkg.semantic_domain,
    semantic_release: pkg.semantic_release,
    schema_snapshot: pkg.schema_snapshot,
    datasource: datasourceRef,
    semantic_context_ref: {
      package_id: pkg.package_id,
      package_hash: pkg.package_hash,
      receipt_id: base.semantic_context.receipt.receipt_id,
      receipt_hash: base.semantic_context.receipt.receipt_hash,
      retrieval_receipt_hash: pkg.retrieval_receipt.receipt_hash,
      inference_receipt_hash: pkg.inference_receipt.receipt_hash,
    },
    requested_object_ids: [...sources, domain.time_domain_id].sort(),
    ...catalog.executable,
    physical_bindings: [...catalog.executable.physical_bindings].sort((a, b) =>
      a.logical_object_id < b.logical_object_id ? -1 : 1,
    ),
    relationships: [],
    time_semantics: [domain],
    quality_constraints: [],
    unresolved_ambiguities: [],
    request_scoped_interpretations: [
      {
        interpretation_id: "request-scoped.months",
        requested_term: "最近12个完整月",
        scope: "REQUEST_ONLY",
        source_object_ids: sources,
        operator: {
          kind: "RECENT_COMPLETE_PERIODS",
          metric_id: sources[1],
          time_dimension_id: sources[0],
          period_unit: "MONTH",
          period_count: 12,
          anchor: "PUBLISHED_COMPLETE_FRONTIER",
        },
        user_explanation: "发布边界前12个月",
        publication_effect: "NONE",
      },
      {
        interpretation_id: "request-scoped.yoy",
        requested_term: "同比",
        scope: "REQUEST_ONLY",
        source_object_ids: sources,
        operator: {
          kind: "PERIOD_COMPARISON_RATE",
          metric_id: sources[1],
          time_dimension_id: sources[0],
          comparison_offset: { unit: "YEAR", value: 1 },
          formula: "(current_value - comparison_value) / NULLIF(comparison_value, 0)",
        },
        user_explanation: "同口径年度比较",
        publication_effect: "NONE",
      },
    ],
  });
  return {
    ...base,
    candidate: periodComparisonFixture().candidate,
    semantic_catalog: catalog,
    semantic_query_context: context,
    result: await queryResult(
      [
        { name: "month", type: "1114" },
        { name: "current_value", type: "1700" },
        { name: "comparison_value", type: "1700" },
        { name: "growth", type: "1700" },
      ],
      [
        {
          month: "2023-11-01T00:00:00.000Z",
          current_value: "100",
          comparison_value: null,
          growth: null,
        },
      ],
    ),
  };
}

async function groupedRequestDerivationFixture() {
  const base = await requestDerivationFixture();
  const fact = base.physical_snapshot.content.relations[0];
  if (!fact) throw new Error("FACT_REQUIRED");
  const snapshot = await createPhysicalSchemaSnapshot({
    schema_version: "physical-schema-snapshot-draft@1.0.0",
    snapshot_id: snapshotId,
    scan_run_id: id(7),
    captured_at: "2026-08-26T00:00:00.000Z",
    content: {
      ...base.physical_snapshot.content,
      relations: [
        { ...fact, columns: [...fact.columns, column("customer_id", 4, "text", "text", false)] },
        {
          ...fact,
          identity: { schema_name: "public", relation_name: "customers" },
          columns: [
            column("customer_id", 1, "text", "text", false),
            column("segment", 2, "text", "text", false),
          ],
        },
      ],
    },
  });
  const dimension: SemanticDimension = {
    dimension_id: "dimension.segment",
    name: "客户类型",
    aliases: ["客户类型"],
    table_id: "customers",
    column_id: "customers.segment",
    grain: { grain_id: "customer", granularity: "atomic" },
    data_type: "text",
    sensitivity: "INTERNAL",
    hierarchical: false,
    parent_dimension_id: null,
    tags: [],
    analysis: { groupable: true, pivotable: true, causal_role: null },
  };
  const relationship: SemanticRelationship = {
    relationship_id: "relationship.order_customer",
    name: "order_customer",
    kind: "physical",
    left_table_id: "orders",
    left_column_ids: ["orders.customer_id"],
    right_table_id: "customers",
    right_column_ids: ["customers.customer_id"],
    cardinality: "many-to-one",
    left_row_preservation: "required",
    right_row_preservation: "optional",
    proof_kind: "SNAPSHOT_CERTIFIED",
    proof_detail: "fixed snapshot",
    tags: [],
    analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] },
  };
  const binding = (
    table: string,
    name: string,
    objectId: string,
    objectType: "dimension" | "column",
  ) => ({
    logical_object_id: objectId,
    logical_object_type: objectType,
    datasource_id: datasourceId,
    schema_name: "public",
    table_name: table,
    column_name: name,
    binding_lifecycle: "active" as const,
    valid_from: null,
    valid_until: null,
  });
  const groupBinding = binding("customers", "segment", dimension.dimension_id, "dimension");
  const catalog = {
    ...base.semantic_catalog,
    relationships: { relationships: [relationship] },
    executable: {
      ...base.semantic_catalog.executable,
      metrics: base.semantic_catalog.executable.metrics.map((m) => ({
        ...m,
        analysis: {
          ...m.analysis,
          allowed_dimension_ids: [
            ...m.analysis.allowed_dimension_ids,
            dimension.dimension_id,
          ].sort(),
        },
      })),
      dimensions: [...base.semantic_catalog.executable.dimensions, dimension],
      physical_bindings: [
        ...base.semantic_catalog.executable.physical_bindings,
        groupBinding,
        binding("orders", "customer_id", "column.orders.customer_id", "column"),
        binding("customers", "customer_id", "column.customers.customer_id", "column"),
      ],
    },
  };
  const semantic = await semanticContext(
    snapshot,
    [dimension.dimension_id],
    [relationship.relationship_id],
  );
  const pkg = semantic.package;
  const { context_hash: _hash, ...draft } = base.semantic_query_context;
  const context = await buildSemanticQueryContext({
    ...draft,
    schema_snapshot: pkg.schema_snapshot,
    semantic_context_ref: {
      package_id: pkg.package_id,
      package_hash: pkg.package_hash,
      receipt_id: semantic.receipt.receipt_id,
      receipt_hash: semantic.receipt.receipt_hash,
      retrieval_receipt_hash: pkg.retrieval_receipt.receipt_hash,
      inference_receipt_hash: pkg.inference_receipt.receipt_hash,
    },
    requested_object_ids: [
      ...draft.requested_object_ids,
      dimension.dimension_id,
      relationship.relationship_id,
    ].sort(),
    metrics: catalog.executable.metrics,
    dimensions: catalog.executable.dimensions,
    relationships: [relationship],
    // Key columns are not output grants in the accepted SemanticQueryContext.
    physical_bindings: [...draft.physical_bindings, groupBinding].sort((a, b) =>
      a.logical_object_id.localeCompare(b.logical_object_id),
    ),
  });
  return {
    ...base,
    candidate: groupedPeriodComparisonFixture().candidate,
    physical_snapshot: snapshot,
    semantic_catalog: catalog,
    semantic_context: semantic,
    semantic_query_context: context,
    result: await queryResult(
      [
        { name: "month", type: "1114" },
        { name: "segment", type: "25" },
        { name: "current_value", type: "1700" },
        { name: "comparison_value", type: "1700" },
        { name: "growth", type: "1700" },
      ],
      [
        {
          month: "2023-11-01T00:00:00.000Z",
          segment: null,
          current_value: "100",
          comparison_value: null,
          growth: null,
        },
      ],
    ),
  };
}

describe("grouped request-derived authority", () => {
  it.each([false, true])(
    "binds exact period roles and group coverage (complete=%s)",
    async (complete) => {
      const input = await groupedRequestDerivationFixture();
      input.candidate = groupedPeriodComparisonFixture(true, complete).candidate;
      const proof = await resolvePostgresqlRequestDerivedBindings(input);
      const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
      expect(binding.columns[4]?.request_derivation?.period_comparison).toEqual({
        time_output: "month",
        current_output: "current_value",
        comparison_output: "comparison_value",
        category_output: "segment",
        group_coverage: complete ? "BOTH_PERIOD_GROUPS" : "CURRENT_PERIOD_GROUPS",
      });
      expect(proof[0]?.nullable_metric_outputs).toEqual(
        complete ? ["comparison_value", "current_value"] : ["comparison_value"],
      );
      await expect(
        verifyQueryEvidenceSemanticBinding(JSON.parse(JSON.stringify(binding))),
      ).resolves.toEqual(binding);
      const tampered = structuredClone(binding);
      const mapping = tampered.columns[4]?.request_derivation?.period_comparison;
      if (!mapping) throw new Error("COMPARISON_REQUIRED");
      [mapping.current_output, mapping.comparison_output] = [
        mapping.comparison_output,
        mapping.current_output,
      ];
      await expect(verifyQueryEvidenceSemanticBinding(tampered)).rejects.toThrow(
        "QUERY_EVIDENCE_SEMANTIC_BINDING_HASH_MISMATCH",
      );
    },
  );

  it.each([
    "missing-current",
    "same-period-alias",
    "wrong-time",
    "missing-category",
    "category-is-measure",
    "wrong-source",
    "wrong-formula",
    "wrong-aggregate",
    "no-window",
    "no-group-full",
    "non-period-operator",
  ])("rejects comparison metadata that does not close: %s", async (variant) => {
    const input = await groupedRequestDerivationFixture();
    input.candidate = groupedPeriodComparisonFixture(true, true).candidate;
    const { binding_hash: _hash, ...draft } =
      await buildPostgresqlQueryEvidenceSemanticBinding(input);
    const current = draft.columns[2],
      rate = draft.columns[4],
      mapping = rate?.request_derivation?.period_comparison;
    if (!current || !rate?.request_derivation || !mapping) throw new Error("COMPARISON_REQUIRED");
    if (variant === "missing-current") mapping.current_output = "unknown";
    if (variant === "same-period-alias") mapping.current_output = mapping.comparison_output;
    if (variant === "wrong-time") mapping.time_output = "segment";
    if (variant === "missing-category") mapping.category_output = "unknown";
    if (variant === "category-is-measure") mapping.category_output = mapping.current_output;
    if (variant === "wrong-source") current.semantic_object_id = "metric.other";
    if (variant === "wrong-formula") current.formula_hash = hash("f");
    if (variant === "wrong-aggregate") current.aggregate = "avg";
    if (variant === "no-window") draft.time_window = null;
    if (variant === "no-group-full") {
      mapping.category_output = null;
      draft.columns = draft.columns.filter((c) => c.output_name !== "segment");
    }
    if (variant === "non-period-operator") {
      const ratio = (
        await aggregateRatioBindingFixture()
      ).semantic_query_context.request_scoped_interpretations?.find(
        ({ operator }) => operator.kind === "AGGREGATE_RATIO",
      );
      if (!ratio) throw new Error("RATIO_REQUIRED");
      rate.request_derivation.interpretation = ratio;
      rate.semantic_object_id = ratio.interpretation_id;
    }
    await expect(buildQueryEvidenceSemanticBinding(draft)).rejects.toThrow();
  });

  it("binds the exact certified relationship and both keys, retaining unmatched categorical NULL", async () => {
    const input = await groupedRequestDerivationFixture();
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns[1]).toMatchObject({
      semantic_role: "DIMENSION",
      semantic_object_id: "dimension.segment",
      nullable: true,
    });
    expect(binding.columns[4]).toMatchObject({ semantic_role: "REQUEST_DERIVED", nullable: true });
    expect(
      binding.columns[4]?.physical_sources.map((s) => `${s.relation_name}.${s.column_name}`).sort(),
    ).toEqual([
      "customers.customer_id",
      "customers.segment",
      "orders.amount",
      "orders.customer_id",
      "orders.order_date",
    ]);
    expect(
      input.semantic_query_context.physical_bindings.some(
        (b) => b.logical_object_id === "column.customers.customer_id",
      ),
    ).toBe(false);
  });
  it.each([
    "published-edge-missing",
    "edge-tamper",
    "fanout",
    "declared-only",
    "join-denied",
    "preserve-right",
    "metric-dimension-denied",
    "dimension-not-groupable",
    "key-binding-missing",
    "missing-window",
    "omitted-group",
  ])("rejects %s without query I/O", async (variant) => {
    const input = await groupedRequestDerivationFixture();
    const { context_hash: _hash, ...draft } = input.semantic_query_context;
    const edge = input.semantic_catalog.relationships.relationships[0];
    if (!edge) throw new Error("EDGE_REQUIRED");
    if (variant === "published-edge-missing")
      input.semantic_catalog.relationships.relationships = [];
    if (variant === "edge-tamper") draft.relationships = [{ ...edge, proof_detail: "invented" }];
    if (["fanout", "declared-only", "join-denied", "preserve-right"].includes(variant)) {
      const changed: SemanticRelationship = {
        ...edge,
        ...(variant === "fanout" ? { cardinality: "one-to-many" as const } : {}),
        ...(variant === "declared-only" ? { proof_kind: "DECLARED_ONLY" as const } : {}),
        ...(variant === "preserve-right" ? { right_row_preservation: "required" as const } : {}),
        analysis: {
          ...edge.analysis,
          ...(variant === "join-denied" ? { join_allowed: false } : {}),
          ...(variant === "fanout" ? { fanout_closed: false } : {}),
        },
      };
      draft.relationships = [changed];
      input.semantic_catalog.relationships.relationships = [changed];
    }
    if (variant === "metric-dimension-denied") {
      input.semantic_catalog.executable.metrics = input.semantic_catalog.executable.metrics.map(
        (m) => ({
          ...m,
          analysis: { ...m.analysis, allowed_dimension_ids: ["dimension.order_month"] },
        }),
      );
      draft.metrics = input.semantic_catalog.executable.metrics;
    }
    if (variant === "dimension-not-groupable") {
      input.semantic_catalog.executable.dimensions =
        input.semantic_catalog.executable.dimensions.map((d) =>
          d.dimension_id === "dimension.segment"
            ? { ...d, analysis: { ...d.analysis, groupable: false } }
            : d,
        );
      draft.dimensions = input.semantic_catalog.executable.dimensions;
    }
    if (variant === "key-binding-missing")
      input.semantic_catalog.executable.physical_bindings =
        input.semantic_catalog.executable.physical_bindings.filter(
          (b) => b.logical_object_id !== "column.customers.customer_id",
        );
    if (variant === "missing-window")
      draft.request_scoped_interpretations = draft.request_scoped_interpretations?.filter(
        (i) => i.operator.kind !== "RECENT_COMPLETE_PERIODS",
      );
    if (variant === "omitted-group") input.candidate = periodComparisonFixture().candidate;
    input.semantic_query_context = await buildSemanticQueryContext(draft);
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
      variant === "key-binding-missing"
        ? "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID"
        : variant === "omitted-group"
          ? "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH"
          : "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
    );
  });
});

describe("request-derived QueryEvidence authority", () => {
  it("preserves exact context and request-only provenance, numeric type and NULL comparison", async () => {
    const input = await requestDerivationFixture();
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns[3]).toMatchObject({
      semantic_role: "REQUEST_DERIVED",
      semantic_object_id: "request-scoped.yoy",
      aggregate: null,
      nullable: true,
      request_derivation: {
        semantic_query_context_hash: input.semantic_query_context.context_hash,
        interpretation: { scope: "REQUEST_ONLY", publication_effect: "NONE" },
      },
    });
    expect(binding.columns[3]?.formula_hash).toMatch(/^sha256:/u);
    expect(binding.columns[2]?.nullable).toBe(true);
    expect(binding.columns.slice(1, 3).map(({ semantic_role }) => semantic_role)).toEqual([
      "METRIC",
      "METRIC",
    ]);
  });
  it("rejects relabeling the request rate as its source Metric before query I/O", async () => {
    const input = await requestDerivationFixture();
    input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
      index === 3
        ? {
            ...column,
            semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
          }
        : column,
    );
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
      "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
    );
  });
  it.each([
    "missing-context",
    "context-hash",
    "run",
    "receipt",
    "metric",
    "binding",
    "operator-id",
    "sql",
    "oid",
  ])("rejects %s drift without producing a binding", async (variant) => {
    const input = await requestDerivationFixture();
    if (variant === "missing-context") {
      const { semantic_query_context: _context, ...missing } = input;
      await expect(buildPostgresqlQueryEvidenceSemanticBinding(missing)).rejects.toThrow(
        "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
      );
      return;
    }
    const { context_hash: _hash, ...draft } = input.semantic_query_context;
    if (variant === "context-hash")
      input.semantic_query_context = { ...input.semantic_query_context, context_hash: hash("f") };
    if (variant === "run")
      input.semantic_query_context = await buildSemanticQueryContext({ ...draft, run_id: id(90) });
    if (variant === "receipt")
      input.semantic_query_context = await buildSemanticQueryContext({
        ...draft,
        semantic_context_ref: { ...draft.semantic_context_ref, receipt_hash: hash("0") },
      });
    if (variant === "metric")
      input.semantic_query_context = await buildSemanticQueryContext({
        ...draft,
        metrics: draft.metrics.map((metric) => ({ ...metric, aggregation: "avg" })),
      });
    if (variant === "binding")
      input.semantic_query_context = await buildSemanticQueryContext({
        ...draft,
        physical_bindings: draft.physical_bindings.map((binding) => ({
          ...binding,
          valid_until: "2024-01-01",
        })),
      });
    if (variant === "operator-id")
      input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
        index === 3
          ? {
              ...column,
              semantic_binding: {
                object_kind: "REQUEST_DERIVED",
                object_id: "request-scoped.unaccepted",
              },
            }
          : column,
      );
    if (variant === "sql")
      input.candidate.sql = input.candidate.sql.replace("(c.v-p.v)", "(p.v-c.v)");
    if (variant === "oid")
      input.result = await queryResult(
        [
          { name: "month", type: "1114" },
          { name: "current_value", type: "1700" },
          { name: "comparison_value", type: "1700" },
          { name: "growth", type: "25" },
        ],
        [],
      );
    await expect(buildPostgresqlQueryEvidenceSemanticBinding(input)).rejects.toThrow();
  });
});

async function formulaFixture(measuresNullable = true) {
  const snapshot = await physicalSnapshot("date", true, measuresNullable);
  const catalog = semanticCatalog();
  const metric = catalog.executable.metrics[0];
  if (!metric) throw new Error("missing metric fixture");
  const sum = (slot_id: string): SemanticFormulaExpression => ({
    kind: "AGGREGATE",
    function: "SUM",
    input: { kind: "SLOT", slot_id },
    distinct: false,
    filter: null,
  });
  const expression: SemanticFormulaExpression = {
    kind: "CASE",
    branches: [
      {
        when: {
          kind: "BINARY",
          operator: "EQ",
          left: sum("spend"),
          right: { kind: "LITERAL", value: 0 },
        },
        result: { kind: "LITERAL", value: 0 },
      },
    ],
    otherwise: { kind: "BINARY", operator: "DIVIDE", left: sum("amount"), right: sum("spend") },
  };
  const semantic_catalog: QueryEvidenceSemanticCatalog = {
    ...catalog,
    executable: {
      ...catalog.executable,
      metrics: [
        ...catalog.executable.metrics,
        {
          ...metric,
          metric_id: "metric.order_spend",
          column_id: "spend",
          dependency_column_ids: ["spend"],
        },
      ],
      formulas: [
        {
          node_id: "formula.roas",
          node_version: 1,
          node_type: "FORMULA",
          name: "ROAS",
          aliases: [],
          owner_ref: "semantic.owner",
          lifecycle: "ACTIVE",
          evidence_refs: [],
          tags: [],
          formula_type: "ratio",
          return_type: "numeric",
          language: "semantic-ast",
          language_version: "semantic-formula-ast@2",
          expression,
        },
      ],
      physical_bindings: [
        ...catalog.executable.physical_bindings,
        {
          logical_object_id: "metric.order_spend",
          logical_object_type: "metric",
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: "spend",
          binding_lifecycle: "active",
          valid_from: null,
          valid_until: null,
        },
      ],
    },
  };
  return {
    candidate: {
      ...candidate(),
      sql: "select case when sum(o.spend)=$1 then $1 else sum(o.amount)/sum(o.spend) end as roas from public.orders as o",
      parameters: [0],
      time_window: null,
      result_columns: [
        {
          name: "roas",
          semantic_type: "NUMBER",
          label: "ROAS",
          semantic_binding: { object_kind: "FORMULA", object_id: "formula.roas" },
        },
      ],
      presentation: {
        title: "ROAS",
        summary: "已发布公式",
        visualization: "TABLE",
        x_key: null,
        y_keys: [],
      },
    } satisfies Text2SqlQueryCandidate,
    result: await queryResult([{ name: "roas", type: "1700" }], [{ roas: "3.2" }]),
    physical_snapshot: snapshot,
    semantic_context: await semanticContext(snapshot, ["formula.roas", "metric.order_spend"]),
    semantic_catalog,
    datasource_ref: datasourceRef,
    target_binding_hash: targetBindingHash,
  };
}

async function aggregateRatioBindingFixture(measuresNullable = true) {
  const base = await formulaFixture(measuresNullable);
  const channel: SemanticDimension = {
    dimension_id: "dimension.channel",
    name: "渠道",
    aliases: ["channel"],
    table_id: "orders",
    column_id: "order_id",
    grain: { grain_id: "channel", granularity: "atomic" as const },
    data_type: "text" as const,
    sensitivity: "PUBLIC" as const,
    hierarchical: false,
    parent_dimension_id: null,
    tags: [],
    analysis: { groupable: true, pivotable: true, causal_role: null },
  };
  const catalog = {
    ...base.semantic_catalog,
    executable: {
      ...base.semantic_catalog.executable,
      metrics: base.semantic_catalog.executable.metrics.map((metric) => ({
        ...metric,
        analysis: { ...metric.analysis, allowed_dimension_ids: [channel.dimension_id] },
      })),
      dimensions: [channel],
      physical_bindings: [
        ...base.semantic_catalog.executable.physical_bindings,
        {
          logical_object_id: channel.dimension_id,
          logical_object_type: "dimension" as const,
          datasource_id: datasourceId,
          schema_name: "public",
          table_name: "orders",
          column_name: "order_id",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
        },
      ],
    },
  };
  const semantic_context = await semanticContext(base.physical_snapshot, [
    "dimension.channel",
    "metric.order_spend",
  ]);
  const pkg = semantic_context.package;
  const context = await buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    answer_scope: "DATA_RESULT_REQUIRED",
    scope,
    run_id: runId,
    semantic_domain: pkg.semantic_domain,
    semantic_release: pkg.semantic_release,
    schema_snapshot: pkg.schema_snapshot,
    datasource: datasourceRef,
    semantic_context_ref: {
      package_id: pkg.package_id,
      package_hash: pkg.package_hash,
      receipt_id: semantic_context.receipt.receipt_id,
      receipt_hash: semantic_context.receipt.receipt_hash,
      retrieval_receipt_hash: pkg.retrieval_receipt.receipt_hash,
      inference_receipt_hash: pkg.inference_receipt.receipt_hash,
    },
    requested_object_ids: [
      "dimension.channel",
      "metric.order_revenue",
      "metric.order_spend",
      "order-time",
    ],
    metrics: catalog.executable.metrics,
    dimensions: [channel],
    formulas: [],
    relationships: [],
    physical_bindings: [...catalog.executable.physical_bindings].sort((a, b) =>
      a.logical_object_id < b.logical_object_id ? -1 : 1,
    ),
    time_semantics: catalog.executable.metrics.slice(0, 1).map((metric) => metric.time_domain),
    quality_constraints: [],
    unresolved_ambiguities: [],
    request_scoped_interpretations: [
      {
        interpretation_id: "request-scoped.net-roi",
        requested_term: "净ROI",
        scope: "REQUEST_ONLY",
        source_object_ids: ["metric.order_revenue", "metric.order_spend"],
        operator: {
          kind: "AGGREGATE_RATIO",
          numerator_metric_id: "metric.order_revenue",
          denominator_metric_id: "metric.order_spend",
          numerator_adjustment: "SUBTRACT_DENOMINATOR",
          aggregation: "SUM_BEFORE_RATIO",
          zero_denominator: "NULL",
        },
        user_explanation: "先汇总收入和投入再计算净回报，投入为零保留空值。",
        publication_effect: "NONE",
      },
    ],
  });
  const candidate: Text2SqlQueryCandidate = {
    ...base.candidate,
    sql: "SELECT o.order_id AS channel, SUM(o.amount) AS revenue, SUM(o.spend) AS spend, (SUM(o.amount)-SUM(o.spend))/NULLIF(SUM(o.spend),0) AS net_roi FROM public.orders AS o GROUP BY o.order_id ORDER BY net_roi DESC",
    parameters: [],
    result_columns: [
      {
        name: "channel",
        label: "渠道",
        semantic_type: "STRING",
        semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.channel" },
      },
      {
        name: "revenue",
        label: "收入",
        semantic_type: "NUMBER",
        semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
      },
      {
        name: "spend",
        label: "投入",
        semantic_type: "NUMBER",
        semantic_binding: { object_kind: "METRIC", object_id: "metric.order_spend" },
      },
      {
        name: "net_roi",
        label: "净ROI",
        semantic_type: "NUMBER",
        semantic_binding: { object_kind: "REQUEST_DERIVED", object_id: "request-scoped.net-roi" },
      },
    ],
  };
  return {
    ...base,
    candidate,
    semantic_context,
    semantic_catalog: catalog,
    semantic_query_context: context,
    result: await queryResult(
      [
        { name: "channel", type: "25" },
        { name: "revenue", type: "1700" },
        { name: "spend", type: "1700" },
        { name: "net_roi", type: "1700" },
      ],
      [{ channel: "test", revenue: "0", spend: "0", net_roi: null }],
    ),
  };
}

async function aggregateRatioWindowBindingFixture(
  projectMonth = true,
  timeType: "date" | "text" = "date",
) {
  const input = await aggregateRatioBindingFixture();
  const month = semanticCatalog().executable.dimensions[0];
  if (!month) throw new Error("DIMENSION_FIXTURE_REQUIRED");
  const domain = {
    time_domain_id: "order-time",
    calendar: "gregorian" as const,
    timezone: "Asia/Shanghai",
    min_time: "2023-01-01T00:00:00.000Z",
    max_time: "2024-11-01T00:00:00.000Z",
  };
  const metrics = input.semantic_catalog.executable.metrics.map((metric) => ({
    ...metric,
    time_domain: domain,
    analysis: {
      ...metric.analysis,
      allowed_dimension_ids: ["dimension.channel", month.dimension_id],
    },
  }));
  const snapshot = await physicalSnapshot(timeType, true);
  const committed = await semanticContext(snapshot, ["dimension.channel", "metric.order_spend"]);
  const pkg = committed.package;
  const dimensions = [...input.semantic_catalog.executable.dimensions, month];
  const catalog: QueryEvidenceSemanticCatalog = {
    ...input.semantic_catalog,
    executable: { ...input.semantic_catalog.executable, metrics, dimensions },
  };
  const { context_hash: _hash, ...draft } = input.semantic_query_context;
  const context = await buildSemanticQueryContext({
    ...draft,
    metrics,
    dimensions,
    schema_snapshot: pkg.schema_snapshot,
    semantic_context_ref: {
      package_id: pkg.package_id,
      package_hash: pkg.package_hash,
      receipt_id: committed.receipt.receipt_id,
      receipt_hash: committed.receipt.receipt_hash,
      retrieval_receipt_hash: pkg.retrieval_receipt.receipt_hash,
      inference_receipt_hash: pkg.inference_receipt.receipt_hash,
    },
    time_semantics: [domain],
    requested_object_ids: [...draft.requested_object_ids, month.dimension_id].sort(),
    request_scoped_interpretations: [
      {
        interpretation_id: "request-scoped.calendar",
        requested_term: "最近12个完整月",
        scope: "REQUEST_ONLY",
        source_object_ids: [month.dimension_id, "metric.order_revenue"],
        operator: {
          kind: "RECENT_COMPLETE_PERIODS",
          metric_id: "metric.order_revenue",
          time_dimension_id: month.dimension_id,
          period_count: 12,
          period_unit: "MONTH",
          anchor: "PUBLISHED_COMPLETE_FRONTIER",
        },
        user_explanation: "发布边界前12个完整月。",
        publication_effect: "NONE",
      },
      ...(draft.request_scoped_interpretations ?? []),
    ],
  });
  const time = timeType === "text" ? "o.order_date::pg_catalog.timestamp" : "o.order_date";
  const query = input.candidate;
  query.sql = query.sql.replace(
    "GROUP BY o.order_id",
    `WHERE ${time} >= $1::pg_catalog.timestamp AND ${time} < $2::pg_catalog.timestamp GROUP BY o.order_id`,
  );
  query.parameters = ["2023-11-01", "2024-11-01"];
  query.time_window = {
    dimension_id: month.dimension_id,
    start_parameter: 1,
    end_parameter: 2,
    semantics: "HALF_OPEN",
  };
  if (projectMonth) {
    query.sql = query.sql
      .replace("SELECT ", `SELECT date_trunc($3, ${time})::date AS month, `)
      .replace("GROUP BY o.order_id", "GROUP BY month,o.order_id");
    query.parameters.push("month");
    query.result_columns.unshift({
      name: "month",
      label: "月份",
      semantic_type: "DATE",
      semantic_binding: { object_kind: "DIMENSION", object_id: month.dimension_id },
    });
  }
  return {
    ...input,
    candidate: query,
    semantic_context: committed,
    semantic_query_context: context,
    semantic_catalog: catalog,
    physical_snapshot: snapshot,
    result: projectMonth
      ? await queryResult(
          [{ name: "month", type: "1082" }, ...input.result.columns],
          [{ month: "2024-01-01", channel: "test", revenue: "10", spend: "5", net_roi: "1" }],
        )
      : input.result,
  };
}

const requestedRelationship: SemanticRelationship = {
  relationship_id: "relationship.order_customer",
  name: "order_customer",
  kind: "physical",
  left_table_id: "orders",
  left_column_ids: ["customer_id"],
  right_table_id: "customers",
  right_column_ids: ["customer_id"],
  cardinality: "many-to-one",
  left_row_preservation: "required",
  right_row_preservation: "optional",
  proof_kind: "SNAPSHOT_CERTIFIED",
  proof_detail: "Fixed snapshot relationship fixture.",
  tags: [],
  analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] },
};

async function withRequestedRelationship(
  input:
    | Awaited<ReturnType<typeof requestDerivationFixture>>
    | Awaited<ReturnType<typeof aggregateRatioBindingFixture>>,
  granted = true,
) {
  const additionalIds = input.semantic_context.package.retrieval_receipt.selected_object_ids.filter(
    (id) =>
      !["column.orders.order_id", "dimension.order_month", "metric.order_revenue"].includes(id),
  );
  const semantic_context = await semanticContext(
    input.physical_snapshot,
    additionalIds,
    granted ? [requestedRelationship.relationship_id] : [],
  );
  const pkg = semantic_context.package;
  const { context_hash: _hash, ...draft } = input.semantic_query_context;
  const semantic_query_context = await buildSemanticQueryContext({
    ...draft,
    requested_object_ids: [
      ...draft.requested_object_ids,
      requestedRelationship.relationship_id,
    ].sort(),
    relationships: [requestedRelationship],
    semantic_context_ref: {
      package_id: pkg.package_id,
      package_hash: pkg.package_hash,
      receipt_id: semantic_context.receipt.receipt_id,
      receipt_hash: semantic_context.receipt.receipt_hash,
      retrieval_receipt_hash: pkg.retrieval_receipt.receipt_hash,
      inference_receipt_hash: pkg.inference_receipt.receipt_hash,
    },
  });
  return { ...input, semantic_context, semantic_query_context };
}

describe("repeated Metric outputs need a proved comparison", () => {
  it.each(["no-context", "empty-context", "window-only"])(
    "rejects two aliases of the same Metric with %s",
    async (kind) => {
      const original = await requestDerivationFixture();
      const { semantic_query_context: originalContext, ...base } = original;
      const { context_hash: _hash, ...draft } = originalContext;
      const input = {
        ...base,
        candidate: {
          ...original.candidate,
          sql: original.candidate.sql.replace(", (c.v-p.v)/NULLIF(p.v,0) AS growth", ""),
          result_columns: original.candidate.result_columns.slice(0, 3),
          presentation: { ...original.candidate.presentation, y_keys: ["current_value"] },
        },
        ...(kind === "no-context"
          ? {}
          : {
              semantic_query_context: await buildSemanticQueryContext({
                ...draft,
                request_scoped_interpretations:
                  kind === "window-only"
                    ? draft.request_scoped_interpretations?.filter(
                        ({ operator }) => operator.kind === "RECENT_COMPLETE_PERIODS",
                      )
                    : [],
              }),
            }),
      };
      await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
        "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
      );
    },
  );

  it("keeps ordinary direct single-Metric queries valid", async () => {
    await expect(resolvePostgresqlRequestDerivedBindings(await fixture())).resolves.toEqual([]);
  });

  it.each([requestDerivationFixture, groupedRequestDerivationFixture])(
    "keeps fully proved current/prior Metric outputs valid",
    async (fixture) => {
      await expect(resolvePostgresqlRequestDerivedBindings(await fixture())).resolves.toHaveLength(
        1,
      );
    },
  );
});

describe.each([
  { name: "period comparison", fixture: requestDerivationFixture },
  { name: "aggregate ratio", fixture: aggregateRatioBindingFixture },
])("request-derived $name relationship closure", ({ fixture }) => {
  it("admits requested relationship metadata from the verified inference receipt", async () => {
    const input = await withRequestedRelationship(await fixture());
    const selected = postgresqlQueryEvidenceSemanticBindingInternals.selectedSemanticObjects(
      input.semantic_context,
    );
    expect(selected.has(requestedRelationship.relationship_id)).toBe(false);
    const proof = await resolvePostgresqlRequestDerivedBindings(input);
    expect(proof).toHaveLength(1);
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns[3]?.semantic_role).toBe("REQUEST_DERIVED");
    expect(
      binding.columns[3]?.physical_sources.every((source) => source.relation_name === "orders"),
    ).toBe(true);
  });

  it("rejects a requested relationship absent from the inference receipt", async () => {
    const input = await withRequestedRelationship(await fixture(), false);
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
      "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
    );
  });

  it("does not turn a metadata grant into a result Dimension", async () => {
    const input = await withRequestedRelationship(await fixture());
    input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
      index === 0
        ? {
            ...column,
            semantic_binding: {
              object_kind: "DIMENSION",
              object_id: requestedRelationship.relationship_id,
            },
          }
        : column,
    );
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow();
  });

  it("still rejects a changed inference receipt without a new exact package", async () => {
    const input = await withRequestedRelationship(await fixture());
    input.semantic_context = {
      ...input.semantic_context,
      package: {
        ...input.semantic_context.package,
        inference_receipt: {
          ...input.semantic_context.package.inference_receipt,
          mandatory_relationship_ids: [],
        },
      },
    };
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow();
  });
});

describe("request-only aggregate ratio binding", () => {
  it.each(["date", "text"] as const)(
    "binds exact complete-month ratio and physical time source for %s",
    async (type) => {
      const input = await aggregateRatioWindowBindingFixture(true, type);
      await expect(resolvePostgresqlRequestDerivedBindings(input)).resolves.toHaveLength(1);
      const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
      expect(binding.time_window).toEqual({
        dimension_id: "dimension.order_month",
        start: "2023-11-01",
        end: "2024-11-01",
        semantics: "HALF_OPEN",
        timezone: "Asia/Shanghai",
      });
      expect(binding.columns[4]?.physical_sources.map((source) => source.column_name)).toEqual([
        "amount",
        "order_date",
        "order_id",
        "spend",
      ]);
      expect(binding.columns[4]?.semantic_role).toBe("REQUEST_DERIVED");
      expect(binding.columns[0]?.semantic_role).toBe("DIMENSION");
    },
  );

  it("keeps the window time lineage when no time column is returned", async () => {
    const input = await aggregateRatioWindowBindingFixture(false);
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.time_window?.dimension_id).toBe("dimension.order_month");
    expect(binding.columns[3]?.physical_sources.map((source) => source.column_name)).toContain(
      "order_date",
    );
  });

  it.each(["not-published", "not-selected", "not-requested"])(
    "rejects an otherwise valid time Dimension that is %s",
    async (variant) => {
      const input = await aggregateRatioWindowBindingFixture();
      const { context_hash: _hash, ...draft } = input.semantic_query_context;
      const timeId = "dimension.order_month";
      if (variant === "not-published") {
        input.semantic_catalog = {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            dimensions: input.semantic_catalog.executable.dimensions.filter(
              (d) => d.dimension_id !== timeId,
            ),
          },
        };
      }
      if (variant === "not-requested")
        draft.requested_object_ids = draft.requested_object_ids.filter((id) => id !== timeId);
      if (variant === "not-selected") {
        // Unit fixture only: preserve the original retrieval/closure receipts;
        // a new published Dimension must not inherit the old selection grant.
        const otherId = "dimension.unselected_month";
        draft.dimensions = draft.dimensions.map((d) =>
          d.dimension_id === timeId ? { ...d, dimension_id: otherId } : d,
        );
        draft.requested_object_ids = draft.requested_object_ids.map((id) =>
          id === timeId ? otherId : id,
        );
        draft.request_scoped_interpretations = draft.request_scoped_interpretations?.map((i) =>
          i.operator.kind === "RECENT_COMPLETE_PERIODS"
            ? {
                ...i,
                source_object_ids: i.source_object_ids.map((id) => (id === timeId ? otherId : id)),
                operator: { ...i.operator, time_dimension_id: otherId },
              }
            : i,
        );
        draft.metrics = draft.metrics.map((m) => ({
          ...m,
          analysis: {
            ...m.analysis,
            allowed_dimension_ids: m.analysis.allowed_dimension_ids.map((id) =>
              id === timeId ? otherId : id,
            ),
          },
        }));
        input.semantic_catalog = {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            dimensions: draft.dimensions,
            metrics: draft.metrics,
          },
        };
        input.candidate.result_columns = input.candidate.result_columns.map((c) =>
          c.semantic_binding.object_id === timeId
            ? { ...c, semantic_binding: { ...c.semantic_binding, object_id: otherId } }
            : c,
        );
        if (input.candidate.time_window) input.candidate.time_window.dimension_id = otherId;
      }
      input.semantic_query_context = await buildSemanticQueryContext(draft);
      await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
        "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
      );
    },
  );

  it.each([
    "missing-window",
    "changed-bound",
    "missing-context-window",
    "second-metric-coverage",
    "second-metric-coverage-unavailable",
    "second-metric-timezone",
    "second-metric-time-column",
    "second-metric-dimension-permission",
  ])("rejects ratio time authority drift: %s", async (variant) => {
    const input = await aggregateRatioWindowBindingFixture();
    if (variant === "missing-window") input.candidate.time_window = null;
    if (variant === "changed-bound") input.candidate.parameters[0] = "2023-12-01";
    const { context_hash: _hash, ...draft } = input.semantic_query_context;
    const metrics = draft.metrics.map((metric) => {
      if (metric.metric_id !== "metric.order_spend") return metric;
      const domain = metric.time_domain;
      if (!domain) throw new Error("TIME_DOMAIN_FIXTURE_REQUIRED");
      return {
        ...metric,
        ...(variant === "second-metric-coverage"
          ? { time_domain: { ...domain, min_time: "2024-01-01T00:00:00.000Z" } }
          : {}),
        ...(variant === "second-metric-coverage-unavailable"
          ? { time_domain: { ...domain, min_time: null, max_time: null } }
          : {}),
        ...(variant === "second-metric-timezone"
          ? { time_domain: { ...domain, timezone: "UTC" } }
          : {}),
        ...(variant === "second-metric-time-column" ? { time_column_id: "other_date" } : {}),
        ...(variant === "second-metric-dimension-permission"
          ? { analysis: { ...metric.analysis, allowed_dimension_ids: ["dimension.channel"] } }
          : {}),
      };
    });
    input.semantic_catalog = {
      ...input.semantic_catalog,
      executable: { ...input.semantic_catalog.executable, metrics },
    };
    input.semantic_query_context = await buildSemanticQueryContext({
      ...draft,
      metrics,
      request_scoped_interpretations:
        variant === "missing-context-window"
          ? draft.request_scoped_interpretations?.filter(
              (i) => i.operator.kind !== "RECENT_COMPLETE_PERIODS",
            )
          : draft.request_scoped_interpretations,
    });
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow();
  });

  it("does not drop an accepted time restriction to use the bounded full-total ratio proof", async () => {
    const input = await aggregateRatioBindingFixture();
    const month = semanticCatalog().executable.dimensions[0];
    if (!month) throw new Error("DIMENSION_FIXTURE_REQUIRED");
    const domain = {
      time_domain_id: "order-time",
      calendar: "gregorian" as const,
      timezone: "Asia/Shanghai",
      min_time: "2023-01-01T00:00:00.000Z",
      max_time: "2024-11-01T00:00:00.000Z",
    };
    const { context_hash: _hash, ...draft } = input.semantic_query_context;
    const metrics = draft.metrics.map((metric) => ({ ...metric, time_domain: domain }));
    input.semantic_catalog = {
      ...input.semantic_catalog,
      executable: {
        ...input.semantic_catalog.executable,
        metrics,
        dimensions: [...input.semantic_catalog.executable.dimensions, month],
      },
    };
    input.semantic_query_context = await buildSemanticQueryContext({
      ...draft,
      metrics,
      time_semantics: [domain],
      dimensions: [...draft.dimensions, month],
      requested_object_ids: [...draft.requested_object_ids, month.dimension_id].sort(),
      request_scoped_interpretations: [
        {
          interpretation_id: "request-scoped.calendar",
          requested_term: "最近12个月",
          scope: "REQUEST_ONLY",
          source_object_ids: [month.dimension_id, "metric.order_revenue"],
          operator: {
            kind: "RECENT_COMPLETE_PERIODS",
            metric_id: "metric.order_revenue",
            time_dimension_id: month.dimension_id,
            period_count: 12,
            period_unit: "MONTH",
            anchor: "PUBLISHED_COMPLETE_FRONTIER",
          },
          user_explanation: "发布边界前12个完整月。",
          publication_effect: "NONE",
        },
        ...(draft.request_scoped_interpretations ?? []),
      ],
    });
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
      "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
    );
  });

  it("keeps empty SUM results nullable even when the physical inputs are NOT NULL", async () => {
    const input = await aggregateRatioBindingFixture(false);
    input.candidate = {
      ...input.candidate,
      sql: input.candidate.sql
        .replace("o.order_id AS channel, ", "")
        .replace(" GROUP BY o.order_id", ""),
      result_columns: input.candidate.result_columns.slice(1),
    };
    input.result = await queryResult(
      [
        { name: "revenue", type: "1700" },
        { name: "spend", type: "1700" },
        { name: "net_roi", type: "1700" },
      ],
      [{ revenue: null, spend: null, net_roi: null }],
    );
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns.map(({ nullable }) => nullable)).toEqual([true, true, true]);
    expect(
      binding.columns
        .flatMap(({ physical_sources }) => physical_sources)
        .every(({ nullable }) => !nullable),
    ).toBe(true);
  });

  it("binds exact accepted net ROI, NULL policy, physical group and two raw published metrics", async () => {
    const input = await aggregateRatioBindingFixture();
    const proof = await resolvePostgresqlRequestDerivedBindings(input);
    expect(proof).toHaveLength(1);
    expect(proof[0]?.dependency_metrics.map((metric) => metric.metric_id)).toEqual([
      "metric.order_revenue",
      "metric.order_spend",
    ]);
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns[3]).toMatchObject({
      semantic_role: "REQUEST_DERIVED",
      semantic_object_id: "request-scoped.net-roi",
      nullable: true,
      aggregate: null,
      request_derivation: {
        semantic_query_context_hash: input.semantic_query_context.context_hash,
        interpretation: {
          operator: {
            kind: "AGGREGATE_RATIO",
            numerator_adjustment: "SUBTRACT_DENOMINATOR",
            zero_denominator: "NULL",
          },
        },
      },
    });
    expect(binding.columns[3]?.physical_sources.map((source) => source.column_name)).toEqual([
      "amount",
      "order_id",
      "spend",
    ]);
    expect(binding.columns.slice(1, 3).map((column) => column.semantic_role)).toEqual([
      "METRIC",
      "METRIC",
    ]);
    expect(binding.columns[3]?.formula_hash).toMatch(/^sha256:/);
  });

  it.each(["METRIC", "FORMULA"] as const)(
    "rejects relabeling as %s before target I/O",
    async (kind) => {
      const input = await aggregateRatioBindingFixture();
      input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
        index === 3
          ? {
              ...column,
              semantic_binding: {
                object_kind: kind,
                object_id: kind === "METRIC" ? "metric.order_revenue" : "formula.roas",
              },
            }
          : column,
      );
      await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow(
        "QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID",
      );
    },
  );

  it.each([
    "sum",
    "null-policy",
    "grain",
    "dependencies",
    "groupable",
    "allowed-dimension",
    "binding",
    "run",
    "receipt",
    "context-hash",
    "snapshot",
    "formula",
    "sql",
  ])("rejects %s drift", async (variant) => {
    const input = await aggregateRatioBindingFixture();
    const { context_hash: _hash, ...draft } = input.semantic_query_context;
    if (
      ["sum", "null-policy", "grain", "dependencies", "allowed-dimension", "formula"].includes(
        variant,
      )
    ) {
      draft.metrics = draft.metrics.map((metric, index) =>
        index === 0
          ? {
              ...metric,
              ...(variant === "sum" ? { aggregation: "avg" as const } : {}),
              ...(variant === "null-policy" ? { null_policy: "coalesce-zero" as const } : {}),
              ...(variant === "grain"
                ? { grain: { grain_id: "different", granularity: "day" as const } }
                : {}),
              ...(variant === "dependencies" ? { dependency_column_ids: ["amount", "spend"] } : {}),
              ...(variant === "allowed-dimension"
                ? { analysis: { ...metric.analysis, allowed_dimension_ids: [] } }
                : {}),
              ...(variant === "formula"
                ? {
                    formula: {
                      formula_id: "formula.roas",
                      expression: "ratio",
                      dialect: "text2sql" as const,
                      description: "wrong formula",
                    },
                  }
                : {}),
            }
          : metric,
      );
      // Keep the declared catalog aligned to exercise actual semantic checks, not only content equality.
      input.semantic_catalog.executable.metrics = draft.metrics;
    }
    if (variant === "groupable") {
      draft.dimensions = draft.dimensions.map((dimension) => ({
        ...dimension,
        analysis: { ...dimension.analysis, groupable: false },
      }));
      input.semantic_catalog.executable.dimensions =
        input.semantic_catalog.executable.dimensions.map((dimension) => ({
          ...dimension,
          analysis: { ...dimension.analysis, groupable: false },
        }));
    }
    if (variant === "binding")
      draft.physical_bindings = draft.physical_bindings.map((binding) => ({
        ...binding,
        valid_until: "2024-01-01",
      }));
    if (variant === "run") draft.run_id = id(90);
    if (variant === "receipt")
      draft.semantic_context_ref = { ...draft.semantic_context_ref, receipt_hash: hash("0") };
    if (variant === "formula")
      draft.formulas = [formulaNodeSchema.parse(input.semantic_catalog.executable.formulas[0])];
    input.semantic_query_context = await buildSemanticQueryContext(draft);
    if (variant === "context-hash")
      input.semantic_query_context = { ...input.semantic_query_context, context_hash: hash("f") };
    if (variant === "snapshot")
      input.physical_snapshot = { ...input.physical_snapshot, snapshot_content_hash: hash("0") };
    if (variant === "sql")
      input.candidate.sql = input.candidate.sql.replace(
        "(SUM(o.amount)-SUM(o.spend))",
        "SUM(o.amount)",
      );
    await expect(resolvePostgresqlRequestDerivedBindings(input)).rejects.toThrow();
  });
});

describe("PostgreSQL QueryEvidence semantic binding", () => {
  it.each(["orders.order_date", "column.orders.order_date"])(
    "resolves a selected cross-table Metric time source %s without rejecting ordinary row queries",
    async (timeColumnId) => {
      const input = await fixture("text");
      const metric = input.semantic_catalog.executable.metrics[0];
      if (!metric) throw new Error("METRIC_FIXTURE_REQUIRED");
      const crossTable = {
        ...input,
        semantic_catalog: {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            metrics: [{ ...metric, table_id: "deliveries", time_column_id: timeColumnId }],
            dimensions: [],
            physical_bindings: [
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
        },
      };
      await expect(
        assertPostgresqlQueryTemporalSelection({
          ...crossTable,
          candidate: {
            ...input.candidate,
            sql: "select o.order_id as order_id from public.orders as o order by o.order_date::pg_catalog.date desc limit $1",
            parameters: [10],
            time_window: null,
          },
        }),
      ).resolves.toBeUndefined();
      // No selected time Dimension, no SQL cast: the published cross-table source still
      // identifies a hidden text-backed time filter. It does not grant a time window.
      await expect(
        assertPostgresqlQueryTemporalSelection({
          ...crossTable,
          candidate: {
            ...input.candidate,
            sql: "select o.order_id as order_id from public.orders as o where o.order_date >= $1",
            parameters: ["2026-01-01"],
            time_window: null,
          },
        }),
      ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" });
      const binding = crossTable.semantic_catalog.executable.physical_bindings[0];
      if (!binding) throw new Error("BINDING_FIXTURE_REQUIRED");
      for (const physicalBindings of [
        [],
        [{ ...binding, datasource_id: id(99) }],
        [{ ...binding, logical_object_id: "column.deliveries.order_date" }],
        [{ ...binding, binding_lifecycle: "deprecated" as const }],
      ]) {
        await expect(
          assertPostgresqlQueryTemporalSelection({
            ...crossTable,
            candidate: { ...input.candidate, time_window: null },
            semantic_catalog: {
              ...crossTable.semantic_catalog,
              executable: {
                ...crossTable.semantic_catalog.executable,
                physical_bindings: physicalBindings,
              },
            },
          }),
        ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID" });
      }
      await expect(
        assertPostgresqlQueryTemporalSelection({
          ...crossTable,
          candidate: { ...input.candidate, time_window: null },
          semantic_catalog: {
            ...crossTable.semantic_catalog,
            executable: {
              ...crossTable.semantic_catalog.executable,
              physical_bindings: [{ ...binding, schema_name: "other" }],
            },
          },
        }),
      ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_PHYSICAL_BINDING_STALE" });
    },
  );

  it.each(["date", "text"] as const)(
    "rejects an undeclared temporal selection on a %s source",
    async (physicalType) => {
      const input = await fixture(physicalType);
      if (physicalType === "text") {
        input.candidate.sql = input.candidate.sql.replaceAll(
          "o.order_date",
          "o.order_date::timestamp",
        );
      }
      await expect(
        buildPostgresqlQueryEvidenceSemanticBinding({
          ...input,
          candidate: { ...input.candidate, time_window: null },
        }),
      ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" });
    },
  );

  it("uses a selected Metric's physical relation to identify a text time column without granting a time Dimension", async () => {
    const input = await fixture("text");
    await expect(
      assertPostgresqlQueryTemporalSelection({
        ...input,
        candidate: { ...input.candidate, time_window: null },
        semantic_catalog: {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            dimensions: [],
            physical_bindings: input.semantic_catalog.executable.physical_bindings.filter(
              (binding) => binding.column_name !== "order_date",
            ),
          },
        },
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" });
  });

  it("does not accept a correctly bound Formula with a hidden time restriction", async () => {
    const input = await formulaFixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          sql: `${input.candidate.sql} where o.order_date >= $2 and o.order_date < $3`,
          parameters: [0, "2026-01-01", "2026-03-01"],
        },
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_WINDOW_REQUIRED" });
  });

  it("proves a standalone published Formula before execution and retains its exact authority in evidence", async () => {
    const input = await formulaFixture();
    const proof = await resolvePostgresqlPublishedFormulaBindings(input);
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding(input);
    expect(binding.columns).toEqual(proof.map(({ column }) => column));
    expect(binding.columns).toMatchObject([
      {
        semantic_role: "FORMULA",
        semantic_object_id: "formula.roas",
        aggregate: null,
        formula_hash: expect.stringMatching(/^sha256:/u),
        physical_sources: [{ column_name: "amount" }, { column_name: "spend" }],
      },
    ]);
    expect(binding.time_window).toBeNull();
    expect(proof[0]?.dependency_metrics.map(({ metric_id }) => metric_id)).toEqual([
      "metric.order_revenue",
      "metric.order_spend",
    ]);
    const reversed = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      semantic_catalog: {
        ...input.semantic_catalog,
        executable: {
          ...input.semantic_catalog.executable,
          metrics: [...input.semantic_catalog.executable.metrics].reverse(),
          physical_bindings: [...input.semantic_catalog.executable.physical_bindings].reverse(),
        },
      },
    });
    expect(reversed.binding_hash).toBe(binding.binding_hash);
  });

  it.each([
    ["expression", "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH"],
    ["unselected formula", "QUERY_EVIDENCE_FORMULA_BINDING_INVALID"],
    ["unselected dependency", "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH"],
    ["cross grain", "QUERY_EVIDENCE_FORMULA_BINDING_INVALID"],
    ["missing physical binding", "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID"],
  ])(
    "rejects invalid Formula %s both before I/O and during evidence acceptance",
    async (change, code) => {
      const input = await formulaFixture();
      if (change === "expression")
        input.candidate.sql = input.candidate.sql.replace("sum(o.amount)", "avg(o.amount)");
      if (change === "unselected formula")
        input.semantic_context = await semanticContext(input.physical_snapshot, [
          "metric.order_spend",
        ]);
      if (change === "unselected dependency")
        input.semantic_context = await semanticContext(input.physical_snapshot, ["formula.roas"]);
      if (change === "cross grain")
        input.semantic_catalog = {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            metrics: input.semantic_catalog.executable.metrics.map((metric) =>
              metric.metric_id === "metric.order_spend"
                ? { ...metric, grain: { grain_id: "other-grain", granularity: "day" } }
                : metric,
            ),
          },
        };
      if (change === "missing physical binding")
        input.semantic_catalog = {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            physical_bindings: input.semantic_catalog.executable.physical_bindings.filter(
              ({ logical_object_id }) => logical_object_id !== "metric.order_spend",
            ),
          },
        };
      await expect(resolvePostgresqlPublishedFormulaBindings(input)).rejects.toMatchObject({
        code,
      });
      await expect(buildPostgresqlQueryEvidenceSemanticBinding(input)).rejects.toMatchObject({
        code,
      });
    },
  );

  it("never borrows a Formula dependency excluded by the accepted query context", async () => {
    const input = {
      ...(await formulaFixture()),
      formula_dependency_metric_ids: ["metric.order_revenue"],
    };
    await expect(resolvePostgresqlPublishedFormulaBindings(input)).rejects.toMatchObject({
      code: "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH",
    });
    await expect(buildPostgresqlQueryEvidenceSemanticBinding(input)).rejects.toMatchObject({
      code: "TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH",
    });
  });

  it("binds selected row-level physical columns to the exact published binding and snapshot", async () => {
    const input = await fixture();
    const physicalCandidate: Text2SqlQueryCandidate = {
      schema_version: "text2sql-query-candidate@1.0.0",
      sql: "select o.order_id as order_id, o.order_date as order_date, o.amount as order_amount from public.orders o order by o.order_date desc limit $1",
      parameters: [10],
      result_columns: [
        {
          name: "order_id",
          semantic_type: "STRING",
          label: "订单编号",
          semantic_binding: {
            object_kind: "PHYSICAL_COLUMN",
            object_id: "column.orders.order_id",
          },
        },
        {
          name: "order_date",
          semantic_type: "DATE",
          label: "下单日期",
          semantic_binding: {
            object_kind: "PHYSICAL_COLUMN",
            object_id: "column.orders.order_date",
          },
        },
        {
          name: "order_amount",
          semantic_type: "NUMBER",
          label: "订单金额",
          semantic_binding: {
            object_kind: "PHYSICAL_COLUMN",
            object_id: "column.orders.amount",
          },
        },
      ],
      time_window: null,
      presentation: {
        title: "最近 10 笔订单",
        summary: "按下单日期倒序返回 10 笔订单。",
        visualization: "TABLE",
        x_key: null,
        y_keys: [],
      },
    };

    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: physicalCandidate,
      result: await queryResult([
        { name: "order_id", type: "25" },
        { name: "order_date", type: "1082" },
        { name: "order_amount", type: "1700" },
      ]),
    });

    expect(binding.columns).toMatchObject([
      {
        semantic_role: "PHYSICAL_COLUMN",
        semantic_object_id: "column.orders.order_id",
        logical_type: "STRING",
        aggregate: null,
        formula_hash: null,
      },
      {
        semantic_role: "PHYSICAL_COLUMN",
        semantic_object_id: "column.orders.order_date",
        logical_type: "DATE",
        aggregate: null,
        formula_hash: null,
      },
      {
        semantic_role: "PHYSICAL_COLUMN",
        semantic_object_id: "column.orders.amount",
        logical_type: "NUMBER",
        aggregate: null,
        formula_hash: null,
      },
    ]);
  });

  it("binds a selected text-backed physical date only through an explicit temporal cast", async () => {
    const input = await fixture("text");
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: {
        schema_version: "text2sql-query-candidate@1.0.0",
        sql: "select o.order_date::pg_catalog.date as order_date from public.orders o order by o.order_date::pg_catalog.timestamp desc limit $1",
        parameters: [10],
        result_columns: [
          {
            name: "order_date",
            semantic_type: "DATE",
            label: "下单日期",
            semantic_binding: {
              object_kind: "PHYSICAL_COLUMN",
              object_id: "column.orders.order_date",
            },
          },
        ],
        time_window: null,
        presentation: {
          title: "最近订单日期",
          summary: "按下单日期倒序。",
          visualization: "TABLE",
          x_key: null,
          y_keys: [],
        },
      },
      result: await queryResult([{ name: "order_date", type: "1082" }]),
    });

    expect(binding.columns[0]).toMatchObject({
      semantic_role: "PHYSICAL_COLUMN",
      semantic_object_id: "column.orders.order_date",
      logical_type: "DATE",
    });
  });

  it("rejects an uncast text-backed physical date declaration", async () => {
    const input = await fixture("text");
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          schema_version: "text2sql-query-candidate@1.0.0",
          sql: "select o.order_date as order_date from public.orders o order by o.order_date desc limit $1",
          parameters: [10],
          result_columns: [
            {
              name: "order_date",
              semantic_type: "DATE",
              label: "下单日期",
              semantic_binding: {
                object_kind: "PHYSICAL_COLUMN",
                object_id: "column.orders.order_date",
              },
            },
          ],
          time_window: null,
          presentation: {
            title: "最近订单日期",
            summary: "按下单日期倒序。",
            visualization: "TABLE",
            x_key: null,
            y_keys: [],
          },
        },
        result: await queryResult([{ name: "order_date", type: "1082" }]),
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID" });
  });

  it("rejects a computed expression masquerading as a row-level physical column", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          schema_version: "text2sql-query-candidate@1.0.0",
          sql: "select o.amount * $1 as order_amount from public.orders o",
          parameters: [2],
          result_columns: [
            {
              name: "order_amount",
              semantic_type: "NUMBER",
              label: "订单金额",
              semantic_binding: {
                object_kind: "PHYSICAL_COLUMN",
                object_id: "column.orders.amount",
              },
            },
          ],
          time_window: null,
          presentation: {
            title: "订单金额",
            summary: "订单金额明细。",
            visualization: "TABLE",
            x_key: null,
            y_keys: [],
          },
        },
        result: await queryResult([{ name: "order_amount", type: "1700" }]),
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID" });
  });

  it("rejects an unselected physical column even when it exists in the release", async () => {
    const input = await fixture();
    const revenueColumn = input.candidate.result_columns[1];
    if (!revenueColumn) throw new TypeError("TEST_REVENUE_COLUMN_REQUIRED");
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          result_columns: [
            {
              name: "order_month",
              semantic_type: "DATE",
              label: "月份",
              semantic_binding: {
                object_kind: "PHYSICAL_COLUMN",
                object_id: "column.orders.unselected",
              },
            },
            revenueColumn,
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED" });
  });

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

  it("coalesces object and column bindings that resolve to the same published physical source", async () => {
    const input = await fixture();
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      semantic_catalog: {
        ...input.semantic_catalog,
        executable: {
          ...input.semantic_catalog.executable,
          physical_bindings: [
            ...input.semantic_catalog.executable.physical_bindings,
            {
              logical_object_id: "dimension.order_month",
              logical_object_type: "dimension" as const,
              datasource_id: datasourceId,
              schema_name: "public",
              table_name: "orders",
              column_name: "order_date",
              binding_lifecycle: "active" as const,
              valid_from: null,
              valid_until: null,
            },
            {
              logical_object_id: "metric.order_revenue",
              logical_object_type: "metric" as const,
              datasource_id: datasourceId,
              schema_name: "public",
              table_name: "orders",
              column_name: "amount",
              binding_lifecycle: "active" as const,
              valid_from: null,
              valid_until: null,
            },
          ],
        },
      },
    });

    expect(binding.columns.map(({ physical_sources: sources }) => sources)).toEqual([
      [
        expect.objectContaining({
          schema_name: "public",
          relation_name: "orders",
          column_name: "order_date",
        }),
      ],
      [
        expect.objectContaining({
          schema_name: "public",
          relation_name: "orders",
          column_name: "amount",
        }),
      ],
    ]);
  });

  it("binds a text-backed temporal dimension only through explicit governed temporal casts", async () => {
    const input = await fixture("text");
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: {
        ...input.candidate,
        sql: "select date_trunc('month', o.order_date::pg_catalog.timestamp)::pg_catalog.date as order_month, sum(o.amount) as revenue from public.orders o where o.order_date::pg_catalog.timestamp >= $1::pg_catalog.timestamp and o.order_date::pg_catalog.timestamp < $2::pg_catalog.timestamp group by 1 order by 1",
      },
    });

    expect(binding.columns[0]).toMatchObject({
      logical_type: "DATE",
      semantic_role: "DIMENSION",
      semantic_object_id: "dimension.order_month",
      physical_sources: [
        expect.objectContaining({
          schema_name: "public",
          relation_name: "orders",
          column_name: "order_date",
        }),
      ],
    });
    expect(binding.time_window).toMatchObject({
      dimension_id: "dimension.order_month",
      semantics: "HALF_OPEN",
    });
  });

  it("binds a governed timestamp month bucket for a published date dimension", async () => {
    const input = await fixture("text");
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: {
        ...input.candidate,
        sql: "select date_trunc('month', o.order_date::pg_catalog.timestamp) as order_month, sum(o.amount) as revenue from public.orders o where o.order_date::pg_catalog.timestamp >= $1::pg_catalog.timestamp and o.order_date::pg_catalog.timestamp < $2::pg_catalog.timestamp group by 1 order by 1",
        result_columns: input.candidate.result_columns.map((column, index) =>
          index === 0 ? { ...column, semantic_type: "DATETIME" as const } : column,
        ),
      },
      result: await queryResult([
        { name: "order_month", type: "1114" },
        { name: "revenue", type: "1700" },
      ]),
    });

    expect(binding.columns[0]).toMatchObject({
      logical_type: "DATETIME",
      semantic_role: "DIMENSION",
      semantic_object_id: "dimension.order_month",
    });
  });

  it("binds canonical deparsed temporal parameter casts to the half-open window", async () => {
    const input = await fixture("text");
    const binding = await buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: {
        ...input.candidate,
        sql: "SELECT date_trunc($3, o.order_date::timestamp) AS order_month, sum(o.amount) AS revenue FROM public.orders AS o WHERE o.order_date::timestamp >= CAST($1 AS timestamp) AND o.order_date::timestamp < CAST($2 AS timestamp) GROUP BY date_trunc($3, o.order_date::timestamp) ORDER BY order_month",
        parameters: [...input.candidate.parameters, "month"],
        result_columns: input.candidate.result_columns.map((column, index) =>
          index === 0 ? { ...column, semantic_type: "DATETIME" as const } : column,
        ),
      },
      result: await queryResult([
        { name: "order_month", type: "1114" },
        { name: "revenue", type: "1700" },
      ]),
    });

    expect(binding.time_window).toEqual({
      dimension_id: "dimension.order_month",
      start: "2026-01-01",
      end: "2026-03-01",
      semantics: "HALF_OPEN",
      timezone: "Asia/Shanghai",
    });
  });

  it("rejects date-to-datetime widening without a governed temporal bucket", async () => {
    const input = await fixture("text");

    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        candidate: {
          ...input.candidate,
          sql: "select o.order_date::pg_catalog.timestamp as order_month, sum(o.amount) as revenue from public.orders o where o.order_date::pg_catalog.timestamp >= $1::pg_catalog.timestamp and o.order_date::pg_catalog.timestamp < $2::pg_catalog.timestamp group by 1 order by 1",
          result_columns: input.candidate.result_columns.map((column, index) =>
            index === 0 ? { ...column, semantic_type: "DATETIME" as const } : column,
          ),
        },
        result: await queryResult([
          { name: "order_month", type: "1114" },
          { name: "revenue", type: "1700" },
        ]),
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_DIMENSION_BINDING_INVALID" });
  });

  it("rejects an uncast text-backed temporal dimension", async () => {
    const input = await fixture("text");

    await expect(buildPostgresqlQueryEvidenceSemanticBinding(input)).rejects.toMatchObject({
      code: "QUERY_EVIDENCE_DIMENSION_BINDING_INVALID",
    });
  });

  it.each([
    ["25", "STRING"],
    ["1114", "DATETIME"],
    ["1184", "DATETIME"],
  ])("reports only observed logical types for a contradicting result OID %s", async (oid, type) => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        result: await queryResult([
          { name: "order_month", type: oid },
          { name: "revenue", type: "1700" },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH",
      observed_result_types: [type, "NUMBER"],
    });
  });

  it("rejects a result name that contradicts the declared output binding", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        result: await queryResult([
          { name: "unexpected_month", type: "1082" },
          { name: "revenue", type: "1700" },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH",
      observed_result_types: undefined,
    });
  });

  it("keeps unsupported PostgreSQL result types fail-closed without repair type feedback", async () => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        result: await queryResult([
          { name: "order_month", type: "3802" },
          { name: "revenue", type: "1700" },
        ]),
      }),
    ).rejects.toMatchObject({
      code: "QUERY_EVIDENCE_RESULT_TYPE_UNSUPPORTED",
      observed_result_types: undefined,
    });
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

  it.each([
    { start: "2026-01-01", end: "2026-04-01", accepted: false },
    { start: "2025-12-01", end: "2026-03-01", accepted: false },
    { start: "2026-01-01", end: "2026-03-01", accepted: true },
    { start: "2026-01-15", end: "2026-02-15", accepted: true },
  ])("checks published half-open coverage for $start to $end", async ({ start, end, accepted }) => {
    const input = await fixture();
    const result = buildPostgresqlQueryEvidenceSemanticBinding({
      ...input,
      candidate: { ...input.candidate, parameters: [start, end] },
      semantic_catalog: {
        ...input.semantic_catalog,
        executable: {
          ...input.semantic_catalog.executable,
          metrics: input.semantic_catalog.executable.metrics.map((metric) => ({
            ...metric,
            time_domain: {
              ...metric.time_domain,
              min_time: "2026-01-01T08:00:00.000+08:00",
              max_time: "2026-03-01T00:00:00.000Z",
            },
          })),
        },
      },
    });
    if (accepted) {
      await expect(result).resolves.toMatchObject({ time_window: { start, end } });
    } else {
      await expect(result).rejects.toMatchObject({
        code: "QUERY_EVIDENCE_TIME_WINDOW_OUT_OF_RANGE",
      });
    }
  });

  it.each([
    { min_time: "invalid", max_time: null },
    { min_time: null, max_time: "invalid" },
    { min_time: "2026-03-01", max_time: "2026-01-01" },
  ])("fails closed for malformed published time bounds %j", async (bounds) => {
    const input = await fixture();
    await expect(
      buildPostgresqlQueryEvidenceSemanticBinding({
        ...input,
        semantic_catalog: {
          ...input.semantic_catalog,
          executable: {
            ...input.semantic_catalog.executable,
            metrics: input.semantic_catalog.executable.metrics.map((metric) => ({
              ...metric,
              time_domain: { ...metric.time_domain, ...bounds },
            })),
          },
        },
      }),
    ).rejects.toMatchObject({ code: "QUERY_EVIDENCE_TIME_DOMAIN_INVALID" });
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
