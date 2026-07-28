import { describe, expect, it } from "vitest";
import {
  beginResearchStepInputSchema,
  budgetLedgerInputHashMaterialSchema,
  budgetLedgerReceiptSchema,
  candidateEnumerationReceiptSchema,
  candidateEnumeratorAttestationSchema,
  computeCandidateEnumerationInputHash,
  computeCandidateQueryAssessmentV2Hash,
  computeCoverageDerivationInputHash,
  computeDerivationReceiptHash,
  computeEnumerationUniverseHashV2,
  computeNoCandidateAssessmentV2Hash,
  computeOutstandingReservationSetHashV2,
  computeProvisionDerivationPolicyRequestHash,
  computeResearchBudgetLedgerV2Hash,
  computeResearchKernelHashV2,
  computeRuntimeLimitsHashV2,
  computeTenantBudgetPolicyHashV2,
  computeU6DerivationPolicyManifestHash,
  coverageDerivationReceiptSchema,
  coverageStatePayloadSchema,
  coverageStatePayloadV2Schema,
  coverageStateV2RefSchema,
  derivationReceiptSchema,
  inputEventWatermarkReceiptSchema,
  issueBudgetLedgerSnapshotInputSchema,
  issueCandidateEnumeratorAttestationInputSchema,
  type KnownArtifactType,
  provisionDerivationPolicyInputSchema,
  provisionedDerivationPolicySchema,
  RESEARCH_RUNTIME_LIMITS,
  researchBudgetLedgerBindingSchema,
  researchBudgetLedgerBindingV2Schema,
  researchStopDecisionPayloadV2Schema,
  researchStopDerivationReceiptSchema,
  reservationBudgetStateProjectionSchema,
  verifyCandidateEnumeratorAttestation,
  verifyCoverageStateV2BudgetBinding,
  verifyDerivationReceipt,
  verifyNoCandidateAssessmentV2,
  verifyProvisionDerivationPolicyInput,
  verifyProvisionedDerivationPolicy,
  verifyResearchBudgetLedgerBindingV2,
  verifyResearchStopDecisionV2BudgetBinding,
  verifyU6DerivationPolicyManifest,
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

function numberedHash(value: number): `sha256:${string}` {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
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
    source_calls: 0;
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

const effectiveLimit = {
  max_steps: 10,
  max_model_calls: 10,
  max_sql_executions: 10,
  max_source_calls: 0 as const,
  max_elapsed_ms: 1_000,
  max_provider_input_tokens_per_call: 10,
  max_provider_output_tokens_per_call: 10,
  max_provider_tokens_per_run: 100,
  max_provider_cost_microusd_per_run: 1_000,
};

function ledger(options: { topUpAllowed?: boolean; exhausted?: boolean } = {}) {
  const exhausted = options.exhausted ?? false;
  const actual = exhausted
    ? usage({
        steps: 10,
        model_calls: 10,
        sql_executions: 10,
        elapsed_ms: 1_000,
        provider_input_tokens: 50,
        provider_output_tokens: 50,
        provider_tokens: 100,
        provider_cost_microusd: 1_000,
      })
    : usage({
        steps: 1,
        model_calls: 1,
        elapsed_ms: 100,
        provider_input_tokens: 5,
        provider_output_tokens: 5,
        provider_tokens: 10,
        provider_cost_microusd: 100,
      });
  return {
    ledger_version: "research-budget-ledger@2.0.0",
    evaluated_through_reservation_seq: 2,
    evaluated_through_budget_event_seq: 4,
    effective_limit: effectiveLimit,
    actual_used: actual,
    unresolved_hold: usage(),
    charged_used: actual,
    remaining: {
      steps: exhausted ? 0 : 9,
      model_calls: exhausted ? 0 : 9,
      sql_executions: exhausted ? 0 : 10,
      source_calls: 0 as const,
      elapsed_ms: exhausted ? 0 : 900,
      provider_tokens: exhausted ? 0 : 90,
      provider_cost_microusd: exhausted ? 0 : 900,
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
    top_up_allowed: options.topUpAllowed ?? false,
    ledger_hash: hash("b"),
  } as const;
}

function demand(steps = 1) {
  return {
    steps,
    model_calls: 1,
    sql_executions: 0,
    source_calls: 0 as const,
    elapsed_ms: 10,
    provider_tokens: 2,
    provider_cost_microusd: 1,
  };
}

function outcomeUsageRef(resourceKind: "MODEL" | "SQL" | "TOOL", sequence = 610) {
  const authority =
    resourceKind === "MODEL"
      ? {
          owner_kind: "MODEL_ADAPTER_AUTHORITY" as const,
          commit_capability: "MODEL_INVOCATION_AUTHORITY" as const,
          producer: "MODEL_ADAPTER" as const,
        }
      : resourceKind === "SQL"
        ? {
            owner_kind: "SQL_ADAPTER_AUTHORITY" as const,
            commit_capability: "SQL_INVOCATION_AUTHORITY" as const,
            producer: "SQL_ADAPTER" as const,
          }
        : {
            owner_kind: "TOOL_ADAPTER_AUTHORITY" as const,
            commit_capability: "TOOL_INVOCATION_AUTHORITY" as const,
            producer: "TOOL_ADAPTER" as const,
          };
  return {
    record_kind: "INVOCATION_OUTCOME_USAGE" as const,
    record_id: uuid(sequence),
    scope,
    run_id: runId,
    record_version: 1 as const,
    content_hash: hash("d"),
    commit_id: uuid(sequence + 1),
    store: "research_invocation_outcome_usage" as const,
    resolver_capability: "RESOURCE_AUTHORITY" as const,
    commit: "commit_invocation_terminal@1.0.0" as const,
    resolver: "resolve_committed_invocation_outcome_usage@1.0.0" as const,
    status: "COMMITTED" as const,
    authority_epoch: 1,
    expires_at: null,
    revocation_seq: 0 as const,
    adapter_kind: resourceKind,
    ...authority,
  };
}

function reservation(
  state:
    | "RESERVED"
    | "IN_USE"
    | "SETTLED"
    | "SETTLED_OVER_LIMIT"
    | "CANCELLED"
    | "EXPIRED"
    | "ABANDONED",
  sequence = 620,
) {
  const zero = usage();
  if (state === "SETTLED" || state === "SETTLED_OVER_LIMIT") {
    const actualUsage =
      state === "SETTLED_OVER_LIMIT"
        ? usage({ model_calls: 1, provider_input_tokens: 2, provider_tokens: 2 })
        : usage({ model_calls: 1, provider_input_tokens: 1, provider_tokens: 1 });
    return {
      reservation_id: uuid(sequence),
      reservation_seq: sequence,
      resource_kind: "MODEL" as const,
      state,
      reserved_usage: usage({ model_calls: 1, provider_input_tokens: 1, provider_tokens: 1 }),
      actual_usage: actualUsage,
      outcome_usage_ref: outcomeUsageRef("MODEL", sequence + 100),
      outcome_unknown_hash: null,
      end_reason_code: "COMPLETED",
    };
  }
  if (state === "ABANDONED") {
    return {
      reservation_id: uuid(sequence),
      reservation_seq: sequence,
      resource_kind: "MODEL" as const,
      state,
      reserved_usage: usage({ model_calls: 1, provider_input_tokens: 1, provider_tokens: 1 }),
      actual_usage: null,
      outcome_usage_ref: null,
      outcome_unknown_hash: hash("e"),
      end_reason_code: "OUTCOME_UNKNOWN",
    };
  }
  return {
    reservation_id: uuid(sequence),
    reservation_seq: sequence,
    resource_kind: "MODEL" as const,
    state,
    reserved_usage: usage({ model_calls: 1, provider_input_tokens: 1, provider_tokens: 1 }),
    actual_usage: state === "RESERVED" || state === "IN_USE" ? null : zero,
    outcome_usage_ref: null,
    outcome_unknown_hash: null,
    end_reason_code:
      state === "RESERVED" || state === "IN_USE"
        ? null
        : state === "EXPIRED"
          ? "EXPIRED"
          : "CANCELLED",
  };
}

function budgetLedgerMaterial(reservations: readonly ReturnType<typeof reservation>[]) {
  return {
    research_brief_ref: ref("ResearchBrief", 630),
    runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1",
    runtime_limits_hash: hash("1"),
    tenant_policy_version: "tenant-budget@1.0.0",
    tenant_policy_hash: hash("2"),
    budget_epoch: 1,
    budget_started_at: "2026-07-27T23:59:00.000000Z",
    evaluated_at: committedAt,
    evaluated_through_reservation_seq: reservations.length,
    evaluated_through_budget_event_seq: 1,
    budget_event_head_hash: hash("4"),
    ordered_budget_event_hashes: [hash("4")],
    ordered_reservation_states: reservations,
    outstanding_set_hash: hash("5"),
  };
}

async function verifiedBudgetReceiptFixture() {
  const ledgerDraft = {
    ...ledger(),
    evaluated_through_reservation_seq: 0,
    evaluated_through_budget_event_seq: 1,
  };
  const committedLedger = {
    ...ledgerDraft,
    ledger_hash: await computeResearchBudgetLedgerV2Hash(ledgerDraft),
  };
  const runtimeLimitsMaterial = {
    runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1" as const,
    limits: RESEARCH_RUNTIME_LIMITS,
  };
  const tenantPolicyMaterial = {
    scope,
    tenant_policy_version: "tenant-budget@1.0.0",
    limits: effectiveLimit,
    top_up_allowed: false,
  };
  const inputMaterial = {
    ...budgetLedgerMaterial([]),
    runtime_limits_hash: await computeRuntimeLimitsHashV2(runtimeLimitsMaterial),
    tenant_policy_hash: await computeTenantBudgetPolicyHashV2(tenantPolicyMaterial),
    outstanding_set_hash: await computeOutstandingReservationSetHashV2({
      scope,
      run_id: runId,
      budget_epoch: 1,
      reservations: [],
    }),
  };
  const inputHash = await computeResearchKernelHashV2("u6-budget-ledger-input@2", inputMaterial);
  const snapshotCommandHash = await computeResearchKernelHashV2(
    "u6-budget-ledger-snapshot-command@1",
    {
      schema_version: "1.0.0",
      scope,
      run_id: runId,
      principal_id: principalId,
      idempotency_key: "verified-budget-receipt",
      snapshot_operation_id: uuid(640),
      research_brief_ref: inputMaterial.research_brief_ref,
    },
  );
  const receiptDraft = {
    protocol_version: "research-budget-ledger-receipt@2.0.0" as const,
    receipt_id: uuid(640),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "verified-budget-receipt",
    input_hash: inputHash,
    output_hash: committedLedger.ledger_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    snapshot_command_hash: snapshotCommandHash,
    research_brief_ref: inputMaterial.research_brief_ref,
    runtime_limits_version: inputMaterial.runtime_limits_version,
    runtime_limits_hash: inputMaterial.runtime_limits_hash,
    tenant_policy_version: inputMaterial.tenant_policy_version,
    tenant_policy_hash: inputMaterial.tenant_policy_hash,
    budget_epoch: inputMaterial.budget_epoch,
    budget_started_at: inputMaterial.budget_started_at,
    evaluated_through_reservation_seq: 0,
    evaluated_through_budget_event_seq: 1,
    evaluated_at: inputMaterial.evaluated_at,
    valid_until: "2026-07-28T00:01:00.000000Z",
    outstanding_set_hash: inputMaterial.outstanding_set_hash,
    active_count: 0,
    outcome_unknown_count: 0,
    abandoned_count: 0,
    actual_used: committedLedger.actual_used,
    unresolved_hold: committedLedger.unresolved_hold,
    ledger: committedLedger,
  };
  return {
    inputMaterial,
    verificationContext: {
      kind: "BUDGET" as const,
      runtime_limits_material: runtimeLimitsMaterial,
      tenant_policy_material: tenantPolicyMaterial,
      research_brief_budget_limit: effectiveLimit,
    },
    receipt: {
      ...receiptDraft,
      receipt_hash: await computeDerivationReceiptHash(receiptDraft),
    },
  };
}

async function verifiedEmptyCandidateReceiptFixture() {
  const { receipt: budgetReceipt } = await verifiedBudgetReceiptFixture();
  const coverageRef = ref("CoverageState", 650, hash("7"));
  const frontier = versionFrontier();
  const frontierHash = await computeResearchKernelHashV2("u6-version-frontier@1", frontier);
  const closureRefs = {
    obligation_execution_decision_refs: [],
    query_evidence_refs: [],
    atomic_claim_refs: [],
    evidence_relation_refs: [],
    support_decision_refs: [],
    hypothesis_assessment_refs: [],
  };
  const coverageInput = {
    evidence_plan_ref: evidencePlanRef,
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    version_frontier: frontier,
    version_frontier_hash: frontierHash,
    closure_refs: closureRefs,
    kernel_version: "kernel@1.0.0",
  };
  const coverageInputHash = await computeCoverageDerivationInputHash(coverageInput);
  const coverageReceiptDraft = {
    protocol_version: "coverage-derivation-receipt@1.0.0" as const,
    receipt_id: uuid(651),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "verified-empty-coverage",
    input_hash: coverageInputHash,
    output_hash: coverageRef.content_hash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    coverage_ref: coverageRef,
    evidence_plan_ref: evidencePlanRef,
    budget_receipt_id: budgetReceipt.receipt_id,
    budget_receipt_hash: budgetReceipt.receipt_hash,
    version_frontier: frontier,
    version_frontier_hash: frontierHash,
    closure_refs: closureRefs,
    coverage_input_hash: coverageInputHash,
    kernel_version: coverageInput.kernel_version,
  };
  const coverageReceipt = {
    ...coverageReceiptDraft,
    receipt_hash: await computeDerivationReceiptHash(coverageReceiptDraft),
  };

  const enumeratorVersion = "enumerator@1.0.0";
  const eigPolicyVersion = "eig@1.0.0";
  const enumerationUniverseHash = await computeEnumerationUniverseHashV2({
    coverage_ref: coverageRef,
    budget_input_hash: budgetReceipt.input_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    query_contract_universe_refs: [],
    unresolved_obligation_refs: [],
  });
  const candidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
    unresolved: [],
    candidateQueries: [],
    noCandidateRefs: [],
  });
  const attestationCommand = {
    ...strictCommandBase(),
    attestation_operation_id: uuid(652),
    coverage_ref: coverageRef,
    budget_receipt: {
      receipt_id: budgetReceipt.receipt_id,
      receipt_hash: budgetReceipt.receipt_hash,
    },
    budget_input_hash: budgetReceipt.input_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    query_contract_universe_refs: [],
    unresolved_obligation_refs: [],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: [],
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
  };
  const attestationCommandHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-command@1",
    attestationCommand,
  );
  const attestationDraft = {
    protocol_version: "candidate-enumerator-attestation@1.0.0" as const,
    attestation_id: attestationCommand.attestation_operation_id,
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
    implementation_digest: hash("8"),
    query_contract_universe_refs: [],
    unresolved_obligation_refs: [],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: [],
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
    attestation_command_hash: attestationCommandHash,
  };
  const { attestation_id: _attestationId, ...attestationInputMaterial } = attestationDraft;
  const attestationInputHash = await computeResearchKernelHashV2(
    "u6-candidate-enumerator-attestation-input@1",
    attestationInputMaterial,
  );
  const attestationWithoutHash = {
    ...attestationDraft,
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
    query_contract_universe_refs: [],
  };
  const candidateInputHash = await computeCandidateEnumerationInputHash(candidateInput);
  const candidateReceiptDraft = {
    protocol_version: "candidate-enumeration-receipt@1.0.0" as const,
    receipt_id: uuid(653),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "verified-empty-candidate",
    input_hash: candidateInputHash,
    output_hash: candidateSetHash,
    receipt_hash: hash("0"),
    committed_at: committedAt,
    coverage_receipt_id: coverageReceipt.receipt_id,
    coverage_receipt_hash: coverageReceipt.receipt_hash,
    budget_receipt_id: budgetReceipt.receipt_id,
    budget_receipt_hash: budgetReceipt.receipt_hash,
    enumerator_version: enumeratorVersion,
    eig_policy_version: eigPolicyVersion,
    enumerator_capability_id: capabilityId,
    enumerator_authority_epoch: 7,
    enumerator_attestation_id: attestation.attestation_id,
    enumerator_attestation_hash: attestation.attestation_hash,
    unresolved_obligation_refs: [],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: [],
    query_contract_universe_refs: [],
    enumeration_universe_hash: enumerationUniverseHash,
    candidate_set_hash: candidateSetHash,
  };
  const candidateReceipt = {
    ...candidateReceiptDraft,
    receipt_hash: await computeDerivationReceiptHash(candidateReceiptDraft),
  };

  return {
    budgetReceipt,
    coverageReceipt,
    attestation,
    candidateInput,
    candidateReceipt,
    verificationContext: {
      kind: "CANDIDATE" as const,
      attestation,
      budget_receipt: budgetReceipt,
      coverage_receipt: coverageReceipt,
    },
  };
}

