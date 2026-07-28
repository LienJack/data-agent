import { orderedReservationBudgetStateArraySchema } from "./derivation-budget-contracts.js";
import {
  candidateQueryAssessmentV2ArraySchema,
  noCandidateAssessmentV2ArraySchema,
  supportedSubsetBindingV2Schema,
  validateNoCandidateAssessmentClosure,
} from "./derivation-decision-contracts.js";
import {
  addScopedReferenceIssues,
  appScopeSchema,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  type ContentHash,
  type candidateQueryAssessmentSchema,
  computeResearchKernelHashV2,
  contentHashSchema,
  coverageStateV2RefSchema,
  databaseUtcTimestampSchema,
  embeddedNodeReferenceIdentity,
  evidencePlanRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  idempotencyKeySchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  obligationExecutionDecisionRefSchema,
  orderedArtifactReferenceArraySchema,
  orderedProofObligationReferenceArraySchema,
  parseInertWireInput,
  positiveIntSchema,
  type proofObligationRefSchema,
  queryContractRefSchema,
  queryEvidenceRefSchema,
  RESEARCH_RUNTIME_LIMITS,
  receiptBindingSchema,
  referenceMatchesScope,
  reportReadyCertificateV3RefSchema,
  researchBriefRefSchema,
  researchBudgetLimitSchema,
  researchStopDecisionV2RefSchema,
  sameJson,
  sequentialContentHashArraySchema,
  strictResearchCommandBaseSchema,
  supportDecisionRefSchema,
  systemReferenceMatchesScope,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  versionFrontierSchema,
  versionIdentifierSchema,
  z,
} from "./derivation-wire-shared.js";

export const budgetLedgerInputHashMaterialSchema = z
  .strictObject({
    research_brief_ref: researchBriefRefSchema,
    runtime_limits_version: z.literal("RESEARCH_RUNTIME_LIMITS@1"),
    runtime_limits_hash: contentHashSchema,
    tenant_policy_version: versionIdentifierSchema,
    tenant_policy_hash: contentHashSchema,
    budget_epoch: positiveIntSchema,
    budget_started_at: databaseUtcTimestampSchema,
    evaluated_at: databaseUtcTimestampSchema,
    evaluated_through_reservation_seq: nonNegativeIntSchema,
    evaluated_through_budget_event_seq: nonNegativeIntSchema,
    budget_event_head_hash: contentHashSchema,
    ordered_budget_event_hashes: sequentialContentHashArraySchema(
      1,
      U6_WIRE_LIMITS.max_artifact_input_refs,
    ),
    ordered_reservation_states: orderedReservationBudgetStateArraySchema,
    outstanding_set_hash: contentHashSchema,
  })
  .superRefine((material, ctx) => {
    if (Date.parse(material.evaluated_at) < Date.parse(material.budget_started_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Budget evaluated_at 不能早于 budget_started_at。",
        path: ["evaluated_at"],
      });
    }
    if (
      material.ordered_budget_event_hashes.length !== material.evaluated_through_budget_event_seq ||
      material.ordered_budget_event_hashes.at(-1) !== material.budget_event_head_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Event hash chain 必须从 seq=1 完整覆盖至水位并命中 Head。",
        path: ["ordered_budget_event_hashes"],
      });
    }
    if (material.ordered_reservation_states.length !== material.evaluated_through_reservation_seq) {
      ctx.addIssue({
        code: "custom",
        message: "Reservation projection 必须从 seq=1 完整覆盖至 reservation 水位。",
        path: ["ordered_reservation_states"],
      });
    }
    for (const [index, reservation] of material.ordered_reservation_states.entries()) {
      if (reservation.reservation_seq !== index + 1) {
        ctx.addIssue({
          code: "custom",
          message: "Reservation projection 不允许 seq 缺口。",
          path: ["ordered_reservation_states", index, "reservation_seq"],
        });
      }
      const reference = reservation.outcome_usage_ref;
      if (
        reference !== null &&
        !systemReferenceMatchesScope(
          reference,
          {
            app_id: material.research_brief_ref.app_id,
            tenant_id: material.research_brief_ref.tenant_id,
            environment: material.research_brief_ref.environment,
          },
          material.research_brief_ref.run_id,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Reservation OutcomeUsage 必须与 ResearchBrief 属于同一 Scope/Run。",
          path: ["ordered_reservation_states", index, "outcome_usage_ref"],
        });
      }
    }
  });

