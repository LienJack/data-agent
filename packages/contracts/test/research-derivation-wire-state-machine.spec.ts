import { describe, expect, it } from "vitest";
import {
  issueBudgetLedgerSnapshotInputSchema,
  issueCandidateEnumeratorAttestationInputSchema,
  type KnownArtifactType,
  researchStopDecisionPayloadV2Schema,
  reservationBudgetStateProjectionSchema,
  verifyCandidateEnumeratorAttestationBudgetBinding,
  verifyCoverageStateV2BudgetBinding,
  verifyResearchStopDecisionV2BudgetBinding,
} from "../src/index.js";

type TestScope = {
  readonly app_id: string;
  readonly tenant_id: string;
  readonly environment: string;
};

type ResourceKind = "MODEL" | "SQL" | "TOOL";
type ReservationState =
  | "RESERVED"
  | "IN_USE"
  | "SETTLED"
  | "SETTLED_OVER_LIMIT"
  | "CANCELLED"
  | "EXPIRED"
  | "ABANDONED";
type CandidateAdmissibility =
  | "EXECUTABLE_NOW"
  | "WAITING_EXTERNAL_CAPABILITY"
  | "BUDGET_BLOCKED"
  | "INADMISSIBLE";

const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const otherTenantScope = {
  ...scope,
  tenant_id: "00000000-0000-4000-8000-000000000099",
} as const;
const runId = "00000000-0000-4000-8000-000000000003";
const otherRunId = "00000000-0000-4000-8000-000000000098";
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
  options: {
    readonly scope?: TestScope;
    readonly runId?: string;
    readonly contentHash?: `sha256:${string}`;
  } = {},
) {
  return {
    artifact_id: uuid(sequence),
    artifact_type: artifactType,
    ...(options.scope ?? scope),
    run_id: options.runId ?? runId,
    revision: 1,
    content_hash: options.contentHash ?? hash("a"),
  };
}

