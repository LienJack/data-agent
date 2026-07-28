import {
  coverageStatePayloadV2Schema,
  researchStopDecisionPayloadV2Schema,
} from "./derivation-decision-contracts.js";
import {
  budgetLedgerInputHashMaterialSchema,
  type CandidateEnumeratorAttestation,
  candidateEnumerationInputHashMaterialSchema,
  candidateEnumeratorAttestationSchema,
  computeEnumerationUniverseHashV2,
  computeOutstandingReservationSetHashV2,
  computeRuntimeLimitsHashV2,
  computeTenantBudgetPolicyHashV2,
  coverageDerivationInputHashMaterialSchema,
  inputWatermarkInputHashMaterialSchema,
  issueCandidateEnumeratorAttestationInputSchema,
  runtimeLimitsHashMaterialSchema,
  stopDerivationInputHashMaterialSchema,
  tenantBudgetPolicyHashMaterialSchema,
} from "./derivation-inputs.js";
import {
  budgetLedgerReceiptSchema,
  candidateEnumerationReceiptSchema,
  computeDerivationReceiptInputHash,
  coverageDerivationReceiptSchema,
  type derivationReceiptSchema,
  verifyCandidateAssessments,
  verifyDerivationReceiptSelfHash,
  verifyNoCandidateAssessments,
} from "./derivation-receipt-contracts.js";
import {
  computeResearchKernelHashV2,
  parseInertWireInput,
  type receiptBindingSchema,
  referenceMatchesScope,
  researchBudgetLimitSchema,
  sameJson,
  z,
} from "./derivation-wire-shared.js";

export const budgetReceiptVerificationContextSchema = z.strictObject({
  kind: z.literal("BUDGET"),
  runtime_limits_material: runtimeLimitsHashMaterialSchema,
  tenant_policy_material: tenantBudgetPolicyHashMaterialSchema,
  research_brief_budget_limit: researchBudgetLimitSchema,
});

export const candidateReceiptVerificationContextSchema = z.strictObject({
  kind: z.literal("CANDIDATE"),
  attestation: candidateEnumeratorAttestationSchema,
  budget_receipt: budgetLedgerReceiptSchema,
  coverage_receipt: coverageDerivationReceiptSchema,
});

export const stopReceiptVerificationContextSchema = z.strictObject({
  kind: z.literal("STOP"),
  stop_decision: researchStopDecisionPayloadV2Schema,
  candidate_receipt: candidateEnumerationReceiptSchema,
  candidate_input_material: candidateEnumerationInputHashMaterialSchema,
  candidate_context: candidateReceiptVerificationContextSchema,
});

export const derivationReceiptVerificationContextSchema = z.discriminatedUnion("kind", [
  budgetReceiptVerificationContextSchema,
  candidateReceiptVerificationContextSchema,
  stopReceiptVerificationContextSchema,
]);

