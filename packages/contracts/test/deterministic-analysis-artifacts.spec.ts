import { describe, expect, it } from "vitest";
import {
  type ArtifactReference,
  analysisCompletionReceiptPayloadSchema,
  analysisProgramPayloadSchema,
  atomicClaimV2PayloadSchema,
  atomicClaimV3PayloadSchema,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ResearchEnvelopeContentHash,
  dataProfilePayloadSchema,
  derivedAnalysisEvidencePayloadSchema,
  evidenceCheckReceiptV2PayloadSchema,
  knownArtifactTypeSchema,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  l2ArtifactTypeSchema,
  l4ContractArtifactSchema,
  l5ContractArtifactSchema,
  parseL2ResearchDocumentCandidate,
  publicAnalysisRunEventV1Schema,
  reportManifestV3PayloadSchema,
  tabularImportReceiptPayloadSchema,
} from "../src/index.js";
import { analysisResultContractFixture } from "../src/testing/index.js";
import { hashes, ids, makeArtifactEnvelope, makeArtifactReference } from "./fixtures.js";

const timestamp = "2026-08-22T00:00:00.000Z";
const laterTimestamp = "2026-08-23T00:00:00.000Z";

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
}

function reference<const T extends Parameters<typeof makeArtifactReference>[0]>(
  artifactType: T,
  suffix: number,
) {
  return makeArtifactReference(artifactType, uuid(suffix));
}

const briefRef = reference("ResearchBrief", 101);
const semanticReleaseRef = reference("SemanticRelease", 102);
const metricRef = { container_ref: semanticReleaseRef, node_id: "gross_profit" } as const;

const trendOperatorObligation = {
  call_id: "trend_fit",
  operator_id: "robust-trend.theil-sen-slope@1",
  result_binding: {
    result_output_name: "result",
    result_collection_path: "/method_evidence/trends",
    operator_collection_path: "/series",
    label_fields: ["label"],
    value_bindings: [
      {
        result_field: "slope",
        operator_field: "slope",
        comparison: "NUMERIC_TOLERANCE",
        absolute_tolerance: 1e-9,
        relative_tolerance: 1e-9,
      },
    ],
    require_exact_label_set: true,
  },
} as const;

