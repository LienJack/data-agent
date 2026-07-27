import { z } from "zod";

const partialPreconditionsSchema = z.strictObject({
  hard_budget_cap: z.literal(true),
  deliverable_supported_subset: z.literal(true),
  budget_executable_query_count: z.literal(0),
});

const partialTerminalSchema = z.strictObject({
  terminal: z.literal("PARTIAL"),
  reason_code: z.literal("EVIDENCE_PARTIAL"),
});
const staleTerminalSchema = z.strictObject({
  terminal: z.literal("STALE"),
  reason_code: z.literal("RUN_STALE"),
});
const failedTerminalSchema = z.strictObject({
  terminal: z.literal("FAILED"),
  reason_code: z.literal("INTERNAL_EXECUTION_FAILED"),
});

function partialMutation<const I extends string, const R extends string>(
  mutationId: I,
  domainReason: R,
) {
  return z.strictObject({
    mutation_id: z.literal(mutationId),
    partial_preconditions: partialPreconditionsSchema,
    public_terminal: partialTerminalSchema,
    domain_reason_code: z.literal(domainReason),
    certificate_issued: z.literal(false),
    grant_issued: z.literal(false),
  });
}

function terminalMutation<
  const I extends string,
  const R extends string,
  const T extends z.ZodType,
>(mutationId: I, terminal: T, domainReason: R) {
  return z.strictObject({
    mutation_id: z.literal(mutationId),
    partial_preconditions: z.null(),
    public_terminal: terminal,
    domain_reason_code: z.literal(domainReason),
    certificate_issued: z.literal(false),
    grant_issued: z.literal(false),
  });
}

function rejectedMutation<const I extends string, const R extends string>(
  mutationId: I,
  domainReason: R,
) {
  return z.strictObject({
    mutation_id: z.literal(mutationId),
    partial_preconditions: z.null(),
    public_terminal: z.null(),
    domain_reason_code: z.literal(domainReason),
    certificate_issued: z.literal(false),
    grant_issued: z.literal(false),
  });
}

export const CONTROLLED_RQ092_MUTATION_IDS = [
  "citation-only",
  "hidden-conflict",
  "critical-query-failure",
  "stale-cross-revision",
  "budget-false-complete",
  "writer-bypass",
  "false-source-independence",
  "wrong-successful-sql",
  "wrong-filter-successful-sql",
  "bounded-universe-disclosure-omission",
  "supervisor-certificate-bypass",
  "certificate-tamper",
  "certificate-semantic-hash-tamper",
  "current-ready-revocation-race",
] as const;

export const CONTROLLED_PARTIAL_MUTATION_IDS = [
  "citation-only",
  "hidden-conflict",
  "critical-query-failure",
  "budget-false-complete",
  "false-source-independence",
  "wrong-successful-sql",
  "wrong-filter-successful-sql",
  "bounded-universe-disclosure-omission",
] as const;

const controlledHypothesesSchema = z.tuple([
  z.strictObject({
    hypothesis_id: z.literal("promotion-mix"),
    metric_alias: z.literal("promotion_decline_share"),
    support_predicate: z.strictObject({
      operator: z.literal("GTE"),
      threshold: z.literal(0.6),
    }),
    refute_predicate: z.strictObject({
      operator: z.literal("LTE"),
      threshold: z.literal(0.3),
    }),
    expected_assessment: z.literal("SURVIVED"),
  }),
  z.strictObject({
    hypothesis_id: z.literal("late-refund"),
    metric_alias: z.literal("late_refund_decline_share"),
    support_predicate: z.strictObject({
      operator: z.literal("GTE"),
      threshold: z.literal(0.4),
    }),
    refute_predicate: z.strictObject({
      operator: z.literal("LTE"),
      threshold: z.literal(0.2),
    }),
    expected_assessment: z.literal("REFUTED"),
  }),
]);

