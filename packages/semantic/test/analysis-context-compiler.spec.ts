import {
  type ArtifactReference,
  buildOntologyAnalysisSourceBinding,
  buildResolvedContextPackage,
  buildResolvedContextReceipt,
  computeSemanticSourceBundleHash,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  type SemanticSourceBundle,
  semanticSourceBundleSchema,
  U13_EXECUTABLE_SUBSET,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  AnalysisContextCompilationError,
  compileAnalysisContext,
  compileAnalysisTransform,
  evaluateAnalysisApplicability,
} from "../src/analysis/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const grain = { grain_id: "order-day", granularity: "day" as const };
const unit = {
  unit_id: "cny",
  dimension: "currency" as const,
  base_unit: null,
  conversion_factor: null,
};
const timeDomain = {
  time_domain_id: "order-time",
  calendar: "gregorian" as const,
  timezone: "Asia/Shanghai",
  min_time: null,
  max_time: null,
};

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  artifact_id: string,
  content_hash: `sha256:${string}`,
): ArtifactReference {
  return {
    artifact_id,
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

function sourceBundle(): SemanticSourceBundle {
  return semanticSourceBundleSchema.parse({
    metadata: {
      bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
      authority_envelope: {
        kind: "PUBLISHED",
        release_id: id(30),
        release_revision: 1,
        released_at: "2026-08-22T00:00:00.000Z",
      },
      capability_profile: U13_EXECUTABLE_SUBSET,
      bundle_id: id(20),
      scope,
      producer: { kind: "deterministic", id: "analysis-test" },
      authority: {
        kind: "deterministic",
        id: "semantic-authority",
        policy_version: "semantic-authority@2.0.0",
      },
      created_at: "2026-08-22T00:00:00.000Z",
    },
    formulas: [
      {
        formula_id: "gross-revenue-formula",
        formula_type: "additive_aggregate",
        return_type: "numeric",
        grain,
        unit,
        time_domain: timeDomain,
        additivity: "additive",
        cardinality: "scalar",
        null_policy: "coalesce-zero",
        dependency_formula_ids: [],
      },
    ],
    metrics: [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        table_id: "orders",
        column_id: "amount",
        aggregation: "sum",
        formula: {
          formula_id: "gross-revenue-formula",
          expression: "SUM(amount)",
          dialect: "text2sql",
        },
        grain,
        unit,
        time_domain: timeDomain,
        time_column_id: "ordered_at",
        additivity: "additive",
        null_policy: "coalesce-zero",
        fanout_policy: "preaggregate",
        dependency_column_ids: ["amount"],
        tags: [],
        analysis: {
          primary: true,
          priority: 10_000,
          missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY",
          seasonality: { kind: "WEEKLY", period_count: 7, minimum_history_points: 28 },
          allowed_dimension_ids: ["region", "secret_customer"],
          capabilities: [
            "ASSOCIATION",
            "CHART_DATASET",
            "CONCENTRATION",
            "CONTRIBUTION",
            "DATA_PROFILE",
            "FORECAST",
            "ROBUST_ANOMALY",
            "ROOT_CAUSE_DISCOVERY",
            "TREND_CHANGE",
          ],
          causal_role: "OUTCOME",
        },
      },
    ],
    dimensions: [
      {
        dimension_id: "region",
        name: "Region",
        aliases: ["区域"],
        table_id: "customers",
        column_id: "region",
        grain,
        data_type: "text",
        sensitivity: "PUBLIC",
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        analysis: { groupable: true, pivotable: true, causal_role: "CANDIDATE_CONFOUNDER" },
      },
      {
        dimension_id: "secret_customer",
        name: "Secret Customer",
        aliases: ["customer secret"],
        table_id: "customers",
        column_id: "secret",
        grain,
        data_type: "text",
        sensitivity: "SECRET",
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        analysis: { groupable: true, pivotable: false, causal_role: null },
      },
    ],
    relationships: [
      {
        relationship_id: "orders-customers",
        name: "Orders to customers",
        kind: "analytical",
        left_table_id: "orders",
        left_column_ids: ["customer_id"],
        right_table_id: "customers",
        right_column_ids: ["id"],
        cardinality: "many-to-one",
        left_row_preservation: "required",
        right_row_preservation: "optional",
        proof_kind: "DDL_ENFORCED",
        proof_detail: "fk",
        tags: [],
        analysis: {
          join_allowed: true,
          fanout_closed: true,
          ontology_path: ["customer", "order"],
        },
      },
    ],
    contribution_profile: {
      profile_id: "gross-revenue-contribution",
      targets: [
        {
          endpoint_id: "gross-revenue-by-region",
          kind: "ROW_PARTITION",
          metric_ref: "gross_revenue",
          baseline_query_contract_template_hash: hash("d"),
          followup_query_contract_template_hash: hash("e"),
          fixed_predicate_ast_hash: hash("f"),
          expected_row0_cell: "gross_revenue",
          ontology_identity: "region",
          datasource_id: id(5),
          unit_ref: "cny",
          grain_ref: "order-day",
          time_domain_ref: "order-time",
          filter_hash: hash("1"),
          snapshot_policy: "SNAPSHOT",
        },
      ],
      witnesses: [
        {
          kind: "ROW_PARTITION",
          witness: {
            same_measure: {
              canonical_measure_ast_hash: hash("2"),
              aggregation_algebra: "SUM",
              grain_identity: "order-day",
              unit_identity: "cny",
              null_policy_identity: "coalesce-zero",
              universe_hash: hash("3"),
            },
            driver_predicate_hash: hash("4"),
            residual_predicate_hash: hash("5"),
            driver_residual_mutual_exclusion_hash: hash("6"),
            driver_residual_exhaustive_union_hash: hash("7"),
            max_bound: 5_000,
            stable_ordering: ["signed_delta_desc", "region_asc"],
          },
        },
      ],
      static_driver_capacity: [
        {
          obligation_id: "gross-revenue-contribution",
          max_sql_executions: 2,
          endpoint_cost_model: "baseline+followup",
          compiler_version: "contribution-compiler@1.0.0",
          diagnostic_binding_limit: 5_000,
          artifact_input_limit: 64,
        },
      ],
      stable_ordering: ["gross-revenue-by-region"],
      declared_max_bound: 5_000,
    },
    domain_causal_policy: null,
  });
}

async function fixture(bundle = sourceBundle()) {
  const publishedMetrics = bundle.metrics.map((metric, index) => ({
    metric,
    evidenceHash: hash(((index + 6) % 10).toString()),
  }));
  const semanticRelease = {
    resource_id: id(4),
    resource_revision: 1,
    resource_hash: hash("2"),
    datasource_id: id(5),
    semantic_generation: 1,
    publication_status: "PUBLISHED" as const,
  };
  const schemaSnapshot = {
    resource_id: id(6),
    resource_revision: 1,
    resource_hash: hash("3"),
    datasource_id: id(5),
    semantic_release_id: id(4),
    semantic_generation: 1,
  };
  const contextPolicy = {
    resource_id: id(7),
    resource_revision: 1,
    resource_hash: hash("4"),
    max_context_tokens: 4_096,
    max_resource_bindings: 64,
  };
  const packageDocument = await buildResolvedContextPackage({
    schema_version: "resolved-context-package@1.0.0",
    scope,
    semantic_domain: "commerce",
    question_hash: hash("1"),
    defaults_ref: { defaults_id: id(8), defaults_revision: 1, defaults_hash: hash("8") },
    semantic_release: semanticRelease,
    schema_snapshot: schemaSnapshot,
    context_policy: contextPolicy,
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
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "gross_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4_096,
      max_context_bytes: 4_096,
      mandatory_bytes: 64 * publishedMetrics.length,
      included_bytes: 64 * publishedMetrics.length,
      cropped_bytes: 0,
      items: publishedMetrics.map(({ metric, evidenceHash }) => ({
        item_kind: "METRIC",
        item_id: metric.metric_id,
        item_hash: evidenceHash,
        byte_size: 64,
        priority: 10_000,
        mandatory: true,
        disposition: "MANDATORY",
        reason_code: "ROUTE_SELECTED",
      })),
    },
    evidence: publishedMetrics.map(({ metric, evidenceHash }) => ({
      evidence_kind: "METRIC",
      evidence_id: metric.metric_id,
      evidence_hash: evidenceHash,
      summary: metric.name,
      source_ref: null,
    })),
    knowledge_refs: [],
  });
  const sourceHash = await computeSemanticSourceBundleHash(bundle);
  const semanticReleaseRef = reference("SemanticRelease", id(4), hash("2"));
  const sourceRef = reference("SemanticSourceBundle", id(20), sourceHash);
  const ontologyBinding = await buildOntologyAnalysisSourceBinding({
    schema_version: "ontology-analysis-source-binding@1.0.0",
    namespace_id: id(30),
    package_id: id(31),
    package_version: 1,
    package_hash: hash("b"),
    semantic_release_id: id(4),
    semantic_release_revision: 1,
    semantic_release_hash: hash("2"),
    semantic_source_bundle: {
      source_class: "BUSINESS_CONTEXT",
      source_role: "BUSINESS_SOURCE_BUNDLE",
      namespace_id: id(30),
      source_id: id(20),
      source_version: 2,
      source_hash: sourceHash,
      object_path: ["semantic", "analysis"],
    },
  });
  const contextReceipt = await buildResolvedContextReceipt({
    schema_version: "resolved-context-receipt@1.0.0",
    receipt_id: id(40),
    scope,
    consumer: "RUN",
    request_id: id(41),
    request_hash: hash("c"),
    run_id: runId,
    package_ref: {
      package_id: packageDocument.package_id,
      package_revision: 1,
      package_hash: packageDocument.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: packageDocument.authority_snapshot_hash,
    resolved_at: "2026-08-22T00:00:00.000Z",
  });
  const input = {
    package: packageDocument,
    context_receipt: contextReceipt,
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", id(6), hash("3")),
    policy_receipt_ref: reference("PolicyReceipt", id(7), hash("4")),
    semantic_source_bundle_ref: sourceRef,
    semantic_source_bundle: bundle,
    ontology_analysis_binding: ontologyBinding,
    requested_metric_ids: ["gross_revenue"],
  };
  return { input, packageDocument };
}

describe("analysis context compiler", () => {
  it("rejects V1 identity and compiles deterministic V2 authority", async () => {
    const bundle = sourceBundle();
    expect(semanticSourceBundleSchema.safeParse(bundle).success).toBe(true);
    expect(
      semanticSourceBundleSchema.safeParse({
        ...bundle,
        metadata: { ...bundle.metadata, bundle_version: "semantic-source-bundle@1" },
      }).success,
    ).toBe(false);
    const missingPeriodPolicy = structuredClone(bundle);
    const metricWithoutPolicy = missingPeriodPolicy.metrics[0] as
      | Record<string, unknown>
      | undefined;
    if (!metricWithoutPolicy) throw new TypeError("missing metric fixture");
    metricWithoutPolicy.analysis = {
      ...(metricWithoutPolicy.analysis as Record<string, unknown>),
      missing_period_policy: undefined,
    };
    expect(semanticSourceBundleSchema.safeParse(missingPeriodPolicy).success).toBe(false);
    const { input } = await fixture(bundle);
    const first = await compileAnalysisContext(input);
    const second = await compileAnalysisContext(input);
    expect(first.context_hash).toBe(second.context_hash);
    expect(first.metrics[0]?.metric_ref.node_id).toBe("gross_revenue");
    expect(first.metrics[0]?.allowed_dimensions.map(({ dimension_id }) => dimension_id)).toEqual([
      "region",
    ]);
    expect(first.metrics[0]?.analysis_capabilities).toContain("CONTRIBUTION");
  });

  it("rejects release/hash drift and metrics outside Resolved Context", async () => {
    const { input } = await fixture();
    await expect(
      compileAnalysisContext({
        ...input,
        semantic_release_ref: { ...input.semantic_release_ref, content_hash: hash("f") },
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_CONTEXT_RELEASE_STALE" });
    await expect(
      compileAnalysisContext({
        ...input,
        semantic_source_bundle_ref: {
          ...input.semantic_source_bundle_ref,
          content_hash: hash("f"),
        },
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_CONTEXT_SOURCE_BUNDLE_STALE" });
    await expect(
      compileAnalysisContext({ ...input, requested_metric_ids: ["candidate_metric"] }),
    ).rejects.toBeInstanceOf(AnalysisContextCompilationError);
  });

  it("returns stable applicability verdicts for time, additivity, sensitivity and L5", async () => {
    const { input } = await fixture();
    const context = await compileAnalysisContext(input);
    await expect(
      evaluateAnalysisApplicability(context, {
        skill_id: "trend-change@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: ["region"],
      }),
    ).resolves.toEqual({ verdict: "APPLICABLE", reason_codes: [] });
    await expect(
      evaluateAnalysisApplicability(context, {
        skill_id: "contribution-concentration@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: [],
      }),
    ).resolves.toEqual({ verdict: "APPLICABLE", reason_codes: [] });
    await expect(
      evaluateAnalysisApplicability(context, {
        skill_id: "root-cause-investigation@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: [],
        requested_level: "L5_CAUSAL",
      }),
    ).resolves.toMatchObject({
      verdict: "NOT_APPLICABLE",
      reason_codes: expect.arrayContaining(["CAUSAL_POLICY_NOT_PUBLISHED"]),
    });
  });

  it("rejects non-additive contribution, missing time semantics, and cross-metric conflicts", async () => {
    const nonAdditiveBundle = sourceBundle();
    const nonAdditiveMetric = nonAdditiveBundle.metrics[0];
    const nonAdditiveFormula = nonAdditiveBundle.formulas[0];
    if (!nonAdditiveMetric || !nonAdditiveFormula) throw new TypeError("missing metric fixture");
    nonAdditiveMetric.additivity = "non-additive";
    nonAdditiveFormula.additivity = "non-additive";
    nonAdditiveFormula.formula_type = "ratio";
    const { input: nonAdditiveInput } = await fixture(nonAdditiveBundle);
    const nonAdditiveContext = await compileAnalysisContext(nonAdditiveInput);
    await expect(
      evaluateAnalysisApplicability(nonAdditiveContext, {
        skill_id: "contribution-concentration@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: [],
      }),
    ).resolves.toMatchObject({
      verdict: "NOT_APPLICABLE",
      reason_codes: expect.arrayContaining([
        "ANALYSIS_CAPABILITY_NOT_PUBLISHED",
        "NON_ADDITIVE_CONTRIBUTION_NOT_LOWERABLE",
      ]),
    });

    const noTimeBundle = sourceBundle();
    const noTimeMetric = noTimeBundle.metrics[0];
    if (!noTimeMetric) throw new TypeError("missing metric fixture");
    noTimeMetric.time_domain = null;
    noTimeMetric.time_column_id = null;
    noTimeMetric.analysis.seasonality = null;
    noTimeMetric.analysis.capabilities = noTimeMetric.analysis.capabilities.filter(
      (capability) => capability !== "FORECAST",
    );
    const { input: noTimeInput } = await fixture(noTimeBundle);
    const noTimeContext = await compileAnalysisContext(noTimeInput);
    await expect(
      evaluateAnalysisApplicability(noTimeContext, {
        skill_id: "trend-change@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: [],
      }),
    ).resolves.toMatchObject({
      verdict: "NOT_APPLICABLE",
      reason_codes: expect.arrayContaining([
        "ANALYSIS_CAPABILITY_NOT_PUBLISHED",
        "TIME_DOMAIN_NOT_PUBLISHED",
      ]),
    });

    const conflictBundle = sourceBundle();
    const baseMetric = conflictBundle.metrics[0];
    const baseFormula = conflictBundle.formulas[0];
    if (!baseMetric?.formula || !baseFormula) throw new TypeError("missing metric fixture");
    conflictBundle.metrics.push({
      ...structuredClone(baseMetric),
      metric_id: "order_count",
      name: "Order Count",
      aliases: ["Orders"],
      column_id: "order_id",
      formula: { ...baseMetric.formula, formula_id: "order-count-formula" },
      grain: { grain_id: "order-month", granularity: "month" },
      unit: { ...unit, unit_id: "count", dimension: "count" },
      null_policy: "preserve",
      time_domain: { ...timeDomain, time_domain_id: "order-time-utc", timezone: "UTC" },
      analysis: {
        ...baseMetric.analysis,
        primary: false,
        capabilities: ["ASSOCIATION", "CHART_DATASET", "DATA_PROFILE"],
      },
    });
    conflictBundle.formulas.push({
      ...structuredClone(baseFormula),
      formula_id: "order-count-formula",
      grain: { grain_id: "order-month", granularity: "month" },
      unit: { ...unit, unit_id: "count", dimension: "count" },
      null_policy: "preserve",
      time_domain: { ...timeDomain, time_domain_id: "order-time-utc", timezone: "UTC" },
    });
    const { input: conflictInput } = await fixture(conflictBundle);
    const conflictContext = await compileAnalysisContext({
      ...conflictInput,
      requested_metric_ids: ["gross_revenue", "order_count"],
    });
    await expect(
      evaluateAnalysisApplicability(conflictContext, {
        skill_id: "association-outlier-completeness@1",
        metric_ids: ["gross_revenue", "order_count"],
        dimension_ids: [],
      }),
    ).resolves.toMatchObject({
      verdict: "NOT_APPLICABLE",
      reason_codes: expect.arrayContaining([
        "GRAIN_MISMATCH",
        "UNIT_MISMATCH",
        "NULL_POLICY_CONFLICT",
        "TIMEZONE_MISMATCH",
      ]),
    });
  });

  it("admits L5 applicability only with published roles, policy, DAG and adjustment closure", async () => {
    const causalBundle = sourceBundle();
    const outcome = causalBundle.metrics[0];
    const outcomeFormula = causalBundle.formulas[0];
    if (!outcome?.formula || !outcomeFormula) throw new TypeError("missing causal fixture");
    outcome.analysis.capabilities = [
      "ASSOCIATION",
      "CAUSAL_IDENTIFICATION",
      "CHART_DATASET",
      "CONCENTRATION",
      "CONTRIBUTION",
      "DATA_PROFILE",
      "FORECAST",
      "ROBUST_ANOMALY",
      "ROOT_CAUSE_DISCOVERY",
      "TREND_CHANGE",
    ];
    causalBundle.metrics.push({
      ...structuredClone(outcome),
      metric_id: "promotion_spend",
      name: "Promotion Spend",
      aliases: ["Promo Spend"],
      column_id: "promotion_spend",
      formula: { ...outcome.formula, formula_id: "promotion-spend-formula" },
      analysis: {
        ...outcome.analysis,
        primary: false,
        capabilities: [
          "CAUSAL_IDENTIFICATION",
          "CHART_DATASET",
          "DATA_PROFILE",
          "ROOT_CAUSE_DISCOVERY",
        ],
        causal_role: "TREATMENT",
      },
    });
    causalBundle.formulas.push({
      ...structuredClone(outcomeFormula),
      formula_id: "promotion-spend-formula",
    });
    causalBundle.domain_causal_policy = {
      policy_refs: [reference("PolicyReceipt", id(50), hash("d"))],
      intervention_semantics_refs: ["promotion-budget-intervention"],
      adjustment_set_object_ids: ["region"],
      excluded_mediator_ids: [],
      excluded_collider_ids: [],
      directed_edges: [
        {
          source_object_id: "promotion_spend",
          target_object_id: "gross_revenue",
          mechanism_ref: "promotion-drives-demand",
          ontology_path: ["campaign", "order"],
        },
        {
          source_object_id: "region",
          target_object_id: "gross_revenue",
          mechanism_ref: "regional-demand",
          ontology_path: ["customer", "order"],
        },
      ],
    };
    const { input } = await fixture(causalBundle);
    const context = await compileAnalysisContext({
      ...input,
      requested_metric_ids: ["gross_revenue", "promotion_spend"],
    });
    await expect(
      evaluateAnalysisApplicability(context, {
        skill_id: "root-cause-investigation@1",
        metric_ids: ["gross_revenue"],
        dimension_ids: ["region"],
        requested_level: "L5_CAUSAL",
      }),
    ).resolves.toEqual({ verdict: "APPLICABLE", reason_codes: [] });

    const invalidPolicy = structuredClone(causalBundle);
    if (!invalidPolicy.domain_causal_policy) throw new TypeError("missing causal policy fixture");
    invalidPolicy.domain_causal_policy.adjustment_set_object_ids = ["promotion_spend"];
    const { input: invalidInput } = await fixture(invalidPolicy);
    await expect(compileAnalysisContext(invalidInput)).rejects.toThrow(/CANDIDATE_CONFOUNDER/);
  });

  it("compiles bounded transforms deterministically and fails closed on fanout/formula drift", async () => {
    const { input } = await fixture();
    const context = await compileAnalysisContext(input);
    const first = await compileAnalysisTransform(context, {
      kind: "GROUP_BY",
      metric_id: "gross_revenue",
      dimension_ids: ["region"],
    });
    const second = await compileAnalysisTransform(context, {
      kind: "GROUP_BY",
      metric_id: "gross_revenue",
      dimension_ids: ["region", "region"],
    });
    expect(first.status).toBe("COMPILED");
    expect(second).toEqual(first);
    await expect(
      compileAnalysisTransform(context, {
        kind: "DERIVED_METRIC",
        metric_id: "gross_revenue",
        formula_hash: hash("f"),
      }),
    ).resolves.toEqual({ status: "REJECTED", reason_code: "UNPUBLISHED_SEMANTIC_INPUT" });

    const unsafeBundle = sourceBundle();
    const unsafeRelationship = unsafeBundle.relationships[0];
    if (!unsafeRelationship) throw new TypeError("missing relationship fixture");
    unsafeRelationship.analysis.fanout_closed = false;
    const { input: unsafeInput } = await fixture(unsafeBundle);
    const unsafeContext = await compileAnalysisContext(unsafeInput);
    await expect(
      compileAnalysisTransform(unsafeContext, {
        kind: "JOIN",
        metric_id: "gross_revenue",
        relationship_id: "orders-customers",
      }),
    ).resolves.toEqual({ status: "REJECTED", reason_code: "FANOUT_NOT_CLOSED" });
  });
});