function assertDerivationReceiptInputProjectionBinding(
  receipt: z.infer<typeof derivationReceiptSchema>,
  inputHashMaterial: unknown,
): void {
  switch (receipt.protocol_version) {
    case "research-budget-ledger-receipt@2.0.0": {
      const material = parseInertWireInput(budgetLedgerInputHashMaterialSchema, inputHashMaterial);
      if (
        !sameJson(material.research_brief_ref, receipt.research_brief_ref) ||
        material.runtime_limits_version !== receipt.runtime_limits_version ||
        material.runtime_limits_hash !== receipt.runtime_limits_hash ||
        material.tenant_policy_version !== receipt.tenant_policy_version ||
        material.tenant_policy_hash !== receipt.tenant_policy_hash ||
        material.budget_epoch !== receipt.budget_epoch ||
        material.budget_started_at !== receipt.budget_started_at ||
        material.evaluated_at !== receipt.evaluated_at ||
        material.evaluated_through_reservation_seq !== receipt.evaluated_through_reservation_seq ||
        material.evaluated_through_budget_event_seq !==
          receipt.evaluated_through_budget_event_seq ||
        material.outstanding_set_hash !== receipt.outstanding_set_hash
      ) {
        throw new TypeError("Budget Receipt 字段未逐字绑定 Budget input projection。");
      }
      return;
    }
    case "coverage-derivation-receipt@1.0.0": {
      const material = parseInertWireInput(
        coverageDerivationInputHashMaterialSchema,
        inputHashMaterial,
      );
      if (
        !sameJson(material.evidence_plan_ref, receipt.evidence_plan_ref) ||
        material.budget_receipt.receipt_id !== receipt.budget_receipt_id ||
        material.budget_receipt.receipt_hash !== receipt.budget_receipt_hash ||
        !sameJson(material.version_frontier, receipt.version_frontier) ||
        material.version_frontier_hash !== receipt.version_frontier_hash ||
        !sameJson(material.closure_refs, receipt.closure_refs) ||
        material.kernel_version !== receipt.kernel_version
      ) {
        throw new TypeError("Coverage Receipt 字段未逐字绑定 Coverage input projection。");
      }
      return;
    }
    case "candidate-enumeration-receipt@2.0.0": {
      const material = parseInertWireInput(
        candidateEnumerationInputHashMaterialSchema,
        inputHashMaterial,
      );
      if (
        material.coverage_receipt.receipt_id !== receipt.coverage_receipt_id ||
        material.coverage_receipt.receipt_hash !== receipt.coverage_receipt_hash ||
        material.budget_receipt.receipt_id !== receipt.budget_receipt_id ||
        material.budget_receipt.receipt_hash !== receipt.budget_receipt_hash ||
        material.enumerator_attestation_id !== receipt.enumerator_attestation_id ||
        material.enumerator_attestation_hash !== receipt.enumerator_attestation_hash ||
        material.enumerator_head_version !== receipt.enumerator_head_version ||
        material.enumerator_version !== receipt.enumerator_version ||
        material.eig_policy_version !== receipt.eig_policy_version ||
        !sameJson(material.query_contract_universe_refs, receipt.query_contract_universe_refs)
      ) {
        throw new TypeError("Candidate Receipt 字段未逐字绑定 Candidate input projection。");
      }
      return;
    }
    case "research-stop-derivation-receipt@2.0.0": {
      const material = parseInertWireInput(
        stopDerivationInputHashMaterialSchema,
        inputHashMaterial,
      );
      if (
        !sameJson(material.stop_ref, receipt.stop_ref) ||
        !sameJson(material.coverage_ref, receipt.coverage_ref) ||
        material.coverage_receipt.receipt_id !== receipt.coverage_receipt_id ||
        material.coverage_receipt.receipt_hash !== receipt.coverage_receipt_hash ||
        material.candidate_receipt.receipt_id !== receipt.candidate_receipt_id ||
        material.candidate_receipt.receipt_hash !== receipt.candidate_receipt_hash ||
        material.budget_receipt.receipt_id !== receipt.budget_receipt_id ||
        material.budget_receipt.receipt_hash !== receipt.budget_receipt_hash ||
        !sameJson(material.supported_subset, receipt.supported_subset) ||
        !sameJson(material.required_disclosures, receipt.required_disclosures) ||
        material.pre_stop_readiness_hash !== receipt.pre_stop_readiness_hash ||
        material.kernel_version !== receipt.kernel_version ||
        material.enumerator_version !== receipt.enumerator_version ||
        material.eig_policy_version !== receipt.eig_policy_version
      ) {
        throw new TypeError("Stop Receipt 字段未逐字绑定 Stop input projection。");
      }
      return;
    }
    case "research-input-watermark-receipt@1.0.0": {
      const material = parseInertWireInput(
        inputWatermarkInputHashMaterialSchema,
        inputHashMaterial,
      );
      if (
        !sameJson(material.certificate_ref, receipt.certificate_ref) ||
        material.observed_event_seq !== receipt.observed_event_seq ||
        material.observed_head_hash !== receipt.observed_head_hash ||
        material.certificate_input_closure_hash !== receipt.certificate_input_closure_hash
      ) {
        throw new TypeError("Input Watermark Receipt 字段未逐字绑定 input projection。");
      }
      return;
    }
  }
}

