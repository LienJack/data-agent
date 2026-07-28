import {
  researchBudgetLedgerBindingV2Schema,
  verifyResearchBudgetLedgerBindingV2,
} from "./derivation-budget-contracts.js";
import {
  candidateQueryAssessmentV2ArraySchema,
  type candidateQueryAssessmentV2Schema,
  noCandidateAssessmentV2ArraySchema,
  supportedSubsetBindingV2Schema,
  verifyCandidateQueryAssessmentV2,
  verifyNoCandidateAssessmentV2,
} from "./derivation-decision-contracts.js";
import {
  computeBudgetLedgerInputHash,
  computeCandidateEnumerationInputHash,
  computeCoverageDerivationInputHash,
  computeInputWatermarkInputHash,
  computeStopDerivationInputHash,
  derivationClosureRefsSchema,
  derivationReceiptCommonShape,
  issueBudgetLedgerSnapshotInputSchema,
  validateCandidateEnumerationClosure,
} from "./derivation-inputs.js";
import {
  addScopedReferenceIssues,
  type ContentHash,
  computeResearchKernelHashV2,
  contentHashSchema,
  coverageStateV2RefSchema,
  databaseUtcTimestampSchema,
  evidencePlanRefSchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  orderedArtifactReferenceArraySchema,
  orderedProofObligationReferenceArraySchema,
  parseInertWireInput,
  positiveIntSchema,
  queryContractRefSchema,
  referenceMatchesScope,
  reportReadyCertificateV3RefSchema,
  researchBriefRefSchema,
  researchBudgetUsageSchema,
  researchStopDecisionV2RefSchema,
  sameJson,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  versionFrontierSchema,
  versionIdentifierSchema,
  z,
} from "./derivation-wire-shared.js";

export const budgetLedgerReceiptSchema = z
  .strictObject({
    protocol_version: z.literal("research-budget-ledger-receipt@2.0.0"),
    ...derivationReceiptCommonShape,
    snapshot_command_hash: contentHashSchema,
    research_brief_ref: researchBriefRefSchema,
    runtime_limits_version: z.literal("RESEARCH_RUNTIME_LIMITS@1"),
    runtime_limits_hash: contentHashSchema,
    tenant_policy_version: versionIdentifierSchema,
    tenant_policy_hash: contentHashSchema,
    budget_epoch: positiveIntSchema,
    budget_started_at: databaseUtcTimestampSchema,
    evaluated_through_reservation_seq: nonNegativeIntSchema,
    evaluated_through_budget_event_seq: nonNegativeIntSchema,
    evaluated_at: databaseUtcTimestampSchema,
    valid_until: databaseUtcTimestampSchema,
    outstanding_set_hash: contentHashSchema,
    active_count: nonNegativeIntSchema,
    outcome_unknown_count: nonNegativeIntSchema,
    abandoned_count: nonNegativeIntSchema,
    actual_used: researchBudgetUsageSchema,
    unresolved_hold: researchBudgetUsageSchema,
    ledger: researchBudgetLedgerBindingV2Schema,
  })
  .superRefine((receipt, ctx) => {
    if (!referenceMatchesScope(receipt.research_brief_ref, receipt.scope, receipt.run_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Receipt 的 ResearchBrief 必须属于同一 Scope/Run。",
        path: ["research_brief_ref"],
      });
    }
    if (receipt.output_hash !== receipt.ledger.ledger_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Receipt output_hash 必须等于 ledger_hash。",
        path: ["output_hash"],
      });
    }
    if (
      receipt.evaluated_through_reservation_seq !==
        receipt.ledger.evaluated_through_reservation_seq ||
      receipt.evaluated_through_budget_event_seq !==
        receipt.ledger.evaluated_through_budget_event_seq
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Receipt 双水位必须逐字绑定 ledger。",
        path: ["ledger"],
      });
    }
    if (
      !sameJson(receipt.actual_used, receipt.ledger.actual_used) ||
      !sameJson(receipt.unresolved_hold, receipt.ledger.unresolved_hold)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Receipt actual/hold 必须逐字绑定 ledger。",
        path: ["ledger"],
      });
    }
    if (Date.parse(receipt.valid_until) < Date.parse(receipt.evaluated_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Budget Receipt valid_until 不能早于 evaluated_at。",
        path: ["valid_until"],
      });
    }
  });