function validPlan() {
  return {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: hashes.artifact,
    semantic_context_package_hash: hashes.input,
    operator_registry_digest: hashes.execution,
    nodes: [
      {
        node_id: "trend",
        skill_id: "trend-change@1",
        metric_refs: [metricRef],
        dimension_refs: ["product"],
        time_window: {
          start: timestamp,
          end: laterTimestamp,
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: { grain: "day" },
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "OPEN_ANALYSIS",
        operator_obligations: [],
        result_contract: analysisResultContractFixture({
          semantic_context_hash: hashes.input,
          contract_id: "trend.result",
          metric_id: "gross_profit",
          dimension_id: "product",
        }),
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
      {
        node_id: "forecast",
        skill_id: "baseline-forecast-backtest@1",
        metric_refs: [metricRef],
        dimension_refs: [],
        time_window: {
          start: timestamp,
          end: laterTimestamp,
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {},
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
        operator_obligations: [trendOperatorObligation],
        result_contract: analysisResultContractFixture({
          semantic_context_hash: hashes.input,
          contract_id: "forecast.result",
          metric_id: "gross_profit",
        }),
        dependency_node_ids: ["trend"],
        activation_rule: {
          kind: "HISTORY_SUFFICIENT",
          source_node_id: "trend",
          minimum_points: 12,
        },
        criticality: "OPTIONAL",
      },
    ],
    budget: {
      max_steps: 8,
      max_sql_executions: 4,
      max_sandbox_executions: 4,
      max_series_rows: 512,
      max_group_rows: 100,
      max_elapsed_ms: 60_000,
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: "analysis-program-compiler@1.0.0",
    program_hash: hashes.execution,
  } as const;
}

function analysisBinding(
  bindingId: string,
  evidenceRef: ArtifactReference = reference("DerivedAnalysisEvidence", 120),
) {
  return {
    binding_id: bindingId,
    evidence_ref: evidenceRef,
    metric_ref: metricRef,
    output_alias: bindingId,
    observed_value: {
      value_kind: "NUMBER" as const,
      number_value: 1,
      text_value: null,
      unit: "CNY",
    },
    result_cell_hash: hashes.artifact,
  };
}

describe("deterministic analysis contracts", () => {
  it("registers new L2 and system artifact identities without promoting L4/L5 placeholders", () => {
    for (const artifactType of [
      "DataProfile",
      "AnalysisProgram",
      "DerivedAnalysisEvidence",
      "AnalysisCompletionReceipt",
    ]) {
      expect(l2ArtifactTypeSchema.parse(artifactType)).toBe(artifactType);
    }
    expect(knownArtifactTypeSchema.parse("TabularImportReceipt")).toBe("TabularImportReceipt");
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "AtomicClaim",
      "3.0.0",
      "atomic-claim@3.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).toContainEqual([
      "DerivedAnalysisEvidence",
      "2.0.0",
      "derived-analysis-evidence@2.0.0",
    ]);
    expect(L2_RESEARCH_WIRE_VERSION_MATRIX).not.toContainEqual([
      "DerivedAnalysisEvidence",
      "1.0.0",
      "derived-analysis-evidence@1.0.0",
    ]);
    expect(
      l4ContractArtifactSchema.parse({
        level: "L4",
        artifact_type: "DiscoveryCandidate",
        contract_version: "discovery@contract-only",
        delivery_state: "CONTRACT_ONLY",
        executable: false,
        public_message: "未交付",
        observation_target_ref: ids.run,
        novelty_policy_version: "novelty@1",
        multiple_testing_policy_version: "multiple-testing@1",
      }).executable,
    ).toBe(false);
    expect(
      l5ContractArtifactSchema.safeParse({
        level: "L5",
        artifact_type: "CausalEstimate",
        contract_version: "causal-estimate@1",
        delivery_state: "READY",
        executable: true,
        public_message: "已交付",
        causal_question_ref: ids.run,
        estimand: "ATE",
        assumptions: ["SUTVA"],
      }).success,
    ).toBe(false);
  });

  it("keeps tabular import strict, content-bound, and zero-output on rejection", () => {
    const rawRef = reference("ArtifactWorkspaceDocument", 110);
    const outputRef = reference("ArtifactWorkspaceDocument", 111);
    const accepted = {
      artifact_type: "TabularImportReceipt",
      protocol_version: "tabular-import@1.0.0",
      raw_artifact_ref: { ...rawRef, content_hash: hashes.artifact },
      raw_content_hash: hashes.artifact,
      declared_mime_type: "text/csv",
      sniffed_format: "CSV",
      parser_version: "tabular-parser@1.0.0",
      parser_image_digest: hashes.execution,
      parser_policy_version: "tabular-policy@1.0.0",
      parser_limits: {
        max_file_bytes: 16_777_216,
        max_zip_expansion_ratio: 100,
        max_sheets: 8,
        max_rows_per_sheet: 100_000,
        max_columns_per_sheet: 256,
        max_cell_bytes: 65_536,
        max_parse_ms: 60_000,
      },
      selected_sheet_names: ["sales.csv"],
      encoding: "utf-8",
      delimiter: ",",
      locale: "zh-CN",
      date_policy: "iso-date@1.0.0",
      formula_policy: "STATIC_CACHED_VALUE",
      macro_detected: false,
      external_link_detected: false,
      sheets: [
        {
          sheet_id: "sheet-1",
          source_name: "sales.csv",
          normalized_name: "sales",
          row_count: 10,
          column_count: 3,
          formula_cell_count: 0,
          output_ref: { ...outputRef, content_hash: hashes.input },
          output_format: "ARROW",
          output_hash: hashes.input,
        },
      ],
      warnings: [],
      truncation_codes: [],
      status: "ACCEPTED",
      failure_code: null,
      started_at: timestamp,
      completed_at: laterTimestamp,
      import_hash: hashes.execution,
    } as const;
    expect(tabularImportReceiptPayloadSchema.parse(accepted)).toEqual(accepted);
    expect(
      tabularImportReceiptPayloadSchema.safeParse({ ...accepted, unexpected: true }).success,
    ).toBe(false);
    expect(
      tabularImportReceiptPayloadSchema.safeParse({
        ...accepted,
        status: "REJECTED",
        failure_code: "TABULAR_IMPORT_TIMEOUT",
      }).success,
    ).toBe(false);
    expect(
      tabularImportReceiptPayloadSchema.safeParse({
        ...accepted,
        selected_sheet_names: ["other.csv"],
      }).success,
    ).toBe(false);
    expect(
      tabularImportReceiptPayloadSchema.safeParse({
        ...accepted,
        status: "PARTIAL",
        truncation_codes: ["TABULAR_IMPORT_ROWS_TRUNCATED"],
      }).success,
    ).toBe(true);
  });

  it("requires unresolved physical profiles to disclose their semantic boundary", () => {
    const inputRef = reference("ArtifactWorkspaceDocument", 112);
    const profile = {
      artifact_type: "DataProfile",
      protocol_version: "data-profile@1.0.0",
      schema_snapshot_ref: reference("SchemaSnapshot", 113),
      input_artifact_refs: [inputRef],
      tables: [
        {
          table_ref: "sales",
          row_count: 10,
          columns: [
            { name: "amount", physical_type: "decimal", null_count: 0, distinct_estimate: 8 },
          ],
          sample_projection_ref: null,
          time_coverage: null,
          candidate_grain: ["order_id"],
        },
      ],
      semantic_binding_status: "UNRESOLVED",
      limitation_codes: [],
      profile_hash: hashes.artifact,
    } as const;
    expect(dataProfilePayloadSchema.safeParse(profile).success).toBe(false);
    expect(
      dataProfilePayloadSchema.safeParse({
        ...profile,
        limitation_codes: ["UNRESOLVED_SEMANTICS"],
      }).success,
    ).toBe(true);
  });

  it("rejects cycles, unknown skills, and generated nodes without a result contract", () => {
    expect(analysisProgramPayloadSchema.parse(validPlan()).nodes).toHaveLength(2);
    const plan = validPlan();
    const cyclic = {
      ...plan,
      nodes: [{ ...plan.nodes[0], dependency_node_ids: ["forecast"] }, plan.nodes[1]],
    };
    expect(analysisProgramPayloadSchema.safeParse(cyclic).success).toBe(false);

    const unknownSkill = {
      ...plan,
      nodes: [{ ...plan.nodes[0], skill_id: "unknown-analysis@1" }, plan.nodes[1]],
    };
    expect(analysisProgramPayloadSchema.safeParse(unknownSkill).success).toBe(false);

    const missingContract = {
      ...plan,
      nodes: [plan.nodes[0], { ...plan.nodes[1], result_contract: null }],
    };
    expect(analysisProgramPayloadSchema.safeParse(missingContract).success).toBe(false);

    expect(
      analysisProgramPayloadSchema.safeParse({ ...plan, operator_registry_digest: undefined })
        .success,
    ).toBe(false);
    expect(
      analysisProgramPayloadSchema.safeParse({
        ...plan,
        nodes: [
          plan.nodes[0],
          {
            ...plan.nodes[1],
            generated_source_policy: "OPEN_ANALYSIS",
            operator_obligations: [trendOperatorObligation],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds OpenSandbox identity and only accepts Oracle-passing derived evidence", () => {
    const evidence = {
      artifact_type: "DerivedAnalysisEvidence",
      protocol_version: "derived-analysis-evidence@2.0.0",
      analysis_program_ref: reference("AnalysisProgram", 115),
      node_id: "trend",
      skill_id: "trend-change@1",
      algorithm_version: "trend-change@1.0.0",
      query_evidence_refs: [reference("QueryEvidence", 117)],
      sandbox_execution_receipt_ref: reference("SandboxExecutionReceipt", 119),
      sandbox_result_refs: [reference("SandboxResult", 121)],
      runtime_profile: "CORE_ANALYSIS",
      agent_image: "data-agent-opensandbox-agent-core@sha256:test",
      operator_image: "data-agent-opensandbox-operator@sha256:test",
      generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
      operator_registry_digest: hashes.execution,
      operator_obligations: [trendOperatorObligation],
      operator_receipt_closure_hash: hashes.execution,
      parameter_hash: hashes.input,
      input_closure_hash: hashes.execution,
      result: {
        result_kind: "TREND_CHANGE",
        points: [],
        first_value: null,
        last_value: null,
      },
      quality: {
        oracle_verdict: "PASS",
        deterministic_replay: "PASS",
        sample_size: 0,
        coverage_ratio: 0,
      },
      limitation_codes: ["INSUFFICIENT_SAMPLE_SIZE"],
      mandatory_disclosures: [],
      derivation_hash: hashes.artifact,
    } as const;
    expect(derivedAnalysisEvidencePayloadSchema.parse(evidence)).toEqual(evidence);
    expect(
      derivedAnalysisEvidencePayloadSchema.safeParse({
        ...evidence,
        quality: { ...evidence.quality, oracle_verdict: "FAIL" },
      }).success,
    ).toBe(false);
  });

  it("derives completion terminal from critical and optional node outcomes", () => {
    const base = {
      artifact_type: "AnalysisCompletionReceipt",
      protocol_version: "analysis-completion@1.0.0",
      analysis_program_ref: reference("AnalysisProgram", 122),
      node_results: [
        {
          node_id: "trend",
          criticality: "CRITICAL",
          status: "SUCCEEDED",
          evidence_ref: reference("DerivedAnalysisEvidence", 123),
          reason_codes: [],
        },
        {
          node_id: "forecast",
          criticality: "OPTIONAL",
          status: "SKIPPED",
          evidence_ref: null,
          reason_codes: ["FORECAST_NOT_USEFUL"],
        },
      ],
      budget_usage: {
        steps: 2,
        model_calls: 3,
        sql_executions: 1,
        sandbox_executions: 1,
        series_rows: 10,
        group_rows: 0,
        elapsed_ms: 100,
      },
      terminal: "PARTIAL",
      limitation_codes: ["FORECAST_NOT_USEFUL"],
      completion_hash: hashes.execution,
    } as const;
    expect(analysisCompletionReceiptPayloadSchema.parse(base)).toEqual(base);
    expect(
      analysisCompletionReceiptPayloadSchema.safeParse({ ...base, terminal: "READY" }).success,
    ).toBe(false);
    const criticalSkipped = {
      ...base,
      node_results: [
        {
          ...base.node_results[0],
          status: "SKIPPED",
          evidence_ref: null,
          reason_codes: ["ANALYSIS_NODE_DEPENDENCY_FAILED"],
        },
      ],
      limitation_codes: ["ANALYSIS_NODE_DEPENDENCY_FAILED"],
    } as const;
    expect(
      analysisCompletionReceiptPayloadSchema.safeParse({
        ...criticalSkipped,
        terminal: "PARTIAL",
      }).success,
    ).toBe(false);
    expect(
      analysisCompletionReceiptPayloadSchema.safeParse({
        ...criticalSkipped,
        terminal: "HOLD",
      }).success,
    ).toBe(true);
  });

  it("retains exact derivation closure failures in completion receipts", () => {
    const completion = {
      artifact_type: "AnalysisCompletionReceipt",
      protocol_version: "analysis-completion@1.0.0",
      analysis_program_ref: reference("AnalysisProgram", 128),
      node_results: [
        {
          node_id: "generated-analysis",
          criticality: "CRITICAL",
          status: "FAILED",
          evidence_ref: null,
          reason_codes: ["RECEIPT_RUNTIME_MISMATCH", "RESULT_REFERENCE_CLOSURE_FAILED"],
        },
      ],
      budget_usage: {
        steps: 1,
        model_calls: 2,
        sql_executions: 1,
        sandbox_executions: 1,
        series_rows: 0,
        group_rows: 0,
        elapsed_ms: 100,
      },
      terminal: "HOLD",
      limitation_codes: ["RECEIPT_RUNTIME_MISMATCH", "RESULT_REFERENCE_CLOSURE_FAILED"],
      completion_hash: hashes.execution,
    } as const;
    expect(analysisCompletionReceiptPayloadSchema.parse(completion)).toEqual(completion);
  });

  it("keeps AtomicClaim@2 unchanged and fail-closes v3 causal language", () => {
    const association = {
      artifact_type: "AtomicClaim",
      protocol_version: "atomic-claim@3.0.0",
      claim_id: "association-1",
      observation_bindings: [analysisBinding("left"), analysisBinding("right")],
      predicate: { claim_mode: "ASSOCIATIVE", binding_ids: ["left", "right"] },
      statement: "两个指标存在统计关联",
      statement_hash: hashes.artifact,
      evidence_refs: [reference("DerivedAnalysisEvidence", 120)],
      limitations: [],
      disclosures: [],
    } as const;
    expect(atomicClaimV2PayloadSchema.safeParse(association).success).toBe(false);
    expect(atomicClaimV3PayloadSchema.safeParse(association).success).toBe(false);
    expect(
      atomicClaimV3PayloadSchema.safeParse({
        ...association,
        disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
      }).success,
    ).toBe(true);

    const fakeCausal = {
      ...association,
      claim_id: "causal-1",
      observation_bindings: [analysisBinding("effect")],
      predicate: { claim_mode: "CAUSAL_ESTIMATE", binding_ids: ["effect"] },
      evidence_refs: [reference("DerivedAnalysisEvidence", 120)],
      disclosures: ["CAUSAL_ESTIMATE_ASSUMPTION_BOUND"],
    } as const;
    expect(atomicClaimV3PayloadSchema.safeParse(fakeCausal).success).toBe(false);
    const causalRef = reference("CausalEstimate", 124);
    expect(
      atomicClaimV3PayloadSchema.safeParse({
        ...fakeCausal,
        observation_bindings: [analysisBinding("effect", causalRef)],
        evidence_refs: [causalRef],
      }).success,
    ).toBe(false);
    expect(
      atomicClaimV3PayloadSchema.safeParse({
        ...fakeCausal,
        observation_bindings: [analysisBinding("effect", causalRef)],
        evidence_refs: [causalRef],
        identification_certificate_ref: reference("IdentificationCertificate", 125),
      }).success,
    ).toBe(true);

    const acceptedAssociation = {
      ...association,
      disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
    } as const;
    const foreignEvidence = {
      ...acceptedAssociation.evidence_refs[0],
      run_id: uuid(999),
    };
    const crossRunClaim = {
      ...acceptedAssociation,
      observation_bindings: [
        analysisBinding("left", foreignEvidence),
        analysisBinding("right", foreignEvidence),
      ],
      evidence_refs: [foreignEvidence],
    } as const;
    expect(() =>
      parseL2ResearchDocumentCandidate({
        envelope: {
          ...makeArtifactEnvelope(),
          artifact_type: "AtomicClaim",
          schema_version: "3.0.0",
          input_refs: collectL2ResearchPayloadArtifactReferences(crossRunClaim),
        },
        payload: crossRunClaim,
      }),
    ).toThrow(/Artifact Reference 必须与 Envelope 属于同一/);
  });

  it("registers AnalysisProgram wire tuples and hashes canonical candidates deterministically", async () => {
    const payload = validPlan();
    const inputRefs = collectL2ResearchPayloadArtifactReferences(payload);
    const document = {
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_type: "AnalysisProgram",
        schema_version: "1.0.0",
        input_refs: inputRefs,
      },
      payload,
    } as const;
    expect(parseL2ResearchDocumentCandidate(document)).toEqual(document);
    const first = await computeL2ResearchEnvelopeContentHash(document);
    const second = await computeL2ResearchEnvelopeContentHash(structuredClone(document));
    expect(first).toBe(second);
    expect(() =>
      parseL2ResearchDocumentCandidate({
        ...document,
        envelope: { ...document.envelope, schema_version: "2.0.0" },
      }),
    ).toThrow(/L2_WIRE_VERSION_WRITE_UNSUPPORTED/);
  });

  it("keeps analysis report claim closure explicit", () => {
    const claimRef = reference("AtomicClaim", 125);
    const manifest = {
      artifact_type: "ReportManifest",
      protocol_version: "report-manifest@3.0.0",
      brief_ref: briefRef,
      analysis_program_ref: reference("AnalysisProgram", 126),
      completion_receipt_ref: reference("AnalysisCompletionReceipt", 127),
      sections: [
        {
          section_id: "EXECUTIVE_SUMMARY",
          claim_refs: [claimRef],
          discovery_candidate_refs: [],
          causal_estimate_refs: [],
          limitation_codes: [],
        },
      ],
      material_claim_refs: [claimRef],
      required_disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
      allowed_style_profile: "ZH_DETERMINISTIC_ANALYSIS_V1",
      manifest_hash: hashes.artifact,
    } as const;
    expect(reportManifestV3PayloadSchema.parse(manifest)).toEqual(manifest);
    expect(
      reportManifestV3PayloadSchema.safeParse({ ...manifest, material_claim_refs: [] }).success,
    ).toBe(false);
  });

  it("checks program, derived, and causal evidence through an explicit check-receipt version", () => {
    const receipt = {
      artifact_type: "EvidenceCheckReceipt",
      protocol_version: "evidence-check@2.0.0",
      relation_ref: reference("EvidenceRelation", 130),
      check_kind: "PROGRAM_CLOSURE_CHECK",
      verdict: "PASS",
      observed_contract_hash: hashes.artifact,
      evaluated_refs: [
        reference("AnalysisProgram", 131),
        reference("DerivedAnalysisEvidence", 132),
        reference("CausalEstimate", 133),
      ],
      reason_codes: [],
      evaluator_version: "analysis-evidence-checker@1.0.0",
      check_input_hash: hashes.input,
    } as const;
    expect(evidenceCheckReceiptV2PayloadSchema.parse(receipt)).toEqual(receipt);
    expect(
      evidenceCheckReceiptV2PayloadSchema.safeParse({
        ...receipt,
        evaluated_refs: [receipt.evaluated_refs[0], receipt.evaluated_refs[0]],
      }).success,
    ).toBe(false);
  });

  it("public analysis events expose only bounded accepted projection fields", () => {
    const event = {
      schema_version: "public-analysis-event@1.0.0",
      event_id: ids.receipt,
      run_id: ids.run,
      sequence: 1,
      occurred_at: timestamp,
      type: "analysis.node",
      payload: {
        plan_ref: reference("AnalysisProgram", 128),
        node_id: "trend",
        skill_id: "trend-change@1",
        status: "SUCCEEDED",
        summary: "趋势证据已接受",
        artifact_refs: [reference("DerivedAnalysisEvidence", 129)],
        reason_code: null,
      },
    } as const;
    expect(publicAnalysisRunEventV1Schema.parse(event)).toEqual(event);
    expect(
      publicAnalysisRunEventV1Schema.safeParse({
        ...event,
        payload: { ...event.payload, stdout: "secret" },
      }).success,
    ).toBe(false);
    expect(
      publicAnalysisRunEventV1Schema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          plan_ref: { ...event.payload.plan_ref, run_id: uuid(999) },
        },
      }).success,
    ).toBe(false);
  });
});
