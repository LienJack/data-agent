import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type ArtifactReference,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ResearchEnvelopeContentHash,
  type DerivedAnalysisEvidencePayload,
  parseL2ResearchDocumentCandidate,
} from "@data-agent/contracts";
import { analysisResultContractFixture } from "@data-agent/contracts/testing";
import { describe, expect, it } from "vitest";
import { projectArtifactDocument } from "../../src/artifacts/artifact-workspace-service.js";
import {
  buildDerivedAnalysisChartDocument,
  buildDeterministicAnalysisRunProjection,
} from "../../src/artifacts/derived-analysis-projection.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function ref<const T extends ArtifactReference["artifact_type"]>(
  artifact_type: T,
  suffix: number,
  content_hash = hash(String(suffix % 10)),
): ArtifactReference & { readonly artifact_type: T } {
  return {
    artifact_id: id(suffix),
    artifact_type,
    app_id: id(1),
    tenant_id: id(2),
    environment: "test",
    run_id: id(3),
    revision: 1,
    content_hash,
  };
}

async function researchDocument(
  payload:
    | AnalysisProgramPayload
    | DerivedAnalysisEvidencePayload
    | AnalysisCompletionReceiptPayload,
  suffix: number,
  schemaVersion: string,
) {
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: id(suffix),
      artifact_type: payload.artifact_type,
      app_id: id(1),
      tenant_id: id(2),
      environment: "test",
      run_id: id(3),
      revision: 1,
      parent_ref: null,
      attempt_id: id(99),
      producer: { kind: "deterministic", id: "derived-analysis-test@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(payload),
      schema_version: schemaVersion,
      semantic_version: "1.0.0",
      policy_version: "analysis-program-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "CANDIDATE",
      created_at: "2026-08-25T00:00:00.000Z",
    },
    payload,
  });
  return parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
}

function researchRef(document: Awaited<ReturnType<typeof researchDocument>>) {
  return ref(
    document.envelope.artifact_type,
    Number(document.envelope.artifact_id.slice(-12)),
    document.envelope.content_hash,
  );
}