export const coverageDerivationReceiptSchema = z
  .strictObject({
    protocol_version: z.literal("coverage-derivation-receipt@1.0.0"),
    ...derivationReceiptCommonShape,
    coverage_ref: coverageStateV2RefSchema,
    evidence_plan_ref: evidencePlanRefSchema,
    budget_receipt_id: immutableIdSchema,
    budget_receipt_hash: contentHashSchema,
    version_frontier: versionFrontierSchema,
    version_frontier_hash: contentHashSchema,
    closure_refs: derivationClosureRefsSchema,
    coverage_input_hash: contentHashSchema,
    kernel_version: versionIdentifierSchema,
  })
  .superRefine((receipt, ctx) => {
    const references = [
      receipt.coverage_ref,
      receipt.evidence_plan_ref,
      receipt.version_frontier.semantic_release_ref,
      receipt.version_frontier.schema_snapshot_ref,
      receipt.version_frontier.policy_receipt_ref,
      ...Object.values(receipt.closure_refs).flat(),
    ];
    addScopedReferenceIssues(references, receipt.scope, receipt.run_id, ctx, ["references"]);
    if (receipt.output_hash !== receipt.coverage_ref.content_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage Receipt output_hash 必须等于 coverage_ref.content_hash。",
        path: ["output_hash"],
      });
    }
    if (receipt.coverage_input_hash !== receipt.input_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Coverage Receipt coverage_input_hash 必须等于共同 input_hash。",
        path: ["coverage_input_hash"],
      });
    }
  });

const candidateEnumerationReceiptObjectSchema = z.strictObject({
  protocol_version: z.literal("candidate-enumeration-receipt@1.0.0"),
  ...derivationReceiptCommonShape,
  coverage_receipt_id: immutableIdSchema,
  coverage_receipt_hash: contentHashSchema,
  budget_receipt_id: immutableIdSchema,
  budget_receipt_hash: contentHashSchema,
  enumerator_version: versionIdentifierSchema,
  eig_policy_version: versionIdentifierSchema,
  enumerator_capability_id: immutableIdSchema,
  enumerator_authority_epoch: nonNegativeIntSchema,
  enumerator_attestation_id: immutableIdSchema,
  enumerator_attestation_hash: contentHashSchema,
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
  query_contract_universe_refs: orderedArtifactReferenceArraySchema(
    queryContractRefSchema,
    0,
    U6_WIRE_LIMITS.max_obligations,
  ),
  enumeration_universe_hash: contentHashSchema,
  candidate_set_hash: contentHashSchema,
});

export const candidateEnumerationReceiptSchema =
  candidateEnumerationReceiptObjectSchema.superRefine((receipt, ctx) => {
    validateCandidateEnumerationClosure(receipt, ctx);
    if (
      receipt.enumerator_capability_id !== receipt.issuer_capability_id ||
      receipt.enumerator_authority_epoch !== receipt.issuer_authority_epoch
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Enumerator Authority 必须逐字等于 Receipt issuer Authority。",
        path: ["enumerator_capability_id"],
      });
    }
    if (receipt.output_hash !== receipt.candidate_set_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Candidate Receipt output_hash 必须等于 candidate_set_hash。",
        path: ["output_hash"],
      });
    }
    addScopedReferenceIssues(
      [
        ...receipt.query_contract_universe_refs,
        ...receipt.unresolved_obligation_refs.map(({ container_ref }) => container_ref),
        ...receipt.no_candidate_assessments.map(
          ({ obligation_ref }) => obligation_ref.container_ref,
        ),
        ...receipt.candidate_queries.flatMap(({ obligation_refs }) =>
          obligation_refs.map(({ container_ref }) => container_ref),
        ),
      ],
      receipt.scope,
      receipt.run_id,
      ctx,
      ["references"],
    );
  });

