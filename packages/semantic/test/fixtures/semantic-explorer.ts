import {
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  type SemanticExplorerRawSourceEnvelope,
  type SemanticSourceBundle,
  sha256ContentHash,
  U5_EXECUTABLE_SUBSET,
} from "@data-agent/contracts";
import { compileU5Projection } from "../../src/compiler/u5-compiler.js";

export const explorerIds = {
  bundle: "00000000-0000-4000-8000-000000000001",
  app: "00000000-0000-4000-8000-000000000002",
  tenant: "00000000-0000-4000-8000-000000000003",
  datasource: "00000000-0000-4000-8000-000000000004",
  release: "00000000-0000-4000-8000-000000000005",
  executableProjection: "00000000-0000-4000-8000-000000000006",
  relationshipProjection: "00000000-0000-4000-8000-000000000007",
  restrictionProjection: "00000000-0000-4000-8000-000000000008",
  candidate: "00000000-0000-4000-8000-000000000009",
} as const;

const grain = { grain_id: "grain-order", granularity: "atomic" as const };
const unit = {
  unit_id: "unit-usd",
  dimension: "currency" as const,
  base_unit: null,
  conversion_factor: null,
};

function metric(
  metricId: string,
  formulaId: string,
  columnId: string,
  dependencyColumnIds: string[],
) {
  return {
    metric_id: metricId,
    name: metricId,
    aliases: [metricId],
    table_id: "orders",
    column_id: columnId,
    aggregation: "sum" as const,
    formula: {
      formula_id: formulaId,
      expression: `SUM(${columnId})`,
      dialect: "text2sql" as const,
    },
    grain,
    unit,
    time_domain: null,
    time_column_id: null,
    additivity: "additive" as const,
    null_policy: "coalesce-zero" as const,
    fanout_policy: "preaggregate" as const,
    dependency_column_ids: dependencyColumnIds,
    tags: [] as string[],
    analysis: {
      primary: metricId === "metric-gross",
      priority: metricId === "metric-gross" ? 0 : 1,
      missing_period_policy: "NULL" as const,
      seasonality: null,
      allowed_dimension_ids: ["dimension-region"],
      capabilities: [] as ("DATA_PROFILE" | "CHART_DATASET")[],
      causal_role: null,
    },
  };
}