export const q1ControlledFixtureSchema = z.strictObject({
  query_id: z.literal("Q1"),
  depends_on_query_ids: z.tuple([]),
  rows: z.tuple([
    z.strictObject({
      baseline_net_revenue: z.literal(1000),
      current_net_revenue: z.literal(800),
      decline_amount: z.literal(200),
      promotion_contribution: z.literal(140),
      late_refund_contribution: z.literal(20),
      other_contribution: z.literal(40),
    }),
  ]),
});

export const q2ControlledFixtureSchema = z.strictObject({
  query_id: z.literal("Q2"),
  depends_on_query_ids: z.tuple([z.literal("Q1")]),
  rows: z.tuple([
    z.strictObject({
      promotion_decline_share: z.literal(0.7),
      late_refund_decline_share: z.literal(0.1),
    }),
  ]),
});

const mutationRegistrySchema = z.tuple([
  partialMutation("citation-only", "EVIDENCE_SUPPORT_INSUFFICIENT"),
  partialMutation("hidden-conflict", "MATERIAL_CONFLICT_UNDISCLOSED"),
  partialMutation("critical-query-failure", "CRITICAL_OBLIGATION_FAILED"),
  terminalMutation("stale-cross-revision", staleTerminalSchema, "EVIDENCE_REVISION_STALE"),
  partialMutation("budget-false-complete", "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION"),
  terminalMutation("writer-bypass", failedTerminalSchema, "REPORT_PROJECTION_AUTHORITY_INVALID"),
  partialMutation("false-source-independence", "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED"),
  partialMutation("wrong-successful-sql", "OBLIGATION_QUERY_SEMANTICS_MISMATCH"),
  partialMutation("wrong-filter-successful-sql", "OBLIGATION_QUERY_SEMANTICS_MISMATCH"),
  partialMutation(
    "bounded-universe-disclosure-omission",
    "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
  ),
  rejectedMutation("supervisor-certificate-bypass", "REPORT_READY_AUTHORITY_REQUIRED"),
  rejectedMutation("certificate-tamper", "REPORT_READY_CERTIFICATE_TAMPERED"),
  rejectedMutation("certificate-semantic-hash-tamper", "CERTIFICATE_SEMANTIC_HASH_MISMATCH"),
  terminalMutation(
    "current-ready-revocation-race",
    staleTerminalSchema,
    "READINESS_REVOKED_DURING_CONSUMPTION",
  ),
]);

const partialPairGenerationSchema = z.strictObject({
  base_mutation_ids: z.tuple(
    CONTROLLED_PARTIAL_MUTATION_IDS.map((id) => z.literal(id)) as [
      z.ZodLiteral<"citation-only">,
      z.ZodLiteral<"hidden-conflict">,
      z.ZodLiteral<"critical-query-failure">,
      z.ZodLiteral<"budget-false-complete">,
      z.ZodLiteral<"false-source-independence">,
      z.ZodLiteral<"wrong-successful-sql">,
      z.ZodLiteral<"wrong-filter-successful-sql">,
      z.ZodLiteral<"bounded-universe-disclosure-omission">,
    ],
  ),
  continue_suffix: z.literal("--continue"),
  replan_suffix: z.literal("--replan"),
  continue_template: z.strictObject({
    hard_budget_cap: z.literal(false),
    deliverable_supported_subset: z.literal(true),
    budget_executable_query_count: z.literal(1),
    executable_replan_count: z.literal(0),
    expected_decision: z.literal("CONTINUE"),
    expected_reason_code: z.literal("ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE"),
    public_terminal: z.null(),
    certificate_issued: z.literal(false),
    grant_issued: z.literal(false),
  }),
  replan_template: z.strictObject({
    hard_budget_cap: z.literal(false),
    deliverable_supported_subset: z.literal(true),
    budget_executable_query_count: z.literal(0),
    waiting_query_count: z.literal(0),
    budget_blocked_query_count: z.literal(0),
    open_obligation_count: z.literal(1),
    replan_trigger: z.enum(["PLAN_INVALIDATED", "QUERY_COMPILATION_GAP"]),
    executable_with_remaining_budget: z.literal(true),
    expected_decision: z.literal("REPLAN"),
    expected_reason_code: z.literal("EVIDENCE_PLAN_REPLAN_REQUIRED"),
    public_terminal: z.null(),
    certificate_issued: z.literal(false),
    grant_issued: z.literal(false),
  }),
  generated_count: z.literal(16),
});

