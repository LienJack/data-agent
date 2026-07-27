import { describe, expect, it } from "vitest";
import {
  agentDataProjectionReceiptSchema,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeL2ResearchSemanticHash,
  knownArtifactTypeSchema,
  L2_RESEARCH_V1_HISTORICAL_ONLY_ARTIFACT_TYPES,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  l2ArtifactTypeSchema,
  parseL2ResearchDocumentCandidate,
  readHistoricalL2ResearchDocument,
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
  it("按三元组解析 V2，并 strict 拒绝未知字段", () => {
    expect(parseL2ResearchDocumentCandidate(makeBriefV2Document()).payload).toEqual(briefV2);
    expect(researchBriefV2PayloadSchema.safeParse({ ...briefV2, unexpected: true }).success).toBe(
      false,
    );
  });

  it("V1 只能显式作为 historical read，未知版本元组失败", () => {
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toHaveLength(18);
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

  it("Envelope Content Hash 复用既有 L2 身份材料", async () => {
    const document = makeBriefV2Document();
    const contentA = await computeL2ResearchEnvelopeContentHash(document);
    const legacyMaterialHash = await computeL2ArtifactContentHash(document as never);
    const contentB = await computeL2ResearchEnvelopeContentHash({
      ...document,
      envelope: {
        ...document.envelope,
        attempt_id: "00000000-0000-4000-8000-000000000099",
      },
    });

    expect(contentA).toBe(legacyMaterialHash);
    expect(contentA).not.toBe(contentB);
  });

  it("领域 Semantic Hash 排除声明 Hash，并规范排序集合型数组", async () => {
    const decision = {
      artifact_type: "ObligationExecutionDecision",
      protocol_version: "obligation-execution@1.0.0",
      brief_ref: makeArtifactReference("ResearchBrief"),
      obligation_ref: obligationRef,
      query_contract_ref: makeArtifactReference("QueryContract"),
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
    expect(semanticA).toBe(semanticB);

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
