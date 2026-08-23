import { describe, expect, it } from "vitest";
import {
  type CandidateEnumeratorAttestation,
  computeBudgetLedgerInputHash,
  computeCandidateEnumerationInputHash,
  computeCandidateQueryAssessmentV2Hash,
  computeCoverageDerivationInputHash,
  computeDerivationReceiptHash,
  computeEnumerationUniverseHashV2,
  computeInputWatermarkInputHash,
  computeNoCandidateAssessmentV2Hash,
  computeOutstandingReservationSetHashV2,
  computeResearchBudgetLedgerV2Hash,
  computeResearchKernelHashV2,
  computeRuntimeLimitsHashV2,
  computeStopDerivationInputHash,
  computeTenantBudgetPolicyHashV2,
  coverageDerivationReceiptSchema,
  type KnownArtifactType,
  RESEARCH_RUNTIME_LIMITS,
  verifyCandidateEnumeratorAttestation,
  verifyDerivationReceipt,
  verifyResearchStopDecisionV2,
} from "../src/index.js";

const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const runId = "00000000-0000-4000-8000-000000000003";
const principalId = "00000000-0000-4000-8000-000000000004";
const capabilityId = "00000000-0000-4000-8000-000000000005";
const committedAt = "2026-07-28T00:00:00.000000Z";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function ref<const T extends KnownArtifactType>(
  artifactType: T,
  sequence: number,
  contentHash = hash("a"),
) {
  return {
    artifact_id: uuid(sequence),
    artifact_type: artifactType,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: contentHash,
  };
}

const evidencePlanRef = ref("EvidencePlan", 100);

function obligationRef(nodeId = "obligation-a") {
  return {
    container_ref: evidencePlanRef,
    node_id: nodeId,
  };
}

function usage(
  overrides: Partial<{
    steps: number;
    model_calls: number;
    sql_executions: number;
    elapsed_ms: number;
    provider_input_tokens: number;
    provider_output_tokens: number;
    provider_tokens: number;
    provider_cost_microusd: number;
  }> = {},
) {
  return {
    steps: 0,
    model_calls: 0,
    sql_executions: 0,
    source_calls: 0 as const,
    elapsed_ms: 0,
    provider_input_tokens: 0,
    provider_output_tokens: 0,
    provider_tokens: 0,
    provider_cost_microusd: 0,
    ...overrides,
  };
}

const reservedUsage = usage({
  model_calls: 1,
  provider_input_tokens: 10,
  provider_tokens: 10,
  provider_cost_microusd: 100,
});

function reservedState() {
  return {
    reservation_id: uuid(110),
    reservation_seq: 1,
    resource_kind: "MODEL" as const,
    state: "RESERVED" as const,
    reserved_usage: reservedUsage,
    actual_usage: null,
    outcome_usage_ref: null,
    outcome_unknown_hash: null,
    end_reason_code: null,
  };
}

function versionFrontier() {
  return {
    semantic_release_ref: ref("SemanticRelease", 120),
    schema_snapshot_ref: ref("SchemaSnapshot", 121),
    data_snapshot: {
      protocol_version: "data-snapshot-binding@1.0.0",
      datasource_id: uuid(122),
      strategy: "CONTROLLED_REVISION",
      snapshot_token: "snapshot@1",
      schema_manifest_hash: hash("1"),
      data_manifest_hash: hash("2"),
      fixture_manifest_hash: hash("3"),
      replay_state: "REPLAYABLE",
      binding_hash: hash("4"),
    },
    policy_receipt_ref: ref("PolicyReceipt", 123),
    identity_binding: {
      principal_id: principalId,
      delegation_chain_hash: hash("5"),
      authority_epoch: 1,
    },
  } as const;
}

function closureRefs() {
  return {
    obligation_execution_decision_refs: [],
    query_evidence_refs: [],
    atomic_claim_refs: [],
    evidence_relation_refs: [],
    support_decision_refs: [],
    hypothesis_assessment_refs: [],
  };
}

function candidateAssessmentDraft() {
  const reasonCodes: "ANALYSIS_INCONCLUSIVE"[] = ["ANALYSIS_INCONCLUSIVE"];
  return {
    query_contract_ref: ref("QueryContract", 130),
    obligation_refs: [obligationRef()],
    admissibility: "INADMISSIBLE" as const,
    expected_information_gain_microunits: 0,
    required_budget: {
      steps: 1,
      model_calls: 1,
      sql_executions: 0,
      source_calls: 0 as const,
      elapsed_ms: 10,
      provider_tokens: 2,
      provider_cost_microusd: 1,
    },
    waiting_on_codes: [],
    reason_codes: reasonCodes,
    assessment_hash: hash("0"),
  };
}

async function rehashReceipt<T extends { receipt_hash: `sha256:${string}` }>(receipt: T) {
  const draft = {
    ...receipt,
    receipt_hash: hash("0"),
  };
  return {
    ...draft,
    receipt_hash: await computeDerivationReceiptHash(draft),
  };
}

function attestationCommandMaterial(attestation: CandidateEnumeratorAttestation) {
  return {
    schema_version: "1.0.0" as const,
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
  };
}

