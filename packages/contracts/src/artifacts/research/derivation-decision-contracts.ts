import { researchBudgetLedgerBindingV2Schema } from "./derivation-budget-contracts.js";
import {
  type ArtifactReference,
  addCanonicalArtifactReferenceIssues,
  addCanonicalEmbeddedReferenceIssues,
  addDistinctArtifactReferenceIssues,
  addScopedReferenceIssues,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  type ContentHash,
  candidateQueryAssessmentSchema,
  computeResearchKernelHashV2,
  contentHashSchema,
  coverageCountsSchema,
  coverageStateV2RefSchema,
  deriveCoverageCounts,
  embeddedNodeReferenceIdentity,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  obligationCoverageSchema,
  obligationExecutionDecisionRefSchema,
  orderedArtifactReferenceArraySchema,
  orderedProofObligationReferenceArraySchema,
  parseInertWireInput,
  proofObligationRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  receiptBindingSchema,
  type researchBudgetBalanceSchema,
  sameJson,
  sameStringSet,
  supportDecisionRefSchema,
  supportedSubsetBindingSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueReasonCodeArraySchema,
  versionFrontierSchema,
  versionIdentifierSchema,
  z,
} from "./derivation-wire-shared.js";

const orderedObligationCoverageSchema = obligationCoverageSchema.superRefine((obligation, ctx) => {
  addCanonicalArtifactReferenceIssues(obligation.obligation_execution_decision_refs, ctx, [
    "obligation_execution_decision_refs",
  ]);
  addCanonicalArtifactReferenceIssues(obligation.query_evidence_refs, ctx, ["query_evidence_refs"]);
  addCanonicalArtifactReferenceIssues(obligation.support_decision_refs, ctx, [
    "support_decision_refs",
  ]);
  addCanonicalArtifactReferenceIssues(obligation.conflict_refs, ctx, ["conflict_refs"]);
});

export const coverageStatePayloadV2Schema = z
  .strictObject({
    artifact_type: z.literal("CoverageState"),
    protocol_version: z.literal("coverage-state@2.0.0"),
    evidence_plan_ref: evidencePlanRefSchema,
    obligation_execution_decision_refs: orderedArtifactReferenceArraySchema(
      obligationExecutionDecisionRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    query_evidence_refs: orderedArtifactReferenceArraySchema(
      queryEvidenceRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    atomic_claim_refs: orderedArtifactReferenceArraySchema(
      atomicClaimRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    evidence_relation_refs: orderedArtifactReferenceArraySchema(evidenceRelationRefSchema, 0, 64),
    support_decision_refs: orderedArtifactReferenceArraySchema(
      supportDecisionRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    hypothesis_assessment_refs: orderedArtifactReferenceArraySchema(
      hypothesisAssessmentRefSchema,
      2,
      U6_WIRE_LIMITS.max_hypotheses,
    ),
    obligations: z
      .array(orderedObligationCoverageSchema)
      .min(1)
      .max(U6_WIRE_LIMITS.max_obligations),
    derived_counts: coverageCountsSchema,
    material_conflict_refs: orderedArtifactReferenceArraySchema(evidenceRelationRefSchema, 0, 64),
    budget_receipt: receiptBindingSchema,
    budget_ledger: researchBudgetLedgerBindingV2Schema,
    version_frontier: versionFrontierSchema,
    version_frontier_hash: contentHashSchema,
    coverage_input_hash: contentHashSchema,
  })
  .superRefine((coverage, ctx) => {
    const obligationIdentities = coverage.obligations.map(({ obligation_ref }) =>
      embeddedNodeReferenceIdentity(obligation_ref),
    );
    if (new Set(obligationIdentities).size !== obligationIdentities.length) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage 中 Obligation 必须唯一。",
        path: ["obligations"],
      });
    }
    if (!sameJson(deriveCoverageCounts(coverage.obligations), coverage.derived_counts)) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage derived_counts 必须从 Obligation 状态重算。",
        path: ["derived_counts"],
      });
    }
    const expectedPlanIdentity = artifactReferenceIdentity(coverage.evidence_plan_ref);
    if (
      coverage.obligations.some(
        ({ obligation_ref }) =>
          artifactReferenceIdentity(obligation_ref.container_ref) !== expectedPlanIdentity,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage Obligation 必须绑定 exact evidence_plan_ref。",
        path: ["obligations"],
      });
    }
    const obligationOrder = [...obligationIdentities].sort();
    for (const [index, identity] of obligationIdentities.entries()) {
      if (identity !== obligationOrder[index]) {
        ctx.addIssue({
          code: "custom",
          message: "Coverage obligations 必须按 Embedded Reference identity 升序。",
          path: ["obligations", index],
        });
        break;
      }
    }

    const anchorScope = {
      app_id: coverage.evidence_plan_ref.app_id,
      tenant_id: coverage.evidence_plan_ref.tenant_id,
      environment: coverage.evidence_plan_ref.environment,
    };
    addScopedReferenceIssues(
      [
        ...coverage.obligation_execution_decision_refs,
        ...coverage.query_evidence_refs,
        ...coverage.atomic_claim_refs,
        ...coverage.evidence_relation_refs,
        ...coverage.support_decision_refs,
        ...coverage.hypothesis_assessment_refs,
        ...coverage.material_conflict_refs,
        ...coverage.obligations.flatMap((obligation) => [
          obligation.obligation_ref.container_ref,
          ...obligation.obligation_execution_decision_refs,
          ...obligation.query_evidence_refs,
          ...obligation.support_decision_refs,
          ...obligation.conflict_refs,
        ]),
        coverage.version_frontier.semantic_release_ref,
        coverage.version_frontier.schema_snapshot_ref,
        coverage.version_frontier.policy_receipt_ref,
      ],
      anchorScope,
      coverage.evidence_plan_ref.run_id,
      ctx,
      ["references"],
    );
  });