const derivationClosureRefsSchema = z.strictObject({
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
    0,
    U6_WIRE_LIMITS.max_hypotheses,
  ),
});

export const coverageDerivationInputHashMaterialSchema = z.strictObject({
  evidence_plan_ref: evidencePlanRefSchema,
  budget_receipt: receiptBindingSchema,
  version_frontier: versionFrontierSchema,
  version_frontier_hash: contentHashSchema,
  closure_refs: derivationClosureRefsSchema,
  kernel_version: versionIdentifierSchema,
});

export const candidateEnumerationInputHashMaterialSchema = z.strictObject({
  coverage_receipt: receiptBindingSchema,
  budget_receipt: receiptBindingSchema,
  enumerator_attestation_id: immutableIdSchema,
  enumerator_attestation_hash: contentHashSchema,
  enumerator_head_version: nonNegativeIntSchema,
  enumerator_version: versionIdentifierSchema,
  eig_policy_version: versionIdentifierSchema,
  query_contract_universe_refs: orderedArtifactReferenceArraySchema(
    queryContractRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
});

export const stopDerivationInputHashMaterialSchema = z.strictObject({
  stop_ref: researchStopDecisionV2RefSchema,
  coverage_ref: coverageStateV2RefSchema,
  coverage_receipt: receiptBindingSchema,
  candidate_receipt: receiptBindingSchema,
  budget_receipt: receiptBindingSchema,
  supported_subset: supportedSubsetBindingV2Schema,
  required_disclosures: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_required_disclosures),
  pre_stop_readiness_hash: contentHashSchema,
  kernel_version: versionIdentifierSchema,
  enumerator_version: versionIdentifierSchema,
  eig_policy_version: versionIdentifierSchema,
});

export const inputWatermarkInputHashMaterialSchema = z.strictObject({
  certificate_ref: reportReadyCertificateV3RefSchema,
  observed_event_seq: nonNegativeIntSchema,
  observed_head_hash: contentHashSchema,
  certificate_input_closure_hash: contentHashSchema,
});

export const runtimeLimitsHashMaterialSchema = z
  .strictObject({
    runtime_limits_version: z.literal("RESEARCH_RUNTIME_LIMITS@1"),
    limits: researchBudgetLimitSchema,
  })
  .superRefine((material, ctx) => {
    if (!sameJson(material.limits, RESEARCH_RUNTIME_LIMITS)) {
      ctx.addIssue({
        code: "custom",
        message: "Runtime limits 必须逐字等于 RESEARCH_RUNTIME_LIMITS。",
        path: ["limits"],
      });
    }
  });

export const tenantBudgetPolicyHashMaterialSchema = z.strictObject({
  scope: appScopeSchema,
  tenant_policy_version: versionIdentifierSchema,
  limits: researchBudgetLimitSchema,
  top_up_allowed: z.boolean(),
});

export const outstandingReservationSetHashMaterialSchema = z
  .strictObject({
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    budget_epoch: positiveIntSchema,
    reservations: orderedReservationBudgetStateArraySchema,
  })
  .superRefine((material, ctx) => {
    if (
      material.reservations.some(
        ({ state }) => state !== "RESERVED" && state !== "IN_USE" && state !== "ABANDONED",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Outstanding set 只接受 RESERVED、IN_USE、ABANDONED。",
        path: ["reservations"],
      });
    }
    for (const [index, reservation] of material.reservations.entries()) {
      const reference = reservation.outcome_usage_ref;
      if (
        reference !== null &&
        !systemReferenceMatchesScope(reference, material.scope, material.run_id)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Outstanding Reservation reference 必须属于同一 Scope/Run。",
          path: ["reservations", index, "outcome_usage_ref"],
        });
      }
    }
  });

export const enumerationUniverseHashMaterialSchema = z.strictObject({
  coverage_ref: coverageStateV2RefSchema,
  budget_input_hash: contentHashSchema,
  enumerator_version: versionIdentifierSchema,
  eig_policy_version: versionIdentifierSchema,
  query_contract_universe_refs: orderedArtifactReferenceArraySchema(
    queryContractRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  unresolved_obligation_refs: orderedProofObligationReferenceArraySchema(
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
});

export async function computeBudgetLedgerInputHash(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-budget-ledger-input@2",
    parseInertWireInput(budgetLedgerInputHashMaterialSchema, input),
  );
}

export async function computeCoverageDerivationInputHash(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-coverage-derivation-input@2",
    parseInertWireInput(coverageDerivationInputHashMaterialSchema, input),
  );
}