function candidate(
  admissibility:
    | "EXECUTABLE_NOW"
    | "WAITING_EXTERNAL_CAPABILITY"
    | "BUDGET_BLOCKED"
    | "INADMISSIBLE",
  options: {
    querySequence?: number;
    steps?: number;
    waitingCodes?: string[];
    eig?: number;
  } = {},
) {
  return {
    query_contract_ref: ref("QueryContract", options.querySequence ?? 200),
    obligation_refs: [obligationRef()],
    admissibility,
    expected_information_gain_microunits:
      options.eig ?? (admissibility === "INADMISSIBLE" ? 0 : 100),
    required_budget: demand(options.steps ?? 1),
    waiting_on_codes:
      options.waitingCodes ??
      (admissibility === "WAITING_EXTERNAL_CAPABILITY" ? ["WAREHOUSE_WINDOW"] : []),
    reason_codes: [
      admissibility === "EXECUTABLE_NOW"
        ? "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE"
        : "ANALYSIS_INCONCLUSIVE",
    ],
    assessment_hash: hash("c"),
  } as const;
}

function supportedSubset(deliverable = false) {
  return {
    claim_refs: deliverable ? [ref("AtomicClaim", 300)] : [],
    support_decision_refs: deliverable ? [ref("SupportDecision", 301)] : [],
    required_disclosures: deliverable ? ["BUDGET_LIMIT"] : [],
    subset_hash: hash("d"),
  };
}

