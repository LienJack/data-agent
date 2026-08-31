import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  agentDataProjectionReceiptSchema,
  artifactReferenceIdentity,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeL2ResearchSemanticHash,
  deriveCoverageCounts,
  knownArtifactTypeSchema,
  L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES,
  L2_RESEARCH_TRANSITIONAL_WRITABLE_TUPLES,
  L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  l2ArtifactTypeSchema,
  type ObligationCoverage,
  parseAndHashL2ResearchDocumentCandidate,
  parseL2ResearchDocumentCandidate,
  parseL2ResearchPayloadForEnvelopeCandidate,
  type ReportManifestPayload,
  type ReportManifestV1Payload,
  readHistoricalL2ResearchDocument,
  readHistoricalVersionedL2ResearchDocument,
  reportManifestPayloadSchema,
  reportManifestV1PayloadSchema,
  reportManifestV2PayloadSchema,
  reportReadyCertificateV2PayloadSchema,
  reportReadyCertificateV3PayloadSchema,
  researchBriefV2PayloadSchema,
  researchStopDecisionPayloadSchema,
  U6_WIRE_LIMITS,
  verifyL2ArtifactDocument,
} from "../src/artifacts/index.js";
import { hashes, makeArtifactEnvelope, makeArtifactReference } from "./fixtures.js";

const briefV2 = {
  artifact_type: "ResearchBrief",
  protocol_version: "research-brief@2.0.0",
  question_frame_ref: makeArtifactReference("QuestionFrame"),
  scope: {
    subject: "分析收入下降",
    time_window: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-02-01T00:00:00.000Z",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    },
    dimensions: ["region"],
    metric_refs: [
      {
        container_ref: makeArtifactReference("SemanticRelease"),
        node_id: "revenue",
      },
    ],
  },
  success_criteria: [
    {
      criterion_id: "revenue-change",
      statement: "识别收入变化",
      materiality: "CRITICAL",
    },
  ],
  evidence_policy: {
    allowed_kinds: ["QUERY"],
    minimum_support_mode: "DETERMINISTIC",
    unsupported_source_behavior: "REJECT",
  },
  hypothesis_universe_policy: {
    candidate_sources: ["METRIC_DECOMPOSITION"],
    enumerator_version: "hypothesis-enumerator@1.0.0",
    required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
  },
  freshness_policy: {
    max_age_seconds: 3600,
    require_snapshot_replayable: true,
  },
  source_independence_policy: {
    mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
    minimum_provenance_groups: 1,
    required_disclosures: ["SINGLE_AUTHORITY_SOURCE"],
  },
  claim_policy: {
    allowed_modes: ["DESCRIPTIVE", "COMPARATIVE", "DIAGNOSTIC"],
    forbidden_modes: ["CAUSAL", "PRESCRIPTIVE", "ACTION_EXECUTING"],
  },
  budget: {
    max_steps: 24,
    max_model_calls: 32,
    max_sql_executions: 16,
    max_source_calls: 0,
    max_elapsed_ms: 600_000,
    max_provider_input_tokens_per_call: 32_000,
    max_provider_output_tokens_per_call: 8_000,
    max_provider_tokens_per_run: 256_000,
    max_provider_cost_microusd_per_run: 5_000_000,
  },
  policy_ref: makeArtifactReference("PolicyReceipt"),
  policy_digest: hashes.artifact,
  data_classification: "INTERNAL",
  retention_policy_ref: {
    policy_id: "research-retention",
    policy_version: "1.0.0",
    policy_hash: hashes.input,
  },
} as const;

function makeBriefV2Document() {
  const envelope = {
    ...makeArtifactEnvelope(),
    artifact_type: "ResearchBrief",
    schema_version: "2.0.0",
    input_refs: [
      briefV2.question_frame_ref,
      briefV2.scope.metric_refs[0].container_ref,
      briefV2.policy_ref,
    ],
  };
  return { envelope, payload: briefV2 };
}

function makeBudgetLedger() {
  return {
    ledger_version: "research-budget-ledger@1.0.0",
    evaluated_through_reservation_seq: 0,
    effective_limit: {
      max_steps: 1,
      max_model_calls: 1,
      max_sql_executions: 1,
      max_source_calls: 0,
      max_elapsed_ms: 1,
      max_provider_input_tokens_per_call: 1,
      max_provider_output_tokens_per_call: 1,
      max_provider_tokens_per_run: 2,
      max_provider_cost_microusd_per_run: 1,
    },
    used: {
      steps: 0,
      model_calls: 0,
      sql_executions: 0,
      source_calls: 0,
      elapsed_ms: 0,
      provider_input_tokens: 0,
      provider_output_tokens: 0,
      provider_tokens: 0,
      provider_cost_microusd: 0,
    },
    remaining: {
      steps: 1,
      model_calls: 1,
      sql_executions: 1,
      source_calls: 0,
      elapsed_ms: 1,
      provider_tokens: 2,
      provider_cost_microusd: 1,
    },
    top_up_allowed: false,
    ledger_hash: hashes.artifact,
  } as const;
}

function makeStopCommon(
  overrides: {
    candidate_queries?: unknown[];
    unresolved_obligation_refs?: unknown[];
    no_candidate_obligation_refs?: unknown[];
    claim_refs?: unknown[];
    support_decision_refs?: unknown[];
    required_disclosures?: string[];
    top_up_allowed?: boolean;
  } = {},
) {
  return {
    artifact_type: "ResearchStopDecision",
    protocol_version: "research-stop@1.0.0",
    coverage_ref: makeArtifactReference("CoverageState"),
    candidate_queries: overrides.candidate_queries ?? [],
    candidate_set: {
      enumerator_version: "candidate-enumerator@1.0.0",
      unresolved_obligation_refs: overrides.unresolved_obligation_refs ?? [],
      no_candidate_obligation_refs: overrides.no_candidate_obligation_refs ?? [],
      candidate_set_hash: hashes.artifact,
    },
    supported_subset: {
      claim_refs: overrides.claim_refs ?? [],
      support_decision_refs: overrides.support_decision_refs ?? [],
      required_disclosures: overrides.required_disclosures ?? [],
      subset_hash: hashes.input,
    },
    budget_ledger: {
      ...makeBudgetLedger(),
      top_up_allowed: overrides.top_up_allowed ?? false,
    },
    reason_codes: ["OBLIGATION_SATISFIED"],
    eig_policy_version: "eig@1.0.0",
    decision_input_hash: hashes.execution,
  } as const;
}