export const researchStopDerivationReceiptSchema = z
  .strictObject({
    protocol_version: z.literal("research-stop-derivation-receipt@1.0.0"),
    ...derivationReceiptCommonShape,
    stop_ref: researchStopDecisionV2RefSchema,
    coverage_ref: coverageStateV2RefSchema,
    coverage_receipt_id: immutableIdSchema,
    coverage_receipt_hash: contentHashSchema,
    candidate_receipt_id: immutableIdSchema,
    candidate_receipt_hash: contentHashSchema,
    budget_receipt_id: immutableIdSchema,
    budget_receipt_hash: contentHashSchema,
    supported_subset: supportedSubsetBindingV2Schema,
    required_disclosures: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_required_disclosures),
    pre_stop_readiness_hash: contentHashSchema,
    kernel_version: versionIdentifierSchema,
    enumerator_version: versionIdentifierSchema,
    eig_policy_version: versionIdentifierSchema,
    decision: z.enum([
      "CONTINUE",
      "REPLAN",
      "STOP_READY",
      "STOP_PARTIAL",
      "STOP_NEEDS_MORE_RESEARCH",
      "STOP_INCONCLUSIVE",
    ]),
    decision_input_hash: contentHashSchema,
  })
  .superRefine((receipt, ctx) => {
    addScopedReferenceIssues(
      [
        receipt.stop_ref,
        receipt.coverage_ref,
        ...receipt.supported_subset.claim_refs,
        ...receipt.supported_subset.support_decision_refs,
      ],
      receipt.scope,
      receipt.run_id,
      ctx,
      ["references"],
    );
    if (receipt.output_hash !== receipt.stop_ref.content_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Stop Receipt output_hash 必须等于 stop_ref.content_hash。",
        path: ["output_hash"],
      });
    }
    if (!sameJson(receipt.required_disclosures, receipt.supported_subset.required_disclosures)) {
      ctx.addIssue({
        code: "custom",
        message: "Stop Receipt required_disclosures 必须逐字等于 Supported Subset。",
        path: ["required_disclosures"],
      });
    }
  });

export const inputEventWatermarkReceiptSchema = z
  .strictObject({
    protocol_version: z.literal("research-input-watermark-receipt@1.0.0"),
    ...derivationReceiptCommonShape,
    observed_event_seq: nonNegativeIntSchema,
    observed_head_hash: contentHashSchema,
    certificate_ref: reportReadyCertificateV3RefSchema,
    certificate_input_closure_hash: contentHashSchema,
  })
  .superRefine((receipt, ctx) => {
    if (!referenceMatchesScope(receipt.certificate_ref, receipt.scope, receipt.run_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Input Watermark Certificate 必须属于同一 Scope/Run。",
        path: ["certificate_ref"],
      });
    }
    if (receipt.output_hash !== receipt.certificate_ref.content_hash) {
      ctx.addIssue({
        code: "custom",
        message: "Input Watermark output_hash 必须等于 Certificate content_hash。",
        path: ["output_hash"],
      });
    }
  });

export const derivationReceiptSchema = z.discriminatedUnion("protocol_version", [
  budgetLedgerReceiptSchema,
  coverageDerivationReceiptSchema,
  candidateEnumerationReceiptSchema,
  researchStopDerivationReceiptSchema,
  inputEventWatermarkReceiptSchema,
]);

const derivationReceiptHashDomains = {
  "research-budget-ledger-receipt@2.0.0": "u6-budget-ledger-receipt@2",
  "coverage-derivation-receipt@1.0.0": "u6-coverage-derivation-receipt@1",
  "candidate-enumeration-receipt@1.0.0": "u6-candidate-enumeration-receipt@1",
  "research-stop-derivation-receipt@1.0.0": "u6-stop-derivation-receipt@1",
  "research-input-watermark-receipt@1.0.0": "u6-input-watermark-receipt@1",
} as const;

export async function computeDerivationReceiptHash(input: unknown): Promise<ContentHash> {
  const receipt = parseInertWireInput(derivationReceiptSchema, input);
  const { receipt_hash: _receiptHash, ...material } = receipt;
  return computeResearchKernelHashV2(
    derivationReceiptHashDomains[receipt.protocol_version],
    material,
  );
}

export async function computeDerivationReceiptInputHash(
  protocolVersion: z.infer<typeof derivationReceiptSchema>["protocol_version"],
  input: unknown,
): Promise<ContentHash> {
  switch (protocolVersion) {
    case "research-budget-ledger-receipt@2.0.0":
      return computeBudgetLedgerInputHash(input);
    case "coverage-derivation-receipt@1.0.0":
      return computeCoverageDerivationInputHash(input);
    case "candidate-enumeration-receipt@1.0.0":
      return computeCandidateEnumerationInputHash(input);
    case "research-stop-derivation-receipt@1.0.0":
      return computeStopDerivationInputHash(input);
    case "research-input-watermark-receipt@1.0.0":
      return computeInputWatermarkInputHash(input);
  }
}

export async function verifyCandidateAssessments(
  assessments: readonly z.infer<typeof candidateQueryAssessmentV2Schema>[],
): Promise<void> {
  for (const assessment of assessments) {
    await verifyCandidateQueryAssessmentV2(assessment);
  }
}

export async function verifyNoCandidateAssessments(
  assessments: z.infer<typeof noCandidateAssessmentV2ArraySchema>,
): Promise<void> {
  for (const assessment of assessments) {
    await verifyNoCandidateAssessmentV2(assessment);
  }
}

