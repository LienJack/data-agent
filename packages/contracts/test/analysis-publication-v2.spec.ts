import { describe, expect, it } from "vitest";
import {
  type AnalysisCompletionReceiptPayload,
  analysisCompletionReceiptPayloadSchema,
  buildAnalysisAuthorityCommit,
  buildAnalysisContextJournalAppend,
  buildAnalysisOracleReceipt,
  buildAnalysisPublicationV2Command,
  buildArtifactWorkspaceChartDocumentV3,
  buildProductTeamArtifactDocument,
  collectL2ResearchPayloadArtifactReferences,
  computeArtifactWorkspaceChartDatasetV3Hash,
  computeL2ResearchEnvelopeContentHash,
  type DerivedAnalysisEvidencePayload,
  derivedAnalysisEvidencePayloadSchema,
  parseL2ResearchDocumentCandidate,
  researchArtifactCommitInputSchema,
  sha256ContentHash,
} from "../src/index.js";

const id = (suffix: number) => `91500000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const attemptId = id(4);
const principalId = id(5);

function reference<const T extends string>(
  artifact_type: T,
  suffix: number,
  content_hash = hash(String(suffix % 10)),
) {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  } as const;
}

async function researchCommand(input: {
  readonly payload: DerivedAnalysisEvidencePayload | AnalysisCompletionReceiptPayload;
  readonly artifact_id: string;
  readonly idempotency_key: string;
}) {
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: input.artifact_id,
      artifact_type: input.payload.artifact_type,
      ...scope,
      run_id: runId,
      revision: 1,
      parent_ref: null,
      attempt_id: attemptId,
      producer: { kind: "deterministic", id: "analysis-publication-test@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(input.payload),
      schema_version: input.payload.artifact_type === "DerivedAnalysisEvidence" ? "2.0.0" : "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "analysis-program-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "CANDIDATE",
      created_at: "2026-08-30T00:00:00.000Z",
    },
    payload: input.payload,
  });
  const candidate = parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
  return researchArtifactCommitInputSchema.parse({
    schema_version: "1.0.0",
    scope,
    run_id: runId,
    principal_id: principalId,
    idempotency_key: input.idempotency_key,
    commit_id: id(input.payload.artifact_type === "DerivedAnalysisEvidence" ? 83 : 84),
    attempt_id: attemptId,
    worker_fence: 7,
    candidate,
    expected_parent_ref: null,
  });
}

describe("Falcon24 analysis publication V2", () => {
  it("builds a hash-bound command from one valid READY publication material", async () => {
    const analysisProgramRef = reference("AnalysisProgram", 10);
    const queryEvidenceRef = reference("QueryEvidence", 11);
    const sandboxResultRefs = [
      reference("SandboxResult", 20),
      reference("SandboxResult", 21),
      reference("SandboxResult", 22),
    ] as const;
    const sandboxPayload = {
      schema_version: "analysis-sandbox-execution-receipt@1.0.0",
    };
    const sandboxReceiptHash = await sha256ContentHash(sandboxPayload);
    const sandboxReceiptRef = reference("SandboxExecutionReceipt", 23, sandboxReceiptHash);
    const evidence = derivedAnalysisEvidencePayloadSchema.parse({
      artifact_type: "DerivedAnalysisEvidence",
      protocol_version: "derived-analysis-evidence@2.0.0",
      analysis_program_ref: analysisProgramRef,
      node_id: "trend",
      skill_id: "trend-change@1",
      algorithm_version: "trend-change@1.0.0",
      query_evidence_refs: [queryEvidenceRef],
      sandbox_execution_receipt_ref: sandboxReceiptRef,
      sandbox_result_refs: sandboxResultRefs,
      runtime_profile: "CORE_ANALYSIS",
      agent_image: "agent@sha256:test",
      operator_image: "operator@sha256:test",
      generated_source_policy: "NO_GENERATED_SOURCE",
      operator_registry_digest: hash("a"),
      operator_obligations: [],
      operator_receipt_closure_hash: hash("b"),
      parameter_hash: hash("c"),
      input_closure_hash: hash("d"),
      result: {
        result_kind: "TREND_CHANGE",
        points: [
          {
            period_start: "2026-01-01T00:00:00.000Z",
            value: 10,
            absolute_delta: null,
            relative_delta: null,
          },
        ],
        first_value: 10,
        last_value: 10,
      },
      quality: {
        oracle_verdict: "PASS",
        deterministic_replay: "PASS",
        sample_size: 1,
        coverage_ratio: 1,
      },
      limitation_codes: [],
      mandatory_disclosures: [],
      derivation_hash: hash("e"),
    });
    const evidenceCommand = await researchCommand({
      payload: evidence,
      artifact_id: id(80),
      idempotency_key: "analysis-evidence:trend",
    });
    const evidenceRef = reference(
      "DerivedAnalysisEvidence",
      80,
      evidenceCommand.candidate.envelope.content_hash as `sha256:${string}`,
    );
    const completion = analysisCompletionReceiptPayloadSchema.parse({
      artifact_type: "AnalysisCompletionReceipt",
      protocol_version: "analysis-completion@1.0.0",
      analysis_program_ref: analysisProgramRef,
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
        model_calls: 1,
        sql_executions: 0,
        sandbox_executions: 1,
        series_rows: 1,
        group_rows: 0,
        elapsed_ms: 10,
      },
      terminal: "READY",
      limitation_codes: [],
      completion_hash: hash("f"),
    });
    const completionCommand = await researchCommand({
      payload: completion,
      artifact_id: id(81),
      idempotency_key: "analysis-completion:ready",
    });
    const completionRef = reference(
      "AnalysisCompletionReceipt",
      81,
      completionCommand.candidate.envelope.content_hash as `sha256:${string}`,
    );
    const chart = await buildArtifactWorkspaceChartDocumentV3({
      schema_version: "artifact-workspace-chart-document@3.0.0",
      document_ref: reference("ArtifactWorkspaceDocument", 82, hash("0")),
      source_refs: {
        query_evidence_refs: [queryEvidenceRef],
        derived_evidence_ref: evidenceRef,
      },
      provenance: {
        transform_version: "derived-analysis-chart@1.0.0",
        dataset_hash: hash("0"),
        semantic_context: {
          package_id: id(90),
          package_hash: hash("1"),
          receipt_id: id(91),
          receipt_hash: hash("2"),
        },
        algorithm_version: "trend-change@1.0.0",
        parameter_hash: evidence.parameter_hash,
        input_closure_hash: evidence.input_closure_hash,
        runtime_profile: evidence.runtime_profile,
        agent_image: evidence.agent_image,
        operator_image: evidence.operator_image,
      },
      projection: {
        kind: "CHART",
        chart_type: "LINE",
        title: "月度收入趋势",
        description: null,
        unit: null,
        x_key: "period",
        y_keys: ["value"],
        lower_bound_key: null,
        upper_bound_key: null,
        series_key: null,
        legend: { visible: false },
        evidence_level: "L2_OBSERVATION",
        table: {
          kind: "TABLE",
          columns: [
            { key: "period", label: "月份", data_type: "STRING" },
            { key: "value", label: "收入", data_type: "NUMBER" },
          ],
          rows: [{ period: "2026-01-01", value: 10 }],
          total_rows: 1,
        },
      },
    });
    const oracle = await buildAnalysisOracleReceipt({
      schema_version: "analysis-oracle-receipt@1.0.0",
      oracle_id: id(30),
      scope,
      run_id: runId,
      node_id: "trend",
      analysis_program_ref: analysisProgramRef,
      implementation_id: "independent-analysis-oracle@1.0.0",
      implementation_hash: hash("3"),
      input_binding: {
        query_evidence_refs: [queryEvidenceRef],
        input_materialization_closure_hash: evidence.input_closure_hash,
        stage_id: id(31),
        stage_hash: hash("4"),
        published_closure_hash: hash("5"),
        operator_receipt_closure_hash: evidence.operator_receipt_closure_hash,
        sandbox_receipt_hash: sandboxReceiptRef.content_hash,
        chart_dataset_hashes: [await computeArtifactWorkspaceChartDatasetV3Hash(chart.projection)],
      },
      verdict: "PASS",
      expected_terminal: "READY",
      sample_size: 1,
      coverage_ratio: 1,
      limitation_codes: [],
      disclosure_codes: [],
      verified_at: "2026-08-30T00:00:00.000Z",
    });
    const stageArtifacts = [
      {
        artifact_name: "result",
        artifact_kind: "RESULT" as const,
        media_type: "application/json" as const,
        content_sha256: sandboxResultRefs[0].content_hash,
        bytes: 128,
      },
      {
        artifact_name: "table:trend",
        artifact_kind: "TABLE" as const,
        media_type: "application/json" as const,
        content_sha256: sandboxResultRefs[1].content_hash,
        bytes: 128,
      },
      {
        artifact_name: "chart:trend",
        artifact_kind: "CHART" as const,
        media_type: "application/json" as const,
        content_sha256: sandboxResultRefs[2].content_hash,
        bytes: 128,
      },
    ] as const;
    const explanation = {
      schema_version: "analysis-agent-final@1.0.0" as const,
      summary_zh: "趋势及图表已通过独立 Oracle 验证。",
    };
    const oraclePayload = { oracle_receipt: oracle };
    const authorityCommit = await buildAnalysisAuthorityCommit({
      schema_version: "analysis-authority-commit@1.0.0",
      scope,
      run_id: runId,
      principal_id: principalId,
      node_id: "trend",
      attempt_id: attemptId,
      worker_fence: 7,
      idempotency_key: "analysis-authority:trend",
      analysis_program_ref: analysisProgramRef,
      stage_id: oracle.input_binding.stage_id,
      stage_hash: oracle.input_binding.stage_hash,
      closure_hash: oracle.input_binding.published_closure_hash,
      operator_receipt_closure_hash: oracle.input_binding.operator_receipt_closure_hash,
      oracle_receipt_payload: oraclePayload,
      oracle_receipt_hash: await sha256ContentHash(oraclePayload),
      explanation,
      explanation_hash: await sha256ContentHash(explanation),
      output_bindings: [
        { stage_artifact: stageArtifacts[0], reference: sandboxResultRefs[0] },
        { stage_artifact: stageArtifacts[1], reference: sandboxResultRefs[1] },
        { stage_artifact: stageArtifacts[2], reference: sandboxResultRefs[2] },
      ],
      sandbox_receipt_ref: sandboxReceiptRef,
      sandbox_receipt_payload: sandboxPayload,
      sandbox_receipt_hash: sandboxReceiptHash,
      public_event_id: id(32),
    });
    const journalCommand = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope,
      run_id: runId,
      principal_id: principalId,
      node_id: "trend",
      attempt_id: attemptId,
      context_generation: 1,
      worker_fence: 7,
      expected_prev_seq: 1,
      expected_prev_entry_hash: hash("6"),
      runtime_digest: hash("7"),
      policy_version: "analysis-cell-policy@1.1.0",
      operator_registry_digest: evidence.operator_registry_digest,
      event: {
        event_type: "AUTHORITY_COMMITTED",
        stage_id: authorityCommit.stage_id,
        authority_commit_hash: authorityCommit.authority_commit_hash,
      },
    });
    const report = await buildProductTeamArtifactDocument({
      schema_version: "product-team-artifact@2.0.0",
      artifact_ref: reference("AnalysisReport", 85, hash("0")),
      profile_id: "governed-analysis-agent",
      task_id: id(86),
      source_refs: [evidenceRef, completionRef, chart.document_ref],
      provenance: null,
      projection: {
        kind: "REPORT",
        title: "受治理数据分析",
        sections: [
          {
            heading: "结论",
            body_text: explanation.summary_zh,
            source_refs: [evidenceRef, chart.document_ref],
          },
        ],
      },
      committed_at: "2026-08-30T00:00:00.000Z",
    });

    await expect(
      buildAnalysisPublicationV2Command({
        schema_version: "falcon24-analysis-publication@2.0.0",
        scope,
        run_id: runId,
        principal_id: principalId,
        attempt_id: attemptId,
        worker_fence: 7,
        idempotency_key: "falcon24-analysis-publication:test",
        analysis_program_ref: analysisProgramRef,
        nodes: [
          {
            authority_commit: authorityCommit,
            journal_command: journalCommand,
            oracle_receipt: oracle,
          },
        ],
        l2_artifact_commands: [evidenceCommand, completionCommand],
        chart_documents: [chart],
        report_document: report,
        public_event_id: id(87),
        authority: {
          schema_version: "falcon24-authority-binding@2.0.0",
          authority_epoch: "E2",
          baseline_id: id(88),
          baseline_hash: hash("8"),
          activation_attempt_id: id(89),
        },
      }),
    ).resolves.toMatchObject({
      schema_version: "falcon24-analysis-publication@2.0.0",
      publication_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });
});