async function verifyBudgetReceiptSecondaryMaterials(
  receipt: z.infer<typeof budgetLedgerReceiptSchema>,
  inputHashMaterial: unknown,
  contextInput: unknown,
): Promise<void> {
  const context = parseInertWireInput(budgetReceiptVerificationContextSchema, contextInput);
  const material = parseInertWireInput(budgetLedgerInputHashMaterialSchema, inputHashMaterial);
  const runtimeLimitsHash = await computeRuntimeLimitsHashV2(context.runtime_limits_material);
  const tenantPolicyHash = await computeTenantBudgetPolicyHashV2(context.tenant_policy_material);
  const outstandingReservations = material.ordered_reservation_states.filter(
    ({ state }) => state === "RESERVED" || state === "IN_USE" || state === "ABANDONED",
  );
  const outstandingSetHash = await computeOutstandingReservationSetHashV2({
    scope: receipt.scope,
    run_id: receipt.run_id,
    budget_epoch: receipt.budget_epoch,
    reservations: outstandingReservations,
  });
  const activeCount = outstandingReservations.filter(
    ({ state }) => state === "RESERVED" || state === "IN_USE",
  ).length;
  const outcomeUnknownCount = outstandingReservations.filter(
    ({ outcome_unknown_hash }) => outcome_unknown_hash !== null,
  ).length;
  const abandonedCount = outstandingReservations.filter(
    ({ state }) => state === "ABANDONED",
  ).length;
  const expectedEffectiveLimit = {
    max_steps: Math.min(
      context.runtime_limits_material.limits.max_steps,
      context.tenant_policy_material.limits.max_steps,
      context.research_brief_budget_limit.max_steps,
    ),
    max_model_calls: Math.min(
      context.runtime_limits_material.limits.max_model_calls,
      context.tenant_policy_material.limits.max_model_calls,
      context.research_brief_budget_limit.max_model_calls,
    ),
    max_sql_executions: Math.min(
      context.runtime_limits_material.limits.max_sql_executions,
      context.tenant_policy_material.limits.max_sql_executions,
      context.research_brief_budget_limit.max_sql_executions,
    ),
    max_source_calls: 0 as const,
    max_elapsed_ms: Math.min(
      context.runtime_limits_material.limits.max_elapsed_ms,
      context.tenant_policy_material.limits.max_elapsed_ms,
      context.research_brief_budget_limit.max_elapsed_ms,
    ),
    max_provider_input_tokens_per_call: Math.min(
      context.runtime_limits_material.limits.max_provider_input_tokens_per_call,
      context.tenant_policy_material.limits.max_provider_input_tokens_per_call,
      context.research_brief_budget_limit.max_provider_input_tokens_per_call,
    ),
    max_provider_output_tokens_per_call: Math.min(
      context.runtime_limits_material.limits.max_provider_output_tokens_per_call,
      context.tenant_policy_material.limits.max_provider_output_tokens_per_call,
      context.research_brief_budget_limit.max_provider_output_tokens_per_call,
    ),
    max_provider_tokens_per_run: Math.min(
      context.runtime_limits_material.limits.max_provider_tokens_per_run,
      context.tenant_policy_material.limits.max_provider_tokens_per_run,
      context.research_brief_budget_limit.max_provider_tokens_per_run,
    ),
    max_provider_cost_microusd_per_run: Math.min(
      context.runtime_limits_material.limits.max_provider_cost_microusd_per_run,
      context.tenant_policy_material.limits.max_provider_cost_microusd_per_run,
      context.research_brief_budget_limit.max_provider_cost_microusd_per_run,
    ),
  };
  if (
    !sameJson(context.tenant_policy_material.scope, receipt.scope) ||
    context.tenant_policy_material.tenant_policy_version !== receipt.tenant_policy_version ||
    context.tenant_policy_material.top_up_allowed !== receipt.ledger.top_up_allowed ||
    !sameJson(expectedEffectiveLimit, receipt.ledger.effective_limit) ||
    runtimeLimitsHash !== receipt.runtime_limits_hash ||
    runtimeLimitsHash !== material.runtime_limits_hash ||
    tenantPolicyHash !== receipt.tenant_policy_hash ||
    tenantPolicyHash !== material.tenant_policy_hash ||
    outstandingSetHash !== receipt.outstanding_set_hash ||
    outstandingSetHash !== material.outstanding_set_hash ||
    activeCount !== receipt.active_count ||
    outcomeUnknownCount !== receipt.outcome_unknown_count ||
    abandonedCount !== receipt.abandoned_count
  ) {
    throw new TypeError("Budget Receipt 二级 Hash/计数未绑定 exact 原始 material。");
  }
}