export const controlledFixtureContractSchema = z
  .strictObject({
    protocol_version: z.literal("u6-controlled-fixture@1.0.0"),
    fixture_id: z.literal("retail-revenue-investigation-v1"),
    authority_kind: z.literal("SYNTHETIC_PROTOCOL_FIXTURE"),
    benchmark_eligible: z.literal(false),
    demo_truth_eligible: z.literal(false),
    release_evidence_eligible: z.literal(false),
    question: z.literal(
      "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？",
    ),
    hypotheses: controlledHypothesesSchema,
    queries: z.tuple([q1ControlledFixtureSchema, q2ControlledFixtureSchema]),
    rq092_mutation_ids: z.tuple(
      CONTROLLED_RQ092_MUTATION_IDS.map((id) => z.literal(id)) as [
        z.ZodLiteral<"citation-only">,
        z.ZodLiteral<"hidden-conflict">,
        z.ZodLiteral<"critical-query-failure">,
        z.ZodLiteral<"stale-cross-revision">,
        z.ZodLiteral<"budget-false-complete">,
        z.ZodLiteral<"writer-bypass">,
        z.ZodLiteral<"false-source-independence">,
        z.ZodLiteral<"wrong-successful-sql">,
        z.ZodLiteral<"wrong-filter-successful-sql">,
        z.ZodLiteral<"bounded-universe-disclosure-omission">,
        z.ZodLiteral<"supervisor-certificate-bypass">,
        z.ZodLiteral<"certificate-tamper">,
        z.ZodLiteral<"certificate-semantic-hash-tamper">,
        z.ZodLiteral<"current-ready-revocation-race">,
      ],
    ),
    mutation_count: z.literal(14),
    partial_mutation_count: z.literal(8),
    generated_partial_pair_count: z.literal(16),
    mutation_registry: mutationRegistrySchema,
    partial_pair_generation: partialPairGenerationSchema,
    required_disclosures: z.tuple([
      z.literal("SINGLE_AUTHORITY_SOURCE"),
      z.literal("L2_NON_CAUSAL"),
      z.literal("BOUNDED_HYPOTHESIS_UNIVERSE"),
    ]),
    expected: z.strictObject({
      promotion_mix: z.literal("SURVIVED"),
      late_refund: z.literal("REFUTED"),
      stop_decision: z.literal("STOP_READY"),
      public_terminal: z.literal("READY"),
      public_reason_code: z.literal("RUN_READY"),
      release_decision: z.literal("HOLD"),
    }),
  })
  .superRefine((fixture, ctx) => {
    const registryIds = fixture.mutation_registry.map(({ mutation_id }) => mutation_id);
    if (JSON.stringify(registryIds) !== JSON.stringify(fixture.rq092_mutation_ids)) {
      ctx.addIssue({
        code: "custom",
        message: "Mutation Registry 顺序必须严格等于 rq092_mutation_ids。",
        path: ["mutation_registry"],
      });
    }
    const partialCount = fixture.mutation_registry.filter(
      ({ partial_preconditions }) => partial_preconditions !== null,
    ).length;
    if (
      fixture.mutation_registry.length !== fixture.mutation_count ||
      partialCount !== fixture.partial_mutation_count ||
      fixture.partial_pair_generation.base_mutation_ids.length * 2 !==
        fixture.generated_partial_pair_count
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Mutation/Partial/Pair Count 必须从 Registry 重算为 14/8/16。",
        path: ["mutation_count"],
      });
    }
  });

export type Q1ControlledFixture = z.infer<typeof q1ControlledFixtureSchema>;
export type Q2ControlledFixture = z.infer<typeof q2ControlledFixtureSchema>;
export type ControlledFixtureContract = z.infer<typeof controlledFixtureContractSchema>;
