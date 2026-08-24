import {
  type AnalysisProgramPayload,
  type AnalysisSandboxExecutionReceipt,
  analysisSandboxExecutionReceiptSchema,
  type DerivedAnalysisEvidencePayload,
} from "@data-agent/contracts";
import { analysisResultContractFixture } from "@data-agent/contracts/testing";
import { describe, expect, it } from "vitest";
import {
  computeAnalysisDerivationHash,
  verifyAnalysisDerivation,
  verifyAnalysisResult,
  verifyScaleMetamorphism,
} from "../../src/analysis-evidence/index.js";
import { hashes, reference } from "../fixtures.js";

const planRef = reference("AnalysisProgram", "70");
const receiptRef = reference("SandboxExecutionReceipt", "72");
const queryRef = reference("QueryEvidence", "73");
const resultRef = reference("SandboxResult", "74");
const tableRef = reference("SandboxResult", "75");
const chartRef = reference("SandboxResult", "76");
const inputResultRef = reference("SandboxResult", "79");
const materializationRef = reference("AnalysisInputMaterializationReceipt", "78");

const plan: AnalysisProgramPayload = {
  artifact_type: "AnalysisProgram",
  protocol_version: "analysis-program@1.0.0",
  brief_ref: reference("ResearchBrief", "76"),
  analysis_context_hash: hashes.b,
  semantic_context_package_hash: hashes.c,
  operator_registry_digest: hashes.c,
  nodes: [
    {
      node_id: "trend-node",
      skill_id: "trend-change@1",
      metric_refs: [],
      dimension_refs: [],
      time_window: {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-02-01T00:00:00.000Z",
        timezone: "UTC",
        semantics: "HALF_OPEN",
      },
      comparison_window: null,
      parameters: {},
      execution_mode: "MODEL_GENERATED",
      generated_source_policy: "OPEN_ANALYSIS",
      operator_obligations: [],
      result_contract: analysisResultContractFixture({
        semantic_context_hash: hashes.c,
        contract_id: "trend-node.result",
      }),
      dependency_node_ids: [],
      activation_rule: { kind: "ALWAYS" },
      criticality: "CRITICAL",
    },
  ],
  budget: {
    max_steps: 4,
    max_sql_executions: 1,
    max_sandbox_executions: 1,
    max_series_rows: 100,
    max_group_rows: 100,
    max_elapsed_ms: 10_000,
  },
  compiler_kind: "DETERMINISTIC_DEFAULT",
  compiler_version: "analysis-program-compiler@1.0.0",
  program_hash: hashes.a,
};

const trendResult: Extract<
  DerivedAnalysisEvidencePayload["result"],
  { result_kind: "TREND_CHANGE" }
> = {
  result_kind: "TREND_CHANGE",
  points: [
    {
      period_start: "2026-01-01T00:00:00.000Z",
      value: 10,
      absolute_delta: null,
      relative_delta: null,
    },
    {
      period_start: "2026-01-02T00:00:00.000Z",
      value: 12,
      absolute_delta: 2,
      relative_delta: 0.2,
    },
  ],
  first_value: 10,
  last_value: 12,
};

const receipt: AnalysisSandboxExecutionReceipt = analysisSandboxExecutionReceiptSchema.parse({
  schema_version: "analysis-sandbox-execution-receipt@1.0.0",
  workspace_id: planRef.tenant_id,
  run_id: planRef.run_id,
  attempt_id: "00000000-0000-4000-8000-000000000080",
  worker_fence: 1,
  fence_token: "fence-1",
  idempotency_key: "analysis-verifier-one",
  request_hash: hashes.a,
  analysis_program_ref: planRef,
  node_id: "trend-node",
  runtime_profile: "CORE_ANALYSIS",
  runtime: {
    provider: "OpenSandbox",
    opensandbox_sdk_version: "opensandbox-sdk@1.0.0",
    code_interpreter_sdk_version: "code-interpreter-sdk@1.0.0",
    agent_image: "data-agent-analysis-core@sha256:test",
    operator_image: "data-agent-analysis-operator@sha256:test",
    agent_sandbox_id: "00000000-0000-4000-8000-000000000081",
    operator_sandbox_id: "00000000-0000-4000-8000-000000000082",
  },
  generated_source_policy: "OPEN_ANALYSIS",
  operator_registry_digest: plan.operator_registry_digest,
  operator_obligations: [],
  operator_receipts: [],
  operator_receipt_closure_hash: hashes.a,
  result_contract_hash: plan.nodes[0]?.result_contract.contract_hash,
  publish_manifest_hash: hashes.b,
  published_closure_hash: hashes.c,
  publish_id: "trend-node-publish",
  inputs: [
    {
      name: "monthly_orders",
      format: "ARROW",
      query_evidence_ref: queryRef,
      input_ref: inputResultRef,
      materialization_receipt_ref: materializationRef,
      content_sha256: inputResultRef.content_hash,
      bytes: 128,
    },
  ],
  cells: [
    {
      cell_id: "cell-1",
      source_sha256: hashes.b,
      execution_id: "execution-1",
      execution_count: 1,
      elapsed_ms: 20,
      status: "SUCCEEDED",
    },
  ],
  started_at: "2026-08-22T00:00:00.000Z",
  finished_at: "2026-08-22T00:00:01.000Z",
  elapsed_ms: 1_000,
  hard_controls: {
    network_isolated: true,
    scoped_filesystem: true,
    separate_operator_sandbox: true,
    resource_limits_enforced: true,
    secure_access: false,
  },
  status: "SUCCEEDED",
  failure_code: null,
  outputs: [
    {
      artifact_name: "result",
      artifact_kind: "RESULT",
      media_type: "application/json",
      reference: resultRef,
      content_sha256: resultRef.content_hash,
      bytes: 256,
    },
    {
      artifact_name: "table:result_table",
      artifact_kind: "TABLE",
      media_type: "application/json",
      reference: tableRef,
      content_sha256: tableRef.content_hash,
      bytes: 256,
    },
    {
      artifact_name: "chart:result_chart",
      artifact_kind: "CHART",
      media_type: "application/json",
      reference: chartRef,
      content_sha256: chartRef.content_hash,
      bytes: 256,
    },
  ],
  execution_hash: hashes.c,
});

