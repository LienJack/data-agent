import {
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
  type SemanticContextCommitResult,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  compilePublishedAnalysisContext,
  PublishedAnalysisContextCompilationError,
} from "../src/analysis/published-context-compiler.js";

const id = (suffix: number) => `91000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const releaseId = id(4);
const releaseHash = hash("b");
const grain = { grain_id: "order-month", granularity: "month" as const };
const timeDomain = {
  time_domain_id: "order-time",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: null,
  max_time: null,
};

async function semanticContext(): Promise<SemanticContextCommitResult> {
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: hash("a"),
    release_hash: releaseHash,
    query_hash: hash("c"),
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("d"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: ["metric.order_revenue", "dimension.order_month"],
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
    selected_object_ids: ["dimension.order_month", "metric.order_revenue"],
    pruned_object_ids: [],
    fallback_reason_codes: [],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("e"),
    steps: [],
    mandatory_object_ids: ["dimension.order_month", "metric.order_revenue"],
    mandatory_relationship_ids: ["relationship.order-customer"],
    closure_complete: true,
    reason_codes: [],
  });
  const packageDocument = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: "falcon24",
    question_hash: hash("c"),
    defaults_ref: { defaults_id: id(5), defaults_revision: 1, defaults_hash: hash("5") },
    semantic_release: {
      resource_id: releaseId,
      resource_revision: 3,
      resource_hash: releaseHash,
      datasource_id: id(6),
      semantic_generation: 3,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(7),
      resource_revision: 2,
      resource_hash: hash("7"),
      datasource_id: id(6),
      semantic_release_id: releaseId,
      semantic_generation: 3,
    },
    context_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("8"),
      max_context_tokens: 32_000,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(9),
      resource_revision: 1,
      resource_hash: hash("9"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    authority_snapshot_hash: hash("a"),
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "metric.order_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 32_000,
      max_context_bytes: 32_000,
      mandatory_bytes: 192,
      included_bytes: 192,
      cropped_bytes: 0,
      items: [
        {
          item_kind: "METRIC",
          item_id: "metric.order_revenue",
          item_hash: hash("1"),
          byte_size: 64,
          priority: 10_000,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "ROUTE_SELECTED",
        },
        {
          item_kind: "ONTOLOGY",
          item_id: "dimension.order_month",
          item_hash: hash("2"),
          byte_size: 64,
          priority: 9_000,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "ROUTE_SELECTED",
        },
        {
          item_kind: "GRAPH",
          item_id: "relationship.order-customer",
          item_hash: hash("3"),
          byte_size: 64,
          priority: 8_000,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "AUTHORITY_REQUIRED",
        },
      ],
    },
    evidence: [
      {
        evidence_kind: "METRIC",
        evidence_id: "metric.order_revenue",
        evidence_hash: hash("1"),
        summary: "订单收入",
        source_ref: null,
      },
      {
        evidence_kind: "ONTOLOGY",
        evidence_id: "dimension.order_month",
        evidence_hash: hash("2"),
        summary: "订单月份",
        source_ref: null,
      },
      {
        evidence_kind: "GRAPH",
        evidence_id: "relationship.order-customer",
        evidence_hash: hash("3"),
        summary: "订单到客户",
        source_ref: null,
      },
    ],
    knowledge_refs: [],
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: ["dimension.order_month", "metric.order_revenue"],
      relationship_ids: ["relationship.order-customer"],
      closure_hash: hash("4"),
    },
    analysis_capabilities: ["CHART_DATASET", "TREND_CHANGE"],
  });
  const receipt = await buildSemanticContextReceipt({
    schema_version: "semantic-context-receipt@1.0.0",
    receipt_id: id(10),
    scope,
    consumer: "RUN",
    request_id: id(11),
    request_hash: hash("6"),
    run_id: runId,
    package_ref: {
      package_id: packageDocument.package_id,
      package_revision: 1,
      package_hash: packageDocument.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: packageDocument.authority_snapshot_hash,
    resolved_at: "2026-08-26T00:00:00.000Z",
  });
  return {
    schema_version: "semantic-context-commit-result@1.0.0",
    disposition: "CREATED",
    package: packageDocument,
    receipt,
  };
}

function catalog() {
  return {
    release_identity: {
      semantic_domain: "falcon24",
      release_id: releaseId,
      release_digest: releaseHash,
    },
    executable: {
      schema_version: "semantic-executable-projection@1.0.0" as const,
      metrics: [
        {
          metric_id: "metric.order_revenue",
          name: "订单收入",
          aliases: ["收入"],
          table_id: "orders",
          column_id: "order_total",
          aggregation: "sum" as const,
          formula: null,
          grain,
          unit: null,
          time_domain: timeDomain,
          time_column_id: "order_date",
          additivity: "additive" as const,
          null_policy: "coalesce-zero" as const,
          fanout_policy: "preaggregate" as const,
          dependency_column_ids: ["order_total"],
          tags: [],
          analysis: {
            primary: true,
            priority: 10_000,
            missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY" as const,
            seasonality: null,
            allowed_dimension_ids: ["dimension.order_month", "dimension.secret_customer"],
            capabilities: ["CHART_DATASET" as const, "TREND_CHANGE" as const],
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
        {
          dimension_id: "dimension.secret_customer",
          name: "敏感客户",
          aliases: ["客户"],
          table_id: "customers",
          column_id: "secret",
          grain,
          data_type: "text" as const,
          sensitivity: "SECRET" as const,
          hierarchical: false,
          parent_dimension_id: null,
          tags: [],
          analysis: { groupable: true, pivotable: false, causal_role: null },
        },
      ],
      formulas: [],
      physical_bindings: [],
    },
    relationships: {
      schema_version: "semantic-relationship-projection@1.0.0" as const,
      relationships: [
        {
          relationship_id: "relationship.order-customer",
          name: "订单到客户",
          kind: "analytical" as const,
          left_table_id: "orders",
          left_column_ids: ["customer_id"],
          right_table_id: "customers",
          right_column_ids: ["customer_id"],
          cardinality: "many-to-one" as const,
          left_row_preservation: "required" as const,
          right_row_preservation: "optional" as const,
          proof_kind: "DDL_ENFORCED" as const,
          proof_detail: "orders_customer_fk",
          tags: [],
          analysis: {
            join_allowed: true,
            fanout_closed: true,
            ontology_path: ["entity.order", "entity.customer"],
          },
        },
      ],
    },
    restrictions: {
      schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
      quality_constraints: [],
      time_semantics: [timeDomain],
    },
  };
}

describe("published analysis context compiler", () => {
  it("compiles exact published metrics, safe dimensions and join lineage without a case id", async () => {
    const semantic_context = await semanticContext();
    const context = await compilePublishedAnalysisContext({
      run_id: runId,
      semantic_context,
      catalog: catalog(),
    });

    expect(context.semantic_context_binding.package_hash).toBe(
      semantic_context.package.package_hash,
    );
    expect(context.metrics.map(({ metric_ref }) => metric_ref.node_id)).toEqual([
      "metric.order_revenue",
    ]);
    expect(context.metrics[0]?.allowed_dimensions.map(({ dimension_id }) => dimension_id)).toEqual([
      "dimension.order_month",
    ]);
    expect(context.relationships).toEqual([
      {
        relationship_id: "relationship.order-customer",
        left_table_id: "orders",
        right_table_id: "customers",
        cardinality: "many-to-one",
        fanout_closed: true,
        ontology_path: ["entity.order", "entity.customer"],
      },
    ]);
  });

  it("fails closed when the historical release identity differs", async () => {
    await expect(
      compilePublishedAnalysisContext({
        run_id: runId,
        semantic_context: await semanticContext(),
        catalog: {
          ...catalog(),
          release_identity: { ...catalog().release_identity, release_digest: hash("f") },
        },
      }),
    ).rejects.toMatchObject({
      name: PublishedAnalysisContextCompilationError.name,
      code: "PUBLISHED_ANALYSIS_CONTEXT_RELEASE_MISMATCH",
    });
  });

  it("rejects metrics that semantic retrieval did not select", async () => {
    await expect(
      compilePublishedAnalysisContext({
        run_id: runId,
        semantic_context: await semanticContext(),
        catalog: catalog(),
        requested_metric_ids: ["metric.not_selected"],
      }),
    ).rejects.toMatchObject({
      name: PublishedAnalysisContextCompilationError.name,
      code: "PUBLISHED_ANALYSIS_CONTEXT_METRIC_NOT_RESOLVED",
    });
  });
});