function makeV2BudgetLedger() {
  const usage = {
    steps: 0,
    model_calls: 0,
    sql_executions: 0,
    source_calls: 0,
    elapsed_ms: 0,
    provider_input_tokens: 0,
    provider_output_tokens: 0,
    provider_tokens: 0,
    provider_cost_microusd: 0,
  } as const;
  return {
    ledger_version: "research-budget-ledger@2.0.0",
    evaluated_through_reservation_seq: 0,
    evaluated_through_budget_event_seq: 0,
    effective_limit: {
      max_steps: 1,
      max_model_calls: 1,
      max_sql_executions: 1,
      max_source_calls: 0,
      max_elapsed_ms: 1,
      max_provider_input_tokens_per_call: 1,
      max_provider_output_tokens_per_call: 1,
      max_provider_tokens_per_run: 2,
      max_provider_cost_microusd_per_run: 1,
    },
    actual_used: usage,
    unresolved_hold: usage,
    charged_used: usage,
    remaining: {
      steps: 1,
      model_calls: 1,
      sql_executions: 1,
      source_calls: 0,
      elapsed_ms: 1,
      provider_tokens: 2,
      provider_cost_microusd: 1,
    },
    overage: {
      steps: 0,
      model_calls: 0,
      sql_executions: 0,
      source_calls: 0,
      elapsed_ms: 0,
      provider_tokens: 0,
      provider_cost_microusd: 0,
    },
    top_up_allowed: false,
    ledger_hash: hashes.artifact,
  } as const;
}

function makeCoverageStateV2Payload() {
  const evidencePlanRef = makeArtifactReference("EvidencePlan");
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
      makeArtifactReference("HypothesisAssessment", "00000000-0000-4000-8000-000000000011"),
      makeArtifactReference("HypothesisAssessment", "00000000-0000-4000-8000-000000000012"),
    ],
    obligations: [
      {
        obligation_ref: {
          container_ref: evidencePlanRef,
          node_id: "o1",
        },
        materiality: "CRITICAL",
        state: "OPEN",
        obligation_execution_decision_refs: [],
        query_evidence_refs: [],
        support_decision_refs: [],
        conflict_refs: [],
        reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
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
      receipt_id: "00000000-0000-4000-8000-000000000013",
      receipt_hash: hashes.input,
    },
    budget_ledger: makeV2BudgetLedger(),
    version_frontier: {
      semantic_release_ref: makeArtifactReference("SemanticRelease"),
      schema_snapshot_ref: makeArtifactReference("SchemaSnapshot"),
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0",
        datasource_id: "00000000-0000-4000-8000-000000000014",
        strategy: "CONTROLLED_REVISION",
        snapshot_token: "snapshot@1",
        schema_manifest_hash: hashes.artifact,
        data_manifest_hash: hashes.input,
        fixture_manifest_hash: hashes.execution,
        replay_state: "REPLAYABLE",
        binding_hash: hashes.artifact,
      },
      policy_receipt_ref: makeArtifactReference("PolicyReceipt"),
      identity_binding: {
        principal_id: "researcher",
        delegation_chain_hash: hashes.input,
        authority_epoch: 1,
      },
    },
    version_frontier_hash: hashes.artifact,
    coverage_input_hash: hashes.execution,
  } as const;
}

function makeResearchStopDecisionV2Payload() {
  const coverageRef = makeArtifactReference("CoverageState");
  const obligationRef = {
    container_ref: makeArtifactReference("EvidencePlan"),
    node_id: "o1",
  } as const;
  return {
    artifact_type: "ResearchStopDecision",
    protocol_version: "research-stop@2.0.0",
    coverage_ref: coverageRef,
    budget_receipt: {
      receipt_id: "00000000-0000-4000-8000-000000000015",
      receipt_hash: hashes.input,
    },
    budget_ledger: makeV2BudgetLedger(),
    candidate_queries: [
      {
        query_contract_ref: makeArtifactReference("QueryContract"),
        obligation_refs: [obligationRef],
        admissibility: "INADMISSIBLE",
        expected_information_gain_microunits: 0,
        required_budget: {
          steps: 1,
          model_calls: 0,
          sql_executions: 0,
          source_calls: 0,
          elapsed_ms: 0,
          provider_tokens: 0,
          provider_cost_microusd: 0,
        },
        waiting_on_codes: [],
        reason_codes: ["ANALYSIS_INCONCLUSIVE"],
        assessment_hash: hashes.artifact,
      },
    ],
    candidate_set: {
      enumerator_version: "candidate-enumerator@1.0.0",
      unresolved_obligation_refs: [obligationRef],
      no_candidate_obligation_refs: [],
      no_candidate_assessments: [],
      candidate_set_hash: hashes.input,
    },
    supported_subset: {
      claim_refs: [],
      support_decision_refs: [],
      required_disclosures: [],
      subset_hash: hashes.execution,
    },
    reason_codes: ["ANALYSIS_INCONCLUSIVE"],
    eig_policy_version: "eig@1.0.0",
    decision_input_hash: hashes.artifact,
    decision: "STOP_INCONCLUSIVE",
    non_ready_terminal: "INCONCLUSIVE",
    inadmissibility_summary_hash: hashes.input,
  } as const;
}

function makeCurrentV2Document(
  payload:
    | ReturnType<typeof makeCoverageStateV2Payload>
    | ReturnType<typeof makeResearchStopDecisionV2Payload>,
) {
  return {
    envelope: {
      ...makeArtifactEnvelope(),
      artifact_type: payload.artifact_type,
      schema_version: "2.0.0",
      input_refs: collectL2ResearchPayloadArtifactReferences(payload),
    },
    payload,
  };
}

const obligationRef = {
  container_ref: makeArtifactReference("EvidencePlan"),
  node_id: "o1",
} as const;

function makeCandidate(
  admissibility:
    | "EXECUTABLE_NOW"
    | "WAITING_EXTERNAL_CAPABILITY"
    | "BUDGET_BLOCKED"
    | "INADMISSIBLE",
) {
  return {
    query_contract_ref: makeArtifactReference("QueryContract"),
    obligation_refs: [obligationRef],
    admissibility,
    expected_information_gain_microunits: admissibility === "EXECUTABLE_NOW" ? 1 : 0,
    required_budget: {
      steps: admissibility === "BUDGET_BLOCKED" ? 2 : 1,
      model_calls: 0,
      sql_executions: 0,
      source_calls: 0,
      elapsed_ms: 0,
      provider_tokens: 0,
      provider_cost_microusd: 0,
    },
    waiting_on_codes:
      admissibility === "WAITING_EXTERNAL_CAPABILITY" ? ["PROVIDER_CAPABILITY"] : [],
    reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
    assessment_hash: hashes.artifact,
  } as const;
}