function obligationRef(
  nodeId = "obligation-a",
  options: {
    readonly scope?: TestScope;
    readonly runId?: string;
  } = {},
) {
  return {
    container_ref: ref("EvidencePlan", 100, options),
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

function ledger(options: { readonly exhausted?: boolean; readonly topUpAllowed?: boolean } = {}) {
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

function budgetReceipt(
  options: {
    readonly scope?: TestScope;
    readonly runId?: string;
    readonly receiptId?: string;
    readonly receiptHash?: `sha256:${string}`;
    readonly inputHash?: `sha256:${string}`;
    readonly ledger?: ReturnType<typeof ledger>;
  } = {},
) {
  const receiptScope = options.scope ?? scope;
  const receiptRunId = options.runId ?? runId;
  const receiptLedger = options.ledger ?? ledger();
  return {
    protocol_version: "research-budget-ledger-receipt@2.0.0",
    receipt_id: options.receiptId ?? uuid(800),
    scope: receiptScope,
    run_id: receiptRunId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "state-machine-budget",
    input_hash: options.inputHash ?? hash("1"),
    output_hash: receiptLedger.ledger_hash,
    receipt_hash: options.receiptHash ?? hash("2"),
    committed_at: committedAt,
    snapshot_command_hash: hash("3"),
    research_brief_ref: ref("ResearchBrief", 801, {
      scope: receiptScope,
      runId: receiptRunId,
    }),
    runtime_limits_version: "RESEARCH_RUNTIME_LIMITS@1",
    runtime_limits_hash: hash("4"),
    tenant_policy_version: "tenant-budget@1.0.0",
    tenant_policy_hash: hash("5"),
    budget_epoch: 1,
    budget_started_at: "2026-07-27T23:59:00.000000Z",
    evaluated_through_reservation_seq: receiptLedger.evaluated_through_reservation_seq,
    evaluated_through_budget_event_seq: receiptLedger.evaluated_through_budget_event_seq,
    evaluated_at: committedAt,
    valid_until: "2026-07-28T00:01:00.000000Z",
    outstanding_set_hash: hash("6"),
    active_count: 0,
    outcome_unknown_count: 0,
    abandoned_count: 0,
    actual_used: receiptLedger.actual_used,
    unresolved_hold: receiptLedger.unresolved_hold,
    ledger: receiptLedger,
  } as const;
}

function candidate(
  admissibility: CandidateAdmissibility,
  options: {
    readonly querySequence?: number;
    readonly eig?: number;
    readonly scope?: TestScope;
    readonly runId?: string;
  } = {},
) {
  return {
    query_contract_ref: ref("QueryContract", options.querySequence ?? 200, options),
    obligation_refs: [obligationRef("obligation-a", options)],
    admissibility,
    expected_information_gain_microunits:
      options.eig ?? (admissibility === "INADMISSIBLE" ? 0 : 100),
    required_budget: {
      steps: 1,
      model_calls: 1,
      sql_executions: 0,
      source_calls: 0 as const,
      elapsed_ms: 10,
      provider_tokens: 2,
      provider_cost_microusd: 1,
    },
    waiting_on_codes: admissibility === "WAITING_EXTERNAL_CAPABILITY" ? ["WAREHOUSE_WINDOW"] : [],
    reason_codes: ["ANALYSIS_INCONCLUSIVE"],
    assessment_hash: hash("c"),
  } as const;
}

function supportedSubset(deliverable: boolean) {
  return {
    claim_refs: deliverable ? [ref("AtomicClaim", 300)] : [],
    support_decision_refs: deliverable ? [ref("SupportDecision", 301)] : [],
    required_disclosures: deliverable ? ["BUDGET_LIMIT"] : [],
    subset_hash: hash("d"),
  };
}

function stopBase(
  candidateQueries: readonly ReturnType<typeof candidate>[],
  options: {
    readonly ledger?: ReturnType<typeof ledger>;
    readonly deliverable?: boolean;
    readonly receipt?: ReturnType<typeof budgetReceipt>;
  } = {},
) {
  const receipt =
    options.receipt ??
    (options.ledger === undefined ? budgetReceipt() : budgetReceipt({ ledger: options.ledger }));
  return {
    artifact_type: "ResearchStopDecision",
    protocol_version: "research-stop@2.0.0",
    coverage_ref: ref("CoverageState", 400),
    budget_receipt: {
      receipt_id: receipt.receipt_id,
      receipt_hash: receipt.receipt_hash,
    },
    budget_ledger: options.ledger ?? receipt.ledger,
    candidate_queries: candidateQueries,
    candidate_set: {
      enumerator_version: "enumerator@1.0.0",
      unresolved_obligation_refs: [obligationRef()],
      no_candidate_obligation_refs: [],
      no_candidate_assessments: [],
      candidate_set_hash: hash("f"),
    },
    supported_subset: supportedSubset(options.deliverable ?? false),
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

function coveragePayload(receipt = budgetReceipt()) {
  return {
    artifact_type: "CoverageState",
    protocol_version: "coverage-state@2.0.0",
    evidence_plan_ref: ref("EvidencePlan", 100),
    obligation_execution_decision_refs: [],
    query_evidence_refs: [],
    atomic_claim_refs: [],
    evidence_relation_refs: [],
    support_decision_refs: [],
    hypothesis_assessment_refs: [
      ref("HypothesisAssessment", 510),
      ref("HypothesisAssessment", 511),
    ],
    obligations: [
      {
        obligation_ref: obligationRef(),
        materiality: "CRITICAL",
        state: "OPEN",
        obligation_execution_decision_refs: [],
        query_evidence_refs: [],
        support_decision_refs: [],
        conflict_refs: [],
        reason_codes: ["ANALYSIS_INCONCLUSIVE"],
      },
    ],
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
      receipt_id: receipt.receipt_id,
      receipt_hash: receipt.receipt_hash,
    },
    budget_ledger: receipt.ledger,
    version_frontier: versionFrontier(),
    version_frontier_hash: hash("8"),
    coverage_input_hash: hash("9"),
  } as const;
}

function candidateEnumerationCommand(
  universe: readonly ReturnType<typeof ref<"QueryContract">>[],
  candidateQueries: readonly ReturnType<typeof candidate>[],
) {
  return {
    schema_version: "1.0.0",
    scope,
    run_id: runId,
    principal_id: principalId,
    idempotency_key: "candidate-closure",
    attestation_operation_id: uuid(700),
    coverage_ref: ref("CoverageState", 701),
    budget_receipt: {
      receipt_id: uuid(800),
      receipt_hash: hash("2"),
    },
    budget_input_hash: hash("1"),
    enumerator_version: "enumerator@1.0.0",
    eig_policy_version: "eig@1.0.0",
    query_contract_universe_refs: universe,
    unresolved_obligation_refs: [obligationRef()],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: candidateQueries,
    enumeration_universe_hash: hash("a"),
    candidate_set_hash: hash("b"),
  } as const;
}

function candidateAttestation(receipt = budgetReceipt()) {
  const assessment = candidate("INADMISSIBLE");
  return {
    protocol_version: "candidate-enumerator-attestation@1.0.0",
    attestation_id: uuid(700),
    scope,
    run_id: runId,
    issuer_principal_id: principalId,
    issuer_capability_id: capabilityId,
    issuer_authority_epoch: 7,
    idempotency_key: "candidate-attestation",
    coverage_ref: ref("CoverageState", 701),
    budget_receipt: {
      receipt_id: receipt.receipt_id,
      receipt_hash: receipt.receipt_hash,
    },
    budget_input_hash: receipt.input_hash,
    enumerator_version: "enumerator@1.0.0",
    eig_policy_version: "eig@1.0.0",
    implementation_digest: hash("e"),
    query_contract_universe_refs: [assessment.query_contract_ref],
    unresolved_obligation_refs: [obligationRef()],
    no_candidate_obligation_refs: [],
    no_candidate_assessments: [],
    candidate_queries: [assessment],
    enumeration_universe_hash: hash("a"),
    candidate_set_hash: hash("b"),
    attestation_command_hash: hash("c"),
    input_hash: hash("d"),
    attestation_hash: hash("e"),
    committed_at: committedAt,
  } as const;
}

function outcomeUsageRef(resourceKind: ResourceKind, sequence = 900) {
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
    record_kind: "INVOCATION_OUTCOME_USAGE",
    record_id: uuid(sequence),
    scope,
    run_id: runId,
    record_version: 1,
    content_hash: hash("d"),
    commit_id: uuid(sequence + 1),
    store: "research_invocation_outcome_usage",
    resolver_capability: "RESOURCE_AUTHORITY",
    commit: "commit_invocation_terminal@1.0.0",
    resolver: "resolve_committed_invocation_outcome_usage@1.0.0",
    status: "COMMITTED",
    authority_epoch: 1,
    expires_at: null,
    revocation_seq: 0,
    adapter_kind: resourceKind,
    ...authority,
  } as const;
}

function reservation(state: ReservationState, resourceKind: ResourceKind = "MODEL") {
  const reservedUsage = usage({
    model_calls: resourceKind === "MODEL" ? 1 : 0,
    sql_executions: resourceKind === "SQL" ? 1 : 0,
    provider_input_tokens: resourceKind === "MODEL" ? 1 : 0,
    provider_tokens: resourceKind === "MODEL" ? 1 : 0,
  });
  if (state === "SETTLED" || state === "SETTLED_OVER_LIMIT") {
    const actualUsage =
      state === "SETTLED_OVER_LIMIT"
        ? usage({
            model_calls: 1,
            provider_input_tokens: 2,
            provider_tokens: 2,
          })
        : reservedUsage;
    return {
      reservation_id: uuid(910),
      reservation_seq: 1,
      resource_kind: resourceKind,
      state,
      reserved_usage: reservedUsage,
      actual_usage: actualUsage,
      outcome_usage_ref: outcomeUsageRef(resourceKind),
      outcome_unknown_hash: null,
      end_reason_code: state === "SETTLED" ? "COMPLETED" : "OVER_LIMIT",
    };
  }
  if (state === "ABANDONED") {
    return {
      reservation_id: uuid(910),
      reservation_seq: 1,
      resource_kind: resourceKind,
      state,
      reserved_usage: reservedUsage,
      actual_usage: null,
      outcome_usage_ref: null,
      outcome_unknown_hash: hash("e"),
      end_reason_code: "OUTCOME_UNKNOWN",
    };
  }
  return {
    reservation_id: uuid(910),
    reservation_seq: 1,
    resource_kind: resourceKind,
    state,
    reserved_usage: reservedUsage,
    actual_usage: state === "RESERVED" || state === "IN_USE" ? null : usage(),
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

describe("U6 derivation wire state-machine contract", () => {
  it("拒绝 REPLAN/Partial/Inconclusive 的互斥分支逃逸", () => {
    const exhausted = ledger({ exhausted: true });
    const invalidDecisions = [
      {
        ...stopBase([candidate("EXECUTABLE_NOW")]),
        decision: "REPLAN",
        replan_obligation_refs: [obligationRef()],
        replan_assessment: {
          trigger: "PLAN_INVALIDATED",
          executable_with_remaining_budget: true,
          assessment_hash: hash("a"),
        },
      },
      {
        ...stopBase([candidate("BUDGET_BLOCKED")], {
          ledger: ledger({ exhausted: true, topUpAllowed: true }),
          deliverable: true,
        }),
        decision: "STOP_PARTIAL",
        non_ready_terminal: "PARTIAL",
        partial_disclosure_codes: ["BUDGET_LIMIT"],
      },
      {
        ...stopBase([candidate("BUDGET_BLOCKED")], { ledger: exhausted }),
        decision: "STOP_PARTIAL",
        non_ready_terminal: "PARTIAL",
        partial_disclosure_codes: ["BUDGET_LIMIT"],
      },
      {
        ...stopBase([candidate("WAITING_EXTERNAL_CAPABILITY")]),
        decision: "STOP_INCONCLUSIVE",
        non_ready_terminal: "INCONCLUSIVE",
        inadmissibility_summary_hash: hash("b"),
      },
    ];

    for (const decision of invalidDecisions) {
      expect(researchStopDecisionPayloadV2Schema.safeParse(decision).success).toBe(false);
    }
  });

  it("CONTINUE 的 equal-EIG tie-break 固定选择最小完整 Reference identity", () => {
    const first = candidate("EXECUTABLE_NOW", { querySequence: 200, eig: 100 });
    const second = candidate("EXECUTABLE_NOW", { querySequence: 201, eig: 100 });
    const valid = {
      ...stopBase([first, second]),
      decision: "CONTINUE",
      selected_next_query_ref: first.query_contract_ref,
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(valid).success).toBe(true);
    expect(
      researchStopDecisionPayloadV2Schema.safeParse({
        ...valid,
        selected_next_query_ref: second.query_contract_ref,
      }).success,
    ).toBe(false);

    const crossRun = {
      ...valid,
      candidate_queries: [
        first,
        {
          ...second,
          query_contract_ref: {
            ...second.query_contract_ref,
            run_id: otherRunId,
          },
        },
      ],
    };
    expect(researchStopDecisionPayloadV2Schema.safeParse(crossRun).success).toBe(false);
  });

  it("Candidate Enumerator 拒绝 universe assessment 漏项、越界项与跨 Run 引用", () => {
    const first = candidate("INADMISSIBLE", { querySequence: 200 });
    const second = candidate("INADMISSIBLE", { querySequence: 201 });
    const missing = candidateEnumerationCommand(
      [first.query_contract_ref, second.query_contract_ref],
      [first],
    );
    const extra = candidateEnumerationCommand([first.query_contract_ref], [first, second]);
    const crossRunCandidate = candidate("INADMISSIBLE", {
      querySequence: 200,
      runId: otherRunId,
    });
    const crossRun = candidateEnumerationCommand(
      [crossRunCandidate.query_contract_ref],
      [crossRunCandidate],
    );

    for (const command of [missing, extra, crossRun]) {
      expect(issueCandidateEnumeratorAttestationInputSchema.safeParse(command).success).toBe(false);
    }
  });

  it("Reservation 七态分别强制关键 required/forbidden 字段", () => {
    const states: readonly ReservationState[] = [
      "RESERVED",
      "IN_USE",
      "SETTLED",
      "SETTLED_OVER_LIMIT",
      "CANCELLED",
      "EXPIRED",
      "ABANDONED",
    ];
    const invalidByState: Record<ReservationState, () => unknown> = {
      RESERVED: () => ({ ...reservation("RESERVED"), end_reason_code: "EARLY" }),
      IN_USE: () => ({ ...reservation("IN_USE"), outcome_unknown_hash: hash("f") }),
      SETTLED: () => ({ ...reservation("SETTLED"), outcome_usage_ref: null }),
      SETTLED_OVER_LIMIT: () => ({
        ...reservation("SETTLED_OVER_LIMIT"),
        outcome_unknown_hash: hash("f"),
      }),
      CANCELLED: () => ({ ...reservation("CANCELLED"), actual_usage: null }),
      EXPIRED: () => ({
        ...reservation("EXPIRED"),
        actual_usage: usage({ model_calls: 1 }),
      }),
      ABANDONED: () => ({ ...reservation("ABANDONED"), outcome_unknown_hash: null }),
    };

    for (const state of states) {
      expect(reservationBudgetStateProjectionSchema.safeParse(reservation(state)).success).toBe(
        true,
      );
      expect(
        reservationBudgetStateProjectionSchema.safeParse(invalidByState[state]()).success,
      ).toBe(false);
    }

    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("SETTLED"),
        actual_usage: usage({
          model_calls: 1,
          provider_input_tokens: 2,
          provider_tokens: 2,
        }),
      }).success,
    ).toBe(false);
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("SETTLED_OVER_LIMIT"),
        actual_usage: reservation("SETTLED_OVER_LIMIT").reserved_usage,
      }).success,
    ).toBe(false);
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("RESERVED"),
        reserved_usage: usage({ steps: 1, model_calls: 1 }),
      }).success,
    ).toBe(false);
    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("CANCELLED"),
        actual_usage: usage({
          model_calls: 1,
          provider_input_tokens: 2,
          provider_tokens: 2,
        }),
        outcome_usage_ref: outcomeUsageRef("MODEL"),
      }).success,
    ).toBe(false);
  });

  it("OutcomeUsage authority union 接受 MODEL/SQL/TOOL 且拒绝 authority/adapter 换绑", () => {
    for (const resourceKind of ["MODEL", "SQL", "TOOL"] as const) {
      expect(
        reservationBudgetStateProjectionSchema.safeParse(reservation("SETTLED", resourceKind))
          .success,
      ).toBe(true);
    }

    const settledModel = reservation("SETTLED", "MODEL");
    const authorityMismatch = {
      ...settledModel,
      outcome_usage_ref:
        settledModel.outcome_usage_ref === null
          ? null
          : {
              ...settledModel.outcome_usage_ref,
              owner_kind: "SQL_ADAPTER_AUTHORITY",
            },
    };
    expect(reservationBudgetStateProjectionSchema.safeParse(authorityMismatch).success).toBe(false);

    expect(
      reservationBudgetStateProjectionSchema.safeParse({
        ...reservation("SETTLED", "MODEL"),
        outcome_usage_ref: outcomeUsageRef("SQL"),
      }).success,
    ).toBe(false);
  });

  it("Coverage binder 分别拒绝 receipt id/hash、ledger、scope 与 run 错配", () => {
    const receipt = budgetReceipt();
    const coverage = coveragePayload(receipt);
    expect(() => verifyCoverageStateV2BudgetBinding(coverage, receipt)).not.toThrow();

    const wrongId = {
      ...coverage,
      budget_receipt: { ...coverage.budget_receipt, receipt_id: uuid(899) },
    };
    const wrongHash = {
      ...coverage,
      budget_receipt: { ...coverage.budget_receipt, receipt_hash: hash("f") },
    };
    const wrongLedger = {
      ...coverage,
      budget_ledger: { ...coverage.budget_ledger, top_up_allowed: true },
    };
    const wrongScopeReceipt = budgetReceipt({
      scope: otherTenantScope,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });
    const wrongRunReceipt = budgetReceipt({
      runId: otherRunId,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });

    for (const [candidateCoverage, candidateReceipt] of [
      [wrongId, receipt],
      [wrongHash, receipt],
      [wrongLedger, receipt],
      [coverage, wrongScopeReceipt],
      [coverage, wrongRunReceipt],
    ] as const) {
      expect(() =>
        verifyCoverageStateV2BudgetBinding(candidateCoverage, candidateReceipt),
      ).toThrow();
    }
  });

  it("Stop binder 分别拒绝 receipt id/hash、ledger、scope 与 run 错配", () => {
    const receipt = budgetReceipt();
    const stop = {
      ...stopBase([candidate("INADMISSIBLE")], { receipt }),
      decision: "STOP_INCONCLUSIVE",
      non_ready_terminal: "INCONCLUSIVE",
      inadmissibility_summary_hash: hash("b"),
    };
    expect(() => verifyResearchStopDecisionV2BudgetBinding(stop, receipt)).not.toThrow();

    const wrongId = {
      ...stop,
      budget_receipt: { ...stop.budget_receipt, receipt_id: uuid(899) },
    };
    const wrongHash = {
      ...stop,
      budget_receipt: { ...stop.budget_receipt, receipt_hash: hash("f") },
    };
    const wrongLedger = {
      ...stop,
      budget_ledger: { ...stop.budget_ledger, top_up_allowed: true },
    };
    const wrongScopeReceipt = budgetReceipt({
      scope: otherTenantScope,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });
    const wrongRunReceipt = budgetReceipt({
      runId: otherRunId,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });

    for (const [candidateStop, candidateReceipt] of [
      [wrongId, receipt],
      [wrongHash, receipt],
      [wrongLedger, receipt],
      [stop, wrongScopeReceipt],
      [stop, wrongRunReceipt],
    ] as const) {
      expect(() =>
        verifyResearchStopDecisionV2BudgetBinding(candidateStop, candidateReceipt),
      ).toThrow();
    }
  });

  it("Candidate binder 分别拒绝 receipt id/hash、input、scope 与 run 错配", () => {
    const receipt = budgetReceipt();
    const attestation = candidateAttestation(receipt);
    expect(() =>
      verifyCandidateEnumeratorAttestationBudgetBinding(attestation, receipt),
    ).not.toThrow();

    const wrongId = {
      ...attestation,
      budget_receipt: { ...attestation.budget_receipt, receipt_id: uuid(899) },
    };
    const wrongHash = {
      ...attestation,
      budget_receipt: { ...attestation.budget_receipt, receipt_hash: hash("f") },
    };
    const wrongInput = { ...attestation, budget_input_hash: hash("f") };
    const wrongScopeReceipt = budgetReceipt({
      scope: otherTenantScope,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });
    const wrongRunReceipt = budgetReceipt({
      runId: otherRunId,
      receiptId: receipt.receipt_id,
      receiptHash: receipt.receipt_hash,
      inputHash: receipt.input_hash,
      ledger: receipt.ledger,
    });

    for (const [candidateValue, candidateReceipt] of [
      [wrongId, receipt],
      [wrongHash, receipt],
      [wrongInput, receipt],
      [attestation, wrongScopeReceipt],
      [attestation, wrongRunReceipt],
    ] as const) {
      expect(() =>
        verifyCandidateEnumeratorAttestationBudgetBinding(candidateValue, candidateReceipt),
      ).toThrow();
    }
  });

  it("Budget Snapshot command 拒绝跨 tenant 与跨 run ResearchBrief", () => {
    const command = {
      schema_version: "1.0.0",
      scope,
      run_id: runId,
      principal_id: principalId,
      idempotency_key: "snapshot-command",
      snapshot_operation_id: uuid(990),
      research_brief_ref: ref("ResearchBrief", 991),
    };
    expect(issueBudgetLedgerSnapshotInputSchema.safeParse(command).success).toBe(true);
    expect(
      issueBudgetLedgerSnapshotInputSchema.safeParse({
        ...command,
        research_brief_ref: ref("ResearchBrief", 991, { scope: otherTenantScope }),
      }).success,
    ).toBe(false);
    expect(
      issueBudgetLedgerSnapshotInputSchema.safeParse({
        ...command,
        research_brief_ref: ref("ResearchBrief", 991, { runId: otherRunId }),
      }).success,
    ).toBe(false);
  });
});
