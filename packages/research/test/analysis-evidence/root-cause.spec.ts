import {
  type AnalysisContext,
  type AnalysisSandboxExecutionReceipt,
  type ArtifactReference,
  analysisSandboxExecutionReceiptSchema,
  atomicClaimV3PayloadSchema,
  buildAnalysisContext,
  type CausalAttributionAuthorityClosure,
  type CausalEstimatePayload,
  causalAttributionAuthorityClosureSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  computeAttributionAuthorityClosureHash,
  createCausalEstimate,
  createCausalQuestion,
  createIdentificationCertificate,
  createIdentificationPlan,
  createRootCauseDiscoveryCandidate,
  createRootCauseDiscoveryReceipt,
} from "../../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const now = "2026-08-22T00:00:00.000Z";
const causalAgentImage = "data-agent-opensandbox-agent-causal@sha256:test";
const operatorImage = "data-agent-opensandbox-operator@sha256:test";
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

async function contextFixture(
  options: {
    readonly semantic_inference_receipt_hash?: `sha256:${string}`;
    readonly adjustment_set_object_ids?: readonly string[];
    readonly reverse_edge?: boolean;
  } = {},
) {
  const semanticReleaseRef = reference("SemanticRelease", 10);
  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(11),
      package_hash: hash("a"),
      receipt_id: id(12),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 13),
    policy_receipt_ref: reference("PolicyReceipt", 14),
    semantic_retrieval_receipt_hash: hash("b"),
    semantic_inference_receipt_hash: options.semantic_inference_receipt_hash ?? hash("c"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "revenue" },
        formula_hash: hash("d"),
        unit: null,
        grain: { grain_id: "order-day", granularity: "day" },
        time_domain: {
          time_domain_id: "order-time",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: null,
          max_time: null,
        },
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
          {
            dimension_id: "visits",
            grain: { grain_id: "order-day", granularity: "day" },
            data_type: "number",
            sensitivity: "PUBLIC",
            groupable: true,
            pivotable: false,
            causal_role: "MEDIATOR",
          },
          {
            dimension_id: "selection",
            grain: { grain_id: "order-day", granularity: "day" },
            data_type: "boolean",
            sensitivity: "PUBLIC",
            groupable: true,
            pivotable: false,
            causal_role: "COLLIDER",
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
      adjustment_set_object_ids: options.adjustment_set_object_ids ?? ["region"],
      excluded_mediator_ids: ["visits"],
      excluded_collider_ids: ["selection"],
      directed_edges: [
        {
          source_object_id: options.reverse_edge ? "revenue" : "promotion",
          target_object_id: options.reverse_edge ? "promotion" : "revenue",
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
      decision_id: id(30),
      ...scope,
      request_id: id(31),
      subject_id: "promotion->revenue",
      eligibility_criteria: [
        {
          criterion_id: "published-policy",
          criterion_name: "Published policy",
          is_satisfied: true,
        },
      ],
      overall_eligible: true,
      decision: "ELIGIBLE",
      decided_by: "attribution-authority",
      decided_at: now,
      frozen_question_hash: questionHash,
    },
    safety: {
      verdict_id: id(32),
      ...scope,
      run_id: runId,
      evidence_id: id(33),
      verdict: "GO",
      verdict_reason: "All causal publication safety dimensions passed.",
      verdict_dimensions: [
        { dimension_name: "privacy", dimension_result: "PASS" },
        { dimension_name: "identification", dimension_result: "PASS" },
      ],
      determined_by: "attribution-safety-authority",
      determined_at: now,
      evidence_hash: hash("f"),
      auto_approve: false,
      ttl_seconds: 3600,
    },
    feasibility: {
      protocol_version: "attribution-feasibility-verdict@1",
      verdict_id: id(34),
      kernel_evidence_ref: id(33),
      truth_contract_ref: "scm-truth@1",
      verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION",
      oracle_check: {
        check_type: "ORACLE",
        status: "PASS",
        pattern_match_count: 1,
        pattern_total_count: 1,
        evidence_match_count: 1,
        evidence_total_count: 1,
        closure_verdict: "PASS",
        details: [{ pattern_id: "effect", status: "PASS", message: "Effect recovered." }],
      },
      mutation_check: {
        check_type: "MUTATION",
        status: "PASS",
        mutation_count: 1,
        detected_count: 1,
        undetected_count: 0,
        detection_rate: 1,
        details: [
          {
            mutation_id: id(35),
            mutation_type: "CONFOUNDER_REMOVAL",
            expected_response: "HOLD",
            actual_response: "HOLD",
            status: "PASS",
            message: "Missing confounder was rejected.",
          },
        ],
      },
      holdout_check: {
        check_type: "HOLDOUT",
        status: "PASS",
        holdout_count: 1,
        holdout_pass_count: 1,
        holdout_fail_count: 0,
        details: [
          { dataset_id: "scm-holdout", split: "HOLDOUT", status: "PASS", message: "Passed." },
        ],
      },
      summary: "All independent checks passed.",
      reason_codes: ["ALL_CHECKS_PASSED"],
      evaluated_at: now,
      evaluator_version: "causal-evaluator@1",
      verdict_hash: hash("1"),
    },
    scm_truth: {
      causal_id: id(36),
      kind: "SCM_CAUSAL",
      label: "promotion effect",
      description: "Known synthetic promotion effect.",
      treatment_variable: "promotion",
      outcome_variable: "revenue",
      expected_effect: "POSITIVE",
      effect_size: 2,
      effect_interval: { low: 1.5, high: 2.5 },
      directed_edges: [{ source: "promotion", target: "revenue" }],
      observed_confounders: ["region"],
      unobserved_confounders: [],
      mediators: ["visits"],
      colliders: ["selection"],
      data_generating_process_version: "scm-promotion@1",
      metadata: {},
    },
  };
  return causalAttributionAuthorityClosureSchema.parse({
    ...material,
    closure_hash: await computeAttributionAuthorityClosureHash(material),
  });
}