async function computeAttestationInputHash(attestation: CandidateEnumeratorAttestation) {
  const {
    attestation_id: _attestationId,
    input_hash: _inputHash,
    attestation_hash: _attestationHash,
    committed_at: _committedAt,
    ...inputMaterial
  } = attestation;
  return computeResearchKernelHashV2("u6-candidate-enumerator-attestation-input@1", inputMaterial);
}

async function rehashAttestation(attestation: CandidateEnumeratorAttestation) {
  const { attestation_hash: _attestationHash, ...material } = attestation;
  return {
    ...attestation,
    attestation_hash: await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation@1",
      material,
    ),
  };
}

async function buildIntegrityGraph() {
  const runtimeLimitsMaterial = {
    runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1" as const,
    limits: RESEARCH_RUNTIME_LIMITS,
  };
  const tenantPolicyMaterial = {
    scope,
    tenant_policy_version: "tenant-budget@1.0.0",
    limits: RESEARCH_RUNTIME_LIMITS,
    top_up_allowed: false,
  };
  const researchBriefBudgetLimit = { ...RESEARCH_RUNTIME_LIMITS };
  const reservation = reservedState();
  const runtimeLimitsHash = await computeRuntimeLimitsHashV2(runtimeLimitsMaterial);
  const tenantPolicyHash = await computeTenantBudgetPolicyHashV2(tenantPolicyMaterial);
  const outstandingSetHash = await computeOutstandingReservationSetHashV2({
    scope,
    run_id: runId,
    budget_epoch: 1,
    reservations: [reservation],
  });
  const budgetInput = {
    research_brief_ref: ref("ResearchBrief", 140),
    runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1" as const,
    runtime_limits_hash: runtimeLimitsHash,
    tenant_policy_version: tenantPolicyMaterial.tenant_policy_version,
    tenant_policy_hash: tenantPolicyHash,
    budget_epoch: 1,
    budget_started_at: "2026-07-27T23:59:00.000000Z",
    evaluated_at: committedAt,
    evaluated_through_reservation_seq: 1,
    evaluated_through_budget_event_seq: 1,
    budget_event_head_hash: hash("6"),
    ordered_budget_event_hashes: [hash("6")],
    ordered_reservation_states: [reservation],
    outstanding_set_hash: outstandingSetHash,
  };
  const ledgerDraft = {
    ledger_version: "research-budget-ledger@2.0.0" as const,
    evaluated_through_reservation_seq: 1,
    evaluated_through_budget_event_seq: 1,
    effective_limit: RESEARCH_RUNTIME_LIMITS,
    actual_used: usage(),
    unresolved_hold: reservedUsage,
    charged_used: reservedUsage,
    remaining: {
      steps: RESEARCH_RUNTIME_LIMITS.max_steps,
      model_calls: RESEARCH_RUNTIME_LIMITS.max_model_calls - reservedUsage.model_calls,
      sql_executions: RESEARCH_RUNTIME_LIMITS.max_sql_executions - reservedUsage.sql_executions,
      source_calls: 0 as const,
      elapsed_ms: RESEARCH_RUNTIME_LIMITS.max_elapsed_ms,
      provider_tokens:
        RESEARCH_RUNTIME_LIMITS.max_provider_tokens_per_run - reservedUsage.provider_tokens,
      provider_cost_microusd:
        RESEARCH_RUNTIME_LIMITS.max_provider_cost_microusd_per_run -
        reservedUsage.provider_cost_microusd,
    },
    overage: {
      steps: 0,
      model_calls: 0,
      sql_executions: 0,
      source_calls: 0 as const,
      elapsed_ms: 0,
      provider_tokens: 0,
      provider_cost_microusd: 0,
    },
    top_up_allowed: false,
    ledger_hash: hash("0"),
  };
  const ledger = {
    ...ledgerDraft,
    ledger_hash: await computeResearchBudgetLedgerV2Hash(ledgerDraft),
  };
  const budgetInputHash = await computeBudgetLedgerInputHash(budgetInput);
  const snapshotCommandHash = await computeResearchKernelHashV2(
    "u6-budget-ledger-snapshot-command@1",
    {
      schema_version: "1.0.0",
      scope,
      run_id: runId,
      principal_id: principalId,
      idempotency_key: "budget-integrity",
      snapshot_operation_id: uuid(141),
      research_brief_ref: budgetInput.research_brief_ref,
    },
  );
  const budgetReceiptDraft = {
    protocol_version: "research-budget-ledger-receipt@2.0.0" as const,
    receipt_id: uuid(141),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "budget-integrity",
    input_hash: budgetInputHash,
    output_hash: ledger.ledger_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    snapshot_command_hash: snapshotCommandHash,
    research_brief_ref: budgetInput.research_brief_ref,
    runtime_limits_version: budgetInput.runtime_limits_version,
    runtime_limits_hash: budgetInput.runtime_limits_hash,
    tenant_policy_version: budgetInput.tenant_policy_version,
    tenant_policy_hash: budgetInput.tenant_policy_hash,
    budget_epoch: budgetInput.budget_epoch,
    budget_started_at: budgetInput.budget_started_at,
    evaluated_through_reservation_seq: budgetInput.evaluated_through_reservation_seq,
    evaluated_through_budget_event_seq: budgetInput.evaluated_through_budget_event_seq,
    evaluated_at: budgetInput.evaluated_at,
    valid_until: "2026-07-28T00:01:00.000000Z",
    outstanding_set_hash: budgetInput.outstanding_set_hash,
    active_count: 1,
    outcome_unknown_count: 0,
    abandoned_count: 0,
    actual_used: ledger.actual_used,
    unresolved_hold: ledger.unresolved_hold,
    ledger,
  };
  const budgetReceipt = await rehashReceipt(budgetReceiptDraft);
  const budgetContext = {
    kind: "BUDGET" as const,
    runtime_limits_material: runtimeLimitsMaterial,
    tenant_policy_material: tenantPolicyMaterial,
    research_brief_budget_limit: researchBriefBudgetLimit,
  };

  const frontier = versionFrontier();
  const frontierHash = await computeResearchKernelHashV2("u6-version-frontier@1", frontier);
  const coverageRef = ref("CoverageState", 150, hash("8"));
  const coverageInput = {
    evidence_plan_ref: evidencePlanRef,
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    version_frontier: frontier,
    version_frontier_hash: frontierHash,
    closure_refs: closureRefs(),
    kernel_version: "kernel@1.0.0",
  };
  const coverageInputHash = await computeCoverageDerivationInputHash(coverageInput);
  const coverageReceiptDraft = {
    protocol_version: "coverage-derivation-receipt@1.0.0" as const,
    receipt_id: uuid(151),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "coverage-integrity",
    input_hash: coverageInputHash,
    output_hash: coverageRef.content_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    coverage_ref: coverageRef,
    evidence_plan_ref: coverageInput.evidence_plan_ref,
    budget_receipt_id: coverageInput.budget_receipt.receipt_id,
    budget_receipt_hash: coverageInput.budget_receipt.receipt_hash,
    version_frontier: coverageInput.version_frontier,
    version_frontier_hash: coverageInput.version_frontier_hash,
    closure_refs: coverageInput.closure_refs,
    coverage_input_hash: coverageInputHash,
    kernel_version: coverageInput.kernel_version,
  };
  const coverageReceipt = await rehashReceipt(coverageReceiptDraft);

  const assessmentDraft = candidateAssessmentDraft();
  const assessment = {
    ...assessmentDraft,
    assessment_hash: await computeCandidateQueryAssessmentV2Hash(assessmentDraft),
  };
  const queryContractUniverseRefs = [assessment.query_contract_ref];
  const noCandidateObligationRef = obligationRef("obligation-b");
  const unresolvedObligationRefs = [obligationRef(), noCandidateObligationRef];
  const noCandidateObligationRefs = [noCandidateObligationRef];
  const noCandidateReasonCodes: "OBLIGATION_QUERY_SEMANTICS_MISMATCH"[] = [
    "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
  ];
  const noCandidateAssessmentDraft = {
    obligation_ref: noCandidateObligationRef,
    reason_codes: noCandidateReasonCodes,
    constraint_closure_hash: hash("8"),
    assessment_hash: hash("0"),
  };
  const noCandidateAssessments = [
    {
      ...noCandidateAssessmentDraft,
      assessment_hash: await computeNoCandidateAssessmentV2Hash(noCandidateAssessmentDraft),
    },
  ];
  const candidateQueries = [assessment];
  const enumeratorVersion = "enumerator@1.0.0";
  const eigPolicyVersion = "eig@1.0.0";
  const enumerationUniverseHash = await computeEnumerationUniverseHashV2({
    coverage_ref: coverageRef,
    budget_input_hash: budgetReceipt.input_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    query_contract_universe_refs: queryContractUniverseRefs,
    unresolved_obligation_refs: unresolvedObligationRefs,
  });
  const candidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
    unresolved: unresolvedObligationRefs,
    candidateQueries,
    noCandidateRefs: noCandidateObligationRefs,
  });
  const attestationId = uuid(160);
  const attestationCommand = {
    schema_version: "1.0.0" as const,
    scope,
    run_id: runId,
    principal_id: principalId,
    idempotency_key: "attestation-integrity",
    attestation_operation_id: attestationId,
    coverage_ref: coverageRef,
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    budget_input_hash: budgetReceipt.input_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    query_contract_universe_refs: queryContractUniverseRefs,
    unresolved_obligation_refs: unresolvedObligationRefs,
    no_candidate_obligation_refs: noCandidateObligationRefs,
    no_candidate_assessments: noCandidateAssessments,
    candidate_queries: candidateQueries,
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
  };
  const attestationCommandHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-command@1",
    attestationCommand,
  );
  const attestationInputMaterial = {
    protocol_version: "candidate-enumerator-attestation@1.0.0" as const,
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: attestationCommand.idempotency_key,
    coverage_ref: coverageRef,
    budget_receipt: attestationCommand.budget_receipt,
    budget_input_hash: budgetReceipt.input_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    implementation_digest: hash("9"),
    query_contract_universe_refs: queryContractUniverseRefs,
    unresolved_obligation_refs: unresolvedObligationRefs,
    no_candidate_obligation_refs: noCandidateObligationRefs,
    no_candidate_assessments: noCandidateAssessments,
    candidate_queries: candidateQueries,
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
    attestation_command_hash: attestationCommandHash,
  };
  const attestationInputHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-input@1",
    attestationInputMaterial,
  );
  const attestationWithoutHash = {
    ...attestationInputMaterial,
    attestation_id: attestationId,
    input_hash: attestationInputHash,
    committed_at: committedAt,
  };
  const attestation = {
    ...attestationWithoutHash,
    attestation_hash: await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation@1",
      attestationWithoutHash,
    ),
  };

  const candidateInput = {
    coverage_receipt: {
      receipt_id: coverageReceipt.receipt_id,
      receipt_hash: coverageReceipt.receipt_hash,
    },
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    enumerator_attestation_id: attestation.attestation_id,
    enumerator_attestation_hash: attestation.attestation_hash,
    enumerator_head_version: 1,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    query_contract_universe_refs: queryContractUniverseRefs,
  };
  const candidateInputHash = await computeCandidateEnumerationInputHash(candidateInput);
  const candidateReceiptDraft = {
    protocol_version: "candidate-enumeration-receipt@2.0.0" as const,
    receipt_id: uuid(161),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "candidate-integrity",
    input_hash: candidateInputHash,
    output_hash: candidateSetHash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    coverage_receipt_id: candidateInput.coverage_receipt.receipt_id,
    coverage_receipt_hash: candidateInput.coverage_receipt.receipt_hash,
    budget_receipt_id: candidateInput.budget_receipt.receipt_id,
    budget_receipt_hash: candidateInput.budget_receipt.receipt_hash,
    enumerator_head_version: candidateInput.enumerator_head_version,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    enumerator_capability_id: capabilityId,
    enumerator_authority_epoch: 7,
    enumerator_attestation_id: attestation.attestation_id,
    enumerator_attestation_hash: attestation.attestation_hash,
    unresolved_obligation_refs: unresolvedObligationRefs,
    no_candidate_obligation_refs: noCandidateObligationRefs,
    no_candidate_assessments: noCandidateAssessments,
    candidate_queries: candidateQueries,
    query_contract_universe_refs: queryContractUniverseRefs,
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
  };
  const candidateReceipt = await rehashReceipt(candidateReceiptDraft);
  const candidateContext = {
    kind: "CANDIDATE" as const,
    attestation,
    budget_receipt: budgetReceipt,
    coverage_receipt: coverageReceipt,
  };

  const supported = [
    {
      claim_ref: ref("AtomicClaim", 170),
      support_decision_ref: ref("SupportDecision", 171),
    },
  ];
  const requiredDisclosures = ["BUDGET_LIMIT"];
  const subsetHash = await computeResearchKernelHashV2("u6-supported-subset@1", {
    supported,
    required_disclosures: requiredDisclosures,
  });
  const supportedSubset = {
    claim_refs: supported.map(({ claim_ref }) => claim_ref),
    support_decision_refs: supported.map(({ support_decision_ref }) => support_decision_ref),
    required_disclosures: requiredDisclosures,
    subset_hash: subsetHash,
  };
  const stopDecisionMaterial = {
    artifact_type: "ResearchStopDecision" as const,
    protocol_version: "research-stop@2.0.0" as const,
    coverage_ref: coverageRef,
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    budget_ledger: budgetReceipt.ledger,
    candidate_queries: candidateReceipt.candidate_queries,
    candidate_set: {
      enumerator_version: candidateReceipt.enumerator_version,
      unresolved_obligation_refs: candidateReceipt.unresolved_obligation_refs,
      no_candidate_obligation_refs: candidateReceipt.no_candidate_obligation_refs,
      no_candidate_assessments: candidateReceipt.no_candidate_assessments,
      candidate_set_hash: candidateReceipt.candidate_set_hash,
    },
    supported_subset: supportedSubset,
    reason_codes: ["ANALYSIS_INCONCLUSIVE"] as const,
    eig_policy_version: candidateReceipt.eig_policy_version,
    decision: "STOP_INCONCLUSIVE" as const,
    non_ready_terminal: "INCONCLUSIVE" as const,
    inadmissibility_summary_hash: hash("7"),
  };
  const stopDecision = {
    ...stopDecisionMaterial,
    decision_input_hash: await computeResearchKernelHashV2(
      "u6-stop-decision@1",
      stopDecisionMaterial,
    ),
  };
  const stopRef = ref("ResearchStopDecision", 172, hash("a"));
  const stopInput = {
    stop_ref: stopRef,
    coverage_ref: coverageRef,
    coverage_receipt: {
      receipt_id: coverageReceipt.receipt_id,
      receipt_hash: coverageReceipt.receipt_hash,
    },
    candidate_receipt: {
      receipt_id: candidateReceipt.receipt_id,
      receipt_hash: candidateReceipt.receipt_hash,
    },
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    supported_subset: supportedSubset,
    required_disclosures: requiredDisclosures,
    pre_stop_readiness_hash: hash("b"),
    kernel_version: "kernel@1.0.0",
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
  };
  const stopInputHash = await computeStopDerivationInputHash(stopInput);
  const stopReceiptDraft = {
    protocol_version: "research-stop-derivation-receipt@2.0.0" as const,
    receipt_id: uuid(173),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "stop-integrity",
    input_hash: stopInputHash,
    output_hash: stopRef.content_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    stop_ref: stopRef,
    coverage_ref: coverageRef,
    coverage_receipt_id: stopInput.coverage_receipt.receipt_id,
    coverage_receipt_hash: stopInput.coverage_receipt.receipt_hash,
    candidate_receipt_id: stopInput.candidate_receipt.receipt_id,
    candidate_receipt_hash: stopInput.candidate_receipt.receipt_hash,
    budget_receipt_id: stopInput.budget_receipt.receipt_id,
    budget_receipt_hash: stopInput.budget_receipt.receipt_hash,
    supported_subset: supportedSubset,
    required_disclosures: requiredDisclosures,
    pre_stop_readiness_hash: stopInput.pre_stop_readiness_hash,
    kernel_version: stopInput.kernel_version,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    decision: stopDecision.decision,
    decision_input_hash: stopDecision.decision_input_hash,
  };
  const stopReceipt = await rehashReceipt(stopReceiptDraft);
  const stopContext = {
    kind: "STOP" as const,
    stop_decision: stopDecision,
    candidate_receipt: candidateReceipt,
    candidate_input_material: candidateInput,
    candidate_context: candidateContext,
  };

  const certificateRef = ref("ReportReadyCertificate", 180, hash("d"));
  const watermarkInput = {
    certificate_ref: certificateRef,
    observed_event_seq: 12,
    observed_head_hash: hash("e"),
    certificate_input_closure_hash: hash("f"),
  };
  const watermarkInputHash = await computeInputWatermarkInputHash(watermarkInput);
  const watermarkReceiptDraft = {
    protocol_version: "research-input-watermark-receipt@1.0.0" as const,
    receipt_id: uuid(181),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "watermark-integrity",
    input_hash: watermarkInputHash,
    output_hash: certificateRef.content_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    observed_event_seq: watermarkInput.observed_event_seq,
    observed_head_hash: watermarkInput.observed_head_hash,
    certificate_ref: certificateRef,
    certificate_input_closure_hash: watermarkInput.certificate_input_closure_hash,
  };
  const watermarkReceipt = await rehashReceipt(watermarkReceiptDraft);

  return {
    runtimeLimitsMaterial,
    tenantPolicyMaterial,
    researchBriefBudgetLimit,
    budgetInput,
    budgetReceipt,
    budgetContext,
    coverageInput,
    coverageReceipt,
    candidateInput,
    candidateReceipt,
    candidateContext,
    stopInput,
    stopReceipt,
    stopContext,
    watermarkInput,
    watermarkReceipt,
    attestation,
  };
}