export async function computeCandidateEnumerationInputHash(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-candidate-enumeration-input@1",
    parseInertWireInput(candidateEnumerationInputHashMaterialSchema, input),
  );
}

export async function computeStopDerivationInputHash(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-stop-derivation-input@2",
    parseInertWireInput(stopDerivationInputHashMaterialSchema, input),
  );
}

export async function computeInputWatermarkInputHash(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-input-watermark-input@1",
    parseInertWireInput(inputWatermarkInputHashMaterialSchema, input),
  );
}

export async function computeRuntimeLimitsHashV2(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-research-runtime-limits@1",
    parseInertWireInput(runtimeLimitsHashMaterialSchema, input),
  );
}

export async function computeTenantBudgetPolicyHashV2(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-tenant-budget-policy@1",
    parseInertWireInput(tenantBudgetPolicyHashMaterialSchema, input),
  );
}

export async function computeOutstandingReservationSetHashV2(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-outstanding-reservation-set@1",
    parseInertWireInput(outstandingReservationSetHashMaterialSchema, input),
  );
}

export async function computeEnumerationUniverseHashV2(input: unknown): Promise<ContentHash> {
  return computeResearchKernelHashV2(
    "u6-candidate-enumeration-universe@1",
    parseInertWireInput(enumerationUniverseHashMaterialSchema, input),
  );
}

interface CandidateEnumerationClosure {
  readonly query_contract_universe_refs: readonly z.infer<typeof queryContractRefSchema>[];
  readonly unresolved_obligation_refs: readonly z.infer<typeof proofObligationRefSchema>[];
  readonly no_candidate_obligation_refs: readonly z.infer<typeof proofObligationRefSchema>[];
  readonly no_candidate_assessments: Readonly<z.infer<typeof noCandidateAssessmentV2ArraySchema>>;
  readonly candidate_queries: readonly z.infer<typeof candidateQueryAssessmentSchema>[];
}

function validateCandidateEnumerationClosure(
  value: CandidateEnumerationClosure,
  ctx: z.RefinementCtx,
): void {
  const universe = new Set(value.query_contract_universe_refs.map(artifactReferenceIdentity));
  const assessedQueries = new Set(
    value.candidate_queries.map(({ query_contract_ref }) =>
      artifactReferenceIdentity(query_contract_ref),
    ),
  );
  if (
    universe.size !== assessedQueries.size ||
    [...universe].some((identity) => !assessedQueries.has(identity))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "QueryContract universe 每项必须恰有一个 Candidate Assessment。",
      path: ["candidate_queries"],
    });
  }

  const unresolved = new Set(value.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity));
  const noCandidate = new Set(
    value.no_candidate_obligation_refs.map(embeddedNodeReferenceIdentity),
  );
  if ([...noCandidate].some((identity) => !unresolved.has(identity))) {
    ctx.addIssue({
      code: "custom",
      message: "no_candidate_obligation_refs 必须是 unresolved set 的子集。",
      path: ["no_candidate_obligation_refs"],
    });
  }
  validateNoCandidateAssessmentClosure(
    value.no_candidate_obligation_refs,
    value.no_candidate_assessments,
    ctx,
  );
  const assessedObligations = new Set(
    value.candidate_queries.flatMap(({ obligation_refs }) =>
      obligation_refs.map(embeddedNodeReferenceIdentity),
    ),
  );
  if ([...assessedObligations].some((identity) => !unresolved.has(identity))) {
    ctx.addIssue({
      code: "custom",
      message: "Candidate Assessment obligation_refs 必须属于 unresolved set。",
      path: ["candidate_queries"],
    });
  }
  const expectedAssessed = [...unresolved].filter((identity) => !noCandidate.has(identity));
  if (
    expectedAssessed.length !== assessedObligations.size ||
    expectedAssessed.some((identity) => !assessedObligations.has(identity))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Candidate Assessment obligation closure 必须等于 unresolved 减 no-candidate。",
      path: ["candidate_queries"],
    });
  }
  const unresolvedPlanIdentity = value.unresolved_obligation_refs[0]
    ? artifactReferenceIdentity(value.unresolved_obligation_refs[0].container_ref)
    : null;
  if (
    unresolvedPlanIdentity !== null &&
    [
      ...value.unresolved_obligation_refs,
      ...value.no_candidate_obligation_refs,
      ...value.no_candidate_assessments.map(({ obligation_ref }) => obligation_ref),
      ...value.candidate_queries.flatMap(({ obligation_refs }) => obligation_refs),
    ].some(
      ({ container_ref }) => artifactReferenceIdentity(container_ref) !== unresolvedPlanIdentity,
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Enumerator obligation closure 必须绑定同一 exact EvidencePlan。",
      path: ["unresolved_obligation_refs"],
    });
  }
}