async function causalChain(
  computation: { overlap_score?: number; fail_refutation?: boolean } = {},
  suppliedContext?: AnalysisContext,
) {
  const context = suppliedContext ?? (await contextFixture());
  const planRef = reference("AnalysisProgram", 40);
  const candidate = await createRootCauseDiscoveryCandidate({
    context,
    plan_ref: planRef,
    source_evidence_refs: [reference("DerivedAnalysisEvidence", 41)],
    outcome_metric_ref:
      context.metrics[0]?.metric_ref ??
      (() => {
        throw new Error();
      })(),
    observations: [
      {
        factor_id: "promotion",
        factor_kind: "DIMENSION",
        ontology_path: ["promotion", "influences", "revenue"],
        temporal_order: "PRECEDES",
        method: "conditional-association@1",
        effect_direction: "POSITIVE",
        effect_size: 2,
        interval_low: 1.5,
        interval_high: 2.5,
        raw_p_value: 0.01,
        sample_size: 1_000,
        competing_explanations: ["Regional campaign allocation"],
        uncovered_boundaries: ["Unobserved intent"],
      },
    ],
  });
  const candidateRef = reference("DiscoveryCandidate", 42, await sha256ContentHash(candidate));
  const receipt = await createRootCauseDiscoveryReceipt({
    context,
    candidate,
    candidate_ref: candidateRef,
  });
  const receiptRef = reference("DiscoveryReceipt", 43, await sha256ContentHash(receipt));
  const question = await createCausalQuestion({
    context,
    candidate,
    candidate_ref: candidateRef,
    treatment_object_id: "promotion",
    population: "published ecommerce orders",
    estimand: "ATE",
    time_zero: window.start,
    intervention_semantics_ref: "promotion-toggle@1",
    target_window: window,
  });
  const questionRef = reference("CausalQuestion", 44, await sha256ContentHash(question));
  const plan = await createIdentificationPlan({
    context,
    question,
    question_ref: questionRef,
    candidate,
    receipt,
    receipt_ref: receiptRef,
    estimator: "ECONML_DML",
    runtime_profile: "CAUSAL_L5",
    agent_image: causalAgentImage,
    operator_image: operatorImage,
  });
  const identificationPlanRef = reference("IdentificationPlan", 45, await sha256ContentHash(plan));
  const queryRef = reference("QueryEvidence", 46);
  const inputRef = reference("SandboxResult", 47);
  const resultRef = reference("SandboxResult", 51);
  const tableRef = reference("SandboxResult", 91);
  const chartRef = reference("SandboxResult", 92);
  const sandboxReceipt: AnalysisSandboxExecutionReceipt =
    analysisSandboxExecutionReceiptSchema.parse({
      schema_version: "analysis-sandbox-execution-receipt@1.0.0",
      workspace_id: scope.tenant_id,
      run_id: runId,
      attempt_id: id(70),
      worker_fence: 1,
      fence_token: "root-cause-fence",
      idempotency_key: "root-cause-analysis-execution",
      request_hash: hash("1"),
      analysis_program_ref: planRef,
      node_id: "root-cause",
      runtime_profile: "CAUSAL_L5",
      runtime: {
        provider: "OpenSandbox",
        opensandbox_sdk_version: "opensandbox-sdk@1.0.0",
        code_interpreter_sdk_version: "code-interpreter-sdk@1.0.0",
        agent_image: causalAgentImage,
        operator_image: operatorImage,
        agent_sandbox_id: id(71),
        operator_sandbox_id: id(72),
      },
      generated_source_policy: "OPEN_ANALYSIS",
      operator_registry_digest: hash("2"),
      operator_obligations: [],
      operator_receipts: [],
      operator_receipt_closure_hash: hash("3"),
      result_contract_hash: hash("6"),
      publish_manifest_hash: hash("7"),
      published_closure_hash: hash("8"),
      publish_id: "root-cause-publish",
      inputs: [
        {
          name: "causal_input",
          format: "ARROW",
          query_evidence_ref: queryRef,
          input_ref: inputRef,
          materialization_receipt_ref: reference("AnalysisInputMaterializationReceipt", 49),
          content_sha256: inputRef.content_hash,
          bytes: 128,
        },
      ],
      cells: [
        {
          cell_id: "root-cause-cell",
          source_sha256: hash("4"),
          execution_id: "causal-execution",
          execution_count: 1,
          elapsed_ms: 20,
          status: "SUCCEEDED",
        },
      ],
      started_at: now,
      finished_at: "2026-08-22T00:00:01.000Z",
      elapsed_ms: 1_000,
      hard_controls: {
        network_isolated: true,
        scoped_filesystem: true,
        separate_operator_sandbox: true,
        resource_limits_enforced: true,
        secure_access: true,
      },
      status: "SUCCEEDED",
      failure_code: null,
      outputs: [
        {
          artifact_name: "result",
          artifact_kind: "RESULT",
          media_type: "application/json",
          reference: resultRef,
          content_sha256: resultRef.content_hash,
          bytes: 256,
        },
        {
          artifact_name: "table:root_cause",
          artifact_kind: "TABLE",
          media_type: "application/json",
          reference: tableRef,
          content_sha256: tableRef.content_hash,
          bytes: 256,
        },
        {
          artifact_name: "chart:root_cause",
          artifact_kind: "CHART",
          media_type: "application/json",
          reference: chartRef,
          content_sha256: chartRef.content_hash,
          bytes: 256,
        },
      ],
      execution_hash: hash("5"),
    });
  const sandboxReceiptRef = reference(
    "SandboxExecutionReceipt",
    50,
    await sha256ContentHash(sandboxReceipt),
  );
  const estimate = await createCausalEstimate({
    question,
    question_ref: questionRef,
    plan,
    plan_ref: identificationPlanRef,
    analysis_program_ref: planRef,
    sandbox_execution_receipt_ref: sandboxReceiptRef,
    sandbox_result_refs: [resultRef, tableRef, chartRef],
    computation: {
      point_estimate: 2,
      interval_low: 1.5,
      interval_high: 2.5,
      effective_sample_size: 800,
      overlap_score: computation.overlap_score ?? 0.8,
      maximum_standardized_mean_difference: 0.05,
      refutations: [
        "PLACEBO_TREATMENT",
        "RANDOM_COMMON_CAUSE",
        "DATA_SUBSET",
        "BOOTSTRAP",
        "NEGATIVE_CONTROL",
        "SENSITIVITY",
      ].map((refuter, index) => ({
        refuter,
        verdict: computation.fail_refutation && index === 0 ? ("FAIL" as const) : ("PASS" as const),
        observed_statistic: 0,
        threshold: 0.05,
      })) as CausalEstimatePayload["refutations"],
      sensitivity: {
        robustness_value: 2,
        negative_control_passed: true,
        unobserved_confounding_bound: 0.2,
      },
      limitation_codes: [],
    },
  });
  const estimateRef = reference("CausalEstimate", 52, await sha256ContentHash(estimate));
  return {
    context,
    planRef,
    candidate,
    candidateRef,
    receipt,
    receiptRef,
    question,
    questionRef,
    plan,
    identificationPlanRef,
    sandboxReceipt,
    sandboxReceiptRef,
    estimate,
    estimateRef,
  };
}

