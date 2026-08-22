import { createHash } from "node:crypto";
import {
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  analysisSandboxProgramPayloadSchema,
  buildAnalysisContext,
  type CausalAttributionAuthorityClosure,
  causalAttributionAuthorityClosureSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeAnalysisProgramHash,
  computeAttributionAuthorityClosureHash,
} from "@data-agent/research";
import { describe, expect, it } from "vitest";
import { createRootCauseExecutor } from "../../src/analysis/index.js";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const now = "2026-08-22T00:00:00.000Z";
const window = {
  start: "2026-07-01T00:00:00.000Z",
  end: "2026-08-01T00:00:00.000Z",
  timezone: "Asia/Shanghai",
  semantics: "HALF_OPEN" as const,
};

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
  content_hash: `sha256:${string}` = hash(String(suffix % 10)),
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

async function contextFixture() {
  const semanticReleaseRef = reference("SemanticRelease", 10);
  return buildAnalysisContext({
    schema_version: "analysis-context@1.0.0",
    scope,
    resolved_context_binding: {
      package_id: id(11),
      package_hash: hash("a"),
      receipt_id: id(12),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 13),
    policy_receipt_ref: reference("PolicyReceipt", 14),
    semantic_source_bundle_ref: reference("SemanticSourceBundle", 15),
    ontology_analysis_binding_hash: hash("c"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "revenue" },
        formula_hash: hash("d"),
        unit: null,
        grain: { grain_id: "order-day", granularity: "day" },
        time_domain: null,
        time_dimension_ref: "ordered_at",
        additivity: "additive",
        null_policy: "preserve",
        missing_period_policy: "NULL",
        seasonality: null,
        priority: 10_000,
        causal_role: "OUTCOME",
        allowed_dimensions: [
          {
            dimension_id: "promotion",
            grain: { grain_id: "order-day", granularity: "day" },
            data_type: "boolean",
            sensitivity: "PUBLIC",
            groupable: true,
            pivotable: true,
            causal_role: "TREATMENT",
          },
          {
            dimension_id: "region",
            grain: { grain_id: "order-day", granularity: "day" },
            data_type: "text",
            sensitivity: "PUBLIC",
            groupable: true,
            pivotable: true,
            causal_role: "CANDIDATE_CONFOUNDER",
          },
        ],
        analysis_capabilities: ["CAUSAL_IDENTIFICATION", "ROOT_CAUSE_DISCOVERY"],
      },
    ],
    relationships: [
      {
        relationship_id: "promotion-revenue",
        left_table_id: "promotion",
        right_table_id: "revenue",
        cardinality: "many-to-one",
        fanout_closed: true,
        ontology_path: ["promotion", "influences", "revenue"],
      },
    ],
    causal_policy: {
      policy_refs: [reference("PolicyReceipt", 16)],
      intervention_semantics_refs: ["promotion-toggle@1"],
      adjustment_set_object_ids: ["region"],
      excluded_mediator_ids: [],
      excluded_collider_ids: [],
      directed_edges: [
        {
          source_object_id: "promotion",
          target_object_id: "revenue",
          mechanism_ref: "promotion-revenue@1",
          ontology_path: ["promotion", "influences", "revenue"],
        },
        {
          source_object_id: "region",
          target_object_id: "promotion",
          mechanism_ref: "region-promotion@1",
          ontology_path: ["region", "influences", "promotion"],
        },
        {
          source_object_id: "region",
          target_object_id: "revenue",
          mechanism_ref: "region-revenue@1",
          ontology_path: ["region", "influences", "revenue"],
        },
      ],
    },
  });
}