async function fixture(result?: DerivedAnalysisEvidencePayload["result"]) {
  const plan: AnalysisProgramPayload = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: ref("ResearchBrief", 4),
    analysis_context_hash: hash("a"),
    semantic_context_package_hash: hash("0"),
    operator_registry_digest: hash("2"),
    nodes: [
      {
        node_id: "trend",
        skill_id: "trend-change@1",
        metric_refs: [],
        dimension_refs: [],
        time_window: {
          start: "2026-01-01T00:00:00.000Z",
          end: "2026-03-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {},
        execution_mode: "MODEL_GENERATED",
        generated_source_policy: "OPEN_ANALYSIS",
        operator_obligations: [],
        result_contract: analysisResultContractFixture({
          semantic_context_hash: hash("0"),
          contract_id: "trend.result",
        }),
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 10,
      max_group_rows: 10,
      max_elapsed_ms: 1_000,
    },
    compiler_kind: "DETERMINISTIC_DEFAULT",
    compiler_version: "planner-v1",
    program_hash: hash("b"),
  };
  const planDocument = await researchDocument(plan, 5, "1.0.0");
  const planRef = researchRef(planDocument) as ArtifactReference & {
    readonly artifact_type: "AnalysisProgram";
  };
  const evidence: DerivedAnalysisEvidencePayload = {
    artifact_type: "DerivedAnalysisEvidence",
    protocol_version: "derived-analysis-evidence@2.0.0",
    analysis_program_ref: planRef,
    node_id: "trend",
    skill_id: "trend-change@1",
    algorithm_version: "trend-v1",
    query_evidence_refs: [ref("QueryEvidence", 6)],
    sandbox_execution_receipt_ref: ref("SandboxExecutionReceipt", 8),
    sandbox_result_refs: [ref("SandboxResult", 9)],
    runtime_profile: "CORE_ANALYSIS",
    agent_image: "data-agent-opensandbox-agent-core@sha256:test",
    operator_image: "data-agent-opensandbox-operator@sha256:test",
    generated_source_policy: "OPEN_ANALYSIS",
    operator_registry_digest: plan.operator_registry_digest,
    operator_obligations: [],
    operator_receipt_closure_hash: hash("2"),
    parameter_hash: hash("e"),
    input_closure_hash: hash("f"),
    result:
      result ??
      ({
        result_kind: "TREND_CHANGE",
        points: [
          {
            period_start: "2026-01-01T00:00:00.000Z",
            value: 10,
            absolute_delta: null,
            relative_delta: null,
          },
          {
            period_start: "2026-02-01T00:00:00.000Z",
            value: 12,
            absolute_delta: 2,
            relative_delta: 0.2,
          },
        ],
        first_value: 10,
        last_value: 12,
      } as const),
    quality: {
      oracle_verdict: "PASS",
      deterministic_replay: "PASS",
      sample_size: 2,
      coverage_ratio: 1,
    },
    limitation_codes: [],
    mandatory_disclosures: [],
    derivation_hash: hash("1"),
  };
  const evidenceDocument = await researchDocument(evidence, 10, "2.0.0");
  const evidenceRef = researchRef(evidenceDocument) as ArtifactReference & {
    readonly artifact_type: "DerivedAnalysisEvidence";
  };
  const completion: AnalysisCompletionReceiptPayload = {
    artifact_type: "AnalysisCompletionReceipt",
    protocol_version: "analysis-completion@1.0.0",
    analysis_program_ref: planRef,
    node_results: [
      {
        node_id: "trend",
        criticality: "CRITICAL",
        status: "SUCCEEDED",
        evidence_ref: evidenceRef,
        reason_codes: [],
      },
    ],
    budget_usage: {
      steps: 1,
      model_calls: 3,
      sql_executions: 1,
      sandbox_executions: 1,
      series_rows: 2,
      group_rows: 0,
      elapsed_ms: 10,
    },
    terminal: "READY",
    limitation_codes: [],
    completion_hash: hash("2"),
  };
  const completionDocument = await researchDocument(completion, 11, "1.0.0");
  return {
    plan,
    planDocument,
    planRef,
    evidence,
    evidenceDocument,
    evidenceRef,
    completion,
    completionDocument,
    completionRef: researchRef(completionDocument),
  };
}

describe("Derived analysis projection", () => {
  it("preserves missing trend periods and unknown deltas in both chart and preview", async () => {
    const points = [
      {
        period_start: "2026-01-01T00:00:00.000Z",
        value: 10,
        absolute_delta: null,
        relative_delta: null,
      },
      {
        period_start: "2026-02-01T00:00:00.000Z",
        value: null,
        absolute_delta: null,
        relative_delta: null,
      },
      {
        period_start: "2026-03-01T00:00:00.000Z",
        value: 12,
        absolute_delta: null,
        relative_delta: null,
      },
    ];
    const input = await fixture({
      result_kind: "TREND_CHANGE",
      points,
      first_value: 10,
      last_value: 12,
    });
    const chart = await buildDerivedAnalysisChartDocument({
      document_ref: ref("ArtifactWorkspaceDocument", 12),
      evidence_document: input.evidenceDocument,
      semantic_context: {
        package_id: id(13),
        package_hash: hash("3"),
        receipt_id: id(14),
        receipt_hash: hash("4"),
      },
    });
    if (!chart) throw new Error("expected chart");
    const expected = points.map(({ period_start, value, absolute_delta }) => ({
      period_start,
      value,
      absolute_delta,
    }));
    expect(chart.provenance.transform_version).toBe("derived-analysis-chart@1.1.0");
    expect(chart.projection.table).toMatchObject({ rows: expected, total_rows: 3 });
    const preview = await projectArtifactDocument(chart, chart.document_ref, {
      offset: 0,
      limit: 100,
    });
    expect(preview.projection).toEqual(chart.projection);
    expect(input.evidence.result).toEqual({
      result_kind: "TREND_CHANGE",
      points,
      first_value: 10,
      last_value: 12,
    });
  });

  it("does not publish a trend chart when every value is missing", async () => {
    const input = await fixture({
      result_kind: "TREND_CHANGE",
      points: [
        {
          period_start: "2026-01-01T00:00:00.000Z",
          value: null,
          absolute_delta: null,
          relative_delta: null,
        },
      ],
      first_value: null,
      last_value: null,
    });
    await expect(
      buildDerivedAnalysisChartDocument({
        document_ref: ref("ArtifactWorkspaceDocument", 12),
        evidence_document: input.evidenceDocument,
        semantic_context: {
          package_id: id(13),
          package_hash: hash("3"),
          receipt_id: id(14),
          receipt_hash: hash("4"),
        },
      }),
    ).resolves.toBeNull();
  });

  it("seals a V3 chart and public preview to the same accepted evidence", async () => {
    const input = await fixture();
    const chart = await buildDerivedAnalysisChartDocument({
      document_ref: ref("ArtifactWorkspaceDocument", 12),
      evidence_document: input.evidenceDocument,
      semantic_context: {
        package_id: id(13),
        package_hash: hash("3"),
        receipt_id: id(14),
        receipt_hash: hash("4"),
      },
      unit: "元",
    });
    if (!chart) throw new Error("expected chart");
    const preview = await projectArtifactDocument(chart, chart.document_ref, {
      offset: 0,
      limit: 100,
    });
    expect(preview).toMatchObject({
      schema_version: "artifact-preview-result@3.0.0",
      source_refs: { derived_evidence_ref: input.evidenceRef },
      projection: { chart_type: "LINE", evidence_level: "L2_OBSERVATION" },
    });
  });

  it("retains signed contribution and deterministically suppresses a failed forecast", async () => {
    const contribution = await fixture({
      result_kind: "CONTRIBUTION_CONCENTRATION",
      groups: [
        {
          group_key_hash: hash("5"),
          baseline: 10,
          current: 7,
          signed_delta: -3,
          change_share: 1,
        },
      ],
      residual: 0,
      closure_tolerance: 1e-9,
      hhi: 1,
    });
    const chart = await buildDerivedAnalysisChartDocument({
      document_ref: ref("ArtifactWorkspaceDocument", 15),
      evidence_document: contribution.evidenceDocument,
      semantic_context: {
        package_id: id(13),
        package_hash: hash("3"),
        receipt_id: id(14),
        receipt_hash: hash("4"),
      },
    });
    expect(chart?.projection).toMatchObject({
      chart_type: "SIGNED_CONTRIBUTION",
      table: { rows: [{ group_key_hash: hash("5"), signed_delta: -3 }] },
    });
    expect(JSON.stringify(chart)).not.toContain("customer@example.com");

    const forecast = await fixture({
      result_kind: "BASELINE_FORECAST_BACKTEST",
      selected_model: null,
      baseline_model: "seasonal-naive-v1",
      horizon: 0,
      mae: null,
      mase: null,
      useful: false,
      forecast_rows_ref: null,
      backtest_hash: hash("6"),
    });
    await expect(
      buildDerivedAnalysisChartDocument({
        document_ref: ref("ArtifactWorkspaceDocument", 16),
        evidence_document: forecast.evidenceDocument,
        semantic_context: {
          package_id: id(13),
          package_hash: hash("3"),
          receipt_id: id(14),
          receipt_hash: hash("4"),
        },
      }),
    ).resolves.toBeNull();
  });

  it("builds a replay-stable public run projection and rejects uncommitted evidence", async () => {
    const input = await fixture();
    const projectionInput = {
      analysis_program_document: input.planDocument,
      completion_document: input.completionDocument,
      evidence_documents: [{ document: input.evidenceDocument }],
      findings: [
        {
          finding_id: "fact-1",
          tier: "FACT" as const,
          statement: "指标从 10 变为 12",
          evidence_ref: input.evidenceRef,
          evidence_level: "L2_OBSERVATION" as const,
          status: "ACCEPTED" as const,
          disclosure_codes: [],
        },
      ],
    };
    const first = await buildDeterministicAnalysisRunProjection(projectionInput);
    const replay = await buildDeterministicAnalysisRunProjection(projectionInput);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ terminal: "READY", root_cause: { level: "NONE" } });
    expect(JSON.stringify(first)).not.toMatch(
      /source_text|stdout|stderr|private_reasoning|raw_rows/u,
    );

    await expect(
      buildDeterministicAnalysisRunProjection({
        ...projectionInput,
        evidence_documents: [
          {
            document: {
              ...input.evidenceDocument,
              envelope: { ...input.evidenceDocument.envelope, content_hash: hash("9") },
            },
          },
        ],
      }),
    ).rejects.toThrow("ANALYSIS_RUN_PROJECTION_REFERENCE_INVALID");
  });
});