const candidateQueryAssessmentV2Schema = candidateQueryAssessmentSchema.superRefine(
  (assessment, ctx) => {
    addCanonicalEmbeddedReferenceIssues(assessment.obligation_refs, ctx, ["obligation_refs"]);
  },
);

const candidateQueryAssessmentV2ArraySchema = z
  .array(candidateQueryAssessmentV2Schema)
  .max(U6_WIRE_LIMITS.max_obligations)
  .superRefine((assessments, ctx) => {
    addCanonicalArtifactReferenceIssues(
      assessments.map(({ query_contract_ref }) => query_contract_ref),
      ctx,
    );
  });

export async function computeCandidateQueryAssessmentV2Hash(input: unknown): Promise<ContentHash> {
  const assessment = parseInertWireInput(candidateQueryAssessmentV2Schema, input);
  const { assessment_hash: _assessmentHash, ...material } = assessment;
  return computeResearchKernelHashV2("u6-candidate-assessment@1", material);
}

export async function verifyCandidateQueryAssessmentV2(
  input: unknown,
): Promise<z.infer<typeof candidateQueryAssessmentV2Schema>> {
  const assessment = parseInertWireInput(candidateQueryAssessmentV2Schema, input);
  const expectedHash = await computeCandidateQueryAssessmentV2Hash(assessment);
  if (expectedHash !== assessment.assessment_hash) {
    throw new TypeError("Candidate Assessment assessment_hash 与 exact material 不匹配。");
  }
  return assessment;
}

export const noCandidateAssessmentV2Schema = z.strictObject({
  obligation_ref: proofObligationRefSchema,
  reason_codes: uniqueReasonCodeArraySchema(1),
  constraint_closure_hash: contentHashSchema,
  assessment_hash: contentHashSchema,
});

const noCandidateAssessmentV2ArraySchema = z
  .array(noCandidateAssessmentV2Schema)
  .max(U6_WIRE_LIMITS.max_obligations)
  .superRefine((assessments, ctx) => {
    addCanonicalEmbeddedReferenceIssues(
      assessments.map(({ obligation_ref }) => obligation_ref),
      ctx,
    );
  });

export async function computeNoCandidateAssessmentV2Hash(input: unknown): Promise<ContentHash> {
  const assessment = parseInertWireInput(noCandidateAssessmentV2Schema, input);
  const { assessment_hash: _assessmentHash, ...material } = assessment;
  return computeResearchKernelHashV2("u6-no-candidate-assessment@1", material);
}

export async function verifyNoCandidateAssessmentV2(
  input: unknown,
): Promise<z.infer<typeof noCandidateAssessmentV2Schema>> {
  const assessment = parseInertWireInput(noCandidateAssessmentV2Schema, input);
  const expectedHash = await computeNoCandidateAssessmentV2Hash(assessment);
  if (expectedHash !== assessment.assessment_hash) {
    throw new TypeError("NoCandidate Assessment assessment_hash 与 exact material 不匹配。");
  }
  return assessment;
}