async function verifyCandidateReceiptSecondaryMaterials(
  receipt: z.infer<typeof candidateEnumerationReceiptSchema>,
  contextInput: unknown,
): Promise<void> {
  const context = parseInertWireInput(candidateReceiptVerificationContextSchema, contextInput);
  const attestation = await verifyCandidateEnumeratorAttestation(
    context.attestation,
    context.budget_receipt,
  );
  const coverageReceipt = await verifyDerivationReceiptSelfHash(context.coverage_receipt);
  if (coverageReceipt.protocol_version !== "coverage-derivation-receipt@1.0.0") {
    throw new TypeError("Candidate Receipt context 必须提供 Coverage Receipt。");
  }
  if (
    !sameJson(context.budget_receipt.scope, receipt.scope) ||
    context.budget_receipt.run_id !== receipt.run_id ||
    !sameJson(coverageReceipt.scope, receipt.scope) ||
    coverageReceipt.run_id !== receipt.run_id ||
    !sameJson(attestation.scope, receipt.scope) ||
    attestation.run_id !== receipt.run_id ||
    context.budget_receipt.receipt_id !== receipt.budget_receipt_id ||
    context.budget_receipt.receipt_hash !== receipt.budget_receipt_hash ||
    coverageReceipt.receipt_id !== receipt.coverage_receipt_id ||
    coverageReceipt.receipt_hash !== receipt.coverage_receipt_hash ||
    coverageReceipt.budget_receipt_id !== context.budget_receipt.receipt_id ||
    coverageReceipt.budget_receipt_hash !== context.budget_receipt.receipt_hash ||
    attestation.attestation_id !== receipt.enumerator_attestation_id ||
    attestation.attestation_hash !== receipt.enumerator_attestation_hash ||
    attestation.enumerator_version !== receipt.enumerator_version ||
    attestation.eig_policy_version !== receipt.eig_policy_version ||
    attestation.enumeration_universe_hash !== receipt.enumeration_universe_hash ||
    attestation.candidate_set_hash !== receipt.candidate_set_hash ||
    attestation.issuer_principal_id !== receipt.issuer_principal_id ||
    attestation.issuer_capability_id !== receipt.enumerator_capability_id ||
    attestation.issuer_authority_epoch !== receipt.enumerator_authority_epoch ||
    !sameJson(attestation.coverage_ref, coverageReceipt.coverage_ref) ||
    !sameJson(attestation.query_contract_universe_refs, receipt.query_contract_universe_refs) ||
    !sameJson(attestation.unresolved_obligation_refs, receipt.unresolved_obligation_refs) ||
    !sameJson(attestation.no_candidate_obligation_refs, receipt.no_candidate_obligation_refs) ||
    !sameJson(attestation.no_candidate_assessments, receipt.no_candidate_assessments) ||
    !sameJson(attestation.candidate_queries, receipt.candidate_queries)
  ) {
    throw new TypeError("Candidate Receipt 二级 Hash/Attestation context 未逐字闭合。");
  }
}