describe("U6 derivation wire integrity", () => {
  it("以真实 subordinate context 完整验证五类 fully-hashed Receipt", async () => {
    const graph = await buildIntegrityGraph();

    await expect(
      verifyDerivationReceipt(graph.budgetReceipt, graph.budgetInput, graph.budgetContext),
    ).resolves.toEqual(graph.budgetReceipt);
    await expect(
      verifyDerivationReceipt(graph.coverageReceipt, graph.coverageInput),
    ).resolves.toEqual(graph.coverageReceipt);
    await expect(
      verifyDerivationReceipt(graph.candidateReceipt, graph.candidateInput, graph.candidateContext),
    ).resolves.toEqual(graph.candidateReceipt);
    await expect(
      verifyDerivationReceipt(graph.stopReceipt, graph.stopInput, graph.stopContext),
    ).resolves.toEqual(graph.stopReceipt);
    await expect(
      verifyDerivationReceipt(graph.watermarkReceipt, graph.watermarkInput),
    ).resolves.toEqual(graph.watermarkReceipt);

    const forgedSnapshotReceipt = await rehashReceipt({
      ...graph.budgetReceipt,
      snapshot_command_hash: hash("f"),
    });
    await expect(
      verifyDerivationReceipt(forgedSnapshotReceipt, graph.budgetInput, graph.budgetContext),
    ).rejects.toThrow(/snapshot_command_hash/);
  });

  it("Stop Receipt v2 使用独立 golden digest 冻结 hash domain", async () => {
    const { stopReceipt } = await buildIntegrityGraph();
    const goldenDigest = "sha256:18d4dc9c00193d7fb5cd3531b6c92a5a6b05518a0171075d8a8674d0d114b9f6";
    expect(stopReceipt.receipt_hash).toBe(goldenDigest);

    const { receipt_hash: _receiptHash, ...v2Material } = stopReceipt;
    expect(await computeResearchKernelHashV2("u6-stop-derivation-receipt@1", v2Material)).not.toBe(
      goldenDigest,
    );
  });

  it("公开 unknown 入口先复制 inert JSON，拒绝 accessor/custom prototype/异常 Proxy", async () => {
    let getterCalls = 0;
    const accessorInput = {};
    Object.defineProperty(accessorInput, "ledger_version", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "research-budget-ledger@2.0.0";
      },
    });

    await expect(computeResearchBudgetLedgerV2Hash(accessorInput)).rejects.toThrow(
      /data property|enumerable/,
    );
    expect(getterCalls).toBe(0);

    await expect(
      computeResearchBudgetLedgerV2Hash(Object.create({ inherited: true })),
    ).rejects.toThrow(/prototype/);

    const hostileProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile-ownKeys");
        },
      },
    );
    await expect(computeResearchBudgetLedgerV2Hash(hostileProxy)).rejects.toThrow(/无法安全反射/);
  });

  it("五类 Receipt 均拒绝与 committed receipt 不一致的 input material", async () => {
    const graph = await buildIntegrityGraph();

    await expect(
      verifyDerivationReceipt(
        graph.budgetReceipt,
        {
          ...graph.budgetInput,
          evaluated_at: "2026-07-28T00:00:01.000000Z",
        },
        graph.budgetContext,
      ),
    ).rejects.toThrow(/Budget Receipt|input_hash/);
    await expect(
      verifyDerivationReceipt(graph.coverageReceipt, {
        ...graph.coverageInput,
        kernel_version: "kernel@2.0.0",
      }),
    ).rejects.toThrow(/Coverage Receipt|input_hash/);
    await expect(
      verifyDerivationReceipt(
        graph.candidateReceipt,
        {
          ...graph.candidateInput,
          enumerator_head_version: graph.candidateInput.enumerator_head_version + 1,
        },
        graph.candidateContext,
      ),
    ).rejects.toThrow(/Candidate Receipt|input_hash/);
    const reboundCandidateReceipt = await rehashReceipt({
      ...graph.candidateReceipt,
      enumerator_head_version: graph.candidateReceipt.enumerator_head_version + 1,
    });
    await expect(
      verifyDerivationReceipt(
        reboundCandidateReceipt,
        graph.candidateInput,
        graph.candidateContext,
      ),
    ).rejects.toThrow(/Candidate Receipt/);
    await expect(
      verifyDerivationReceipt(
        graph.stopReceipt,
        {
          ...graph.stopInput,
          pre_stop_readiness_hash: hash("0"),
        },
        graph.stopContext,
      ),
    ).rejects.toThrow(/Stop Receipt|input_hash/);
    await expect(
      verifyDerivationReceipt(graph.watermarkReceipt, {
        ...graph.watermarkInput,
        observed_event_seq: graph.watermarkInput.observed_event_seq + 1,
      }),
    ).rejects.toThrow(/Input Watermark|input_hash/);
  });

  it("Budget secondary material 漂移即使重算 input/receipt 外层也失败", async () => {
    const graph = await buildIntegrityGraph();
    const invalidRuntimeMaterial = {
      ...graph.runtimeLimitsMaterial,
      limits: {
        ...graph.runtimeLimitsMaterial.limits,
        max_steps: graph.runtimeLimitsMaterial.limits.max_steps - 1,
      },
    };
    await expect(computeRuntimeLimitsHashV2(invalidRuntimeMaterial)).rejects.toThrow(
      /Runtime limits/,
    );

    const forgedRuntimeHash = await computeResearchKernelHashV2(
      "u6-research-runtime-limits@1",
      invalidRuntimeMaterial,
    );
    const runtimeInput = {
      ...graph.budgetInput,
      runtime_limits_hash: forgedRuntimeHash,
    };
    const runtimeReceipt = await rehashReceipt({
      ...graph.budgetReceipt,
      runtime_limits_hash: forgedRuntimeHash,
      input_hash: await computeBudgetLedgerInputHash(runtimeInput),
    });
    await expect(
      verifyDerivationReceipt(runtimeReceipt, runtimeInput, {
        ...graph.budgetContext,
        runtime_limits_material: invalidRuntimeMaterial,
      }),
    ).rejects.toThrow(/Runtime limits|二级 Hash/);

    const forgedPolicyMaterial = {
      ...graph.tenantPolicyMaterial,
      limits: {
        ...graph.tenantPolicyMaterial.limits,
        max_steps: graph.tenantPolicyMaterial.limits.max_steps - 1,
      },
    };
    const forgedPolicyHash = await computeTenantBudgetPolicyHashV2(forgedPolicyMaterial);
    const policyInput = {
      ...graph.budgetInput,
      tenant_policy_hash: forgedPolicyHash,
    };
    const policyReceipt = await rehashReceipt({
      ...graph.budgetReceipt,
      tenant_policy_hash: forgedPolicyHash,
      input_hash: await computeBudgetLedgerInputHash(policyInput),
    });
    await expect(
      verifyDerivationReceipt(policyReceipt, policyInput, {
        ...graph.budgetContext,
        tenant_policy_material: forgedPolicyMaterial,
      }),
    ).rejects.toThrow(/二级 Hash/);

    const changedReservation = {
      ...graph.budgetInput.ordered_reservation_states[0],
      reserved_usage: usage({
        model_calls: 1,
        provider_input_tokens: 11,
        provider_tokens: 11,
        provider_cost_microusd: 100,
      }),
    };
    const outstandingInput = {
      ...graph.budgetInput,
      ordered_reservation_states: [changedReservation],
    };
    const outstandingReceipt = await rehashReceipt({
      ...graph.budgetReceipt,
      input_hash: await computeBudgetLedgerInputHash(outstandingInput),
    });
    await expect(
      verifyDerivationReceipt(outstandingReceipt, outstandingInput, graph.budgetContext),
    ).rejects.toThrow(/二级 Hash/);
  });

  it("重算 Receipt 外层后仍分别拒绝 Frontier、Assessment、Candidate Set、Universe 与 Subset 漂移", async () => {
    const graph = await buildIntegrityGraph();

    const changedFrontier = {
      ...graph.coverageReceipt.version_frontier,
      identity_binding: {
        ...graph.coverageReceipt.version_frontier.identity_binding,
        authority_epoch:
          graph.coverageReceipt.version_frontier.identity_binding.authority_epoch + 1,
      },
    };
    const frontierInput = {
      ...graph.coverageInput,
      version_frontier: changedFrontier,
    };
    const frontierInputHash = await computeCoverageDerivationInputHash(frontierInput);
    const frontierReceipt = await rehashReceipt({
      ...graph.coverageReceipt,
      version_frontier: changedFrontier,
      input_hash: frontierInputHash,
      coverage_input_hash: frontierInputHash,
    });
    await expect(verifyDerivationReceipt(frontierReceipt, frontierInput)).rejects.toThrow(
      /version_frontier_hash/,
    );

    const crossScopeFrontierReceipt = {
      ...graph.coverageReceipt,
      version_frontier: {
        ...graph.coverageReceipt.version_frontier,
        semantic_release_ref: {
          ...graph.coverageReceipt.version_frontier.semantic_release_ref,
          tenant_id: uuid(30_010),
        },
      },
    };
    expect(coverageDerivationReceiptSchema.safeParse(crossScopeFrontierReceipt).success).toBe(
      false,
    );

    const changedAssessment = {
      ...graph.candidateReceipt.candidate_queries[0],
      expected_information_gain_microunits: 1,
    };
    const changedCandidateQueries = [changedAssessment];
    const changedCandidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
      unresolved: graph.candidateReceipt.unresolved_obligation_refs,
      candidateQueries: changedCandidateQueries,
      noCandidateRefs: graph.candidateReceipt.no_candidate_obligation_refs,
    });
    const assessmentReceipt = await rehashReceipt({
      ...graph.candidateReceipt,
      candidate_queries: changedCandidateQueries,
      candidate_set_hash: changedCandidateSetHash,
      output_hash: changedCandidateSetHash,
    });
    await expect(
      verifyDerivationReceipt(assessmentReceipt, graph.candidateInput, graph.candidateContext),
    ).rejects.toThrow(/assessment_hash|Assessment/i);

    const [committedNoCandidateAssessment] = graph.candidateReceipt.no_candidate_assessments;
    if (!committedNoCandidateAssessment) {
      throw new TypeError("Integrity fixture 必须包含 NoCandidate Assessment。");
    }
    const changedNoCandidateAssessment = {
      ...committedNoCandidateAssessment,
      constraint_closure_hash: hash("f"),
    };
    const noCandidateAssessmentReceipt = await rehashReceipt({
      ...graph.candidateReceipt,
      no_candidate_assessments: [changedNoCandidateAssessment],
    });
    await expect(
      verifyDerivationReceipt(
        noCandidateAssessmentReceipt,
        graph.candidateInput,
        graph.candidateContext,
      ),
    ).rejects.toThrow(/NoCandidate Assessment assessment_hash/);

    const [stopNoCandidateAssessment] =
      graph.stopContext.stop_decision.candidate_set.no_candidate_assessments;
    if (!stopNoCandidateAssessment) {
      throw new TypeError("Stop integrity fixture 必须包含 NoCandidate Assessment。");
    }
    const changedStopAssessmentDraft = {
      ...stopNoCandidateAssessment,
      constraint_closure_hash: hash("6"),
    };
    const changedStopAssessment = {
      ...changedStopAssessmentDraft,
      assessment_hash: await computeNoCandidateAssessmentV2Hash(changedStopAssessmentDraft),
    };
    const { decision_input_hash: _oldDecisionInputHash, ...changedStopDecisionMaterial } = {
      ...graph.stopContext.stop_decision,
      candidate_set: {
        ...graph.stopContext.stop_decision.candidate_set,
        no_candidate_assessments: [changedStopAssessment],
      },
    };
    const changedStopDecision = {
      ...changedStopDecisionMaterial,
      decision_input_hash: await computeResearchKernelHashV2(
        "u6-stop-decision@1",
        changedStopDecisionMaterial,
      ),
    };
    await expect(
      verifyResearchStopDecisionV2(changedStopDecision, graph.budgetReceipt),
    ).resolves.toEqual(changedStopDecision);

    const changedStopRef = {
      ...graph.stopInput.stop_ref,
      content_hash: hash("6"),
    };
    const changedStopInput = {
      ...graph.stopInput,
      stop_ref: changedStopRef,
    };
    const changedStopReceipt = await rehashReceipt({
      ...graph.stopReceipt,
      stop_ref: changedStopRef,
      output_hash: changedStopRef.content_hash,
      input_hash: await computeStopDerivationInputHash(changedStopInput),
      decision_input_hash: changedStopDecision.decision_input_hash,
    });
    await expect(
      verifyDerivationReceipt(changedStopReceipt, changedStopInput, {
        ...graph.stopContext,
        stop_decision: changedStopDecision,
      }),
    ).rejects.toThrow(/Stop Receipt\/Decision\/Candidate subordinate context/);

    const candidateSetReceipt = await rehashReceipt({
      ...graph.candidateReceipt,
      candidate_set_hash: hash("f"),
      output_hash: hash("f"),
    });
    await expect(
      verifyDerivationReceipt(candidateSetReceipt, graph.candidateInput, graph.candidateContext),
    ).rejects.toThrow(/candidate_set_hash/);

    const universeReceipt = await rehashReceipt({
      ...graph.candidateReceipt,
      enumeration_universe_hash: hash("e"),
    });
    await expect(
      verifyDerivationReceipt(universeReceipt, graph.candidateInput, graph.candidateContext),
    ).rejects.toThrow(/Attestation context/);

    const subsetInput = {
      ...graph.stopInput,
      supported_subset: {
        ...graph.stopInput.supported_subset,
        subset_hash: hash("d"),
      },
    };
    const subsetReceipt = await rehashReceipt({
      ...graph.stopReceipt,
      supported_subset: subsetInput.supported_subset,
      input_hash: await computeStopDerivationInputHash(subsetInput),
    });
    await expect(
      verifyDerivationReceipt(subsetReceipt, subsetInput, graph.stopContext),
    ).rejects.toThrow(/subset_hash/);
  });

  it("Candidate Attestation command/universe/candidate-set/input/final 五层各有唯一拒绝点", async () => {
    const graph = await buildIntegrityGraph();
    await expect(
      verifyCandidateEnumeratorAttestation(graph.attestation, graph.budgetReceipt),
    ).resolves.toEqual(graph.attestation);

    const commandBeforeInput = {
      ...graph.attestation,
      attestation_command_hash: hash("1"),
    };
    const commandBeforeFinal = {
      ...commandBeforeInput,
      input_hash: await computeAttestationInputHash(commandBeforeInput),
    };
    const commandMutation = await rehashAttestation(commandBeforeFinal);
    await expect(
      verifyCandidateEnumeratorAttestation(commandMutation, graph.budgetReceipt),
    ).rejects.toThrow(/attestation_command_hash/);

    const universeBeforeCommand = {
      ...graph.attestation,
      enumeration_universe_hash: hash("2"),
    };
    const universeBeforeInput = {
      ...universeBeforeCommand,
      attestation_command_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-command@1",
        attestationCommandMaterial(universeBeforeCommand),
      ),
    };
    const universeBeforeFinal = {
      ...universeBeforeInput,
      input_hash: await computeAttestationInputHash(universeBeforeInput),
    };
    const universeMutation = await rehashAttestation(universeBeforeFinal);
    await expect(
      verifyCandidateEnumeratorAttestation(universeMutation, graph.budgetReceipt),
    ).rejects.toThrow(/enumeration_universe_hash/);

    const candidateSetBeforeCommand = {
      ...graph.attestation,
      candidate_set_hash: hash("3"),
    };
    const candidateSetBeforeInput = {
      ...candidateSetBeforeCommand,
      attestation_command_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-command@1",
        attestationCommandMaterial(candidateSetBeforeCommand),
      ),
    };
    const candidateSetBeforeFinal = {
      ...candidateSetBeforeInput,
      input_hash: await computeAttestationInputHash(candidateSetBeforeInput),
    };
    const candidateSetMutation = await rehashAttestation(candidateSetBeforeFinal);
    await expect(
      verifyCandidateEnumeratorAttestation(candidateSetMutation, graph.budgetReceipt),
    ).rejects.toThrow(/candidate_set_hash/);

    const inputBeforeFinal = {
      ...graph.attestation,
      input_hash: hash("4"),
    };
    const inputMutation = await rehashAttestation(inputBeforeFinal);
    await expect(
      verifyCandidateEnumeratorAttestation(inputMutation, graph.budgetReceipt),
    ).rejects.toThrow(/input_hash/);

    await expect(
      verifyCandidateEnumeratorAttestation(
        {
          ...graph.attestation,
          attestation_hash: hash("5"),
        },
        graph.budgetReceipt,
      ),
    ).rejects.toThrow(/attestation_hash/);
  });
});