function validateNoCandidateAssessmentClosure(
  noCandidateRefs: readonly z.infer<typeof proofObligationRefSchema>[],
  assessments: readonly z.infer<typeof noCandidateAssessmentV2Schema>[],
  ctx: z.RefinementCtx,
): void {
  const expected = noCandidateRefs.map(embeddedNodeReferenceIdentity);
  const actual = assessments.map(({ obligation_ref }) =>
    embeddedNodeReferenceIdentity(obligation_ref),
  );
  if (
    expected.length !== actual.length ||
    expected.some((identity, index) => identity !== actual[index])
  ) {
    ctx.addIssue({
      code: "custom",
      message: "NoCandidate Assessment 必须与 no_candidate_obligation_refs 规范排序且一一对应。",
      path: ["no_candidate_assessments"],
    });
  }
}

const candidateSetV2Schema = z
  .strictObject({
    enumerator_version: versionIdentifierSchema,
    unresolved_obligation_refs: orderedProofObligationReferenceArraySchema(
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    no_candidate_obligation_refs: orderedProofObligationReferenceArraySchema(
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    no_candidate_assessments: noCandidateAssessmentV2ArraySchema,
    candidate_set_hash: contentHashSchema,
  })
  .superRefine((candidateSet, ctx) => {
    const unresolved = new Set(
      candidateSet.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    if (
      candidateSet.no_candidate_obligation_refs.some(
        (reference) => !unresolved.has(embeddedNodeReferenceIdentity(reference)),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "no_candidate_obligation_refs 必须是 unresolved_obligation_refs 的子集。",
        path: ["no_candidate_obligation_refs"],
      });
    }
    validateNoCandidateAssessmentClosure(
      candidateSet.no_candidate_obligation_refs,
      candidateSet.no_candidate_assessments,
      ctx,
    );
  });

const supportedSubsetBindingV2Schema = supportedSubsetBindingSchema.superRefine((subset, ctx) => {
  if (subset.claim_refs.length !== subset.support_decision_refs.length) {
    ctx.addIssue({
      code: "custom",
      message: "Supported Subset 必须保持 Claim/SupportDecision 一一映射。",
      path: ["support_decision_refs"],
    });
  }

  // This is a zipped relation, not two independent sets. The Research Kernel
  // canonically orders pairs by SupportDecision identity; claim_refs must keep
  // the corresponding index instead of being sorted independently.
  addDistinctArtifactReferenceIssues(subset.claim_refs, ctx, ["claim_refs"]);
  addCanonicalArtifactReferenceIssues(subset.support_decision_refs, ctx, ["support_decision_refs"]);
});

function demandWithinBalance(
  demand: z.infer<typeof candidateQueryAssessmentSchema>["required_budget"],
  remaining: z.infer<typeof researchBudgetBalanceSchema>,
): boolean {
  return (
    demand.steps <= remaining.steps &&
    demand.model_calls <= remaining.model_calls &&
    demand.sql_executions <= remaining.sql_executions &&
    demand.source_calls <= remaining.source_calls &&
    demand.elapsed_ms <= remaining.elapsed_ms &&
    demand.provider_tokens <= remaining.provider_tokens &&
    demand.provider_cost_microusd <= remaining.provider_cost_microusd
  );
}

const researchStopCommonV2Shape = {
  artifact_type: z.literal("ResearchStopDecision"),
  protocol_version: z.literal("research-stop@2.0.0"),
  coverage_ref: coverageStateV2RefSchema,
  budget_receipt: receiptBindingSchema,
  budget_ledger: researchBudgetLedgerBindingV2Schema,
  candidate_queries: candidateQueryAssessmentV2ArraySchema,
  candidate_set: candidateSetV2Schema,
  supported_subset: supportedSubsetBindingV2Schema,
  reason_codes: uniqueReasonCodeArraySchema(1),
  eig_policy_version: versionIdentifierSchema,
  decision_input_hash: contentHashSchema,
} as const;

const continueStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("CONTINUE"),
  selected_next_query_ref: queryContractRefSchema,
});

const replanStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("REPLAN"),
  replan_obligation_refs: orderedProofObligationReferenceArraySchema(
    1,
    U6_WIRE_LIMITS.max_obligations,
  ),
  replan_assessment: z.strictObject({
    trigger: z.enum(["PLAN_INVALIDATED", "QUERY_COMPILATION_GAP"]),
    executable_with_remaining_budget: z.literal(true),
    assessment_hash: contentHashSchema,
  }),
});

const readyStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("STOP_READY"),
});

const partialStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("STOP_PARTIAL"),
  non_ready_terminal: z.literal("PARTIAL"),
  partial_disclosure_codes: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
});

const needsMoreStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("STOP_NEEDS_MORE_RESEARCH"),
  non_ready_terminal: z.literal("NEEDS_MORE_RESEARCH"),
  resume_requirement_codes: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
});