async function verifyStopReceiptSecondaryMaterials(
  receipt: z.infer<typeof derivationReceiptSchema> & {
    protocol_version: "research-stop-derivation-receipt@2.0.0";
  },
  contextInput: unknown,
): Promise<void> {
  const context = parseInertWireInput(stopReceiptVerificationContextSchema, contextInput);
  const candidateReceipt = await verifyDerivationReceipt(
    context.candidate_receipt,
    context.candidate_input_material,
    context.candidate_context,
  );
  if (candidateReceipt.protocol_version !== "candidate-enumeration-receipt@2.0.0") {
    throw new TypeError("Stop Receipt context 必须提供 Candidate Receipt。");
  }
  const coverageReceipt = await verifyDerivationReceiptSelfHash(
    context.candidate_context.coverage_receipt,
  );
  const budgetReceipt = await verifyDerivationReceiptSelfHash(
    context.candidate_context.budget_receipt,
  );
  if (
    coverageReceipt.protocol_version !== "coverage-derivation-receipt@1.0.0" ||
    budgetReceipt.protocol_version !== "research-budget-ledger-receipt@2.0.0"
  ) {
    throw new TypeError("Stop Receipt context 必须提供 Coverage 与 Budget Receipt。");
  }
  const stop = await verifyResearchStopDecisionV2(context.stop_decision, budgetReceipt);
  if (
    !sameJson(stop.coverage_ref, receipt.coverage_ref) ||
    !sameJson(stop.coverage_ref, coverageReceipt.coverage_ref) ||
    stop.decision !== receipt.decision ||
    stop.decision_input_hash !== receipt.decision_input_hash ||
    stop.eig_policy_version !== receipt.eig_policy_version ||
    stop.candidate_set.enumerator_version !== receipt.enumerator_version ||
    !sameJson(stop.supported_subset, receipt.supported_subset) ||
    candidateReceipt.receipt_id !== receipt.candidate_receipt_id ||
    candidateReceipt.receipt_hash !== receipt.candidate_receipt_hash ||
    coverageReceipt.receipt_id !== receipt.coverage_receipt_id ||
    coverageReceipt.receipt_hash !== receipt.coverage_receipt_hash ||
    budgetReceipt.receipt_id !== receipt.budget_receipt_id ||
    budgetReceipt.receipt_hash !== receipt.budget_receipt_hash ||
    candidateReceipt.coverage_receipt_id !== coverageReceipt.receipt_id ||
    candidateReceipt.coverage_receipt_hash !== coverageReceipt.receipt_hash ||
    candidateReceipt.budget_receipt_id !== budgetReceipt.receipt_id ||
    candidateReceipt.budget_receipt_hash !== budgetReceipt.receipt_hash ||
    candidateReceipt.issuer_principal_id !== receipt.issuer_principal_id ||
    candidateReceipt.issuer_capability_id !== receipt.issuer_capability_id ||
    candidateReceipt.issuer_authority_epoch !== receipt.issuer_authority_epoch ||
    coverageReceipt.issuer_principal_id !== receipt.issuer_principal_id ||
    coverageReceipt.issuer_capability_id !== receipt.issuer_capability_id ||
    coverageReceipt.issuer_authority_epoch !== receipt.issuer_authority_epoch ||
    stop.candidate_set.enumerator_version !== candidateReceipt.enumerator_version ||
    stop.eig_policy_version !== candidateReceipt.eig_policy_version ||
    stop.candidate_set.candidate_set_hash !== candidateReceipt.candidate_set_hash ||
    !sameJson(stop.candidate_queries, candidateReceipt.candidate_queries) ||
    !sameJson(
      stop.candidate_set.unresolved_obligation_refs,
      candidateReceipt.unresolved_obligation_refs,
    ) ||
    !sameJson(
      stop.candidate_set.no_candidate_obligation_refs,
      candidateReceipt.no_candidate_obligation_refs,
    ) ||
    !sameJson(
      stop.candidate_set.no_candidate_assessments,
      candidateReceipt.no_candidate_assessments,
    )
  ) {
    throw new TypeError("Stop Receipt/Decision/Candidate subordinate context 未逐字闭合。");
  }
}

async function verifyDerivationReceiptSecondaryMaterials(
  receipt: z.infer<typeof derivationReceiptSchema>,
  inputHashMaterial: unknown,
  contextInput: unknown,
): Promise<void> {
  switch (receipt.protocol_version) {
    case "research-budget-ledger-receipt@2.0.0":
      return verifyBudgetReceiptSecondaryMaterials(receipt, inputHashMaterial, contextInput);
    case "candidate-enumeration-receipt@2.0.0":
      return verifyCandidateReceiptSecondaryMaterials(receipt, contextInput);
    case "research-stop-derivation-receipt@2.0.0":
      return verifyStopReceiptSecondaryMaterials(receipt, contextInput);
    default:
      if (contextInput !== undefined) {
        throw new TypeError("该 Receipt kind 不接受 subordinate verification context。");
      }
  }
}

export async function verifyDerivationReceipt(
  input: unknown,
  inputHashMaterial: unknown,
  subordinateContext?: unknown,
): Promise<z.infer<typeof derivationReceiptSchema>> {
  const receipt = await verifyDerivationReceiptSelfHash(input);
  assertDerivationReceiptInputProjectionBinding(receipt, inputHashMaterial);
  await verifyDerivationReceiptSecondaryMaterials(receipt, inputHashMaterial, subordinateContext);
  const expectedInputHash = await computeDerivationReceiptInputHash(
    receipt.protocol_version,
    inputHashMaterial,
  );
  if (expectedInputHash !== receipt.input_hash) {
    throw new TypeError("Derivation Receipt input_hash 与 exact input projection 不匹配。");
  }
  return receipt;
}

function receiptBindingMatchesBudgetReceipt(
  binding: z.infer<typeof receiptBindingSchema>,
  receipt: z.infer<typeof budgetLedgerReceiptSchema>,
): boolean {
  return binding.receipt_id === receipt.receipt_id && binding.receipt_hash === receipt.receipt_hash;
}