describe("U6 Research Wire", () => {
  it.each([
    {
      name: "空集合返回全零",
      obligations: [] as ObligationCoverage[],
      expected: {
        critical_total: 0,
        critical_open: 0,
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
    },
    {
      name: "按 materiality 与五态分别计数",
      obligations: (["CRITICAL", "SUPPORTING"] as const).flatMap((materiality) =>
        (["OPEN", "SATISFIED", "BLOCKED", "FAILED", "STALE"] as const).map(
          (state, index): ObligationCoverage => ({
            obligation_ref: {
              container_ref: makeArtifactReference("EvidencePlan"),
              node_id: `${materiality.toLowerCase()}-${index}`,
            },
            materiality,
            state,
            obligation_execution_decision_refs: [],
            query_evidence_refs: [],
            support_decision_refs: [],
            conflict_refs: [],
            reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
          }),
        ),
      ),
      expected: {
        critical_total: 5,
        critical_open: 1,
        critical_satisfied: 1,
        critical_blocked: 1,
        critical_failed: 1,
        critical_stale: 1,
        supporting_total: 5,
        supporting_open: 1,
        supporting_satisfied: 1,
        supporting_blocked: 1,
        supporting_failed: 1,
        supporting_stale: 1,
      },
    },
  ])("canonical Coverage 计数器：$name", ({ obligations, expected }) => {
    expect(deriveCoverageCounts(obligations)).toEqual(expected);
  });

  it("用唯一 Wire collector 生成 strict Payload 的 exact Reference Closure", () => {
    const collected = collectL2ResearchPayloadArtifactReferences(briefV2);
    expect(collected.map(artifactReferenceIdentity)).toEqual(
      [...makeBriefV2Document().envelope.input_refs].map(artifactReferenceIdentity).sort(),
    );
    expect(Object.isFrozen(collected)).toBe(true);
    expect(() =>
      collectL2ResearchPayloadArtifactReferences({
        ...briefV2,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      collectL2ResearchPayloadArtifactReferences({
        artifact_type: "ResearchBrief",
        protocol_version: "research-brief@9.9.9",
      }),
    ).toThrow("L2_WIRE_VERSION_WRITE_UNSUPPORTED");
  });

  it("Payload collector 在读取 discriminator 前拒绝 accessor 与自定义 Array prototype", () => {
    let discriminatorGetterTouched = false;
    const accessorPayload = {
      ...briefV2,
      get artifact_type(): never {
        discriminatorGetterTouched = true;
        throw new Error("artifact_type getter 不应执行");
      },
    };
    expect(() => collectL2ResearchPayloadArtifactReferences(accessorPayload)).toThrow(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
    );
    expect(discriminatorGetterTouched).toBe(false);

    let inheritedGetterTouched = false;
    const dimensions = ["region"];
    const customArrayPrototype = Object.create(Array.prototype);
    Object.defineProperty(customArrayPrototype, "inherited", {
      enumerable: true,
      get: () => {
        inheritedGetterTouched = true;
        throw new Error("Array prototype getter 不应执行");
      },
    });
    Object.setPrototypeOf(dimensions, customArrayPrototype);
    expect(() =>
      collectL2ResearchPayloadArtifactReferences({
        ...briefV2,
        scope: {
          ...briefV2.scope,
          dimensions,
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(inheritedGetterTouched).toBe(false);
  });

  it("所有公开 Wire 入口在读取 discriminator 前共同拒绝 accessor", async () => {
    const accessorPayload = () => {
      let touched = false;
      const payload = { ...briefV2 } as Record<string, unknown>;
      Object.defineProperty(payload, "protocol_version", {
        enumerable: true,
        get: () => {
          touched = true;
          throw new Error("protocol_version getter 不应执行");
        },
      });
      return { payload, wasTouched: () => touched };
    };

    const payloadParserCase = accessorPayload();
    expect(() =>
      parseL2ResearchPayloadForEnvelopeCandidate(
        makeBriefV2Document().envelope,
        payloadParserCase.payload,
      ),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(payloadParserCase.wasTouched()).toBe(false);

    const documentParserCase = accessorPayload();
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        payload: documentParserCase.payload,
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(documentParserCase.wasTouched()).toBe(false);

    const historicalReaderCase = accessorPayload();
    expect(() =>
      readHistoricalL2ResearchDocument({
        ...makeBriefV2Document(),
        payload: historicalReaderCase.payload,
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(historicalReaderCase.wasTouched()).toBe(false);

    const semanticHashCase = accessorPayload();
    await expect(computeL2ResearchSemanticHash(semanticHashCase.payload)).rejects.toThrow(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
    );
    expect(semanticHashCase.wasTouched()).toBe(false);
  });

  it("超长 Array 在 Reflect.ownKeys 前失败关闭", () => {
    let ownKeysTouched = false;
    const oversizedDimensions = new Proxy(new Array(U6_WIRE_LIMITS.max_artifact_input_refs + 1), {
      ownKeys: () => {
        ownKeysTouched = true;
        throw new Error("oversized Array 不应进入 ownKeys");
      },
    });

    expect(() =>
      collectL2ResearchPayloadArtifactReferences({
        ...briefV2,
        scope: {
          ...briefV2.scope,
          dimensions: oversizedDimensions,
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(ownKeysTouched).toBe(false);
  });

  it("按三元组解析 V2，并 strict 拒绝未知字段", () => {
    expect(parseL2ResearchDocumentCandidate(makeBriefV2Document()).payload).toEqual(briefV2);
    expect(researchBriefV2PayloadSchema.safeParse({ ...briefV2, unexpected: true }).success).toBe(
      false,
    );
  });

  it("V1 只能显式作为 historical read，未知版本元组失败", () => {
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toHaveLength(31);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "AnalysisProgram",
      "1.1.0",
      "analysis-program@1.1.0",
    ]);
    expect(new Set(L2_RESEARCH_WIRE_VERSION_MATRIX.map((tuple) => tuple.join("\0"))).size).toBe(
      L2_RESEARCH_WIRE_VERSION_MATRIX.length,
    );
    const historical = readHistoricalL2ResearchDocument({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ResearchBrief",
        input_refs: [makeArtifactReference("QuestionFrame")],
      },
      payload: {
        artifact_type: "ResearchBrief",
        question_frame_ref: makeArtifactReference("QuestionFrame"),
        research_goal: "旧版",
        success_criteria: ["旧版成功条件"],
        budget: { max_steps: 1, max_model_calls: 1, max_sql_executions: 1 },
      },
    });
    expect(historical).toMatchObject({
      authority: "HISTORICAL_READ_ONLY",
      can_authorize_current: false,
    });
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        envelope: { ...makeBriefV2Document().envelope, schema_version: "9.9.9" },
      }),
    ).toThrow("L2_WIRE_VERSION_WRITE_UNSUPPORTED");
  });

  it("CoverageState 与 ResearchStopDecision v2 canonical payload/envelope 已进入 writer Registry", () => {
    const currentDocuments = [
      makeCurrentV2Document(makeCoverageStateV2Payload()),
      makeCurrentV2Document(makeResearchStopDecisionV2Payload()),
    ];

    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "CoverageState",
      "2.0.0",
      "coverage-state@2.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "ResearchStopDecision",
      "2.0.0",
      "research-stop@2.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "CoverageState",
      "1.0.0",
      "coverage-state@1.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "ResearchStopDecision",
      "1.0.0",
      "research-stop@1.0.0",
    ]);

    for (const document of currentDocuments) {
      expect(
        parseL2ResearchPayloadForEnvelopeCandidate(document.envelope, document.payload),
      ).toEqual(document.payload);
      expect(parseL2ResearchDocumentCandidate(document)).toEqual(document);
    }
  });

  it("CoverageState 与 ResearchStopDecision v1 在 C2a 原子切换前仅作显式过渡 writer", () => {
    expect(L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES).toEqual([
      ["ReportManifest", "1.0.0", "report-manifest@1.0.0"],
      ["ReportReadyCertificate", "2.0.0", "report-ready@2.0.0"],
    ]);
    expect(L2_RESEARCH_TRANSITIONAL_WRITABLE_TUPLES).toEqual([
      ["CoverageState", "1.0.0", "coverage-state@1.0.0"],
      ["ResearchStopDecision", "1.0.0", "research-stop@1.0.0"],
    ]);

    const v2Coverage = makeCoverageStateV2Payload();
    const { budget_receipt: _budgetReceipt, ...legacyCoveragePayload } = {
      ...v2Coverage,
      protocol_version: "coverage-state@1.0.0" as const,
      budget_ledger: makeBudgetLedger(),
    };
    const legacyCoverageDocument = {
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "CoverageState" as const,
        schema_version: "1.0.0",
        input_refs: collectL2ResearchPayloadArtifactReferences(legacyCoveragePayload),
      },
      payload: legacyCoveragePayload,
    };
    const legacyStopPayload = {
      ...makeStopCommon(),
      decision: "STOP_READY" as const,
    };
    const legacyStopDocument = {
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ResearchStopDecision" as const,
        schema_version: "1.0.0",
        input_refs: collectL2ResearchPayloadArtifactReferences(legacyStopPayload),
      },
      payload: legacyStopPayload,
    };

    for (const document of [legacyCoverageDocument, legacyStopDocument]) {
      expect(
        parseL2ResearchPayloadForEnvelopeCandidate(document.envelope, document.payload),
      ).toEqual(document.payload);
      expect(parseL2ResearchDocumentCandidate(document)).toEqual(document);
      expect(() => readHistoricalVersionedL2ResearchDocument(document)).toThrow(
        "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      );
    }
  });

  it("旧 Report tuple 保留原非空语义且只能 historical read；当前 tuple 显式升级", () => {
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "ReportManifest",
      "2.0.0",
      "report-manifest@2.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "ReportReadyCertificate",
      "3.0.0",
      "report-ready@3.0.0",
    ]);
    expect(L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES).toContainEqual([
      "ReportManifest",
      "1.0.0",
      "report-manifest@1.0.0",
    ]);
    expect(L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES).toContainEqual([
      "ReportReadyCertificate",
      "2.0.0",
      "report-ready@2.0.0",
    ]);

    const briefRef = makeArtifactReference("ResearchBrief");
    const stopRef = makeArtifactReference("ResearchStopDecision");
    const claimRef = makeArtifactReference("AtomicClaim");
    const legacyManifest = {
      artifact_type: "ReportManifest",
      protocol_version: "report-manifest@1.0.0",
      brief_ref: briefRef,
      stop_decision_ref: stopRef,
      sections: [
        {
          section_id: "EXECUTIVE_SUMMARY",
          claim_refs: [claimRef],
          hypothesis_assessment_refs: [],
          conflict_refs: [],
          limitation_codes: [],
        },
        {
          section_id: "SUPPORTED_FINDINGS",
          claim_refs: [claimRef],
          hypothesis_assessment_refs: [],
          conflict_refs: [],
          limitation_codes: [],
        },
      ],
      material_claim_refs: [claimRef],
      required_disclosures: ["L2_NON_CAUSAL"],
      allowed_style_profile: "ZH_L2_RESEARCH_V1",
      manifest_hash: hashes.artifact,
    } as const;
    const legacyDocument = {
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ReportManifest",
        schema_version: "1.0.0",
        input_refs: [briefRef, stopRef, claimRef],
      },
      payload: legacyManifest,
    };
    expectTypeOf<ReportManifestPayload>().toEqualTypeOf<ReportManifestV1Payload>();
    expect(reportManifestPayloadSchema).toBe(reportManifestV1PayloadSchema);
    expect(reportManifestPayloadSchema.safeParse(legacyManifest).success).toBe(true);
    expect(readHistoricalVersionedL2ResearchDocument(legacyDocument)).toMatchObject({
      authority: "HISTORICAL_READ_ONLY",
      can_authorize_current: false,
      document: { payload: legacyManifest },
    });
    expect(() => parseL2ResearchDocumentCandidate(legacyDocument)).toThrow(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
    );
    expect(
      reportManifestV1PayloadSchema.safeParse({
        ...legacyManifest,
        sections: legacyManifest.sections.map((section) => ({
          ...section,
          claim_refs: [],
        })),
        material_claim_refs: [],
      }).success,
    ).toBe(false);

    const legacyCertificateManifestRef = makeArtifactReference("ReportManifest");
    const legacyAnalysisReportRef = makeArtifactReference("AnalysisReport");
    const legacyProjectionReceiptRef = makeArtifactReference("ReportProjectionReceipt");
    const legacySupportGateRef = makeArtifactReference(
      "EvidenceGateReceipt",
      "00000000-0000-4000-8000-000000000021",
    );
    const legacyConflictGateRef = makeArtifactReference(
      "EvidenceGateReceipt",
      "00000000-0000-4000-8000-000000000022",
    );
    const legacyFreshnessGateRef = makeArtifactReference(
      "EvidenceGateReceipt",
      "00000000-0000-4000-8000-000000000023",
    );
    const legacyIndependenceGateRef = makeArtifactReference(
      "EvidenceGateReceipt",
      "00000000-0000-4000-8000-000000000024",
    );
    const legacySupportRef = makeArtifactReference("SupportDecision");
    const legacySemanticRef = makeArtifactReference("SemanticRelease");
    const legacySchemaRef = makeArtifactReference("SchemaSnapshot");
    const legacyPolicyRef = makeArtifactReference("PolicyReceipt");
    const legacyCertificate = {
      artifact_type: "ReportReadyCertificate",
      protocol_version: "report-ready@2.0.0",
      stop_decision_ref: stopRef,
      report_manifest_ref: legacyCertificateManifestRef,
      analysis_report_ref: legacyAnalysisReportRef,
      projection_receipt_ref: legacyProjectionReceiptRef,
      gate_receipt_refs: {
        support: legacySupportGateRef,
        conflict: legacyConflictGateRef,
        freshness: legacyFreshnessGateRef,
        source_independence: legacyIndependenceGateRef,
      },
      material_support_decision_refs: [legacySupportRef],
      version_frontier: {
        semantic_release_ref: legacySemanticRef,
        schema_snapshot_ref: legacySchemaRef,
        data_snapshot: {
          protocol_version: "data-snapshot-binding@1.0.0",
          datasource_id: "00000000-0000-4000-8000-000000000025",
          strategy: "NONE",
          snapshot_token: null,
          schema_manifest_hash: null,
          data_manifest_hash: null,
          fixture_manifest_hash: null,
          replay_state: "REPLAY_UNAVAILABLE",
          binding_hash: hashes.artifact,
        },
        policy_receipt_ref: legacyPolicyRef,
        identity_binding: {
          principal_id: "principal",
          delegation_chain_hash: hashes.input,
          authority_epoch: 1,
        },
      },
      input_closure_hash: hashes.input,
      certificate_semantic_hash: hashes.artifact,
      evaluated_through_input_event_seq: 10,
    } as const;
    const legacyCertificateDocument = {
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ReportReadyCertificate",
        schema_version: "2.0.0",
        input_refs: [
          stopRef,
          legacyCertificateManifestRef,
          legacyAnalysisReportRef,
          legacyProjectionReceiptRef,
          legacySupportGateRef,
          legacyConflictGateRef,
          legacyFreshnessGateRef,
          legacyIndependenceGateRef,
          legacySupportRef,
          legacySemanticRef,
          legacySchemaRef,
          legacyPolicyRef,
        ],
      },
      payload: legacyCertificate,
    };
    expect(reportReadyCertificateV2PayloadSchema.safeParse(legacyCertificate).success).toBe(true);
    expect(readHistoricalVersionedL2ResearchDocument(legacyCertificateDocument)).toMatchObject({
      authority: "HISTORICAL_READ_ONLY",
      can_authorize_current: false,
      document: { payload: legacyCertificate },
    });
    expect(() => parseL2ResearchDocumentCandidate(legacyCertificateDocument)).toThrow(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
    );
  });

  it("reset-only registry 只接受 OED 2.0 tuple，并拒绝旧 OED 1.0 current parse", () => {
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "ObligationExecutionDecision",
      "2.0.0",
      "obligation-execution@2.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).not.toContainEqual([
      "ObligationExecutionDecision",
      "1.0.0",
      "obligation-execution@1.0.0",
    ]);
    expect(() =>
      parseL2ResearchDocumentCandidate({
        envelope: {
          ...makeArtifactEnvelope(),
          artifact_type: "ObligationExecutionDecision",
          schema_version: "1.0.0",
          input_refs: [],
        },
        payload: {
          artifact_type: "ObligationExecutionDecision",
          protocol_version: "obligation-execution@1.0.0",
        },
      }),
    ).toThrow("L2_WIRE_VERSION_WRITE_UNSUPPORTED");
  });

  it("在 Zod/递归 collector 前快速拒绝超长 input_refs、深层图、cycle 与 accessor", () => {
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        envelope: {
          ...makeBriefV2Document().envelope,
          input_refs: Array.from(
            { length: U6_WIRE_LIMITS.max_artifact_input_refs + 1 },
            () => briefV2.question_frame_ref,
          ),
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");

    let deepPayload: unknown = "leaf";
    for (let index = 0; index <= U6_WIRE_LIMITS.max_dependency_depth; index += 1) {
      deepPayload = { nested: deepPayload };
    }
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        payload: deepPayload,
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        payload: {
          oversized: "x".repeat(U6_WIRE_LIMITS.max_artifact_bytes + 1),
        },
      }),
    ).toThrow("L2_WIRE_ARTIFACT_TOO_LARGE");

    const cyclic = makeBriefV2Document() as ReturnType<typeof makeBriefV2Document> & {
      cycle?: unknown;
    };
    cyclic.cycle = cyclic;
    expect(() => parseL2ResearchDocumentCandidate(cyclic)).toThrow(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
    );

    const withAccessor = makeBriefV2Document() as ReturnType<typeof makeBriefV2Document> & {
      trap?: unknown;
    };
    Object.defineProperty(withAccessor, "trap", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    expect(() => parseL2ResearchDocumentCandidate(withAccessor)).toThrow(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
    );
  });

  it("Envelope Content Hash 复用既有 L2 身份材料", async () => {
    const document = makeBriefV2Document();
    const contentA = await computeL2ResearchEnvelopeContentHash(document);
    const parsedAndHash = await parseAndHashL2ResearchDocumentCandidate(document);
    const legacyMaterialHash = await computeL2ArtifactContentHash(document as never);
    const contentB = await computeL2ResearchEnvelopeContentHash({
      ...document,
      envelope: {
        ...document.envelope,
        attempt_id: "00000000-0000-4000-8000-000000000099",
      },
    });

    expect(contentA).toBe(legacyMaterialHash);
    expect(parsedAndHash).toEqual({
      document: parseL2ResearchDocumentCandidate(document),
      content_hash: contentA,
    });
    expect(contentA).not.toBe(contentB);
  });

  it("领域 Semantic Hash 排除声明 Hash，并规范排序集合型数组", async () => {
    const decision = {
      artifact_type: "ObligationExecutionDecision",
      protocol_version: "obligation-execution@2.0.0",
      brief_ref: makeArtifactReference("ResearchBrief"),
      obligation_ref: obligationRef,
      query_contract_ref: makeArtifactReference("QueryContract"),
      sql_artifact_ref: makeArtifactReference("SqlArtifact"),
      semantic_release_ref: makeArtifactReference("SemanticRelease"),
      policy_receipt_ref: makeArtifactReference("PolicyReceipt"),
      observation_contract_hash: hashes.artifact,
      verdict: "FAIL",
      checks: {
        metric: "MISMATCH",
        metric_formula: "MATCH",
        time_window: "MATCH",
        timezone: "MATCH",
        grain: "MATCH",
        dimensions: "MATCH",
        grouping: "MATCH",
        joins: "MATCH",
        canonical_predicates: "MATCH",
        cohort: "MATCH",
        null_semantics: "MATCH",
        authorization_scope: "MATCH",
      },
      reason_codes: ["OBLIGATION_QUERY_SEMANTICS_MISMATCH", "EVIDENCE_SUPPORT_INSUFFICIENT"],
      evaluator_version: "obligation-evaluator@1.0.0",
      decision_semantic_hash: hashes.artifact,
    } as const;
    const semanticA = await computeL2ResearchSemanticHash(decision);
    const semanticB = await computeL2ResearchSemanticHash({
      ...decision,
      decision_semantic_hash: hashes.input,
      reason_codes: [...decision.reason_codes].reverse(),
    });
    const semanticWithOtherSql = await computeL2ResearchSemanticHash({
      ...decision,
      sql_artifact_ref: {
        ...decision.sql_artifact_ref,
        artifact_id: "00000000-0000-4000-8000-000000000088",
      },
    });
    expect(semanticA).toBe(semanticB);
    expect(semanticWithOtherSql).not.toBe(semanticA);
    expect(
      collectL2ResearchPayloadArtifactReferences(decision).map(artifactReferenceIdentity),
    ).toContain(artifactReferenceIdentity(decision.sql_artifact_ref));

    const gateRef = (suffix: string) => ({
      ...makeArtifactReference("EvidenceGateReceipt"),
      artifact_id: `00000000-0000-4000-8000-0000000000${suffix}`,
    });
    const certificate = {
      artifact_type: "ReportReadyCertificate",
      protocol_version: "report-ready@2.0.0",
      stop_decision_ref: makeArtifactReference("ResearchStopDecision"),
      report_manifest_ref: makeArtifactReference("ReportManifest"),
      analysis_report_ref: makeArtifactReference("AnalysisReport"),
      projection_receipt_ref: makeArtifactReference("ReportProjectionReceipt"),
      gate_receipt_refs: {
        support: gateRef("21"),
        conflict: gateRef("22"),
        freshness: gateRef("23"),
        source_independence: gateRef("24"),
      },
      material_support_decision_refs: [makeArtifactReference("SupportDecision")],
      version_frontier: {
        semantic_release_ref: makeArtifactReference("SemanticRelease"),
        schema_snapshot_ref: makeArtifactReference("SchemaSnapshot"),
        data_snapshot: {
          protocol_version: "data-snapshot-binding@1.0.0",
          datasource_id: "00000000-0000-4000-8000-000000000025",
          strategy: "NONE",
          snapshot_token: null,
          schema_manifest_hash: null,
          data_manifest_hash: null,
          fixture_manifest_hash: null,
          replay_state: "REPLAY_UNAVAILABLE",
          binding_hash: hashes.artifact,
        },
        policy_receipt_ref: makeArtifactReference("PolicyReceipt"),
        identity_binding: {
          principal_id: "principal",
          delegation_chain_hash: hashes.input,
          authority_epoch: 1,
        },
      },
      input_closure_hash: hashes.input,
      certificate_semantic_hash: hashes.artifact,
      evaluated_through_input_event_seq: 10,
    } as const;
    const certificateA = await computeL2ResearchSemanticHash(certificate);
    const certificateB = await computeL2ResearchSemanticHash({
      ...certificate,
      certificate_semantic_hash: hashes.execution,
    });
    const certificateAtNextEvent = await computeL2ResearchSemanticHash({
      ...certificate,
      evaluated_through_input_event_seq: 11,
    });
    expect(certificateA).toBe(certificateB);
    expect(certificateAtNextEvent).not.toBe(certificateA);
  });

  it("全反驳 Manifest/Certificate 允许空 Supported 集合，但拒绝完全空报告", () => {
    const refutedAssessmentRef = makeArtifactReference("HypothesisAssessment");
    const manifestBase = {
      artifact_type: "ReportManifest",
      protocol_version: "report-manifest@2.0.0",
      brief_ref: makeArtifactReference("ResearchBrief"),
      stop_decision_ref: makeArtifactReference("ResearchStopDecision"),
      sections: [
        {
          section_id: "EXECUTIVE_SUMMARY",
          claim_refs: [],
          hypothesis_assessment_refs: [],
          conflict_refs: [],
          limitation_codes: [],
        },
        {
          section_id: "SUPPORTED_FINDINGS",
          claim_refs: [],
          hypothesis_assessment_refs: [],
          conflict_refs: [],
          limitation_codes: [],
        },
        {
          section_id: "REFUTED_HYPOTHESES",
          claim_refs: [],
          hypothesis_assessment_refs: [refutedAssessmentRef],
          conflict_refs: [],
          limitation_codes: [],
        },
      ],
      material_claim_refs: [],
      required_disclosures: ["L2_NON_CAUSAL"],
      allowed_style_profile: "ZH_L2_RESEARCH_V1",
      manifest_hash: hashes.artifact,
    } as const;
    expect(reportManifestV2PayloadSchema.safeParse(manifestBase).success).toBe(true);
    expect(reportManifestPayloadSchema.safeParse(manifestBase).success).toBe(false);
    expect(
      reportManifestV2PayloadSchema.safeParse({
        ...manifestBase,
        sections: manifestBase.sections.map((section) =>
          section.section_id === "REFUTED_HYPOTHESES"
            ? { ...section, hypothesis_assessment_refs: [] }
            : section,
        ),
      }).success,
    ).toBe(false);

    const gateRef = (suffix: string) => ({
      ...makeArtifactReference("EvidenceGateReceipt"),
      artifact_id: `00000000-0000-4000-8000-0000000000${suffix}`,
    });
    const refutedOnlyCertificate = {
      artifact_type: "ReportReadyCertificate",
      protocol_version: "report-ready@3.0.0",
      stop_decision_ref: makeArtifactReference("ResearchStopDecision"),
      report_manifest_ref: makeArtifactReference("ReportManifest"),
      analysis_report_ref: makeArtifactReference("AnalysisReport"),
      projection_receipt_ref: makeArtifactReference("ReportProjectionReceipt"),
      gate_receipt_refs: {
        support: gateRef("31"),
        conflict: gateRef("32"),
        freshness: gateRef("33"),
        source_independence: gateRef("34"),
      },
      material_support_decision_refs: [],
      version_frontier: {
        semantic_release_ref: makeArtifactReference("SemanticRelease"),
        schema_snapshot_ref: makeArtifactReference("SchemaSnapshot"),
        data_snapshot: {
          protocol_version: "data-snapshot-binding@1.0.0",
          datasource_id: "00000000-0000-4000-8000-000000000035",
          strategy: "NONE",
          snapshot_token: null,
          schema_manifest_hash: null,
          data_manifest_hash: null,
          fixture_manifest_hash: null,
          replay_state: "REPLAY_UNAVAILABLE",
          binding_hash: hashes.artifact,
        },
        policy_receipt_ref: makeArtifactReference("PolicyReceipt"),
        identity_binding: {
          principal_id: "principal",
          delegation_chain_hash: hashes.input,
          authority_epoch: 1,
        },
      },
      input_closure_hash: hashes.input,
      certificate_semantic_hash: hashes.artifact,
      evaluated_through_input_event_seq: 10,
    } as const;
    expect(reportReadyCertificateV3PayloadSchema.safeParse(refutedOnlyCertificate).success).toBe(
      true,
    );
    expect(
      reportReadyCertificateV2PayloadSchema.safeParse({
        ...refutedOnlyCertificate,
        protocol_version: "report-ready@2.0.0",
      }).success,
    ).toBe(false);
  });

  it("拒绝错 Ref Type、跨 Scope、重复成员与统一上限溢出", () => {
    expect(
      researchBriefV2PayloadSchema.safeParse({
        ...briefV2,
        policy_ref: makeArtifactReference("SchemaSnapshot"),
      }).success,
    ).toBe(false);
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        payload: {
          ...briefV2,
          question_frame_ref: {
            ...briefV2.question_frame_ref,
            tenant_id: "00000000-0000-4000-8000-000000000099",
          },
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(
      researchBriefV2PayloadSchema.safeParse({
        ...briefV2,
        scope: { ...briefV2.scope, dimensions: ["region", "region"] },
      }).success,
    ).toBe(false);
    expect(
      researchBriefV2PayloadSchema.safeParse({
        ...briefV2,
        scope: {
          ...briefV2.scope,
          dimensions: Array.from(
            { length: U6_WIRE_LIMITS.max_dimensions + 1 },
            (_, index) => `d${index}`,
          ),
        },
      }).success,
    ).toBe(false);
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        envelope: {
          ...makeBriefV2Document().envelope,
          input_refs: [briefV2.question_frame_ref, briefV2.policy_ref],
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...makeBriefV2Document(),
        envelope: {
          ...makeBriefV2Document().envelope,
          input_refs: [
            ...makeBriefV2Document().envelope.input_refs,
            makeArtifactReference("SchemaSnapshot"),
          ],
        },
      }),
    ).toThrow("L2_WIRE_REFERENCE_CLOSURE_INVALID");
  });

  it("ResearchStop 六分支由 strict Object 与本地互斥条件判别", () => {
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon(),
        decision: "STOP_READY",
      }).success,
    ).toBe(true);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon(),
        decision: "STOP_READY",
        non_ready_terminal: "PARTIAL",
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon(),
        decision: "CONTINUE",
      }).success,
    ).toBe(false);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon({
          candidate_queries: [makeCandidate("BUDGET_BLOCKED")],
          unresolved_obligation_refs: [obligationRef],
          claim_refs: [makeArtifactReference("AtomicClaim")],
          support_decision_refs: [makeArtifactReference("SupportDecision")],
          required_disclosures: ["BUDGET_LIMIT"],
        }),
        decision: "STOP_PARTIAL",
        non_ready_terminal: "PARTIAL",
        partial_disclosure_codes: ["BUDGET_LIMIT"],
      }).success,
    ).toBe(true);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon({
          candidate_queries: [makeCandidate("WAITING_EXTERNAL_CAPABILITY")],
          unresolved_obligation_refs: [obligationRef],
        }),
        decision: "STOP_NEEDS_MORE_RESEARCH",
        non_ready_terminal: "NEEDS_MORE_RESEARCH",
        resume_requirement_codes: ["PROVIDER_CAPABILITY"],
      }).success,
    ).toBe(true);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon({
          candidate_queries: [makeCandidate("INADMISSIBLE")],
          unresolved_obligation_refs: [obligationRef],
        }),
        decision: "STOP_INCONCLUSIVE",
        non_ready_terminal: "INCONCLUSIVE",
        inadmissibility_summary_hash: hashes.input,
      }).success,
    ).toBe(true);
    expect(
      researchStopDecisionPayloadSchema.safeParse({
        ...makeStopCommon({
          unresolved_obligation_refs: [obligationRef],
          no_candidate_obligation_refs: [obligationRef],
        }),
        decision: "REPLAN",
        replan_obligation_refs: [obligationRef],
        replan_assessment: {
          trigger: "PLAN_INVALIDATED",
          executable_with_remaining_budget: true,
          assessment_hash: hashes.artifact,
        },
      }).success,
    ).toBe(true);

    for (const invalid of [
      {
        ...makeStopCommon(),
        decision: "STOP_PARTIAL",
        non_ready_terminal: "PARTIAL",
        partial_disclosure_codes: ["BUDGET_LIMIT"],
      },
      {
        ...makeStopCommon(),
        decision: "STOP_NEEDS_MORE_RESEARCH",
        non_ready_terminal: "NEEDS_MORE_RESEARCH",
        resume_requirement_codes: ["NEW_BUDGET"],
      },
      {
        ...makeStopCommon(),
        decision: "REPLAN",
        replan_obligation_refs: [obligationRef],
        replan_assessment: {
          trigger: "PLAN_INVALIDATED",
          executable_with_remaining_budget: true,
          assessment_hash: hashes.artifact,
        },
      },
    ]) {
      expect(researchStopDecisionPayloadSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("CONTINUE 在 EIG 相同时按完整 Reference Identity 稳定破平且不依赖 locale", () => {
    const lowerArtifact = makeArtifactReference(
      "QueryContract",
      "00000000-0000-4000-8000-000000000020",
    );
    const higherArtifact = makeArtifactReference(
      "QueryContract",
      "00000000-0000-4000-8000-000000000021",
    );
    const lowerScope = {
      ...lowerArtifact,
      app_id: "00000000-0000-4000-8000-000000000001",
    };
    const higherScope = {
      ...lowerArtifact,
      app_id: "00000000-0000-4000-8000-000000000002",
    };
    const lowerRevision = { ...lowerArtifact, revision: 1 };
    const higherRevision = { ...lowerArtifact, revision: 2 };
    const lowerContentHash = {
      ...lowerArtifact,
      content_hash: `sha256:${"0".repeat(64)}`,
    };
    const higherContentHash = {
      ...lowerArtifact,
      content_hash: `sha256:${"f".repeat(64)}`,
    };
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("Reference Identity 排序不得调用 localeCompare");
    });

    try {
      for (const [firstReference, secondReference] of [
        [lowerArtifact, higherArtifact],
        [lowerScope, higherScope],
        [lowerRevision, higherRevision],
        [lowerContentHash, higherContentHash],
      ]) {
        const firstCandidate = {
          ...makeCandidate("EXECUTABLE_NOW"),
          query_contract_ref: firstReference,
        };
        const secondCandidate = {
          ...makeCandidate("EXECUTABLE_NOW"),
          query_contract_ref: secondReference,
        };
        const common = makeStopCommon({
          candidate_queries: [secondCandidate, firstCandidate],
          unresolved_obligation_refs: [obligationRef],
        });

        expect(
          researchStopDecisionPayloadSchema.safeParse({
            ...common,
            decision: "CONTINUE",
            selected_next_query_ref: firstReference,
          }).success,
        ).toBe(true);
        expect(
          researchStopDecisionPayloadSchema.safeParse({
            ...common,
            decision: "CONTINUE",
            selected_next_query_ref: secondReference,
          }).success,
        ).toBe(false);
      }
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("八种 V1 Research Artifact 不能再通过当前 L2 Authority 入口", async () => {
    expect(L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES).toEqual([
      "ResearchBrief",
      "HypothesisSet",
      "EvidencePlan",
      "QueryEvidence",
      "AtomicClaim",
      "EvidenceRelation",
      "AnalysisReport",
      "ReportReadyCertificate",
    ]);
    const historical = readHistoricalL2ResearchDocument({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "ResearchBrief",
        input_refs: [makeArtifactReference("QuestionFrame")],
      },
      payload: {
        artifact_type: "ResearchBrief",
        question_frame_ref: makeArtifactReference("QuestionFrame"),
        research_goal: "旧版",
        success_criteria: ["旧版成功条件"],
        budget: { max_steps: 1, max_model_calls: 1, max_sql_executions: 1 },
      },
    });
    let authorityCalls = 0;
    await expect(
      verifyL2ArtifactDocument(historical.document, {
        principalId: "principal",
        verifyCommitted: async () => {
          authorityCalls += 1;
          return true;
        },
        resolveL2: async () => {
          authorityCalls += 1;
          return null;
        },
        verifyCommitterCapability: async () => {
          authorityCalls += 1;
          return true;
        },
      }),
    ).rejects.toThrow("L2_WIRE_VERSION_WRITE_UNSUPPORTED");
    expect(authorityCalls).toBe(0);

    await expect(
      verifyL2ArtifactDocument(
        {
          ...historical.document,
          envelope: {
            ...historical.document.envelope,
            schema_version: "legacy-v1",
          },
        },
        {
          principalId: "principal",
          verifyCommitted: async () => true,
          resolveL2: async () => null,
          verifyCommitterCapability: async () => true,
        },
        { mode: "HISTORICAL_READ_ONLY" },
      ),
    ).rejects.toThrow("L2_WIRE_VERSION_WRITE_UNSUPPORTED");
  });

  it("系统 Projection Receipt 不能把 SandboxResult 当作 Agent 输入", () => {
    const projection = {
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@1.0.0",
      scope: {
        app_id: briefV2.question_frame_ref.app_id,
        tenant_id: briefV2.question_frame_ref.tenant_id,
        environment: briefV2.question_frame_ref.environment,
      },
      run_id: briefV2.question_frame_ref.run_id,
      attempt_id: "00000000-0000-4000-8000-000000000008",
      request_id: "00000000-0000-4000-8000-000000000009",
      principal_id: "principal",
      role: "research-supervisor",
      model_profile_ref: {
        provider: "openai",
        profile_id: "00000000-0000-4000-8000-000000000010",
        profile_version: "1.0.0",
        model_id: "gpt",
        profile_hash: hashes.artifact,
        certification_receipt_ref: makeArtifactReference("ModelCertificationReceipt"),
      },
      model_invocation: {
        reservation_id: "00000000-0000-4000-8000-000000000011",
        reservation_seq: 1,
        resource_lease_id: "00000000-0000-4000-8000-000000000012",
        invocation_id: "00000000-0000-4000-8000-000000000013",
        attempt_id: "00000000-0000-4000-8000-000000000008",
        worker_fence: 1,
        request_id: "00000000-0000-4000-8000-000000000009",
        canonical_request_digest: hashes.input,
        reserved: {
          resource_kind: "MODEL",
          input_tokens: 1,
          output_tokens: 1,
          cost_microusd: 1,
          concurrent_slots: 1,
        },
      },
      provider: "openai",
      model_id: "gpt",
      input_refs: [makeArtifactReference("ResearchBrief")],
      approved_fields: ["scope.subject"],
      inherited_classification: "INTERNAL",
      projected_bytes: 1,
      projected_tokens: 1,
      redaction_count: 0,
      small_group_suppression: "PASS",
      dlp_scan: "PASS",
      egress_payload_digest: `hmac-sha256:${"a".repeat(64)}`,
      egress_policy_version: "1.0.0",
      receipt_hash: hashes.execution,
    };
    expect(agentDataProjectionReceiptSchema.safeParse(projection).success).toBe(true);
    expect(
      agentDataProjectionReceiptSchema.safeParse({
        ...projection,
        input_refs: [makeArtifactReference("SandboxResult")],
      }).success,
    ).toBe(false);
    expect(
      agentDataProjectionReceiptSchema.safeParse({
        ...projection,
        input_refs: [
          {
            ...makeArtifactReference("ResearchBrief"),
            tenant_id: "00000000-0000-4000-8000-000000000099",
          },
        ],
      }).success,
    ).toBe(false);
    expect(knownArtifactTypeSchema.safeParse("AgentDataProjectionReceipt").success).toBe(true);
    expect(l2ArtifactTypeSchema.safeParse("AgentDataProjectionReceipt").success).toBe(false);
  });

  it("普通 Parse 只返回无品牌 Candidate，公共根不含 U6 Registrar/Seal/READY 构造器", async () => {
    const candidate = parseL2ResearchDocumentCandidate(makeBriefV2Document());
    expect(Object.getOwnPropertySymbols(candidate)).toHaveLength(0);
    expect(Object.getOwnPropertySymbols(candidate.payload)).toHaveLength(0);
    const publicSurface = await import("../src/index.js");
    for (const forbidden of [
      "registerL2ResearchWire",
      "sealReportReadyCertificate",
      "authorizeCurrentReady",
      "createReportReadyCertificate",
    ]) {
      expect(forbidden in publicSurface).toBe(false);
    }
    expect(
      Object.keys(publicSurface).filter((name) =>
        /(research.*(registrar|authoritybrand|committer)|currentready|fixture(registry|handle)|seal.*reportready|authorize.*reportready)/iu.test(
          name,
        ),
      ),
    ).toEqual([]);
  });
});