const inconclusiveStopV2Schema = z.strictObject({
  ...researchStopCommonV2Shape,
  decision: z.literal("STOP_INCONCLUSIVE"),
  non_ready_terminal: z.literal("INCONCLUSIVE"),
  inadmissibility_summary_hash: contentHashSchema,
});

export const researchStopDecisionPayloadV2Schema = z
  .discriminatedUnion("decision", [
    continueStopV2Schema,
    replanStopV2Schema,
    readyStopV2Schema,
    partialStopV2Schema,
    needsMoreStopV2Schema,
    inconclusiveStopV2Schema,
  ])
  .superRefine((decision, ctx) => {
    const unresolved = new Set(
      decision.candidate_set.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    const noCandidate = new Set(
      decision.candidate_set.no_candidate_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    const assessed = new Set(
      decision.candidate_queries.flatMap(({ obligation_refs }) =>
        obligation_refs.map(embeddedNodeReferenceIdentity),
      ),
    );

    if ([...assessed].some((identity) => !unresolved.has(identity))) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate Assessment 只能覆盖 candidate_set 中的 unresolved Obligation。",
        path: ["candidate_queries"],
      });
    }
    const expectedAssessed = [...unresolved].filter((identity) => !noCandidate.has(identity));
    if (
      expectedAssessed.length !== assessed.size ||
      expectedAssessed.some((identity) => !assessed.has(identity))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate Assessment 覆盖必须严格等于 unresolved 与 no-candidate 的补集。",
        path: ["candidate_set"],
      });
    }

    for (const [index, candidate] of decision.candidate_queries.entries()) {
      const fits = demandWithinBalance(candidate.required_budget, decision.budget_ledger.remaining);
      if (
        candidate.admissibility === "EXECUTABLE_NOW" &&
        (candidate.expected_information_gain_microunits === 0 ||
          candidate.waiting_on_codes.length !== 0 ||
          !fits)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "EXECUTABLE_NOW 要求正 EIG、无等待且预算可执行。",
          path: ["candidate_queries", index],
        });
      }
      if (
        candidate.admissibility === "WAITING_EXTERNAL_CAPABILITY" &&
        (candidate.expected_information_gain_microunits === 0 ||
          candidate.waiting_on_codes.length === 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "WAITING_EXTERNAL_CAPABILITY 要求正 EIG 并声明等待条件。",
          path: ["candidate_queries", index],
        });
      }
      if (
        candidate.admissibility === "BUDGET_BLOCKED" &&
        (candidate.expected_information_gain_microunits === 0 ||
          candidate.waiting_on_codes.length !== 0 ||
          fits)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "BUDGET_BLOCKED 要求正 EIG、无等待且 required_budget 超过当前余额。",
          path: ["candidate_queries", index],
        });
      }
      if (candidate.admissibility === "INADMISSIBLE" && candidate.waiting_on_codes.length !== 0) {
        ctx.addIssue({
          code: "custom",
          message: "INADMISSIBLE 不得保留 waiting_on_codes。",
          path: ["candidate_queries", index, "waiting_on_codes"],
        });
      }
    }

    const executable = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "EXECUTABLE_NOW",
    );
    const waiting = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "WAITING_EXTERNAL_CAPABILITY",
    );
    const budgetBlocked = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility === "BUDGET_BLOCKED",
    );
    const nonInadmissible = decision.candidate_queries.filter(
      ({ admissibility }) => admissibility !== "INADMISSIBLE",
    );

    if (decision.decision === "CONTINUE") {
      const selected = [...executable].sort((left, right) => {
        const eig =
          right.expected_information_gain_microunits - left.expected_information_gain_microunits;
        if (eig !== 0) return eig;
        const leftIdentity = artifactReferenceIdentity(left.query_contract_ref);
        const rightIdentity = artifactReferenceIdentity(right.query_contract_ref);
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      })[0];
      if (
        !selected ||
        artifactReferenceIdentity(selected.query_contract_ref) !==
          artifactReferenceIdentity(decision.selected_next_query_ref)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "CONTINUE 必须选择稳定排序后的最高 EIG 可执行 Query。",
          path: ["selected_next_query_ref"],
        });
      }
    }

    if (decision.decision === "REPLAN") {
      if (
        executable.length !== 0 ||
        waiting.length !== 0 ||
        budgetBlocked.length !== 0 ||
        unresolved.size === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REPLAN 要求无可执行、等待或预算阻塞 Query，且至少一个 unresolved Obligation。",
          path: ["decision"],
        });
      }
      if (
        decision.replan_obligation_refs.some(
          (reference) => !unresolved.has(embeddedNodeReferenceIdentity(reference)),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "REPLAN 只能引用 candidate_set 中的 unresolved Obligation。",
          path: ["replan_obligation_refs"],
        });
      }
    }

    if (decision.decision === "STOP_NEEDS_MORE_RESEARCH") {
      const waitingCodes = new Set(waiting.flatMap(({ waiting_on_codes }) => waiting_on_codes));
      const resumable =
        waiting.length > 0 || (budgetBlocked.length > 0 && decision.budget_ledger.top_up_allowed);
      const expectedResumeRequirements =
        waitingCodes.size > 0 ? [...waitingCodes] : ["ADDITIONAL_RESEARCH_BUDGET"];
      if (executable.length !== 0 || !resumable) {
        ctx.addIssue({
          code: "custom",
          message: "NEEDS_MORE_RESEARCH 要求无可执行 Query，并存在等待条件或可补充预算的路径。",
          path: ["decision"],
        });
      }
      if (!sameStringSet(decision.resume_requirement_codes, expectedResumeRequirements)) {
        ctx.addIssue({
          code: "custom",
          message: "Resume Requirement 必须精确等于等待条件或追加预算条件。",
          path: ["resume_requirement_codes"],
        });
      }
    }

    if (decision.decision === "STOP_PARTIAL") {
      const deliverable =
        decision.supported_subset.claim_refs.length > 0 &&
        decision.supported_subset.support_decision_refs.length > 0 &&
        decision.supported_subset.claim_refs.length ===
          decision.supported_subset.support_decision_refs.length &&
        decision.supported_subset.required_disclosures.length > 0;
      if (
        executable.length !== 0 ||
        waiting.length !== 0 ||
        decision.budget_ledger.top_up_allowed ||
        budgetBlocked.length === 0 ||
        nonInadmissible.some(({ admissibility }) => admissibility !== "BUDGET_BLOCKED") ||
        unresolved.size === 0 ||
        !deliverable
      ) {
        ctx.addIssue({
          code: "custom",
          message: "PARTIAL 要求硬预算封顶、仅余预算阻塞路径和非空可交付 Supported Subset。",
          path: ["decision"],
        });
      }
    }

    if (
      decision.decision === "STOP_INCONCLUSIVE" &&
      (unresolved.size === 0 ||
        decision.candidate_queries.some(({ admissibility }) => admissibility !== "INADMISSIBLE"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "INCONCLUSIVE 要求存在 unresolved Obligation，且全部 Candidate 均不可采纳。",
        path: ["decision"],
      });
    }

    const decisionScope = {
      app_id: decision.coverage_ref.app_id,
      tenant_id: decision.coverage_ref.tenant_id,
      environment: decision.coverage_ref.environment,
    };
    const branchReferences: ArtifactReference[] =
      decision.decision === "CONTINUE"
        ? [decision.selected_next_query_ref]
        : decision.decision === "REPLAN"
          ? decision.replan_obligation_refs.map(({ container_ref }) => container_ref)
          : [];
    addScopedReferenceIssues(
      [
        ...decision.candidate_queries.map(({ query_contract_ref }) => query_contract_ref),
        ...decision.candidate_queries.flatMap(({ obligation_refs }) =>
          obligation_refs.map(({ container_ref }) => container_ref),
        ),
        ...decision.candidate_set.unresolved_obligation_refs.map(
          ({ container_ref }) => container_ref,
        ),
        ...decision.candidate_set.no_candidate_obligation_refs.map(
          ({ container_ref }) => container_ref,
        ),
        ...decision.candidate_set.no_candidate_assessments.map(
          ({ obligation_ref }) => obligation_ref.container_ref,
        ),
        ...decision.supported_subset.claim_refs,
        ...decision.supported_subset.support_decision_refs,
        ...branchReferences,
      ],
      decisionScope,
      decision.coverage_ref.run_id,
      ctx,
      ["references"],
    );
  });

/** @internal */
export {
  candidateQueryAssessmentV2ArraySchema,
  candidateQueryAssessmentV2Schema,
  noCandidateAssessmentV2ArraySchema,
  supportedSubsetBindingV2Schema,
  validateNoCandidateAssessmentClosure,
};

export type CoverageStatePayloadV2 = z.infer<typeof coverageStatePayloadV2Schema>;
export type ResearchStopDecisionPayloadV2 = z.infer<typeof researchStopDecisionPayloadV2Schema>;
export type NoCandidateAssessmentV2 = z.infer<typeof noCandidateAssessmentV2Schema>;