export function createCompleteSemanticSourceBundle(
  runtimeAction: "DENY" | "RESTRICT" = "RESTRICT",
): SemanticSourceBundle {
  const gross = metric("metric-gross", "formula-gross", "orders.amount", ["orders.amount"]);
  const cost = metric("metric-cost", "formula-cost", "orders.cost", ["orders.cost"]);
  const margin = metric("metric-margin", "formula-margin", "orders.margin", [
    "orders.gross",
    "orders.cost",
  ]);

  return {
    metadata: {
      bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
      capability_profile: U5_EXECUTABLE_SUBSET,
      bundle_id: explorerIds.bundle,
      scope: {
        app_id: explorerIds.app,
        tenant_id: explorerIds.tenant,
        environment: "test",
      },
      producer: { kind: "deterministic", id: "semantic-explorer-fixture" },
      authority: {
        kind: "deterministic",
        id: "semantic-authority",
        policy_version: "semantic-authority@2.0.0",
      },
      authority_envelope: {
        kind: "PUBLISHED",
        release_id: explorerIds.release,
        release_revision: 7,
        released_at: "2026-08-09T00:00:00.000Z",
      },
      created_at: "2026-08-09T00:00:00.000Z",
    },
    formulas: [
      {
        formula_id: "formula-gross",
        formula_type: "additive_aggregate",
        return_type: "numeric",
        grain,
        unit,
        time_domain: null,
        additivity: "additive",
        cardinality: "scalar",
        null_policy: "coalesce-zero",
        dependency_formula_ids: [],
      },
      {
        formula_id: "formula-cost",
        formula_type: "additive_aggregate",
        return_type: "numeric",
        grain,
        unit,
        time_domain: null,
        additivity: "additive",
        cardinality: "scalar",
        null_policy: "coalesce-zero",
        dependency_formula_ids: [],
      },
      {
        formula_id: "formula-margin",
        formula_type: "additive_aggregate",
        return_type: "numeric",
        grain,
        unit,
        time_domain: null,
        additivity: "additive",
        cardinality: "scalar",
        null_policy: "coalesce-zero",
        dependency_formula_ids: ["formula-gross", "formula-cost"],
      },
    ],
    metrics: [gross, cost, margin],
    dimensions: [
      {
        dimension_id: "dimension-region",
        name: "Region",
        aliases: ["region"],
        table_id: "customers",
        column_id: "customers.region",
        grain,
        data_type: "text",
        sensitivity: "PUBLIC",
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        analysis: { groupable: true, pivotable: true, causal_role: null },
      },
    ],
    relationships: [
      {
        relationship_id: "relationship-orders-customers",
        name: "Orders to customers",
        kind: "analytical",
        left_table_id: "orders",
        left_column_ids: ["orders.customer_id"],
        right_table_id: "customers",
        right_column_ids: ["customers.id"],
        cardinality: "many-to-one",
        left_row_preservation: "required",
        right_row_preservation: "optional",
        proof_kind: "DDL_ENFORCED",
        proof_detail: "orders.customer_id references customers.id",
        tags: [],
        analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] },
      },
    ],
    business_ontology: {
      domain: "sales",
      owner: "analytics",
      lifecycle: "active",
      entities: [
        {
          entity_id: "entity-order",
          name: "Order",
          aliases: ["purchase"],
          domain: "sales",
          owner: "commerce",
          lifecycle: "active",
          business_relationship_types: [
            {
              relationship_type: "placed_by",
              target_entity_id: "entity-customer",
            },
          ],
        },
        {
          entity_id: "entity-customer",
          name: "Customer",
          aliases: [],
          domain: "sales",
          owner: "commerce",
          lifecycle: "deprecated",
          business_relationship_types: [
            {
              relationship_type: "places",
              target_entity_id: "entity-order",
            },
          ],
        },
      ],
      events: [
        {
          event_id: "event-order-placed",
          name: "Order placed",
          domain: "sales",
          subject_entity_id: "entity-order",
          event_type: "order_placed",
        },
      ],
      terms: [
        {
          term_id: "term-revenue",
          name: "Revenue",
          definition: "Gross value before costs.",
          domain: "sales",
          aliases: ["sales"],
        },
      ],
    },
    physical_binding: {
      default_datasource_id: explorerIds.datasource,
      entries: [
        {
          logical_object_id: "metric-margin",
          logical_object_type: "metric",
          datasource_id: explorerIds.datasource,
          schema_name: "public",
          table_name: "orders",
          column_name: "margin",
          binding_lifecycle: "active",
          valid_from: null,
          valid_until: null,
        },
        {
          logical_object_id: "dimension-region",
          logical_object_type: "dimension",
          datasource_id: explorerIds.datasource,
          schema_name: "public",
          table_name: "customers",
          column_name: "region",
          binding_lifecycle: "active",
          valid_from: null,
          valid_until: null,
        },
        {
          logical_object_id: "relationship-orders-customers",
          logical_object_type: "relationship",
          datasource_id: explorerIds.datasource,
          schema_name: "public",
          table_name: "orders",
          column_name: "customer_id",
          binding_lifecycle: "deprecated",
          valid_from: null,
          valid_until: null,
        },
      ],
    },
    catalog_governance: {
      tables: [
        {
          table_id: "orders",
          table_name: "orders",
          columns: [
            {
              column_id: "orders.amount",
              nullable: false,
              data_type: "numeric",
              constraint_refs: [],
            },
            {
              column_id: "orders.cost",
              nullable: false,
              data_type: "numeric",
              constraint_refs: [],
            },
            {
              column_id: "orders.margin",
              nullable: false,
              data_type: "numeric",
              constraint_refs: [],
            },
          ],
          snapshot_currentness: {
            snapshot_timestamp: "2026-08-09T00:00:00.000Z",
            staleness_threshold_seconds: 3600,
          },
          catalog_fence: "catalog@7",
        },
        {
          table_id: "customers",
          table_name: "customers",
          columns: [
            {
              column_id: "customers.region",
              nullable: true,
              data_type: "text",
              constraint_refs: [],
            },
          ],
          snapshot_currentness: {
            snapshot_timestamp: "2026-08-09T00:00:00.000Z",
            staleness_threshold_seconds: 3600,
          },
          catalog_fence: "catalog@7",
        },
      ],
      data_quality_oracle_refs: [],
    },
    runtime_authorization: {
      table_rules: [
        {
          table_id: "orders",
          action: runtimeAction,
          column_ids: ["orders.amount"],
          predicates: [
            {
              table_id: "orders",
              column_id: "orders.region_id",
              operator: "eq",
              parameter_key: "private-region-parameter",
            },
          ],
        },
      ],
    },
  };
}