describe("root cause discovery and causal identification", () => {
  it("keeps ontology-grounded L4 discovery non-causal and multiple-testing bounded", async () => {
    const chain = await causalChain();
    expect(chain.candidate).toMatchObject({ evidence_level: "L4_DISCOVERY" });
    expect(chain.candidate.candidates[0]?.statistical_support.adjusted_p_value).toBe(0.01);
    expect(chain.receipt.validation_verdict).toBe("PASS");
    expect(
      atomicClaimV3PayloadSchema.safeParse({
        artifact_type: "AtomicClaim",
        protocol_version: "atomic-claim@3.0.0",
        claim_id: "causal",
        observation_bindings: [
          {
            binding_id: "effect",
            evidence_ref: chain.estimateRef,
            metric_ref: null,
            output_alias: "ate",
            observed_value: 2,
            result_cell_hash: hash("4"),
          },
        ],
        predicate: { claim_mode: "CAUSAL_ESTIMATE", binding_ids: ["effect"] },
        statement: "Promotion causes revenue to increase.",
        statement_hash: hash("5"),
        evidence_refs: [chain.estimateRef],
        limitations: [],
        disclosures: ["CAUSAL_ESTIMATE_ASSUMPTION_BOUND"],
      }).success,
    ).toBe(false);
  });

  it("keeps weak or temporally ambiguous discovery on HOLD", async () => {
    const context = await contextFixture();
    const candidate = await createRootCauseDiscoveryCandidate({
      context,
      plan_ref: reference("AnalysisProgram", 60),
      source_evidence_refs: [reference("DerivedAnalysisEvidence", 61)],
      outcome_metric_ref:
        context.metrics[0]?.metric_ref ??
        (() => {
          throw new Error();
        })(),
      observations: [
        {
          factor_id: "promotion",
          factor_kind: "DIMENSION",
          ontology_path: ["promotion", "influences", "revenue"],
          temporal_order: "UNKNOWN",
          method: "conditional-association@1",
          effect_direction: "UNKNOWN",
          effect_size: null,
          interval_low: null,
          interval_high: null,
          raw_p_value: 0.2,
          sample_size: 50,
          competing_explanations: ["Reverse causality"],
          uncovered_boundaries: ["Small sample"],
        },
      ],
    });
    const receipt = await createRootCauseDiscoveryReceipt({
      context,
      candidate,
      candidate_ref: reference("DiscoveryCandidate", 62, await sha256ContentHash(candidate)),
    });
    expect(receipt).toMatchObject({
      temporal_order_verdict: "HOLD",
      multiple_testing_verdict: "HOLD",
      validation_verdict: "HOLD",
      reason_codes: ["ROOT_CAUSE_NOT_IDENTIFIABLE"],
    });
  });

  it("certifies only the complete current Attribution authority chain", async () => {
    const chain = await causalChain();
    const authority = await authorityFixture(chain.question.question_hash);
    const certificate = await createIdentificationCertificate({
      now: new Date("2026-08-22T00:30:00.000Z"),
      context: chain.context,
      question: chain.question,
      question_ref: chain.questionRef,
      plan: chain.plan,
      plan_ref: chain.identificationPlanRef,
      estimate: chain.estimate,
      estimate_ref: chain.estimateRef,
      discovery_receipt_ref: chain.receiptRef,
      sandbox_receipt: chain.sandboxReceipt,
      sandbox_receipt_ref: chain.sandboxReceiptRef,
      authority,
    });
    expect(certificate.verdict).toBe("CERTIFIED");
    expect(certificate.gates).toHaveLength(10);
    expect(certificate.gates.every(({ verdict }) => verdict === "PASS")).toBe(true);
  });

  it("stops reverse causality and mediator adjustment before estimator execution", async () => {
    await expect(causalChain({}, await contextFixture({ reverse_edge: true }))).rejects.toThrow(
      "IDENTIFICATION_DAG_ADJUSTMENT_INVALID",
    );
    await expect(
      causalChain({}, await contextFixture({ adjustment_set_object_ids: ["visits"] })),
    ).rejects.toThrow("IDENTIFICATION_DAG_ADJUSTMENT_INVALID");
  });

  it.each([
    ["overlap", { overlap_score: 0.01 }, "CAUSAL_OVERLAP_INSUFFICIENT"],
    ["refutation", { fail_refutation: true }, "CAUSAL_REFUTATION_FAILED"],
  ] as const)("holds on failed %s gate", async (_name, computation, reason) => {
    const chain = await causalChain(computation);
    const certificate = await createIdentificationCertificate({
      now: new Date("2026-08-22T00:30:00.000Z"),
      context: chain.context,
      question: chain.question,
      question_ref: chain.questionRef,
      plan: chain.plan,
      plan_ref: chain.identificationPlanRef,
      estimate: chain.estimate,
      estimate_ref: chain.estimateRef,
      discovery_receipt_ref: chain.receiptRef,
      sandbox_receipt: chain.sandboxReceipt,
      sandbox_receipt_ref: chain.sandboxReceiptRef,
      authority: await authorityFixture(chain.question.question_hash),
    });
    expect(certificate.verdict).toBe("HOLD");
    expect(certificate.reason_codes).toContain(reason);
  });

  it("invalidates expired authority and semantic drift instead of reviving on replay", async () => {
    const chain = await causalChain();
    const expired = await createIdentificationCertificate({
      now: new Date("2026-08-22T02:00:00.000Z"),
      context: chain.context,
      question: chain.question,
      question_ref: chain.questionRef,
      plan: chain.plan,
      plan_ref: chain.identificationPlanRef,
      estimate: chain.estimate,
      estimate_ref: chain.estimateRef,
      discovery_receipt_ref: chain.receiptRef,
      sandbox_receipt: chain.sandboxReceipt,
      sandbox_receipt_ref: chain.sandboxReceiptRef,
      authority: await authorityFixture(chain.question.question_hash),
    });
    expect(expired).toMatchObject({ verdict: "HOLD", reason_codes: ["CAUSAL_REFUTATION_FAILED"] });

    const driftedContext = await contextFixture({ semantic_inference_receipt_hash: hash("9") });
    const drifted = await createIdentificationCertificate({
      now: new Date("2026-08-22T00:30:00.000Z"),
      context: driftedContext,
      question: chain.question,
      question_ref: chain.questionRef,
      plan: chain.plan,
      plan_ref: chain.identificationPlanRef,
      estimate: chain.estimate,
      estimate_ref: chain.estimateRef,
      discovery_receipt_ref: chain.receiptRef,
      sandbox_receipt: chain.sandboxReceipt,
      sandbox_receipt_ref: chain.sandboxReceiptRef,
      authority: await authorityFixture(chain.question.question_hash),
    });
    expect(drifted.verdict).toBe("HOLD");
    expect(drifted.reason_codes).toContain("ROOT_CAUSE_NOT_IDENTIFIABLE");
  });
});
