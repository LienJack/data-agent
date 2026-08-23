import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import {
  addUniqueIssues,
  contentHashSchema,
  finiteNumberSchema,
  identifierSchema,
  immutableIdSchema,
  modelProviderSchema,
  nonEmptyTextSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  RESEARCH_RUNTIME_LIMITS,
  shortNonEmptyTextSchema,
  timestampSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueStringArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  embeddedNodeReferenceIdentity,
  hypothesisRefSchema,
  hypothesisSetRefSchema,
  localProofObligationReferenceSchema,
  metricRefSchema,
  modelCertificationReceiptRefSchema,
  policyReceiptRefSchema,
  questionFrameRefSchema,
  researchBriefRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
  successCriterionRefSchema,
} from "./references.js";

export const identityBindingSchema = z.strictObject({
  principal_id: z.string().min(1).max(256),
  delegation_chain_hash: contentHashSchema,
  authority_epoch: nonNegativeIntSchema,
});

export const dataSnapshotBindingSchema = z.strictObject({
  protocol_version: z.literal("data-snapshot-binding@1.0.0"),
  datasource_id: immutableIdSchema,
  strategy: z.enum(["CONTROLLED_REVISION", "NONE"]),
  snapshot_token: versionIdentifierSchema.nullable(),
  schema_manifest_hash: contentHashSchema.nullable(),
  data_manifest_hash: contentHashSchema.nullable(),
  fixture_manifest_hash: contentHashSchema.nullable(),
  replay_state: z.enum(["REPLAYABLE", "REPLAY_UNAVAILABLE"]),
  binding_hash: contentHashSchema,
});

export const versionFrontierSchema = z.strictObject({
  semantic_release_ref: semanticReleaseRefSchema,
  schema_snapshot_ref: schemaSnapshotRefSchema,
  data_snapshot: dataSnapshotBindingSchema,
  policy_receipt_ref: policyReceiptRefSchema,
  identity_binding: identityBindingSchema,
});

export const modelProfileReferenceSchema = z.strictObject({
  provider: modelProviderSchema,
  profile_id: immutableIdSchema,
  profile_version: versionIdentifierSchema,
  model_id: shortNonEmptyTextSchema,
  profile_hash: contentHashSchema,
  certification_receipt_ref: modelCertificationReceiptRefSchema,
});

export const retentionPolicyReferenceSchema = z.strictObject({
  policy_id: identifierSchema,
  policy_version: versionIdentifierSchema,
  policy_hash: contentHashSchema,
});

export const researchBudgetLimitSchema = z.strictObject({
  max_steps: positiveIntSchema.max(RESEARCH_RUNTIME_LIMITS.max_steps),
  max_model_calls: nonNegativeIntSchema.max(RESEARCH_RUNTIME_LIMITS.max_model_calls),
  max_sql_executions: nonNegativeIntSchema.max(RESEARCH_RUNTIME_LIMITS.max_sql_executions),
  max_source_calls: z.literal(RESEARCH_RUNTIME_LIMITS.max_source_calls),
  max_elapsed_ms: positiveIntSchema.max(RESEARCH_RUNTIME_LIMITS.max_elapsed_ms),
  max_provider_input_tokens_per_call: positiveIntSchema.max(
    RESEARCH_RUNTIME_LIMITS.max_provider_input_tokens_per_call,
  ),
  max_provider_output_tokens_per_call: positiveIntSchema.max(
    RESEARCH_RUNTIME_LIMITS.max_provider_output_tokens_per_call,
  ),
  max_provider_tokens_per_run: positiveIntSchema.max(
    RESEARCH_RUNTIME_LIMITS.max_provider_tokens_per_run,
  ),
  max_provider_cost_microusd_per_run: nonNegativeIntSchema.max(
    RESEARCH_RUNTIME_LIMITS.max_provider_cost_microusd_per_run,
  ),
});