function stopBase(
  assessment: ReturnType<typeof candidate>,
  options: {
    budget?: ReturnType<typeof ledger>;
    deliverable?: boolean;
  } = {},
) {
  return {
    artifact_type: "ResearchStopDecision",
    protocol_version: "research-stop@2.0.0",
    coverage_ref: ref("CoverageState", 400),
    budget_receipt: {
      receipt_id: uuid(401),
      receipt_hash: hash("e"),
    },
    budget_ledger: options.budget ?? ledger(),
    candidate_queries: [assessment],
    candidate_set: {
      enumerator_version: "enumerator@1.0.0",
      unresolved_obligation_refs: [obligationRef()],
      no_candidate_obligation_refs: [],
      no_candidate_assessments: [],
      candidate_set_hash: hash("f"),
    },
    supported_subset: supportedSubset(options.deliverable),
    reason_codes: ["ANALYSIS_INCONCLUSIVE"],
    eig_policy_version: "eig@1.0.0",
    decision_input_hash: hash("1"),
  } as const;
}

function versionFrontier() {
  return {
    semantic_release_ref: ref("SemanticRelease", 500),
    schema_snapshot_ref: ref("SchemaSnapshot", 501),
    data_snapshot: {
      protocol_version: "data-snapshot-binding@1.0.0",
      datasource_id: uuid(502),
      strategy: "CONTROLLED_REVISION",
      snapshot_token: "snapshot@1",
      schema_manifest_hash: hash("2"),
      data_manifest_hash: hash("3"),
      fixture_manifest_hash: hash("4"),
      replay_state: "REPLAYABLE",
      binding_hash: hash("5"),
    },
    policy_receipt_ref: ref("PolicyReceipt", 503),
    identity_binding: {
      principal_id: principalId,
      delegation_chain_hash: hash("6"),
      authority_epoch: 1,
    },
  } as const;
}

function coveragePayload() {
  const obligation = {
    obligation_ref: obligationRef(),
    materiality: "CRITICAL",
    state: "OPEN",
    obligation_execution_decision_refs: [],
    query_evidence_refs: [],
    support_decision_refs: [],
    conflict_refs: [],
    reason_codes: ["ANALYSIS_INCONCLUSIVE"],
  } as const;
  return {
    artifact_type: "CoverageState",
    protocol_version: "coverage-state@2.0.0",
    evidence_plan_ref: evidencePlanRef,
    obligation_execution_decision_refs: [],
    query_evidence_refs: [],
    atomic_claim_refs: [],
    evidence_relation_refs: [],
    support_decision_refs: [],
    hypothesis_assessment_refs: [
      ref("HypothesisAssessment", 510),
      ref("HypothesisAssessment", 511),
    ],
    obligations: [obligation],
    derived_counts: {
      critical_total: 1,
      critical_open: 1,
      critical_satisfied: 0,
      critical_blocked: 0,
      critical_failed: 0,
      critical_stale: 0,
      supporting_total: 0,
      supporting_open: 0,
      supporting_satisfied: 0,
      supporting_blocked: 0,
      supporting_failed: 0,
      supporting_stale: 0,
    },
    material_conflict_refs: [],
    budget_receipt: {
      receipt_id: uuid(512),
      receipt_hash: hash("7"),
    },
    budget_ledger: ledger(),
    version_frontier: versionFrontier(),
    version_frontier_hash: hash("8"),
    coverage_input_hash: hash("9"),
  } as const;
}

function strictCommandBase() {
  return {
    schema_version: "1.0.0",
    scope,
    run_id: runId,
    principal_id: principalId,
    idempotency_key: "u6-wire-test",
  } as const;
}

function candidateClosure() {
  const assessment = candidate("INADMISSIBLE");
  return {
    query_contract_universe_refs: [assessment.query_contract_ref],
    unresolved_obligation_refs: [obligationRef()],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: [assessment],
  } as const;
}