async function authorityFixture(questionHash: string) {
  const material: Omit<CausalAttributionAuthorityClosure, "closure_hash"> = {
    protocol_version: "causal-attribution-authority-closure@1.0.0",
    eligibility: {
      decision_id: id(20),
      ...scope,
      request_id: id(21),
      subject_id: "promotion->revenue",
      eligibility_criteria: [
        { criterion_id: "causal-policy", criterion_name: "Causal policy", is_satisfied: true },
      ],
      overall_eligible: true,
      decision: "ELIGIBLE",
      decided_by: "attribution-authority",
      decided_at: now,
      frozen_question_hash: questionHash,
    },
    safety: {
      verdict_id: id(22),
      ...scope,
      run_id: runId,
      evidence_id: id(23),
      verdict: "GO",
      verdict_reason: "Causal safety passed.",
      verdict_dimensions: [{ dimension_name: "identification", dimension_result: "PASS" }],
      determined_by: "attribution-safety",
      determined_at: now,
      evidence_hash: hash("f"),
      auto_approve: false,
      ttl_seconds: 3600,
    },
    feasibility: {
      protocol_version: "attribution-feasibility-verdict@1",
      verdict_id: id(24),
      kernel_evidence_ref: id(23),
      truth_contract_ref: "scm@1",
      verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION",
      oracle_check: {
        check_type: "ORACLE",
        status: "PASS",
        pattern_match_count: 1,
        pattern_total_count: 1,
        evidence_match_count: 1,
        evidence_total_count: 1,
        closure_verdict: "PASS",
        details: [{ pattern_id: "effect", status: "PASS", message: "Recovered." }],
      },
      mutation_check: {
        check_type: "MUTATION",
        status: "PASS",
        mutation_count: 1,
        detected_count: 1,
        undetected_count: 0,
        detection_rate: 1,
        details: [],
      },
      holdout_check: {
        check_type: "HOLDOUT",
        status: "PASS",
        holdout_count: 1,
        holdout_pass_count: 1,
        holdout_fail_count: 0,
        details: [],
      },
      summary: "Passed.",
      reason_codes: ["ALL_CHECKS_PASSED"],
      evaluated_at: now,
      evaluator_version: "causal-evaluator@1",
      verdict_hash: hash("1"),
    },
    scm_truth: {
      causal_id: id(25),
      kind: "SCM_CAUSAL",
      label: "promotion",
      description: "Known effect.",
      treatment_variable: "promotion",
      outcome_variable: "revenue",
      expected_effect: "POSITIVE",
      effect_size: 2,
      effect_interval: { low: 1.5, high: 2.5 },
      directed_edges: [{ source: "promotion", target: "revenue" }],
      observed_confounders: ["region"],
      unobserved_confounders: [],
      mediators: [],
      colliders: [],
      data_generating_process_version: "scm@1",
      metadata: {},
    },
  };
  return causalAttributionAuthorityClosureSchema.parse({
    ...material,
    closure_hash: await computeAttributionAuthorityClosureHash(material),
  });
}

function observations(weak = false) {
  return [
    {
      factor_id: "promotion",
      factor_kind: "DIMENSION" as const,
      ontology_path: ["promotion", "influences", "revenue"],
      temporal_order: weak ? ("UNKNOWN" as const) : ("PRECEDES" as const),
      method: "conditional-association@1",
      effect_direction: weak ? ("UNKNOWN" as const) : ("POSITIVE" as const),
      effect_size: weak ? null : 2,
      interval_low: weak ? null : 1.5,
      interval_high: weak ? null : 2.5,
      raw_p_value: weak ? 0.2 : 0.01,
      sample_size: weak ? 50 : 1_000,
      competing_explanations: ["Regional allocation"],
      uncovered_boundaries: ["Unobserved intent"],
    },
  ];
}

