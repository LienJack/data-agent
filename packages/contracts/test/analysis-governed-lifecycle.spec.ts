import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../src/common/index.js";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "../src/generated/statistical-operators.js";
import {
  analysisResultStageArtifactSchema,
  analysisResultStageCleanupCommandSchema,
  analysisResultStageCleanupReceiptSchema,
  assertAnalysisContextJournalTransition,
  buildAnalysisAuthorityCommit,
  buildAnalysisContextJournalAppend,
  buildAnalysisContextJournalEntryHash,
  buildAnalysisOracleReceipt,
  buildAnalysisResultStageCommand,
  buildGovernedOperatorResultCommit,
  verifyAnalysisAuthorityCommit,
  verifyAnalysisContextJournalAppend,
  verifyAnalysisContextJournalEntry,
  verifyAnalysisOracleReceipt,
  verifyAnalysisResultStageCommand,
  verifyGovernedOperatorResultCommit,
} from "../src/ports/index.js";

const id = (suffix: number) => `91000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const attemptId = id(4);

function reference<
  const T extends "AnalysisProgram" | "QueryEvidence" | "SandboxResult" | "SandboxExecutionReceipt",
>(artifact_type: T, suffix: number, content_hash: `sha256:${string}`) {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  } as const;
}

async function governedResult() {
  const receiptPayload = { status: "SUCCEEDED", call_id: "call-1" };
  const receiptHash = await sha256ContentHash(receiptPayload);
  const resultHash = hash("a");
  const result = {
    schema_version: "governed-operator-result-ref@1.0.0" as const,
    scope,
    run_id: runId,
    node_id: "question-1",
    attempt_id: attemptId,
    context_generation: 1,
    call_id: "call-1",
    operator_id: "shapley.decomposition@1",
    program_hash: hash("b"),
    request_sha256: hash("c"),
    result_artifact_ref: reference("SandboxResult", 5, resultHash),
    result_sha256: resultHash,
    result_bytes: 128,
    shape: { kind: "MAPPING" as const, keys: 3, bounded_summary: "three factors" },
    receipt_ref: reference("SandboxExecutionReceipt", 6, receiptHash),
    worker_fence: 7,
  };
  return {
    result,
    commit: await buildGovernedOperatorResultCommit({
      schema_version: "governed-operator-result-commit@1.0.0",
      principal_id: id(9),
      result,
      idempotency_key: "operator-result:call-1",
      operator_registry_digest: hash("d"),
      result_receipt_payload: receiptPayload,
      result_receipt_hash: receiptHash,
    }),
  };
}

async function stage() {
  const governed = await governedResult();
  const artifacts = [
    {
      artifact_name: "result",
      artifact_kind: "RESULT" as const,
      media_type: "application/json" as const,
      content_sha256: hash("1"),
      bytes: 128,
    },
    {
      artifact_name: "table:trend",
      artifact_kind: "TABLE" as const,
      media_type: "application/json" as const,
      content_sha256: hash("2"),
      bytes: 256,
    },
    {
      artifact_name: "chart:trend",
      artifact_kind: "CHART" as const,
      media_type: "application/json" as const,
      content_sha256: hash("3"),
      bytes: 256,
    },
  ];
  const closureHash = hash("4");
  const command = await buildAnalysisResultStageCommand({
    schema_version: "analysis-result-stage-command@1.0.0",
    scope,
    run_id: runId,
    principal_id: id(9),
    node_id: "question-1",
    attempt_id: attemptId,
    context_generation: 1,
    worker_fence: 7,
    idempotency_key: "analysis-stage:question-1",
    stage_id: id(7),
    publish_id: "publish-question-1",
    contract_hash: hash("5"),
    manifest_hash: hash("6"),
    closure_hash: closureHash,
    analytical_value_hashes: [{ symbol_name: "result_document", value_hash: hash("7") }],
    governed_operator_results: [governed.result],
    operator_finalization: {
      schema_version: "statistical-operator-finalization-result@1.0.0",
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      operator_receipts: [],
      operator_receipt_closure_hash: hash("8"),
    },
    execution_snapshot: {
      schema_version: "analysis-result-stage-execution-snapshot@1.0.0",
      request_hash: hash("9"),
      runtime_profile: "CORE_ANALYSIS",
      runtime: {
        agent_image: "agent@sha256:test",
        operator_image: "operator@sha256:test",
        agent_sandbox_id: "agent-1",
        operator_sandbox_id: "operator-1",
        secure_access: true,
      },
      cells: [],
      provider_invocation_refs: [],
      started_at: "2026-08-24T00:00:00.000Z",
      finished_at: "2026-08-24T00:00:01.000Z",
      elapsed_ms: 1_000,
    },
    artifacts,
    expires_at: "2026-08-25T00:00:00.000Z",
  });
  return { governed, command, artifacts };
}

describe("governed analysis lifecycle contracts", () => {
  it("hashes an independent Oracle receipt without admitting sealed material", async () => {
    const receipt = await buildAnalysisOracleReceipt({
      schema_version: "analysis-oracle-receipt@1.0.0",
      oracle_id: id(50),
      scope,
      run_id: runId,
      node_id: "question-1",
      analysis_program_ref: reference("AnalysisProgram", 10, hash("a")),
      implementation_id: "independent-analysis-oracle@1",
      implementation_hash: hash("b"),
      input_binding: {
        query_evidence_refs: [reference("QueryEvidence", 51, hash("c"))],
        input_materialization_closure_hash: hash("d"),
        stage_id: id(7),
        stage_hash: hash("e"),
        published_closure_hash: hash("f"),
        operator_receipt_closure_hash: hash("1"),
        sandbox_receipt_hash: hash("2"),
        chart_dataset_hashes: [hash("3")],
      },
      verdict: "PASS",
      expected_terminal: "READY",
      sample_size: 12,
      coverage_ratio: 1,
      limitation_codes: [],
      disclosure_codes: ["QUALITY_HOLDS_DISCLOSED"],
      verified_at: "2026-08-24T00:00:00.000Z",
    });

    await expect(verifyAnalysisOracleReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyAnalysisOracleReceipt({ ...receipt, sample_size: receipt.sample_size + 1 }),
    ).rejects.toThrow("ANALYSIS_ORACLE_RECEIPT_HASH_MISMATCH");
    await expect(
      buildAnalysisOracleReceipt({
        ...receipt,
        sealed_material: { raw_rows: [{ target: 42 }], stdout: "/sandbox/private" },
      } as never),
    ).rejects.toThrow();
    expect(JSON.stringify(receipt)).not.toMatch(
      /raw_rows|sealed_material|stdout|credential|target/u,
    );
  });

  it("rejects a staged closure artifact at the 64 MiB plus one boundary", () => {
    expect(
      analysisResultStageArtifactSchema.safeParse({
        artifact_name: "oversized-chart",
        artifact_kind: "CHART",
        media_type: "application/json",
        content_sha256: hash("f"),
        bytes: 64 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });

  it("freezes governed operator result and receipt hashes", async () => {
    const { commit } = await governedResult();
    await expect(verifyGovernedOperatorResultCommit(commit)).resolves.toEqual(commit);
    await expect(
      verifyGovernedOperatorResultCommit({
        ...commit,
        result_receipt_payload: { status: "DRIFT" },
      }),
    ).rejects.toThrow("GOVERNED_OPERATOR_RESULT_RECEIPT_HASH_MISMATCH");
  });

  it("hashes journal appends and rejects illegal lifecycle transitions", async () => {
    const command = await buildAnalysisContextJournalAppend({
      schema_version: "analysis-context-journal-append@1.0.0",
      scope,
      run_id: runId,
      principal_id: id(9),
      node_id: "question-1",
      attempt_id: attemptId,
      context_generation: 1,
      worker_fence: 7,
      expected_prev_seq: 0,
      expected_prev_entry_hash: null,
      runtime_digest: hash("7"),
      policy_version: "analysis-cell-policy@1",
      operator_registry_digest: hash("8"),
      event: {
        event_type: "MODEL_CELL_COMMITTED",
        cell_id: "cell-1",
        source_ref: reference("SandboxResult", 8, hash("9")),
        source_sha256: hash("9"),
        timeout_ms: 30_000,
      },
    });
    await expect(verifyAnalysisContextJournalAppend(command)).resolves.toEqual(command);
    const entry = {
      ...command,
      schema_version: "analysis-context-journal-entry@1.0.0" as const,
      seq: 1,
      prev_entry_hash: null,
      entry_hash: await buildAnalysisContextJournalEntryHash(command, 1, null),
      created_at: "2026-08-24T00:00:00.000Z",
    };
    await expect(verifyAnalysisContextJournalEntry(entry)).resolves.toEqual(entry);
    await expect(
      verifyAnalysisContextJournalEntry({ ...entry, entry_hash: hash("f") }),
    ).rejects.toThrow("ANALYSIS_CONTEXT_JOURNAL_ENTRY_HASH_MISMATCH");
    expect(() =>
      assertAnalysisContextJournalTransition(null, "MODEL_CELL_COMMITTED"),
    ).not.toThrow();
    expect(() =>
      assertAnalysisContextJournalTransition("OPERATOR_RESULT_COMMITTED", "PUBLISH_STAGE_CREATED"),
    ).toThrow("ANALYSIS_CONTEXT_JOURNAL_TRANSITION_INVALID");
  });

  it("binds Publisher closure to a durable stage", async () => {
    const { command } = await stage();
    await expect(verifyAnalysisResultStageCommand(command)).resolves.toEqual(command);
    await expect(
      verifyAnalysisResultStageCommand({ ...command, closure_hash: hash("0") }),
    ).rejects.toThrow();
  });

  it("bounds an idempotent expired-stage cleanup batch and closes its deleted references", () => {
    const command = analysisResultStageCleanupCommandSchema.parse({
      schema_version: "analysis-result-stage-cleanup@1.0.0",
      scope,
      principal_id: id(9),
      cleanup_id: id(40),
      idempotency_key: "analysis-stage-cleanup:test",
      requested_limit: 100,
    });
    expect(command.requested_limit).toBe(100);
    expect(() =>
      analysisResultStageCleanupCommandSchema.parse({ ...command, requested_limit: 101 }),
    ).toThrow();
    expect(
      analysisResultStageCleanupReceiptSchema.parse({
        schema_version: "analysis-result-stage-cleanup-receipt@1.0.0",
        scope,
        principal_id: id(9),
        cleanup_id: id(40),
        idempotency_key: command.idempotency_key,
        requested_limit: command.requested_limit,
        cutoff_at: "2026-08-25T00:00:00.000Z",
        deleted_count: 1,
        deleted_stages: [
          {
            run_id: runId,
            node_id: "question-1",
            attempt_id: attemptId,
            context_generation: 1,
            stage_id: id(41),
            stage_hash: hash("a"),
            expires_at: "2026-08-24T00:00:00.000Z",
          },
        ],
        receipt_hash: hash("b"),
      }).deleted_count,
    ).toBe(1);
    expect(() =>
      analysisResultStageCleanupReceiptSchema.parse({
        schema_version: "analysis-result-stage-cleanup-receipt@1.0.0",
        scope,
        principal_id: id(9),
        cleanup_id: id(40),
        idempotency_key: command.idempotency_key,
        requested_limit: command.requested_limit,
        cutoff_at: "2026-08-25T00:00:00.000Z",
        deleted_count: 0,
        deleted_stages: [
          {
            run_id: runId,
            node_id: "question-1",
            attempt_id: attemptId,
            context_generation: 1,
            stage_id: id(41),
            stage_hash: hash("a"),
            expires_at: "2026-08-24T00:00:00.000Z",
          },
        ],
        receipt_hash: hash("b"),
      }),
    ).toThrow();
  });

  it("binds verified stage, Oracle, explanation, outputs, receipt and public event atomically", async () => {
    const staged = await stage();
    const receiptPayload = { schema_version: "analysis-sandbox-execution-receipt@1.0.0" };
    const receiptHash = await sha256ContentHash(receiptPayload);
    const oraclePayload = { verdict: "PASS" };
    const explanation = {
      schema_version: "analysis-agent-final@1.0.0" as const,
      summary_zh: "结果和图表已通过独立校验。",
    };
    const command = await buildAnalysisAuthorityCommit({
      schema_version: "analysis-authority-commit@1.0.0",
      scope,
      run_id: runId,
      principal_id: id(9),
      node_id: "question-1",
      attempt_id: attemptId,
      worker_fence: 7,
      idempotency_key: "analysis-authority:question-1",
      analysis_program_ref: reference("AnalysisProgram", 10, hash("a")),
      stage_id: staged.command.stage_id,
      stage_hash: staged.command.stage_hash,
      closure_hash: staged.command.closure_hash,
      operator_receipt_closure_hash: hash("b"),
      oracle_receipt_payload: oraclePayload,
      oracle_receipt_hash: await sha256ContentHash(oraclePayload),
      explanation,
      explanation_hash: await sha256ContentHash(explanation),
      output_bindings: staged.artifacts.map((stageArtifact, index) => ({
        stage_artifact: stageArtifact,
        reference: reference("SandboxResult", 20 + index, stageArtifact.content_sha256),
      })),
      sandbox_receipt_ref: reference("SandboxExecutionReceipt", 30, receiptHash),
      sandbox_receipt_payload: receiptPayload,
      sandbox_receipt_hash: receiptHash,
      public_event_id: id(31),
    });
    await expect(verifyAnalysisAuthorityCommit(command)).resolves.toEqual(command);
    await expect(
      verifyAnalysisAuthorityCommit({ ...command, stage_hash: hash("f") }),
    ).rejects.toThrow("ANALYSIS_AUTHORITY_COMMIT_HASH_MISMATCH");
  });
});