export const researchBudgetUsageSchema = z
  .strictObject({
    steps: nonNegativeIntSchema,
    model_calls: nonNegativeIntSchema,
    sql_executions: nonNegativeIntSchema,
    source_calls: z.literal(0),
    elapsed_ms: nonNegativeIntSchema,
    provider_input_tokens: nonNegativeIntSchema,
    provider_output_tokens: nonNegativeIntSchema,
    provider_tokens: nonNegativeIntSchema,
    provider_cost_microusd: nonNegativeIntSchema,
  })
  .superRefine((usage, ctx) => {
    if (usage.provider_tokens !== usage.provider_input_tokens + usage.provider_output_tokens) {
      ctx.addIssue({
        code: "custom",
        message: "provider_tokens 必须等于输入与输出 Token 之和。",
        path: ["provider_tokens"],
      });
    }
  });

export const researchBudgetBalanceSchema = z.strictObject({
  steps: nonNegativeIntSchema,
  model_calls: nonNegativeIntSchema,
  sql_executions: nonNegativeIntSchema,
  source_calls: z.literal(0),
  elapsed_ms: nonNegativeIntSchema,
  provider_tokens: nonNegativeIntSchema,
  provider_cost_microusd: nonNegativeIntSchema,
});
export const researchBudgetDemandSchema = researchBudgetBalanceSchema;

const successCriterionSchema = z.strictObject({
  criterion_id: identifierSchema,
  statement: nonEmptyTextSchema,
  materiality: z.enum(["CRITICAL", "SUPPORTING"]),
});

export const researchBriefV2PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("ResearchBrief"),
    protocol_version: z.literal("research-brief@2.0.0"),
    question_frame_ref: questionFrameRefSchema,
    scope: z.strictObject({
      subject: nonEmptyTextSchema,
      time_window: z.strictObject({
        start: timestampSchema,
        end: timestampSchema,
        timezone: z.string().min(1).max(64),
        semantics: z.literal("HALF_OPEN"),
      }),
      dimensions: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_dimensions),
      metric_refs: z
        .array(metricRefSchema)
        .min(1)
        .max(U6_WIRE_LIMITS.max_metric_refs)
        .superRefine((values, ctx) => {
          addUniqueIssues(
            values,
            embeddedNodeReferenceIdentity,
            ctx,
            [],
            "Metric Reference 必须唯一。",
          );
        }),
    }),
    success_criteria: z
      .array(successCriterionSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_success_criteria),
    evidence_policy: z.strictObject({
      allowed_kinds: z.tuple([z.literal("QUERY")]),
      minimum_support_mode: z.literal("DETERMINISTIC"),
      unsupported_source_behavior: z.literal("REJECT"),
    }),
    hypothesis_universe_policy: z.strictObject({
      candidate_sources: z
        .array(z.enum(["USER_PROVIDED", "METRIC_DECOMPOSITION", "DOMAIN_TAXONOMY"]))
        .min(1)
        .max(3),
      enumerator_version: versionIdentifierSchema,
      required_disclosure: z.literal("BOUNDED_HYPOTHESIS_UNIVERSE"),
    }),
    freshness_policy: z.strictObject({
      max_age_seconds: nonNegativeIntSchema,
      require_snapshot_replayable: z.boolean(),
    }),
    source_independence_policy: z.strictObject({
      mode: z.enum(["ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE", "MULTI_PROVENANCE_REQUIRED"]),
      minimum_provenance_groups: positiveIntSchema.max(32),
      required_disclosures: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_required_disclosures),
    }),
    claim_policy: z.strictObject({
      allowed_modes: z.tuple([
        z.literal("DESCRIPTIVE"),
        z.literal("COMPARATIVE"),
        z.literal("DIAGNOSTIC"),
      ]),
      forbidden_modes: z.tuple([
        z.literal("CAUSAL"),
        z.literal("PRESCRIPTIVE"),
        z.literal("ACTION_EXECUTING"),
      ]),
    }),
    budget: researchBudgetLimitSchema,
    policy_ref: policyReceiptRefSchema,
    policy_digest: contentHashSchema,
    data_classification: z.enum(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
    retention_policy_ref: retentionPolicyReferenceSchema,
  })
  .superRefine((brief, ctx) => {
    if (Date.parse(brief.scope.time_window.start) >= Date.parse(brief.scope.time_window.end)) {
      ctx.addIssue({
        code: "custom",
        message: "ResearchBrief 时间窗口必须满足 start < end。",
        path: ["scope", "time_window"],
      });
    }
    addUniqueIssues(
      brief.success_criteria,
      ({ criterion_id }) => criterion_id,
      ctx,
      ["success_criteria"],
      "Success Criterion ID 必须唯一。",
    );
    if (!brief.success_criteria.some(({ materiality }) => materiality === "CRITICAL")) {
      ctx.addIssue({
        code: "custom",
        message: "ResearchBrief 至少需要一个 CRITICAL Success Criterion。",
        path: ["success_criteria"],
      });
    }
    addUniqueIssues(
      brief.hypothesis_universe_policy.candidate_sources,
      (value) => value,
      ctx,
      ["hypothesis_universe_policy", "candidate_sources"],
      "Hypothesis candidate source 必须唯一。",
    );
    const metricContainers = new Set(
      brief.scope.metric_refs.map(({ container_ref }) => artifactReferenceIdentity(container_ref)),
    );
    if (metricContainers.size !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "所有 MetricRef 必须属于同一个 SemanticRelease Revision。",
        path: ["scope", "metric_refs"],
      });
    }
    const independence = brief.source_independence_policy;
    if (
      independence.mode === "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE" &&
      (independence.minimum_provenance_groups !== 1 ||
        !independence.required_disclosures.includes("SINGLE_AUTHORITY_SOURCE"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "单一权威来源模式必须声明单来源披露且 provenance group 等于 1。",
        path: ["source_independence_policy"],
      });
    }
    if (
      independence.mode === "MULTI_PROVENANCE_REQUIRED" &&
      independence.minimum_provenance_groups < 2
    ) {
      ctx.addIssue({
        code: "custom",
        message: "多来源模式至少需要两个 provenance group。",
        path: ["source_independence_policy", "minimum_provenance_groups"],
      });
    }
  });