async function evidenceFixture(): Promise<DerivedAnalysisEvidencePayload> {
  const material: Omit<DerivedAnalysisEvidencePayload, "derivation_hash"> = {
    artifact_type: "DerivedAnalysisEvidence",
    protocol_version: "derived-analysis-evidence@2.0.0",
    analysis_program_ref: planRef,
    node_id: "trend-node",
    skill_id: "trend-change@1",
    algorithm_version: "trend-change@1.0.0",
    query_evidence_refs: [queryRef],
    sandbox_execution_receipt_ref: receiptRef,
    sandbox_result_refs: [resultRef, tableRef, chartRef],
    runtime_profile: receipt.runtime_profile,
    agent_image: receipt.runtime.agent_image,
    operator_image: receipt.runtime.operator_image,
    generated_source_policy: receipt.generated_source_policy,
    operator_registry_digest: receipt.operator_registry_digest,
    operator_obligations: receipt.operator_obligations,
    operator_receipt_closure_hash: receipt.operator_receipt_closure_hash,
    parameter_hash: hashes.a,
    input_closure_hash: hashes.b,
    result: trendResult,
    quality: {
      oracle_verdict: "PASS",
      deterministic_replay: "PASS",
      sample_size: 2,
      coverage_ratio: 1,
    },
    limitation_codes: [],
    mandatory_disclosures: [],
  };
  return { ...material, derivation_hash: await computeAnalysisDerivationHash(material) };
}

describe("OpenSandbox analysis derivation verification", () => {
  it("closes plan, runtime, inputs, outputs, operators, and derivation hash", async () => {
    const evidence = await evidenceFixture();
    await expect(
      verifyAnalysisDerivation({
        plan,
        planRef,
        receipt,
        receiptRef,
        evidence,
        materializedResultRefs: [resultRef, tableRef, chartRef],
        materializedQueryRefs: [queryRef],
        materializedInputRefs: [inputResultRef],
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects runtime and reference substitution", async () => {
    const evidence = await evidenceFixture();
    await expect(
      verifyAnalysisDerivation({
        plan,
        planRef,
        receipt: {
          ...receipt,
          runtime: { ...receipt.runtime, agent_image: "substituted-agent@sha256:test" },
        },
        receiptRef,
        evidence,
        materializedResultRefs: [reference("SandboxResult", "77")],
        materializedQueryRefs: [queryRef],
        materializedInputRefs: [inputResultRef],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "RECEIPT_RUNTIME_MISMATCH",
        "RESULT_REFERENCE_CLOSURE_FAILED",
      ]),
    });
  });

  it("keeps independent invariant and metamorphic oracles", () => {
    const [firstPoint, secondPoint] = trendResult.points;
    if (!firstPoint || !secondPoint) throw new TypeError("trend fixture requires two points");
    expect(verifyAnalysisResult(trendResult)).toEqual({ verdict: "PASS", failures: [] });
    expect(
      verifyAnalysisResult({
        ...trendResult,
        points: [secondPoint, firstPoint],
      }),
    ).toMatchObject({
      verdict: "FAIL",
      failures: expect.arrayContaining(["TREND_ORDER_INVALID"]),
    });
    const scaled = {
      ...trendResult,
      points: trendResult.points.map((point) => ({
        ...point,
        value: point.value === null ? null : point.value * 10,
        absolute_delta: point.absolute_delta === null ? null : point.absolute_delta * 10,
      })),
      first_value: 100,
      last_value: 120,
    };
    expect(verifyScaleMetamorphism({ baseline: trendResult, scaled, factor: 10 })).toBe(true);
  });
});