export async function createRawExplorerEnvelope(options?: {
  readonly sourceKind?: "ACTIVE" | "HISTORICAL";
  readonly includeSidecar?: boolean;
  readonly runtimeAction?: "DENY" | "RESTRICT";
}): Promise<SemanticExplorerRawSourceEnvelope> {
  const projection = await compileU5Projection(
    createCompleteSemanticSourceBundle(options?.runtimeAction),
    "catalog@7",
  );
  const semanticPayload =
    options?.includeSidecar === false
      ? (({ explorer_sidecar: _sidecar, ...historical }) => historical)(projection.semantic)
      : projection.semantic;
  const executableDigest = await sha256ContentHash(semanticPayload);
  const relationshipDigest = await sha256ContentHash(projection.relationship);
  const restrictionDigest = await sha256ContentHash(projection.restriction);
  const releaseDigest = await sha256ContentHash({
    release_id: explorerIds.release,
    executableDigest,
    relationshipDigest,
    restrictionDigest,
  });
  const sourceKind = options?.sourceKind ?? "ACTIVE";

  return {
    source_kind: sourceKind,
    observed_at: "2026-08-09T00:02:00.000Z",
    pointer: {
      semantic_domain: "sales",
      current_release_id:
        sourceKind === "ACTIVE" ? explorerIds.release : "00000000-0000-4000-8000-000000000099",
      current_release_generation: sourceKind === "ACTIVE" ? 7 : 8,
      current_release_digest: sourceKind === "ACTIVE" ? releaseDigest : `sha256:${"9".repeat(64)}`,
      pointer_generation: 11,
      updated_at: "2026-08-09T00:01:00.000Z",
    },
    release: {
      semantic_domain: "sales",
      release_id: explorerIds.release,
      release_generation: 7,
      release_digest: releaseDigest,
      compiler_bundle_digest: projection.bundleHash as `sha256:${string}`,
      candidate_id: explorerIds.candidate,
      executable_projection_ref: explorerIds.executableProjection,
      executable_projection_hash: executableDigest,
      relationship_projection_ref: explorerIds.relationshipProjection,
      relationship_projection_hash: relationshipDigest,
      runtime_restriction_projection_ref: explorerIds.restrictionProjection,
      runtime_restriction_projection_hash: restrictionDigest,
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: "reviewer@example.com",
    },
    executable_projection: {
      projection_id: explorerIds.executableProjection,
      release_id: explorerIds.release,
      projection_digest: executableDigest,
      projection_payload: semanticPayload,
    },
    relationship_projection: {
      projection_id: explorerIds.relationshipProjection,
      release_id: explorerIds.release,
      datasource_id: explorerIds.datasource,
      catalog_epoch: 7,
      projection_digest: relationshipDigest,
      projection_payload: projection.relationship,
    },
    runtime_restriction_projection: {
      projection_id: explorerIds.restrictionProjection,
      release_id: explorerIds.release,
      pointer_generation: 11,
      projection_digest: restrictionDigest,
      projection_payload: projection.restriction,
    },
  };
}

export function createDeterministicTenThousandMetricBundle(): SemanticSourceBundle {
  const base = createCompleteSemanticSourceBundle();
  const metrics = Array.from({ length: 10_000 }, (_, index) => {
    const suffix = index.toString().padStart(5, "0");
    return metric(
      `metric-benchmark-${suffix}`,
      `formula-benchmark-${suffix}`,
      `orders.value_${suffix}`,
      [`orders.value_${suffix}`],
    );
  });
  const formulas = Array.from({ length: 100 }, (_, index) => {
    const suffix = index.toString().padStart(5, "0");
    const previous = (index - 1).toString().padStart(5, "0");
    return {
      formula_id: `formula-benchmark-${suffix}`,
      formula_type: "additive_aggregate" as const,
      return_type: "numeric" as const,
      grain,
      unit,
      time_domain: null,
      additivity: "additive" as const,
      cardinality: "scalar" as const,
      null_policy: "coalesce-zero" as const,
      dependency_formula_ids: index === 0 ? [] : [`formula-benchmark-${previous}`],
    };
  });
  const bindingEntries = metrics.map((benchmarkMetric, index) => {
    const suffix = index.toString().padStart(5, "0");
    return {
      logical_object_id: benchmarkMetric.metric_id,
      logical_object_type: "metric" as const,
      datasource_id: explorerIds.datasource,
      schema_name: "public",
      table_name: "orders",
      column_name: `value_${suffix}`,
      binding_lifecycle: "active" as const,
      valid_from: null,
      valid_until: null,
    };
  });
  return {
    ...base,
    formulas,
    metrics,
    dimensions: [],
    relationships: [],
    business_ontology: undefined,
    physical_binding: {
      default_datasource_id: explorerIds.datasource,
      entries: bindingEntries,
    },
    catalog_governance: {
      tables: [
        {
          table_id: "orders",
          table_name: "orders",
          columns: metrics.map((_, index) => {
            const suffix = index.toString().padStart(5, "0");
            return {
              column_id: `orders.value_${suffix}`,
              nullable: false,
              data_type: "numeric",
              constraint_refs: [],
            };
          }),
          snapshot_currentness: {
            snapshot_timestamp: "2026-08-09T00:00:00.000Z",
            staleness_threshold_seconds: 3600,
          },
          catalog_fence: "catalog@benchmark",
        },
      ],
      data_quality_oracle_refs: [],
    },
    runtime_authorization: undefined,
  };
}