export const hypothesisV2Schema = z.strictObject({
  hypothesis_id: identifierSchema,
  mechanism_class: identifierSchema,
  statement: nonEmptyTextSchema,
  predictions: uniqueStringArraySchema(1, U6_WIRE_LIMITS.max_predictions_per_hypothesis),
  falsifiers: uniqueStringArraySchema(1, U6_WIRE_LIMITS.max_falsifiers_per_hypothesis),
  discriminating_test_ids: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_tests_per_hypothesis),
  materiality: z.enum(["MATERIAL", "ALTERNATIVE"]),
  planning_status: z.literal("ADMISSIBLE"),
});

export const hypothesisSetV2PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("HypothesisSet"),
    protocol_version: z.literal("hypothesis-set@2.0.0"),
    brief_ref: researchBriefRefSchema,
    hypotheses: z.array(hypothesisV2Schema).min(2).max(U6_WIRE_LIMITS.max_hypotheses),
    mechanism_validator_version: versionIdentifierSchema,
    hypothesis_universe_hash: contentHashSchema,
  })
  .superRefine((set, ctx) => {
    addUniqueIssues(
      set.hypotheses,
      ({ hypothesis_id }) => hypothesis_id,
      ctx,
      ["hypotheses"],
      "Hypothesis ID 必须唯一。",
    );
    if (set.hypotheses.filter(({ materiality }) => materiality === "MATERIAL").length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "HypothesisSet 至少需要两个 MATERIAL Hypothesis。",
        path: ["hypotheses"],
      });
    }
    const allTestIds = set.hypotheses.flatMap(({ discriminating_test_ids }) =>
      discriminating_test_ids.map((testId) => ({ testId })),
    );
    addUniqueIssues(
      allTestIds,
      ({ testId }) => testId,
      ctx,
      ["hypotheses"],
      "discriminating_test_id 必须在 HypothesisSet 内全局唯一。",
    );
    addUniqueIssues(
      set.hypotheses,
      ({ mechanism_class, predictions, falsifiers }) =>
        JSON.stringify([mechanism_class, [...predictions].sort(), [...falsifiers].sort()]),
      ctx,
      ["hypotheses"],
      "HYPOTHESIS_COLLAPSE：机制、Prediction 与 Falsifier 不能重复。",
    );
  });

export const observationPredicateSchema = z.discriminatedUnion("operator", [
  z.strictObject({
    operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ"]),
    threshold: finiteNumberSchema,
  }),
  z
    .strictObject({
      operator: z.literal("BETWEEN"),
      threshold: z.tuple([finiteNumberSchema, finiteNumberSchema]),
      bounds: z.literal("CLOSED"),
    })
    .superRefine((predicate, ctx) => {
      if (predicate.threshold[0] > predicate.threshold[1]) {
        ctx.addIssue({
          code: "custom",
          message: "BETWEEN threshold 必须按低到高排序。",
          path: ["threshold"],
        });
      }
    }),
]);