const candidateEnumeratorAttestationObjectSchema = z.strictObject({
  protocol_version: z.literal("candidate-enumerator-attestation@1.0.0"),
  attestation_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  issuer_principal_id: immutableIdSchema,
  issuer_capability_id: immutableIdSchema,
  issuer_authority_epoch: nonNegativeIntSchema,
  idempotency_key: idempotencyKeySchema,
  coverage_ref: coverageStateV2RefSchema,
  budget_receipt: receiptBindingSchema,
  budget_input_hash: contentHashSchema,
  enumerator_version: versionIdentifierSchema,
  eig_policy_version: versionIdentifierSchema,
  implementation_digest: contentHashSchema,
  query_contract_universe_refs: orderedArtifactReferenceArraySchema(
    queryContractRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  unresolved_obligation_refs: orderedProofObligationReferenceArraySchema(
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  no_candidate_obligation_refs: orderedProofObligationReferenceArraySchema(
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  no_candidate_assessments: noCandidateAssessmentV2ArraySchema,
  candidate_queries: candidateQueryAssessmentV2ArraySchema,
  enumeration_universe_hash: contentHashSchema,
  candidate_set_hash: contentHashSchema,
  attestation_command_hash: contentHashSchema,
  input_hash: contentHashSchema,
  attestation_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
});

export const candidateEnumeratorAttestationSchema =
  candidateEnumeratorAttestationObjectSchema.superRefine((attestation, ctx) => {
    validateCandidateEnumerationClosure(attestation, ctx);
    addScopedReferenceIssues(
      [
        attestation.coverage_ref,
        ...attestation.query_contract_universe_refs,
        ...attestation.unresolved_obligation_refs.map(({ container_ref }) => container_ref),
        ...attestation.no_candidate_assessments.map(
          ({ obligation_ref }) => obligation_ref.container_ref,
        ),
        ...attestation.candidate_queries.flatMap(({ obligation_refs }) =>
          obligation_refs.map(({ container_ref }) => container_ref),
        ),
      ],
      attestation.scope,
      attestation.run_id,
      ctx,
      ["references"],
    );
  });

const derivationReceiptCommonShape = {
  receipt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  issuer_principal_id: immutableIdSchema,
  issuer_capability_id: immutableIdSchema,
  issuer_authority_epoch: nonNegativeIntSchema,
  idempotency_key: idempotencyKeySchema,
  input_hash: contentHashSchema,
  output_hash: contentHashSchema,
  receipt_hash: contentHashSchema,
  committed_at: databaseUtcTimestampSchema,
} as const;

export const beginResearchStepInputSchema = strictResearchCommandBaseSchema
  .extend({
    step_operation_id: immutableIdSchema,
    logical_step_id: immutableIdSchema,
    step_kind: z.enum(["PLAN", "QUERY", "EVIDENCE", "ANALYZE", "REPORT"]),
    parent_step_id: immutableIdSchema.nullable(),
    attempt_id: immutableIdSchema,
    worker_fence: positiveIntSchema,
    step_input_hash: contentHashSchema,
  })
  .superRefine((command, ctx) => {
    if (command.parent_step_id === command.logical_step_id) {
      ctx.addIssue({
        code: "custom",
        message: "Research Step 不能把自身作为 parent。",
        path: ["parent_step_id"],
      });
    }
  });

export const begunResearchStepSchema = z.strictObject({
  step_operation_id: immutableIdSchema,
  logical_step_id: immutableIdSchema,
  step_seq: positiveIntSchema,
  budget_event_seq: positiveIntSchema,
  created: z.boolean(),
  committed_at: databaseUtcTimestampSchema,
});

export const issueBudgetLedgerSnapshotInputSchema = strictResearchCommandBaseSchema
  .extend({
    snapshot_operation_id: immutableIdSchema,
    research_brief_ref: researchBriefRefSchema,
  })
  .superRefine((command, ctx) => {
    if (!referenceMatchesScope(command.research_brief_ref, command.scope, command.run_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Snapshot command 的 ResearchBrief 必须属于同一 Scope/Run。",
        path: ["research_brief_ref"],
      });
    }
  });

const issueCandidateEnumeratorAttestationInputObjectSchema = strictResearchCommandBaseSchema.extend(
  {
    attestation_operation_id: immutableIdSchema,
    coverage_ref: coverageStateV2RefSchema,
    budget_receipt: receiptBindingSchema,
    budget_input_hash: contentHashSchema,
    enumerator_version: versionIdentifierSchema,
    eig_policy_version: versionIdentifierSchema,
    query_contract_universe_refs: orderedArtifactReferenceArraySchema(
      queryContractRefSchema,
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    unresolved_obligation_refs: orderedProofObligationReferenceArraySchema(
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    no_candidate_obligation_refs: orderedProofObligationReferenceArraySchema(
      0,
      U6_WIRE_LIMITS.max_obligations,
    ),
    no_candidate_assessments: noCandidateAssessmentV2ArraySchema,
    candidate_queries: candidateQueryAssessmentV2ArraySchema,
    enumeration_universe_hash: contentHashSchema,
    candidate_set_hash: contentHashSchema,
  },
);

export const issueCandidateEnumeratorAttestationInputSchema =
  issueCandidateEnumeratorAttestationInputObjectSchema.superRefine((command, ctx) => {
    validateCandidateEnumerationClosure(command, ctx);
    addScopedReferenceIssues(
      [
        command.coverage_ref,
        ...command.query_contract_universe_refs,
        ...command.unresolved_obligation_refs.map(({ container_ref }) => container_ref),
        ...command.no_candidate_assessments.map(
          ({ obligation_ref }) => obligation_ref.container_ref,
        ),
        ...command.candidate_queries.flatMap(({ obligation_refs }) =>
          obligation_refs.map(({ container_ref }) => container_ref),
        ),
      ],
      command.scope,
      command.run_id,
      ctx,
      ["references"],
    );
  });

export type BudgetLedgerInputHashMaterial = z.infer<typeof budgetLedgerInputHashMaterialSchema>;
export type CoverageDerivationInputHashMaterial = z.infer<
  typeof coverageDerivationInputHashMaterialSchema
>;
export type CandidateEnumerationInputHashMaterial = z.infer<
  typeof candidateEnumerationInputHashMaterialSchema
>;
export type StopDerivationInputHashMaterial = z.infer<typeof stopDerivationInputHashMaterialSchema>;
export type InputWatermarkInputHashMaterial = z.infer<typeof inputWatermarkInputHashMaterialSchema>;
export type RuntimeLimitsHashMaterial = z.infer<typeof runtimeLimitsHashMaterialSchema>;
export type TenantBudgetPolicyHashMaterial = z.infer<typeof tenantBudgetPolicyHashMaterialSchema>;
export type OutstandingReservationSetHashMaterial = z.infer<
  typeof outstandingReservationSetHashMaterialSchema
>;
export type EnumerationUniverseHashMaterial = z.infer<typeof enumerationUniverseHashMaterialSchema>;
export type CandidateEnumeratorAttestation = z.infer<typeof candidateEnumeratorAttestationSchema>;
export type BeginResearchStepInput = z.infer<typeof beginResearchStepInputSchema>;
export type BegunResearchStep = z.infer<typeof begunResearchStepSchema>;
export type IssueBudgetLedgerSnapshotInput = z.infer<typeof issueBudgetLedgerSnapshotInputSchema>;
export type IssueCandidateEnumeratorAttestationInput = z.infer<
  typeof issueCandidateEnumeratorAttestationInputSchema
>;

/** @internal */
export {
  derivationClosureRefsSchema,
  derivationReceiptCommonShape,
  validateCandidateEnumerationClosure,
};