export function verifyCoverageStateV2BudgetBinding(
  coverageInput: unknown,
  budgetReceiptInput: unknown,
): z.infer<typeof coverageStatePayloadV2Schema> {
  const coverage = parseInertWireInput(coverageStatePayloadV2Schema, coverageInput);
  const receipt = parseInertWireInput(budgetLedgerReceiptSchema, budgetReceiptInput);
  if (
    !receiptBindingMatchesBudgetReceipt(coverage.budget_receipt, receipt) ||
    !sameJson(coverage.budget_ledger, receipt.ledger) ||
    !referenceMatchesScope(coverage.evidence_plan_ref, receipt.scope, receipt.run_id)
  ) {
    throw new TypeError(
      "Coverage v2 budget_receipt/ledger 未逐字绑定同一 Budget Snapshot Receipt。",
    );
  }
  return coverage;
}

export function verifyResearchStopDecisionV2BudgetBinding(
  stopInput: unknown,
  budgetReceiptInput: unknown,
): z.infer<typeof researchStopDecisionPayloadV2Schema> {
  const stop = parseInertWireInput(researchStopDecisionPayloadV2Schema, stopInput);
  const receipt = parseInertWireInput(budgetLedgerReceiptSchema, budgetReceiptInput);
  if (
    !receiptBindingMatchesBudgetReceipt(stop.budget_receipt, receipt) ||
    !sameJson(stop.budget_ledger, receipt.ledger) ||
    !referenceMatchesScope(stop.coverage_ref, receipt.scope, receipt.run_id)
  ) {
    throw new TypeError(
      "ResearchStopDecision v2 budget_receipt/ledger 未逐字绑定同一 Budget Snapshot Receipt。",
    );
  }
  return stop;
}

export async function verifyResearchStopDecisionV2(
  input: unknown,
  budgetReceiptInput: unknown,
): Promise<z.infer<typeof researchStopDecisionPayloadV2Schema>> {
  const stop = parseInertWireInput(researchStopDecisionPayloadV2Schema, input);
  const budgetReceipt = await verifyDerivationReceiptSelfHash(budgetReceiptInput);
  if (budgetReceipt.protocol_version !== "research-budget-ledger-receipt@2.0.0") {
    throw new TypeError("ResearchStopDecision v2 只接受 Budget Snapshot Receipt。");
  }
  verifyResearchStopDecisionV2BudgetBinding(stop, budgetReceipt);
  await verifyCandidateAssessments(stop.candidate_queries);
  await verifyNoCandidateAssessments(stop.candidate_set.no_candidate_assessments);

  const expectedCandidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
    unresolved: stop.candidate_set.unresolved_obligation_refs,
    candidateQueries: stop.candidate_queries,
    noCandidateRefs: stop.candidate_set.no_candidate_obligation_refs,
  });
  if (expectedCandidateSetHash !== stop.candidate_set.candidate_set_hash) {
    throw new TypeError("ResearchStopDecision candidate_set_hash 与 frozen v1 material 不匹配。");
  }

  const { decision_input_hash: _decisionInputHash, ...decisionMaterial } = stop;
  const expectedDecisionInputHash = await computeResearchKernelHashV2(
    "u6-stop-decision@1",
    decisionMaterial,
  );
  if (expectedDecisionInputHash !== stop.decision_input_hash) {
    throw new TypeError("ResearchStopDecision decision_input_hash 与 exact material 不匹配。");
  }
  return stop;
}

export function verifyCandidateEnumeratorAttestationBudgetBinding(
  attestationInput: unknown,
  budgetReceiptInput: unknown,
): z.infer<typeof candidateEnumeratorAttestationSchema> {
  const attestation = parseInertWireInput(candidateEnumeratorAttestationSchema, attestationInput);
  const receipt = parseInertWireInput(budgetLedgerReceiptSchema, budgetReceiptInput);
  if (
    !receiptBindingMatchesBudgetReceipt(attestation.budget_receipt, receipt) ||
    attestation.budget_input_hash !== receipt.input_hash ||
    !sameJson(attestation.scope, receipt.scope) ||
    attestation.run_id !== receipt.run_id
  ) {
    throw new TypeError(
      "Candidate Enumerator Attestation 未绑定同一 Budget Snapshot Receipt/input_hash。",
    );
  }
  return attestation;
}