describe("root cause worker runtime", () => {
  it("executes the attested L5 chain and commits only certificate-authorized output", async () => {
    const context = await contextFixture();
    const planRef = reference("AnalysisPlan", 30);
    const committed: string[] = [];
    let sandboxExecutions = 0;
    const executor = createRootCauseExecutor({
      artifacts: {
        async commit({ payload }) {
          committed.push(payload.artifact_type);
          return reference(
            payload.artifact_type,
            40 + committed.length,
            await sha256ContentHash(payload),
          );
        },
      },
      attribution: {
        async resolve({ question }) {
          return authorityFixture(question.question_hash);
        },
      },
      sandbox: {
        async execute(input) {
          sandboxExecutions += 1;
          const source = "def main(sdk):\n    return None\n";
          const sourceHash = `sha256:${createHash("sha256").update(source).digest("hex")}` as const;
          const programMaterial: Omit<AnalysisSandboxProgramPayload, "program_hash"> = {
            artifact_type: "SandboxProgram",
            protocol_version: "analysis-sandbox-program@1.0.0",
            plan_ref: input.analysis_plan_ref as AnalysisSandboxProgramPayload["plan_ref"],
            node_id: "root-cause",
            language: "PYTHON_3_12",
            entrypoint: "main",
            source_sha256: sourceHash,
            source_text_ref: reference(
              "SensitiveExecutionArtifact",
              60,
              sourceHash,
            ) as AnalysisSandboxProgramPayload["source_text_ref"],
            query_evidence_refs: [
              reference("QueryEvidence", 61),
            ] as AnalysisSandboxProgramPayload["query_evidence_refs"],
            input_refs: [reference("SandboxResult", 62)],
            output_contract: {
              schema_version: "python-output-contract@1.0.0",
              outputs: [{ name: "result", type: "JSON", required: true, max_bytes: 1_000_000 }],
            },
            import_profile: "CAUSAL_L5",
            random_seed: 7,
            runtime_digest: input.plan.frontier.runtime_digest ?? hash("2"),
            dependency_lock_digest: input.plan.frontier.dependency_lock_digest ?? hash("3"),
            policy_version: "python-policy@1.0.0",
          };
          const program = analysisSandboxProgramPayloadSchema.parse({
            ...programMaterial,
            program_hash: await computeAnalysisProgramHash(programMaterial),
          });
          return {
            program,
            program_ref: reference("SandboxProgram", 63, await sha256ContentHash(program)),
            execution_receipt_ref: reference("SandboxExecutionReceipt", 64),
            result_refs: [reference("SandboxResult", 65)],
            computation: {
              point_estimate: 2,
              interval_low: 1.5,
              interval_high: 2.5,
              effective_sample_size: 800,
              overlap_score: 0.8,
              maximum_standardized_mean_difference: 0.05,
              refutations: [
                "PLACEBO_TREATMENT",
                "RANDOM_COMMON_CAUSE",
                "DATA_SUBSET",
                "BOOTSTRAP",
                "NEGATIVE_CONTROL",
                "SENSITIVITY",
              ].map((refuter) => ({
                refuter,
                verdict: "PASS" as const,
                observed_statistic: 0,
                threshold: 0.05,
              })) as never,
              sensitivity: {
                robustness_value: 2,
                negative_control_passed: true,
                unobserved_confounding_bound: 0.2,
              },
              limitation_codes: [],
            },
          };
        },
      },
    });
    const result = await executor.execute({
      mode: "L5_CAUSAL",
      now: new Date("2026-08-22T00:30:00.000Z"),
      context,
      plan_ref: planRef,
      source_evidence_refs: [reference("DerivedAnalysisEvidence", 31)],
      outcome_metric_ref:
        context.metrics[0]?.metric_ref ??
        (() => {
          throw new Error();
        })(),
      observations: observations(),
      treatment_object_id: "promotion",
      population: "published ecommerce orders",
      estimand: "ATE",
      time_zero: window.start,
      intervention_semantics_ref: "promotion-toggle@1",
      target_window: window,
      estimator: "ECONML_DML",
    });
    expect(result.status).toBe("CERTIFIED");
    expect(sandboxExecutions).toBe(1);
    expect(committed).toEqual([
      "DiscoveryCandidate",
      "DiscoveryReceipt",
      "CausalQuestion",
      "IdentificationPlan",
      "CausalEstimate",
      "IdentificationCertificate",
    ]);
  });

  it("stops weak L4 evidence before causal sandbox execution", async () => {
    const context = await contextFixture();
    let sandboxExecutions = 0;
    const executor = createRootCauseExecutor({
      artifacts: {
        async commit({ payload }) {
          return reference(payload.artifact_type, 80, await sha256ContentHash(payload));
        },
      },
      attribution: {
        async resolve() {
          throw new Error("authority must not resolve");
        },
      },
      sandbox: {
        async execute() {
          sandboxExecutions += 1;
          throw new Error("sandbox must not run");
        },
      },
    });
    const result = await executor.execute({
      mode: "L5_CAUSAL",
      now: new Date(now),
      context,
      plan_ref: reference("AnalysisPlan", 70),
      source_evidence_refs: [reference("DerivedAnalysisEvidence", 71)],
      outcome_metric_ref:
        context.metrics[0]?.metric_ref ??
        (() => {
          throw new Error();
        })(),
      observations: observations(true),
    });
    expect(result.status).toBe("HOLD");
    expect(result.question_ref).toBeNull();
    expect(sandboxExecutions).toBe(0);
  });
});