type PredicateInterval = {
  low: number;
  lowClosed: boolean;
  high: number;
  highClosed: boolean;
};

function predicateInterval(
  predicate: z.infer<typeof observationPredicateSchema>,
): PredicateInterval {
  switch (predicate.operator) {
    case "GT":
      return { low: predicate.threshold, lowClosed: false, high: Infinity, highClosed: false };
    case "GTE":
      return { low: predicate.threshold, lowClosed: true, high: Infinity, highClosed: false };
    case "LT":
      return { low: -Infinity, lowClosed: false, high: predicate.threshold, highClosed: false };
    case "LTE":
      return { low: -Infinity, lowClosed: false, high: predicate.threshold, highClosed: true };
    case "EQ":
      return {
        low: predicate.threshold,
        lowClosed: true,
        high: predicate.threshold,
        highClosed: true,
      };
    case "BETWEEN":
      return {
        low: predicate.threshold[0],
        lowClosed: true,
        high: predicate.threshold[1],
        highClosed: true,
      };
  }
}

function intervalsOverlap(left: PredicateInterval, right: PredicateInterval): boolean {
  const low = Math.max(left.low, right.low);
  const high = Math.min(left.high, right.high);
  if (low < high) return true;
  if (low > high) return false;
  const leftContains = (low > left.low || left.lowClosed) && (low < left.high || left.highClosed);
  const rightContains =
    (low > right.low || right.lowClosed) && (low < right.high || right.highClosed);
  return leftContains && rightContains;
}

export const observationContractSchema = z
  .strictObject({
    metric_ref: metricRefSchema,
    aggregation: z.enum(["SUM", "COUNT", "AVG", "MIN", "MAX", "RATIO"]),
    unit: z.string().min(1).max(128),
    support_predicate: observationPredicateSchema,
    refute_predicate: observationPredicateSchema,
    null_behavior: z.enum(["FAIL", "IGNORE", "ZERO"]),
    contract_hash: contentHashSchema,
  })
  .superRefine((contract, ctx) => {
    if (
      intervalsOverlap(
        predicateInterval(contract.support_predicate),
        predicateInterval(contract.refute_predicate),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Observation support/refute Predicate 的真值区域不能重叠。",
        path: ["refute_predicate"],
      });
    }
  });

export const proofObligationV2Schema = z
  .strictObject({
    obligation_id: identifierSchema,
    hypothesis_refs: z
      .array(hypothesisRefSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_hypothesis_refs_per_obligation),
    success_criterion_refs: z
      .array(successCriterionRefSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_criterion_refs_per_obligation),
    discriminating_test_ids: uniqueIdentifierArraySchema(
      1,
      U6_WIRE_LIMITS.max_tests_per_hypothesis,
    ),
    materiality: z.enum(["CRITICAL", "SUPPORTING"]),
    evidence_kind: z.literal("QUERY"),
    depends_on: z
      .array(localProofObligationReferenceSchema)
      .max(U6_WIRE_LIMITS.max_dependencies_per_obligation),
    observation_contract: observationContractSchema,
    failure_behavior: z.enum(["BLOCK_READY", "ALLOW_PARTIAL_WITH_DISCLOSURE"]),
  })
  .superRefine((obligation, ctx) => {
    addUniqueIssues(
      obligation.hypothesis_refs,
      embeddedNodeReferenceIdentity,
      ctx,
      ["hypothesis_refs"],
      "HypothesisRef 必须唯一。",
    );
    addUniqueIssues(
      obligation.success_criterion_refs,
      embeddedNodeReferenceIdentity,
      ctx,
      ["success_criterion_refs"],
      "SuccessCriterionRef 必须唯一。",
    );
    addUniqueIssues(
      obligation.depends_on,
      ({ node_id }) => node_id,
      ctx,
      ["depends_on"],
      "depends_on 必须唯一。",
    );
    if (obligation.depends_on.some(({ node_id }) => node_id === obligation.obligation_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Proof Obligation 不能自依赖。",
        path: ["depends_on"],
      });
    }
  });