export async function verifyCandidateEnumeratorAttestation(
  input: unknown,
  budgetReceiptInput: unknown,
): Promise<CandidateEnumeratorAttestation> {
  const attestation = parseInertWireInput(candidateEnumeratorAttestationSchema, input);
  const verifiedBudgetReceipt = await verifyDerivationReceiptSelfHash(budgetReceiptInput);
  if (verifiedBudgetReceipt.protocol_version !== "research-budget-ledger-receipt@2.0.0") {
    throw new TypeError("Candidate Enumerator Attestation 只接受 Budget Snapshot Receipt。");
  }
  verifyCandidateEnumeratorAttestationBudgetBinding(attestation, verifiedBudgetReceipt);
  await verifyCandidateAssessments(attestation.candidate_queries);
  await verifyNoCandidateAssessments(attestation.no_candidate_assessments);
  const issueCommand = issueCandidateEnumeratorAttestationInputSchema.parse({
    schema_version: "1.0.0",
    scope: attestation.scope,
    run_id: attestation.run_id,
    principal_id: attestation.issuer_principal_id,
    idempotency_key: attestation.idempotency_key,
    attestation_operation_id: attestation.attestation_id,
    coverage_ref: attestation.coverage_ref,
    budget_receipt: attestation.budget_receipt,
    budget_input_hash: attestation.budget_input_hash,
    enumerator_version: attestation.enumerator_version,
    eig_policy_version: attestation.eig_policy_version,
    query_contract_universe_refs: attestation.query_contract_universe_refs,
    unresolved_obligation_refs: attestation.unresolved_obligation_refs,
    no_candidate_obligation_refs: attestation.no_candidate_obligation_refs,
    no_candidate_assessments: attestation.no_candidate_assessments,
    candidate_queries: attestation.candidate_queries,
    enumeration_universe_hash: attestation.enumeration_universe_hash,
    candidate_set_hash: attestation.candidate_set_hash,
  });
  const expectedCommandHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-command@1",
    issueCommand,
  );
  if (expectedCommandHash !== attestation.attestation_command_hash) {
    throw new TypeError("Candidate Enumerator attestation_command_hash 与 strict command 不匹配。");
  }

  const expectedUniverseHash = await computeEnumerationUniverseHashV2({
    coverage_ref: attestation.coverage_ref,
    budget_input_hash: attestation.budget_input_hash,
    enumerator_version: attestation.enumerator_version,
    eig_policy_version: attestation.eig_policy_version,
    query_contract_universe_refs: attestation.query_contract_universe_refs,
    unresolved_obligation_refs: attestation.unresolved_obligation_refs,
  });
  if (expectedUniverseHash !== attestation.enumeration_universe_hash) {
    throw new TypeError("Candidate Enumerator enumeration_universe_hash 与完整宇宙不匹配。");
  }

  const expectedCandidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
    unresolved: attestation.unresolved_obligation_refs,
    candidateQueries: attestation.candidate_queries,
    noCandidateRefs: attestation.no_candidate_obligation_refs,
  });
  if (expectedCandidateSetHash !== attestation.candidate_set_hash) {
    throw new TypeError("Candidate Enumerator candidate_set_hash 与 frozen v1 material 不匹配。");
  }

  const {
    attestation_id: _attestationId,
    input_hash: _inputHash,
    attestation_hash: _attestationHash,
    committed_at: _committedAt,
    ...inputMaterial
  } = attestation;
  const expectedInputHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-input@1",
    inputMaterial,
  );
  if (expectedInputHash !== attestation.input_hash) {
    throw new TypeError("Candidate Enumerator input_hash 与 exact input material 不匹配。");
  }

  const { attestation_hash: _hash, ...attestationMaterial } = attestation;
  const expectedAttestationHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation@1",
    attestationMaterial,
  );
  if (expectedAttestationHash !== attestation.attestation_hash) {
    throw new TypeError("Candidate Enumerator attestation_hash 与 committed material 不匹配。");
  }
  return attestation;
}

export type BudgetReceiptVerificationContext = z.infer<
  typeof budgetReceiptVerificationContextSchema
>;
export type CandidateReceiptVerificationContext = z.infer<
  typeof candidateReceiptVerificationContextSchema
>;
export type StopReceiptVerificationContext = z.infer<typeof stopReceiptVerificationContextSchema>;
export type DerivationReceiptVerificationContext = z.infer<
  typeof derivationReceiptVerificationContextSchema
>;