describe("U6 Research derivation v2 wire", () => {
  it("闭合 ResearchBudgetLedgerBindingV2 的 provider token 与七轴方程", () => {
    expect(researchBudgetLedgerBindingV2Schema.safeParse(ledger()).success).toBe(true);

    const invalidTokens = structuredClone(ledger());
    invalidTokens.actual_used.provider_tokens = 11;
    expect(researchBudgetLedgerBindingV2Schema.safeParse(invalidTokens).success).toBe(false);

    const invalidCharged = structuredClone(ledger());
    invalidCharged.charged_used.steps = 2;
    expect(researchBudgetLedgerBindingV2Schema.safeParse(invalidCharged).success).toBe(false);

    const invalidEquation = {
      ...ledger(),
      remaining: {
        ...ledger().remaining,
        steps: 8,
      },
    };
    expect(researchBudgetLedgerBindingV2Schema.safeParse(invalidEquation).success).toBe(false);

    const dualBalance = {
      ...ledger(),
      remaining: {
        ...ledger().remaining,
        steps: 8,
      },
      overage: {
        ...ledger().overage,
        steps: 1,
      },
    };
    expect(researchBudgetLedgerBindingV2Schema.safeParse(dualBalance).success).toBe(false);
  });

  it("Coverage v2 严格区分 v1/v2 payload 并保持 v1 parser 行为", () => {
    const v2 = coveragePayload();
    expect(coverageStatePayloadV2Schema.safeParse(v2).success).toBe(true);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...v2,
        extra_key: true,
      }).success,
    ).toBe(false);

    const v1Ledger = {
      ledger_version: "research-budget-ledger@1.0.0",
      evaluated_through_reservation_seq: 0,
      effective_limit: effectiveLimit,
      used: usage(),
      remaining: {
        steps: 10,
        model_calls: 10,
        sql_executions: 10,
        source_calls: 0,
        elapsed_ms: 1_000,
        provider_tokens: 100,
        provider_cost_microusd: 1_000,
      },
      top_up_allowed: false,
      ledger_hash: hash("a"),
    } as const;
    expect(researchBudgetLedgerBindingSchema.safeParse(v1Ledger).success).toBe(true);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...v2,
        budget_ledger: v1Ledger,
      }).success,
    ).toBe(false);

    const v1Coverage = {
      ...v2,
      protocol_version: "coverage-state@1.0.0",
      budget_ledger: v1Ledger,
    };
    const { budget_receipt: _budgetReceipt, ...v1CoverageWithoutReceipt } = v1Coverage;
    expect(coverageStatePayloadSchema.safeParse(v1CoverageWithoutReceipt).success).toBe(true);
    expect(coverageStatePayloadV2Schema.safeParse(v1CoverageWithoutReceipt).success).toBe(false);
  });

  it("ArtifactReference v2 alias 不新增 version，并拒绝 duplicate 与乱序", () => {
    const v2Reference = ref("CoverageState", 600);
    expect(coverageStateV2RefSchema.safeParse(v2Reference).success).toBe(true);
    expect(
      coverageStateV2RefSchema.safeParse({
        ...v2Reference,
        version: "2.0.0",
      }).success,
    ).toBe(false);

    const first = ref("AtomicClaim", 610);
    const second = ref("AtomicClaim", 611);
    const base = coveragePayload();
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...base,
        atomic_claim_refs: [first, first],
      }).success,
    ).toBe(false);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...base,
        atomic_claim_refs: [second, first],
      }).success,
    ).toBe(false);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...base,
        atomic_claim_refs: [first, second],
      }).success,
    ).toBe(true);
  });

  it("SupportedSubset 按 SupportDecision identity 排序成对关系，不独立重排 Claim", () => {
    const firstSupport = ref("SupportDecision", 612);
    const secondSupport = ref("SupportDecision", 613);
    const firstClaim = ref("AtomicClaim", 615);
    const secondClaim = ref("AtomicClaim", 614);
    const crossedSubset = {
      claim_refs: [firstClaim, secondClaim],
      support_decision_refs: [firstSupport, secondSupport],
      required_disclosures: ["BUDGET_LIMIT"],
      subset_hash: hash("d"),
    };
    const partial = {
      ...stopBase(candidate("BUDGET_BLOCKED", { steps: 1 }), {
        budget: ledger({ exhausted: true }),
        deliverable: true,
      }),
      supported_subset: crossedSubset,
      decision: "STOP_PARTIAL",
      non_ready_terminal: "PARTIAL",
      partial_disclosure_codes: ["BUDGET_LIMIT"],
    };

    expect(researchStopDecisionPayloadV2Schema.safeParse(partial).success).toBe(true);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...partial,
        supported_subset: {
          ...crossedSubset,
          support_decision_refs: [secondSupport, firstSupport],
        },
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...partial,
        supported_subset: {
          ...crossedSubset,
          claim_refs: [firstClaim],
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "CONTINUE",
      () => ({
        ...stopBase(candidate("EXECUTABLE_NOW")),
        decision: "CONTINUE",
        selected_next_query_ref: ref("QueryContract", 200),
      }),
    ],
    [
      "REPLAN",
      () => ({
        ...stopBase(candidate("INADMISSIBLE")),
        decision: "REPLAN",
        replan_obligation_refs: [obligationRef()],
        replan_assessment: {
          trigger: "PLAN_INVALIDATED",
          executable_with_remaining_budget: true,
          assessment_hash: hash("a"),
        },
      }),
    ],
    [
      "STOP_READY",
      () => ({
        ...stopBase(candidate("INADMISSIBLE")),
        decision: "STOP_READY",
      }),
    ],
    [
      "STOP_PARTIAL",
      () => ({
        ...stopBase(candidate("BUDGET_BLOCKED", { steps: 1 }), {
          budget: ledger({ exhausted: true }),
          deliverable: true,
        }),
        decision: "STOP_PARTIAL",
        non_ready_terminal: "PARTIAL",
        partial_disclosure_codes: ["BUDGET_LIMIT"],
      }),
    ],
    [
      "STOP_NEEDS_MORE_RESEARCH",
      () => ({
        ...stopBase(
          candidate("WAITING_EXTERNAL_CAPABILITY", {
            waitingCodes: ["WAREHOUSE_WINDOW"],
          }),
        ),
        decision: "STOP_NEEDS_MORE_RESEARCH",
        non_ready_terminal: "NEEDS_MORE_RESEARCH",
        resume_requirement_codes: ["WAREHOUSE_WINDOW"],
      }),
    ],
    [
      "STOP_INCONCLUSIVE",
      () => ({
        ...stopBase(candidate("INADMISSIBLE")),
        decision: "STOP_INCONCLUSIVE",
        non_ready_terminal: "INCONCLUSIVE",
        inadmissibility_summary_hash: hash("b"),
      }),
    ],
  ] as const)("接受六个严格互斥 Stop v2 分支：%s", (_name, makePayload) => {
    expect(researchStopDecisionPayloadV2Schema.safeParse(makePayload()).success).toBe(true);
  });

  it("拒绝非法 Stop branch、错误 non_ready_terminal 与 extra key", () => {
    const partial = {
      ...stopBase(candidate("BUDGET_BLOCKED", { steps: 1 }), {
        budget: ledger({ exhausted: true }),
        deliverable: true,
      }),
      decision: "STOP_PARTIAL",
      non_ready_terminal: "NEEDS_MORE_RESEARCH",
      partial_disclosure_codes: ["BUDGET_LIMIT"],
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(partial).success).toBe(false);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...partial,
        decision: "STOP_UNKNOWN",
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...stopBase(candidate("EXECUTABLE_NOW")),
        decision: "CONTINUE",
        selected_next_query_ref: ref("QueryContract", 200),
        non_ready_terminal: "PARTIAL",
      }).success,
    ).toBe(false);
  });

  it("Candidate Enumerator command/attestation 对完整 universe 与全部 hash fail closed", async () => {
    const candidateAssessment = candidate("INADMISSIBLE");
    const closure = {
      ...candidateClosure(),
      candidate_queries: [
        {
          ...candidateAssessment,
          assessment_hash: await computeCandidateQueryAssessmentV2Hash(candidateAssessment),
        },
      ],
    };
    const coverageRef = ref("CoverageState", 700);
    const { receipt: committedBudgetReceipt } = await verifiedBudgetReceiptFixture();
    const budgetReceipt = {
      receipt_id: committedBudgetReceipt.receipt_id,
      receipt_hash: committedBudgetReceipt.receipt_hash,
    };
    const budgetInputHash = committedBudgetReceipt.input_hash;
    const enumeratorVersion = "enumerator@1.0.0";
    const eigPolicyVersion = "eig@1.0.0";
    const universeHash = await computeResearchKernelHashV2("u6-candidate-enumeration-universe@1", {
      coverage_ref: coverageRef,
      budget_input_hash: budgetInputHash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      query_contract_universe_refs: closure.query_contract_universe_refs,
      unresolved_obligation_refs: closure.unresolved_obligation_refs,
    });
    const candidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
      unresolved: closure.unresolved_obligation_refs,
      candidateQueries: closure.candidate_queries,
      noCandidateRefs: closure.no_candidate_obligation_refs,
    });
    const issueInput = {
      ...strictCommandBase(),
      attestation_operation_id: uuid(702),
      coverage_ref: coverageRef,
      budget_receipt: budgetReceipt,
      budget_input_hash: budgetInputHash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      ...closure,
      enumeration_universe_hash: universeHash,
      candidate_set_hash: candidateSetHash,
    };
    expect(issueCandidateEnumeratorAttestationInputSchema.safeParse(issueInput).success).toBe(true);
    const commandHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation-command@1",
      issueInput,
    );
    const attestationBase = {
      protocol_version: "candidate-enumerator-attestation@1.0.0",
      attestation_id: issueInput.attestation_operation_id,
      scope,
      run_id: runId,
      issuer_principal_id: principalId,
      issuer_capability_id: capabilityId,
      issuer_authority_epoch: 7,
      idempotency_key: issueInput.idempotency_key,
      coverage_ref: coverageRef,
      budget_receipt: budgetReceipt,
      budget_input_hash: budgetInputHash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      implementation_digest: hash("e"),
      ...closure,
      enumeration_universe_hash: universeHash,
      candidate_set_hash: candidateSetHash,
      attestation_command_hash: commandHash,
    };
    const { attestation_id: _attestationId, ...attestationInputMaterial } = attestationBase;
    const inputHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation-input@1",
      attestationInputMaterial,
    );
    const attestationWithoutHash = {
      ...attestationBase,
      input_hash: inputHash,
      committed_at: committedAt,
    };
    const attestationHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation@1",
      attestationWithoutHash,
    );
    const attestation = {
      ...attestationWithoutHash,
      attestation_hash: attestationHash,
    };

    expect(candidateEnumeratorAttestationSchema.safeParse(attestation).success).toBe(true);
    await expect(
      verifyCandidateEnumeratorAttestation(attestation, committedBudgetReceipt),
    ).resolves.toEqual(attestation);
    await expect(
      verifyCandidateEnumeratorAttestation(attestation, {
        ...committedBudgetReceipt,
        input_hash: hash("d"),
      }),
    ).rejects.toThrow(/Receipt|Budget Snapshot/);
    await expect(
      verifyCandidateEnumeratorAttestation(
        {
          ...attestation,
          candidate_set_hash: hash("f"),
        },
        committedBudgetReceipt,
      ),
    ).rejects.toThrow(/hash/);

    // 攻击者不能只改内层 Assessment Hash 后重算所有外层可见 Hash。
    const tamperedAssessment = {
      ...attestation.candidate_queries[0],
      assessment_hash: hash("f"),
    };
    const tamperedCandidateQueries = [tamperedAssessment];
    const tamperedCandidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
      unresolved: attestation.unresolved_obligation_refs,
      candidateQueries: tamperedCandidateQueries,
      noCandidateRefs: attestation.no_candidate_obligation_refs,
    });
    const tamperedIssueCommand = {
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
      candidate_queries: tamperedCandidateQueries,
      enumeration_universe_hash: attestation.enumeration_universe_hash,
      candidate_set_hash: tamperedCandidateSetHash,
    } as const;
    const tamperedAttestationCommandHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation-command@1",
      tamperedIssueCommand,
    );
    const tamperedBeforeInputHash = {
      ...attestation,
      candidate_queries: tamperedCandidateQueries,
      candidate_set_hash: tamperedCandidateSetHash,
      attestation_command_hash: tamperedAttestationCommandHash,
    };
    const {
      attestation_id: _tamperedId,
      input_hash: _tamperedInputHash,
      attestation_hash: _tamperedAttestationHash,
      committed_at: _tamperedCommittedAt,
      ...tamperedInputMaterial
    } = tamperedBeforeInputHash;
    const tamperedInputHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation-input@1",
      tamperedInputMaterial,
    );
    const tamperedBeforeAttestationHash = {
      ...tamperedBeforeInputHash,
      input_hash: tamperedInputHash,
    };
    const { attestation_hash: _staleTamperedAttestationHash, ...tamperedAttestationMaterial } =
      tamperedBeforeAttestationHash;
    const tamperedAttestationHash = await computeResearchKernelHashV2(
      "u6-candidate-enumerator-attestation@1",
      tamperedAttestationMaterial,
    );
    await expect(
      verifyCandidateEnumeratorAttestation(
        {
          ...tamperedBeforeAttestationHash,
          attestation_hash: tamperedAttestationHash,
        },
        committedBudgetReceipt,
      ),
    ).rejects.toThrow(/assessment_hash|Assessment/i);

    expect(
      candidateEnumeratorAttestationSchema.safeParse({
        ...attestation,
        query_contract_universe_refs: [
          ...attestation.query_contract_universe_refs,
          ...attestation.query_contract_universe_refs,
        ],
      }).success,
    ).toBe(false);
    expect(
      candidateEnumeratorAttestationSchema.safeParse({
        ...attestation,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("NoCandidate Assessment 逐 Obligation 闭合并抵抗外层重哈希攻击", async () => {
    const unresolvedObligation = obligationRef("no-candidate-obligation");
    const assessmentDraft = {
      obligation_ref: unresolvedObligation,
      reason_codes: ["OBLIGATION_QUERY_SEMANTICS_MISMATCH"],
      constraint_closure_hash: hash("2"),
      assessment_hash: hash("0"),
    } as const;
    const noCandidateAssessment = {
      ...assessmentDraft,
      assessment_hash: await computeNoCandidateAssessmentV2Hash(assessmentDraft),
    };
    await expect(verifyNoCandidateAssessmentV2(noCandidateAssessment)).resolves.toEqual(
      noCandidateAssessment,
    );

    const coverageRef = ref("CoverageState", 710);
    const { receipt: committedBudgetReceipt } = await verifiedBudgetReceiptFixture();
    const budgetReceipt = {
      receipt_id: committedBudgetReceipt.receipt_id,
      receipt_hash: committedBudgetReceipt.receipt_hash,
    };
    const enumeratorVersion = "enumerator@1.0.0";
    const eigPolicyVersion = "eig@1.0.0";
    const universeHash = await computeEnumerationUniverseHashV2({
      coverage_ref: coverageRef,
      budget_input_hash: committedBudgetReceipt.input_hash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      query_contract_universe_refs: [],
      unresolved_obligation_refs: [unresolvedObligation],
    });
    const candidateSetHash = await computeResearchKernelHashV2("u6-candidate-set@1", {
      unresolved: [unresolvedObligation],
      candidateQueries: [],
      noCandidateRefs: [unresolvedObligation],
    });
    const issueInput = {
      ...strictCommandBase(),
      attestation_operation_id: uuid(711),
      coverage_ref: coverageRef,
      budget_receipt: budgetReceipt,
      budget_input_hash: committedBudgetReceipt.input_hash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      query_contract_universe_refs: [],
      unresolved_obligation_refs: [unresolvedObligation],
      no_candidate_obligation_refs: [unresolvedObligation],
      no_candidate_assessments: [noCandidateAssessment],
      candidate_queries: [],
      enumeration_universe_hash: universeHash,
      candidate_set_hash: candidateSetHash,
    } as const;
    expect(issueCandidateEnumeratorAttestationInputSchema.safeParse(issueInput).success).toBe(true);

    const attestationBase = {
      protocol_version: "candidate-enumerator-attestation@1.0.0" as const,
      attestation_id: issueInput.attestation_operation_id,
      scope,
      run_id: runId,
      issuer_principal_id: principalId,
      issuer_capability_id: capabilityId,
      issuer_authority_epoch: 7,
      idempotency_key: issueInput.idempotency_key,
      coverage_ref: coverageRef,
      budget_receipt: budgetReceipt,
      budget_input_hash: committedBudgetReceipt.input_hash,
      enumerator_version: enumeratorVersion,
      eig_policy_version: eigPolicyVersion,
      implementation_digest: hash("3"),
      query_contract_universe_refs: [],
      unresolved_obligation_refs: [unresolvedObligation],
      no_candidate_obligation_refs: [unresolvedObligation],
      no_candidate_assessments: [noCandidateAssessment],
      candidate_queries: [],
      enumeration_universe_hash: universeHash,
      candidate_set_hash: candidateSetHash,
      attestation_command_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-command@1",
        issueInput,
      ),
    };
    const { attestation_id: _attestationId, ...attestationInputMaterial } = attestationBase;
    const attestationWithoutHash = {
      ...attestationBase,
      input_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-input@1",
        attestationInputMaterial,
      ),
      committed_at: committedAt,
    };
    const attestation = {
      ...attestationWithoutHash,
      attestation_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation@1",
        attestationWithoutHash,
      ),
    };
    await expect(
      verifyCandidateEnumeratorAttestation(attestation, committedBudgetReceipt),
    ).resolves.toEqual(attestation);

    expect(
      issueCandidateEnumeratorAttestationInputSchema.safeParse({
        ...issueInput,
        no_candidate_assessments: [],
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...stopBase(candidate("INADMISSIBLE")),
        candidate_queries: [],
        candidate_set: {
          enumerator_version: enumeratorVersion,
          unresolved_obligation_refs: [unresolvedObligation],
          no_candidate_obligation_refs: [unresolvedObligation],
          no_candidate_assessments: [noCandidateAssessment],
          candidate_set_hash: candidateSetHash,
        },
        decision: "STOP_INCONCLUSIVE",
        non_ready_terminal: "INCONCLUSIVE",
        inadmissibility_summary_hash: hash("4"),
      }).success,
    ).toBe(true);

    const tamperedAssessment = {
      ...noCandidateAssessment,
      constraint_closure_hash: hash("5"),
    };
    const tamperedIssueInput = {
      ...issueInput,
      no_candidate_assessments: [tamperedAssessment],
    };
    const tamperedAttestationBase = {
      ...attestationBase,
      no_candidate_assessments: [tamperedAssessment],
      attestation_command_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-command@1",
        tamperedIssueInput,
      ),
    };
    const { attestation_id: _tamperedAttestationId, ...tamperedAttestationInputMaterial } =
      tamperedAttestationBase;
    const tamperedAttestationWithoutHash = {
      ...tamperedAttestationBase,
      input_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation-input@1",
        tamperedAttestationInputMaterial,
      ),
      committed_at: committedAt,
    };
    const tamperedAttestation = {
      ...tamperedAttestationWithoutHash,
      attestation_hash: await computeResearchKernelHashV2(
        "u6-candidate-enumerator-attestation@1",
        tamperedAttestationWithoutHash,
      ),
    };
    await expect(
      verifyCandidateEnumeratorAttestation(tamperedAttestation, committedBudgetReceipt),
    ).rejects.toThrow(/NoCandidate Assessment assessment_hash/);
  });

  it("五类 Derivation Receipt 都是 strict 且绑定 output/budget/issuer 关系", () => {
    const common = {
      receipt_id: uuid(800),
      scope,
      run_id: runId,
      issuer_principal_id: principalId,
      issuer_capability_id: capabilityId,
      issuer_authority_epoch: 7,
      idempotency_key: "receipt-test",
      input_hash: hash("1"),
      output_hash: hash("b"),
      receipt_hash: hash("2"),
      committed_at: committedAt,
    };
    const budget = {
      protocol_version: "research-budget-ledger-receipt@2.0.0",
      ...common,
      snapshot_command_hash: hash("3"),
      research_brief_ref: ref("ResearchBrief", 801),
      runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1",
      runtime_limits_hash: hash("4"),
      tenant_policy_version: "tenant-policy@1",
      tenant_policy_hash: hash("5"),
      budget_epoch: 1,
      budget_started_at: "2026-07-27T23:59:00.000000Z",
      evaluated_through_reservation_seq: 2,
      evaluated_through_budget_event_seq: 4,
      evaluated_at: committedAt,
      valid_until: "2026-07-28T00:01:00.000000Z",
      outstanding_set_hash: hash("6"),
      active_count: 0,
      outcome_unknown_count: 0,
      abandoned_count: 0,
      actual_used: ledger().actual_used,
      unresolved_hold: ledger().unresolved_hold,
      ledger: ledger(),
    };
    const coverage = {
      protocol_version: "coverage-derivation-receipt@1.0.0",
      ...common,
      output_hash: hash("7"),
      input_hash: hash("8"),
      coverage_ref: ref("CoverageState", 802, hash("7")),
      evidence_plan_ref: evidencePlanRef,
      budget_receipt_id: budget.receipt_id,
      budget_receipt_hash: budget.receipt_hash,
      version_frontier: versionFrontier(),
      version_frontier_hash: hash("9"),
      closure_refs: {
        obligation_execution_decision_refs: [],
        query_evidence_refs: [],
        atomic_claim_refs: [],
        evidence_relation_refs: [],
        support_decision_refs: [],
        hypothesis_assessment_refs: [],
      },
      coverage_input_hash: hash("8"),
      kernel_version: "kernel@1",
    };
    const closure = candidateClosure();
    const candidateReceipt = {
      protocol_version: "candidate-enumeration-receipt@1.0.0",
      ...common,
      output_hash: hash("a"),
      coverage_receipt_id: coverage.receipt_id,
      coverage_receipt_hash: coverage.receipt_hash,
      budget_receipt_id: budget.receipt_id,
      budget_receipt_hash: budget.receipt_hash,
      enumerator_version: "enumerator@1",
      eig_policy_version: "eig@1",
      enumerator_capability_id: capabilityId,
      enumerator_authority_epoch: 7,
      enumerator_attestation_id: uuid(803),
      enumerator_attestation_hash: hash("b"),
      ...closure,
      enumeration_universe_hash: hash("c"),
      candidate_set_hash: hash("a"),
    };
    const stop = {
      protocol_version: "research-stop-derivation-receipt@1.0.0",
      ...common,
      output_hash: hash("d"),
      stop_ref: ref("ResearchStopDecision", 804, hash("d")),
      coverage_ref: coverage.coverage_ref,
      coverage_receipt_id: coverage.receipt_id,
      coverage_receipt_hash: coverage.receipt_hash,
      candidate_receipt_id: candidateReceipt.receipt_id,
      candidate_receipt_hash: candidateReceipt.receipt_hash,
      budget_receipt_id: budget.receipt_id,
      budget_receipt_hash: budget.receipt_hash,
      supported_subset: supportedSubset(),
      required_disclosures: [],
      pre_stop_readiness_hash: hash("e"),
      kernel_version: "kernel@1",
      enumerator_version: "enumerator@1",
      eig_policy_version: "eig@1",
      decision: "STOP_INCONCLUSIVE",
      decision_input_hash: hash("f"),
    };
    const watermark = {
      protocol_version: "research-input-watermark-receipt@1.0.0",
      ...common,
      output_hash: hash("1"),
      observed_event_seq: 10,
      observed_head_hash: hash("2"),
      certificate_ref: ref("ReportReadyCertificate", 805, hash("1")),
      certificate_input_closure_hash: hash("3"),
    };
    const boundCoveragePayload = {
      ...coveragePayload(),
      budget_receipt: {
        receipt_id: budget.receipt_id,
        receipt_hash: budget.receipt_hash,
      },
      budget_ledger: budget.ledger,
    };
    const boundStopPayload = {
      ...stopBase(candidate("INADMISSIBLE")),
      budget_receipt: {
        receipt_id: budget.receipt_id,
        receipt_hash: budget.receipt_hash,
      },
      budget_ledger: budget.ledger,
      decision: "STOP_INCONCLUSIVE",
      non_ready_terminal: "INCONCLUSIVE",
      inadmissibility_summary_hash: hash("4"),
    };

    expect(budgetLedgerReceiptSchema.safeParse(budget).success).toBe(true);
    expect(coverageDerivationReceiptSchema.safeParse(coverage).success).toBe(true);
    expect(candidateEnumerationReceiptSchema.safeParse(candidateReceipt).success).toBe(true);
    expect(researchStopDerivationReceiptSchema.safeParse(stop).success).toBe(true);
    expect(inputEventWatermarkReceiptSchema.safeParse(watermark).success).toBe(true);
    expect(() => verifyCoverageStateV2BudgetBinding(boundCoveragePayload, budget)).not.toThrow();
    expect(() => verifyResearchStopDecisionV2BudgetBinding(boundStopPayload, budget)).not.toThrow();
    expect(() =>
      verifyCoverageStateV2BudgetBinding(
        {
          ...boundCoveragePayload,
          budget_receipt: {
            ...boundCoveragePayload.budget_receipt,
            receipt_hash: hash("f"),
          },
        },
        budget,
      ),
    ).toThrow(/Budget Snapshot Receipt/);
    for (const receipt of [budget, coverage, candidateReceipt, stop, watermark]) {
      expect(derivationReceiptSchema.safeParse(receipt).success).toBe(true);
    }

    expect(
      budgetLedgerReceiptSchema.safeParse({
        ...budget,
        output_hash: hash("0"),
      }).success,
    ).toBe(false);
    expect(
      candidateEnumerationReceiptSchema.safeParse({
        ...candidateReceipt,
        enumerator_authority_epoch: 8,
      }).success,
    ).toBe(false);
    expect(
      researchStopDerivationReceiptSchema.safeParse({
        ...stop,
        extra_key: true,
      }).success,
    ).toBe(false);
  });

  it("Research step 与 snapshot commands 均 strict、scope-bound 且 fence 为正", () => {
    const step = {
      ...strictCommandBase(),
      step_operation_id: uuid(900),
      logical_step_id: uuid(901),
      step_kind: "QUERY",
      parent_step_id: null,
      attempt_id: uuid(902),
      worker_fence: 1,
      step_input_hash: hash("a"),
    };
    expect(beginResearchStepInputSchema.safeParse(step).success).toBe(true);
    expect(
      beginResearchStepInputSchema.safeParse({
        ...step,
        worker_fence: 0,
      }).success,
    ).toBe(false);
    expect(
      beginResearchStepInputSchema.safeParse({
        ...step,
        parent_step_id: step.logical_step_id,
      }).success,
    ).toBe(false);

    const snapshot = {
      ...strictCommandBase(),
      snapshot_operation_id: uuid(903),
      research_brief_ref: ref("ResearchBrief", 904),
    };
    expect(issueBudgetLedgerSnapshotInputSchema.safeParse(snapshot).success).toBe(true);
    expect(
      issueBudgetLedgerSnapshotInputSchema.safeParse({
        ...snapshot,
        extra_key: true,
      }).success,
    ).toBe(false);
  });

  it("Derivation Policy Manifest/Provision 重算子 hash、manifest hash、request hash 与 result binding", async () => {
    const budgetPolicyBase = {
      tenant_policy_version: "tenant-budget@1.0.0",
      limits: effectiveLimit,
      top_up_allowed: false,
    };
    const tenantPolicyHash = await computeResearchKernelHashV2("u6-tenant-budget-policy@1", {
      scope,
      ...budgetPolicyBase,
    });
    const enumeratorBase = {
      enumerator_version: "enumerator@1.0.0",
      eig_policy_version: "eig@1.0.0",
      input_schema_version: "candidate-enumerator-input@1.0.0",
      implementation_digest: hash("b"),
    } as const;
    const enumeratorVersionHash = await computeResearchKernelHashV2("u6-enumerator-version@1", {
      scope,
      ...enumeratorBase,
    });
    const manifestWithPlaceholder = {
      protocol_version: "u6-derivation-policy-manifest@1.0.0",
      scope,
      deployment_id: uuid(950),
      budget_policy: {
        ...budgetPolicyBase,
        tenant_policy_hash: tenantPolicyHash,
      },
      enumerator: {
        ...enumeratorBase,
        enumerator_version_hash: enumeratorVersionHash,
      },
      manifest_hash: hash("0"),
    } as const;
    const manifest = {
      ...manifestWithPlaceholder,
      manifest_hash: await computeU6DerivationPolicyManifestHash(manifestWithPlaceholder),
    };
    expect(manifest.manifest_hash).toBe(
      await computeResearchKernelHashV2("u6-derivation-policy-manifest@1", {
        protocol_version: manifest.protocol_version,
        scope: manifest.scope,
        deployment_id: manifest.deployment_id,
        budget_policy: manifest.budget_policy,
        enumerator: manifest.enumerator,
      }),
    );
    await expect(verifyU6DerivationPolicyManifest(manifest)).resolves.toEqual(manifest);
    await expect(
      verifyU6DerivationPolicyManifest({
        ...manifest,
        budget_policy: {
          ...manifest.budget_policy,
          top_up_allowed: true,
        },
      }),
    ).rejects.toThrow(/tenant_policy_hash/);
    await expect(
      verifyU6DerivationPolicyManifest({
        ...manifest,
        enumerator: {
          ...manifest.enumerator,
          implementation_digest: hash("c"),
        },
      }),
    ).rejects.toThrow(/enumerator_version_hash/);
    await expect(
      verifyU6DerivationPolicyManifest({
        ...manifest,
        manifest_hash: hash("d"),
      }),
    ).rejects.toThrow(/manifest_hash/);

    const provisionWithoutHash = {
      protocol_version: "u6-derivation-policy-manifest@1.0.0",
      operation_id: uuid(951),
      manifest,
    } as const;
    const command = {
      ...provisionWithoutHash,
      request_hash: await computeProvisionDerivationPolicyRequestHash(provisionWithoutHash),
    };
    expect(provisionDerivationPolicyInputSchema.safeParse(command).success).toBe(true);
    await expect(verifyProvisionDerivationPolicyInput(command)).resolves.toEqual(command);
    await expect(
      verifyProvisionDerivationPolicyInput({
        ...command,
        request_hash: hash("f"),
      }),
    ).rejects.toThrow(/request_hash/);
    expect(
      provisionDerivationPolicyInputSchema.safeParse({
        ...command,
        extra_key: true,
      }).success,
    ).toBe(false);

    const result = {
      operation_id: command.operation_id,
      manifest_hash: manifest.manifest_hash,
      tenant_policy_version: manifest.budget_policy.tenant_policy_version,
      enumerator_version: manifest.enumerator.enumerator_version,
      created: true,
      committed_at: committedAt,
    };
    expect(provisionedDerivationPolicySchema.safeParse(result).success).toBe(true);
    await expect(verifyProvisionedDerivationPolicy(command, result)).resolves.toEqual(result);
    await expect(
      verifyProvisionedDerivationPolicy(command, {
        ...result,
        enumerator_version: "enumerator@2.0.0",
      }),
    ).rejects.toThrow(/未逐字绑定/);
    await expect(
      verifyProvisionedDerivationPolicy(command, {
        ...result,
        operation_id: uuid(952),
      }),
    ).rejects.toThrow(/未逐字绑定/);
    await expect(
      verifyProvisionedDerivationPolicy(command, {
        ...result,
        manifest_hash: hash("e"),
      }),
    ).rejects.toThrow(/未逐字绑定/);
    await expect(
      verifyProvisionedDerivationPolicy(command, {
        ...result,
        tenant_policy_version: "tenant-budget@2.0.0",
      }),
    ).rejects.toThrow(/未逐字绑定/);
  });

  it("Budget Reservation 对终态、unknown、重复 seq/id 与顺序都 fail closed", () => {
    const cancelledPreIo = reservation("CANCELLED");
    expect(reservationBudgetStateProjectionSchema.safeParse(cancelledPreIo).success).toBe(true);

    const cancelledPostIo = {
      ...reservation("CANCELLED", 621),
      actual_usage: usage({ model_calls: 1, provider_input_tokens: 1, provider_tokens: 1 }),
      outcome_usage_ref: outcomeUsageRef("MODEL", 721),
    };
    expect(reservationBudgetStateProjectionSchema.safeParse(cancelledPostIo).success).toBe(true);
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...cancelledPostIo,
        outcome_unknown_hash: hash("f"),
      }).success,
    ).toBe(false);
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("CANCELLED", 622),
        actual_usage: usage({ model_calls: 1, provider_tokens: 1 }),
        outcome_usage_ref: null,
      }).success,
    ).toBe(false);
    expect(reservationBudgetStateProjectionSchema.safeParse(reservation("ABANDONED")).success).toBe(
      true,
    );
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("ABANDONED"),
        actual_usage: usage(),
      }).success,
    ).toBe(false);

    const first = {
      ...reservation("CANCELLED", 623),
      reservation_seq: 1,
    };
    const duplicateSequence = {
      ...reservation("EXPIRED", 624),
      reservation_seq: first.reservation_seq,
    };
    const duplicateId = {
      ...reservation("EXPIRED", 625),
      reservation_id: first.reservation_id,
      reservation_seq: 2,
    };
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse(budgetLedgerMaterial([first])).success,
    ).toBe(true);
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse(
        budgetLedgerMaterial([first, duplicateSequence]),
      ).success,
    ).toBe(false);
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse(budgetLedgerMaterial([first, duplicateId]))
        .success,
    ).toBe(false);
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse(
        budgetLedgerMaterial([
          { ...reservation("EXPIRED", 627), reservation_seq: 2 },
          { ...reservation("CANCELLED", 626), reservation_seq: 1 },
        ]),
      ).success,
    ).toBe(false);
  });

  it("Stop v2 不允许伪造等待/预算阻塞，并精确覆盖 resume 与最高 EIG 选择", () => {
    const waiting = candidate("WAITING_EXTERNAL_CAPABILITY", {
      waitingCodes: ["WAREHOUSE_WINDOW"],
      eig: 11,
    });
    const waitingDecision = {
      ...stopBase(waiting),
      decision: "STOP_NEEDS_MORE_RESEARCH" as const,
      non_ready_terminal: "NEEDS_MORE_RESEARCH" as const,
      resume_requirement_codes: ["WAREHOUSE_WINDOW"],
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(waitingDecision).success).toBe(true);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...waitingDecision,
        candidate_queries: [
          candidate("WAITING_EXTERNAL_CAPABILITY", { eig: 11, waitingCodes: [] }),
        ],
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...waitingDecision,
        resume_requirement_codes: ["DIFFERENT_GATE"],
      }).success,
    ).toBe(false);

    const budgetBlocked = {
      ...stopBase(candidate("BUDGET_BLOCKED", { steps: 1 }), {
        budget: ledger({ exhausted: true, topUpAllowed: true }),
      }),
      decision: "STOP_NEEDS_MORE_RESEARCH" as const,
      non_ready_terminal: "NEEDS_MORE_RESEARCH" as const,
      resume_requirement_codes: ["ADDITIONAL_RESEARCH_BUDGET"],
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(budgetBlocked).success).toBe(true);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...budgetBlocked,
        candidate_queries: [candidate("BUDGET_BLOCKED", { steps: 1 })],
        budget_ledger: ledger({ topUpAllowed: true }),
      }).success,
    ).toBe(false);

    const high = candidate("EXECUTABLE_NOW", { querySequence: 211, eig: 101 });
    const low = candidate("EXECUTABLE_NOW", { querySequence: 210, eig: 100 });
    const continueBase = {
      ...stopBase(low),
      candidate_queries: [low, high],
      candidate_set: {
        ...stopBase(low).candidate_set,
        candidate_set_hash: hash("a"),
      },
      decision: "CONTINUE" as const,
      selected_next_query_ref: high.query_contract_ref,
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(continueBase).success).toBe(true);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...continueBase,
        selected_next_query_ref: low.query_contract_ref,
      }).success,
    ).toBe(false);
  });

  it("Coverage 保持 v1 的 32 条闭包上界，并拒绝跨 Scope/Run 与错误 Derived Count", () => {
    const references = Array.from({ length: 32 }, (_, index) => ref("AtomicClaim", 10_000 + index));
    const payload = {
      ...coveragePayload(),
      atomic_claim_refs: references,
    };
    expect(coverageStatePayloadV2Schema.safeParse(payload).success).toBe(true);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...payload,
        atomic_claim_refs: [...references, ref("AtomicClaim", 10_032)],
      }).success,
    ).toBe(false);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...coveragePayload(),
        derived_counts: {
          ...coveragePayload().derived_counts,
          critical_open: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      coverageStatePayloadV2Schema.safeParse({
        ...coveragePayload(),
        evidence_plan_ref: {
          ...evidencePlanRef,
          run_id: uuid(9_999),
        },
      }).success,
    ).toBe(false);
  });

  it("Budget hash chain 与 Reservation projection 精确接受 256、拒绝 257", () => {
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse({
        ...budgetLedgerMaterial([]),
        evaluated_through_budget_event_seq: 2,
        budget_event_head_hash: hash("1"),
        ordered_budget_event_hashes: [hash("f"), hash("1")],
      }).success,
    ).toBe(true);
    const eventHashes = Array.from({ length: 256 }, (_, index) => numberedHash(index + 1));
    const reservations = Array.from({ length: 256 }, (_, index) => ({
      ...reservation("EXPIRED", 20_000 + index),
      reservation_seq: index + 1,
    }));
    const atLimit = {
      ...budgetLedgerMaterial(reservations),
      evaluated_through_reservation_seq: reservations.length,
      evaluated_through_budget_event_seq: eventHashes.length,
      budget_event_head_hash: numberedHash(256),
      ordered_budget_event_hashes: eventHashes,
    };
    expect(budgetLedgerInputHashMaterialSchema.safeParse(atLimit).success).toBe(true);
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse({
        ...atLimit,
        evaluated_through_budget_event_seq: 257,
        ordered_budget_event_hashes: [...eventHashes, numberedHash(257)],
        budget_event_head_hash: numberedHash(257),
      }).success,
    ).toBe(false);
    expect(
      budgetLedgerInputHashMaterialSchema.safeParse({
        ...atLimit,
        evaluated_through_reservation_seq: 257,
        ordered_reservation_states: [
          ...reservations,
          { ...reservation("EXPIRED", 20_256), reservation_seq: 257 },
        ],
      }).success,
    ).toBe(false);
  });

  it("Budget Ledger 与 Receipt 必须分别重算 hash，并拒绝只重算外层 Receipt 的账本篡改", async () => {
    const { inputMaterial, receipt, verificationContext } = await verifiedBudgetReceiptFixture();
    expect(await computeResearchBudgetLedgerV2Hash(receipt.ledger)).toBe(
      receipt.ledger.ledger_hash,
    );
    await expect(verifyResearchBudgetLedgerBindingV2(receipt.ledger)).resolves.toEqual(
      receipt.ledger,
    );
    await expect(
      verifyDerivationReceipt(receipt, inputMaterial, verificationContext),
    ).resolves.toEqual(receipt);

    const forgedLedger = {
      ...receipt.ledger,
      top_up_allowed: !receipt.ledger.top_up_allowed,
    };
    const forgedReceiptWithoutHash = {
      ...receipt,
      output_hash: forgedLedger.ledger_hash,
      ledger: forgedLedger,
    };
    const forgedReceipt = {
      ...forgedReceiptWithoutHash,
      receipt_hash: await computeDerivationReceiptHash(forgedReceiptWithoutHash),
    };
    expect(forgedReceipt.receipt_hash).not.toBe(receipt.receipt_hash);
    await expect(verifyResearchBudgetLedgerBindingV2(forgedLedger)).rejects.toThrow(/ledger_hash/);
    await expect(
      verifyDerivationReceipt(forgedReceipt, inputMaterial, verificationContext),
    ).rejects.toThrow(/ledger_hash/);
  });

  it("Candidate Receipt context 拒绝跨 Scope/Run 与 Coverage/Budget 换绑", async () => {
    const fixture = await verifiedEmptyCandidateReceiptFixture();
    await expect(
      verifyDerivationReceipt(
        fixture.candidateReceipt,
        fixture.candidateInput,
        fixture.verificationContext,
      ),
    ).resolves.toEqual(fixture.candidateReceipt);

    for (const scopeMutation of [
      {
        scope: {
          ...scope,
          app_id: uuid(30_001),
        },
        run_id: runId,
      },
      {
        scope,
        run_id: uuid(30_002),
      },
    ]) {
      const crossScopeDraft = {
        ...fixture.candidateReceipt,
        ...scopeMutation,
        receipt_hash: hash("0"),
      };
      const crossScopeReceipt = {
        ...crossScopeDraft,
        receipt_hash: await computeDerivationReceiptHash(crossScopeDraft),
      };
      await expect(
        verifyDerivationReceipt(
          crossScopeReceipt,
          fixture.candidateInput,
          fixture.verificationContext,
        ),
      ).rejects.toThrow(/context|逐字闭合/);
    }

    const reboundCoverageDraft = {
      ...fixture.coverageReceipt,
      budget_receipt_id: uuid(30_003),
      budget_receipt_hash: hash("9"),
      receipt_hash: hash("0"),
    };
    const reboundCoverageReceipt = {
      ...reboundCoverageDraft,
      receipt_hash: await computeDerivationReceiptHash(reboundCoverageDraft),
    };
    const reboundCandidateInput = {
      ...fixture.candidateInput,
      coverage_receipt: {
        receipt_id: reboundCoverageReceipt.receipt_id,
        receipt_hash: reboundCoverageReceipt.receipt_hash,
      },
    };
    const reboundCandidateDraft = {
      ...fixture.candidateReceipt,
      coverage_receipt_hash: reboundCoverageReceipt.receipt_hash,
      input_hash: await computeCandidateEnumerationInputHash(reboundCandidateInput),
      receipt_hash: hash("0"),
    };
    const reboundCandidateReceipt = {
      ...reboundCandidateDraft,
      receipt_hash: await computeDerivationReceiptHash(reboundCandidateDraft),
    };
    await expect(
      verifyDerivationReceipt(reboundCandidateReceipt, reboundCandidateInput, {
        ...fixture.verificationContext,
        coverage_receipt: reboundCoverageReceipt,
      }),
    ).rejects.toThrow(/context|逐字闭合/);
  });
});