function validateObligationGraph(
  obligations: readonly z.infer<typeof proofObligationV2Schema>[],
  ctx: z.RefinementCtx,
): void {
  const nodes = new Map(obligations.map((obligation) => [obligation.obligation_id, obligation]));
  for (const [index, obligation] of obligations.entries()) {
    for (const dependency of obligation.depends_on) {
      if (!nodes.has(dependency.node_id)) {
        ctx.addIssue({
          code: "custom",
          message: "depends_on 必须命中同一 EvidencePlan 的 Obligation。",
          path: ["obligations", index, "depends_on"],
        });
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string, depth: number): void => {
    if (depth > U6_WIRE_LIMITS.max_dependency_depth) {
      ctx.addIssue({
        code: "custom",
        message: "Obligation 依赖深度超过上限。",
        path: ["obligations"],
      });
      return;
    }
    if (visiting.has(nodeId)) {
      ctx.addIssue({
        code: "custom",
        message: "EvidencePlan Obligation 图不能成环。",
        path: ["obligations"],
      });
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const dependency of nodes.get(nodeId)?.depends_on ?? []) {
      visit(dependency.node_id, depth + 1);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodes.keys()) visit(nodeId, 1);
}

export const evidencePlanV2PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("EvidencePlan"),
    protocol_version: z.literal("evidence-plan@2.0.0"),
    brief_ref: researchBriefRefSchema,
    hypothesis_set_ref: hypothesisSetRefSchema,
    obligations: z.array(proofObligationV2Schema).min(1).max(U6_WIRE_LIMITS.max_obligations),
    planner_version: versionIdentifierSchema,
    obligation_graph_hash: contentHashSchema,
  })
  .superRefine((plan, ctx) => {
    addUniqueIssues(
      plan.obligations,
      ({ obligation_id }) => obligation_id,
      ctx,
      ["obligations"],
      "Obligation ID 必须唯一。",
    );
    const hypothesisSetIdentity = artifactReferenceIdentity(plan.hypothesis_set_ref);
    const briefIdentity = artifactReferenceIdentity(plan.brief_ref);
    for (const [index, obligation] of plan.obligations.entries()) {
      if (
        obligation.hypothesis_refs.some(
          ({ container_ref }) => artifactReferenceIdentity(container_ref) !== hypothesisSetIdentity,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "HypothesisRef 必须绑定 EvidencePlan 的 exact HypothesisSet。",
          path: ["obligations", index, "hypothesis_refs"],
        });
      }
      if (
        obligation.success_criterion_refs.some(
          ({ container_ref }) => artifactReferenceIdentity(container_ref) !== briefIdentity,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "SuccessCriterionRef 必须绑定 EvidencePlan 的 exact ResearchBrief。",
          path: ["obligations", index, "success_criterion_refs"],
        });
      }
    }
    validateObligationGraph(plan.obligations, ctx);
  });

export type IdentityBinding = z.infer<typeof identityBindingSchema>;
export type DataSnapshotBinding = z.infer<typeof dataSnapshotBindingSchema>;
export type VersionFrontier = z.infer<typeof versionFrontierSchema>;
export type ModelProfileReference = z.infer<typeof modelProfileReferenceSchema>;
export type RetentionPolicyReference = z.infer<typeof retentionPolicyReferenceSchema>;
export type ResearchBudgetLimit = z.infer<typeof researchBudgetLimitSchema>;
export type ResearchBudgetUsage = z.infer<typeof researchBudgetUsageSchema>;
export type ResearchBudgetBalance = z.infer<typeof researchBudgetBalanceSchema>;
export type ResearchBudgetDemand = z.infer<typeof researchBudgetDemandSchema>;
export type ResearchBriefV2Payload = z.infer<typeof researchBriefV2PayloadSchema>;
export type HypothesisV2 = z.infer<typeof hypothesisV2Schema>;
export type HypothesisSetV2Payload = z.infer<typeof hypothesisSetV2PayloadSchema>;
export type ObservationPredicate = z.infer<typeof observationPredicateSchema>;
export type ObservationContract = z.infer<typeof observationContractSchema>;
export type ProofObligationV2 = z.infer<typeof proofObligationV2Schema>;
export type EvidencePlanV2Payload = z.infer<typeof evidencePlanV2PayloadSchema>;