async function verifyCandidateReceiptDerivedHashes(
  receipt: z.infer<typeof candidateEnumerationReceiptSchema>,
): Promise<void> {
  await verifyCandidateAssessments(receipt.candidate_queries);
  await verifyNoCandidateAssessments(receipt.no_candidate_assessments);
  const expectedCandidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
    unresolved: receipt.unresolved_obligation_refs,
    candidateQueries: receipt.candidate_queries,
    noCandidateRefs: receipt.no_candidate_obligation_refs,
  });
  if (expectedCandidateSetHash !== receipt.candidate_set_hash) {
    throw new TypeError("Candidate Receipt candidate_set_hash 与 exact closure 不匹配。");
  }
}

async function verifyReceiptSubordinateHashes(
  receipt: z.infer<typeof derivationReceiptSchema>,
): Promise<void> {
  switch (receipt.protocol_version) {
    case "research-budget-ledger-receipt@2.0.0": {
      await verifyResearchBudgetLedgerBindingV2(receipt.ledger);
      const snapshotCommand = issueBudgetLedgerSnapshotInputSchema.parse({
        schema_version: "1.0.0",
        scope: receipt.scope,
        run_id: receipt.run_id,
        principal_id: receipt.issuer_principal_id,
        idempotency_key: receipt.idempotency_key,
        snapshot_operation_id: receipt.receipt_id,
        research_brief_ref: receipt.research_brief_ref,
      });
      const expectedSnapshotCommandHash = await computeResearchKernelHashV2(
        "u6-budget-ledger-snapshot-command@1",
        snapshotCommand,
      );
      if (expectedSnapshotCommandHash !== receipt.snapshot_command_hash) {
        throw new TypeError("Budget Receipt snapshot_command_hash 与 strict command 不匹配。");
      }
      return;
    }
    case "coverage-derivation-receipt@1.0.0": {
      const expectedFrontierHash = await computeResearchKernelHashV2(
        "u6-version-frontier@1",
        receipt.version_frontier,
      );
      if (expectedFrontierHash !== receipt.version_frontier_hash) {
        throw new TypeError("Coverage Receipt version_frontier_hash 与 exact Frontier 不匹配。");
      }
      return;
    }
    case "candidate-enumeration-receipt@1.0.0":
      await verifyCandidateReceiptDerivedHashes(receipt);
      return;
    case "research-stop-derivation-receipt@1.0.0": {
      if (
        receipt.supported_subset.claim_refs.length !==
        receipt.supported_subset.support_decision_refs.length
      ) {
        throw new TypeError("Stop Receipt Supported Subset 必须保持 Claim/Decision 一一映射。");
      }
      const supported = receipt.supported_subset.claim_refs.map((claimRef, index) => ({
        claim_ref: claimRef,
        support_decision_ref: receipt.supported_subset.support_decision_refs[index],
      }));
      const expectedSubsetHash = await computeResearchKernelHashV2("u6-supported-subset@1", {
        supported,
        required_disclosures: receipt.supported_subset.required_disclosures,
      });
      if (expectedSubsetHash !== receipt.supported_subset.subset_hash) {
        throw new TypeError("Stop Receipt subset_hash 与 exact Supported Subset 不匹配。");
      }
      return;
    }
    case "research-input-watermark-receipt@1.0.0":
      return;
  }
}

export async function verifyDerivationReceiptSelfHash(
  input: unknown,
): Promise<z.infer<typeof derivationReceiptSchema>> {
  const receipt = parseInertWireInput(derivationReceiptSchema, input);
  await verifyReceiptSubordinateHashes(receipt);
  const expectedReceiptHash = await computeDerivationReceiptHash(receipt);
  if (expectedReceiptHash !== receipt.receipt_hash) {
    throw new TypeError("Derivation Receipt receipt_hash 与 strict committed material 不匹配。");
  }
  return receipt;
}

export type BudgetLedgerReceipt = z.infer<typeof budgetLedgerReceiptSchema>;
export type CoverageDerivationReceipt = z.infer<typeof coverageDerivationReceiptSchema>;
export type CandidateEnumerationReceipt = z.infer<typeof candidateEnumerationReceiptSchema>;
export type ResearchStopDerivationReceipt = z.infer<typeof researchStopDerivationReceiptSchema>;
export type InputEventWatermarkReceipt = z.infer<typeof inputEventWatermarkReceiptSchema>;
export type DerivationReceipt = z.infer<typeof derivationReceiptSchema>;
export type StrictReceiptHashMaterial<T extends { readonly receipt_hash: string }> = Omit<
  T,
  "receipt_hash"
>;
