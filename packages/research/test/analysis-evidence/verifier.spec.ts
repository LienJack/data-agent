import { createHash } from "node:crypto";
import type {
  AnalysisProgramPayload,
  AnalysisSandboxProgramPayload,
  DerivedAnalysisEvidencePayload,
  PythonOutputContractV1,
  PythonSandboxReceiptV1,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  computeAnalysisDerivationHash,
  computeAnalysisSandboxProgramHash,
  verifyAnalysisDerivation,
  verifyAnalysisResult,
  verifyAnalysisSandboxProgram,
  verifyScaleMetamorphism,
} from "../../src/analysis-evidence/index.js";
import { hashes, reference } from "../fixtures.js";

const planRef = reference("AnalysisProgram", "70");
const programRef = reference("SandboxProgram", "71");
const receiptRef = reference("SandboxExecutionReceipt", "72");
const queryRef = reference("QueryEvidence", "73");
const resultRef = reference("SandboxResult", "74");
const inputResultRef = reference("SandboxResult", "79");
const sourceRef = reference("SensitiveExecutionArtifact", "75");
const sourceText = "def main(context):\n    context.write_json('result', {'ok': True})\n";
const sourceHash = `sha256:${createHash("sha256").update(sourceText).digest("hex")}` as const;
const outputContract: PythonOutputContractV1 = {
  schema_version: "python-output-contract@1.0.0",
  outputs: [{ name: "result", type: "JSON", required: true, max_bytes: 4_096 }],
};

const plan: AnalysisProgramPayload = {
  artifact_type: "AnalysisProgram",
  protocol_version: "analysis-program@1.0.0",
  brief_ref: reference("ResearchBrief", "76"),
  analysis_context_hash: hashes.b,
  semantic_context_package_hash: hashes.c,
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
      execution_mode: "FROZEN_TEMPLATE",
      output_contract: outputContract,
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

async function programFixture(): Promise<AnalysisSandboxProgramPayload> {
  const material: Omit<AnalysisSandboxProgramPayload, "program_hash"> = {
    artifact_type: "SandboxProgram",
    protocol_version: "analysis-sandbox-program@1.0.0",
    analysis_program_ref: planRef,
    node_id: "trend-node",
    language: "PYTHON_3_12",
    entrypoint: "main",
    source_sha256: sourceHash,
    source_text_ref: { ...sourceRef, content_hash: sourceHash },
    query_evidence_refs: [queryRef],
    input_refs: [inputResultRef],
    output_contract: outputContract,
    import_profile: "CORE_ANALYSIS",
    random_seed: 0,
    runtime_digest: hashes.b,
    dependency_lock_digest: hashes.c,
    policy_version: "python-policy@1.0.0",
  };
  return { ...material, program_hash: await computeAnalysisSandboxProgramHash(material) };
}

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

const receipt: PythonSandboxReceiptV1 = {
  schema_version: "1.0.0",
  workspace_id: planRef.tenant_id,
  run_id: planRef.run_id,
  attempt: 0,
  fence_token: "fence-1",
  idempotency_key: "analysis-verifier-one",
  request_hash: hashes.a,
  sandbox_image_digest: hashes.b,
  python_version: "3.12.10",
  sdk_version: "data-agent-sandbox-sdk@1.0.0",
  dependency_lock_digest: hashes.c,
  policy_version: "python-policy@1.0.0",
  started_at: "2026-08-22T00:00:00.000Z",
  finished_at: "2026-08-22T00:00:01.000Z",
  elapsed_ms: 1_000,
  observed_resources: {
    peak_memory_bytes: 1_024,
    cpu_seconds: 0.2,
    output_bytes: 128,
    stdout_bytes: 0,
    stderr_bytes: 0,
    exit_code: 0,
    signal: null,
  },
  hard_controls: {
    network_isolated: true,
    filesystem_isolated: true,
    memory_limit_enforced: true,
    cpu_limit_enforced: true,
    pid_limit_enforced: true,
  },
  status: "SUCCEEDED",
  failure_code: null,
  output_refs: [resultRef],
  stdout_ref: null,
  stderr_ref: null,
};

async function evidenceFixture(): Promise<DerivedAnalysisEvidencePayload> {
  const material: Omit<DerivedAnalysisEvidencePayload, "derivation_hash"> = {
    artifact_type: "DerivedAnalysisEvidence",
    protocol_version: "derived-analysis-evidence@1.0.0",
    analysis_program_ref: planRef,
    node_id: "trend-node",
    skill_id: "trend-change@1",
    algorithm_version: "trend-change@1.0.0",
    query_evidence_refs: [queryRef],
    sandbox_program_ref: programRef,
    sandbox_execution_receipt_ref: receiptRef,
    sandbox_result_refs: [resultRef],
    runtime_digest: hashes.b,
    dependency_lock_digest: hashes.c,
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

describe("deterministic analysis program and derivation verification", () => {
  it("closes source, plan, output contract, profile and program hash", async () => {
    const program = await programFixture();
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program,
        sourceText,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toEqual({ ok: true, program });

    const tampered = { ...program, runtime_digest: hashes.a };
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program: tampered,
        sourceText: `${sourceText}# tampered\n`,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining(["PROGRAM_SOURCE_HASH_MISMATCH", "PROGRAM_HASH_MISMATCH"]),
    });

    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program: { ...program, node_id: "missing-node" },
        sourceText,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining(["PROGRAM_NODE_NOT_FOUND"]),
    });

    const randomSource =
      "def main(context):\n    rng = numpy.random.default_rng(7)\n    context.write_json('result', {'value': rng.random()})\n";
    const randomSourceHash =
      `sha256:${createHash("sha256").update(randomSource).digest("hex")}` as const;
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program: {
          ...program,
          source_sha256: randomSourceHash,
          source_text_ref: { ...program.source_text_ref, content_hash: randomSourceHash },
        },
        sourceText: randomSource,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining(["PROGRAM_RANDOM_SEED_UNBOUND"]),
    });

    const globalRandomSource =
      "import numpy as np\ndef main(context):\n    context.write_json('result', {'value': np.random.normal()})\n";
    const globalRandomHash =
      `sha256:${createHash("sha256").update(globalRandomSource).digest("hex")}` as const;
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program: {
          ...program,
          source_sha256: globalRandomHash,
          source_text_ref: { ...program.source_text_ref, content_hash: globalRandomHash },
        },
        sourceText: globalRandomSource,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining(["PROGRAM_RANDOM_SEED_UNBOUND"]),
    });

    const seededSource =
      "import numpy\ndef main(context):\n    rng = numpy.random.default_rng(0)\n    context.write_json('result', {'value': rng.normal()})\n";
    const seededSourceHash =
      `sha256:${createHash("sha256").update(seededSource).digest("hex")}` as const;
    const { program_hash: _oldProgramHash, ...seededMaterial } = {
      ...program,
      source_sha256: seededSourceHash,
      source_text_ref: { ...program.source_text_ref, content_hash: seededSourceHash },
    };
    const seededProgram = {
      ...seededMaterial,
      program_hash: await computeAnalysisSandboxProgramHash(seededMaterial),
    };
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: plan,
        analysisProgramRef: planRef,
        program: seededProgram,
        sourceText: seededSource,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toEqual({ ok: true, program: seededProgram });

    const sensitiveContract: PythonOutputContractV1 = {
      schema_version: "python-output-contract@1.0.0",
      outputs: [{ name: "secrets", type: "JSON", required: true, max_bytes: 4_096 }],
    };
    const planNode = plan.nodes[0];
    if (!planNode) throw new Error("plan fixture must contain one node");
    await expect(
      verifyAnalysisSandboxProgram({
        analysisProgram: {
          ...plan,
          nodes: [{ ...planNode, output_contract: sensitiveContract }],
        },
        analysisProgramRef: planRef,
        program: { ...program, output_contract: sensitiveContract },
        sourceText,
        allowedProfiles: ["CORE_ANALYSIS"],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining(["PROGRAM_OUTPUT_SENSITIVE"]),
    });
  });

  it("uses independent invariant and metamorphic oracles", () => {
    expect(verifyAnalysisResult(trendResult)).toEqual({ verdict: "PASS", failures: [] });
    expect(
      verifyAnalysisResult({
        ...trendResult,
        points: [trendResult.points[1], trendResult.points[0]],
      }),
    ).toMatchObject({
      verdict: "FAIL",
      failures: expect.arrayContaining(["TREND_ORDER_INVALID"]),
    });
    expect(
      verifyAnalysisResult({
        ...trendResult,
        first_value: 11,
        points: [trendResult.points[0], { ...trendResult.points[1], relative_delta: 0.3 }],
      }),
    ).toMatchObject({
      verdict: "FAIL",
      failures: expect.arrayContaining([
        "TREND_ENDPOINT_MISMATCH",
        "TREND_RELATIVE_DELTA_MISMATCH",
      ]),
    });
    expect(
      verifyAnalysisResult({
        result_kind: "CONTRIBUTION_CONCENTRATION",
        groups: [
          {
            group_key_hash: hashes.a,
            baseline: 0,
            current: 2,
            signed_delta: 2,
            change_share: 0.5,
          },
        ],
        residual: 0,
        closure_tolerance: 1e-9,
        hhi: 1,
      }),
    ).toMatchObject({
      verdict: "FAIL",
      failures: expect.arrayContaining(["CONTRIBUTION_SHARE_MISMATCH"]),
    });
    expect(
      verifyAnalysisResult({
        result_kind: "GENERATED_ANALYSIS",
        declared_method: "custom@1.0.0",
        structured_output_refs: [resultRef],
        oracle_scope: "INVARIANTS_ONLY",
      }),
    ).toEqual({ verdict: "CANDIDATE_ONLY", failures: ["GENERATED_ORACLE_INSUFFICIENT"] });
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

  it("detects source/runtime/lock/result/reference and derivation tampering", async () => {
    const program = await programFixture();
    const evidence = await evidenceFixture();
    const firstPoint = trendResult.points[0];
    const secondPoint = trendResult.points[1];
    if (!firstPoint || !secondPoint) throw new Error("trend fixture must contain two points");
    const base = {
      plan,
      planRef,
      program,
      programRef,
      sourceText,
      receipt,
      receiptRef,
      evidence,
      materializedResultRefs: [resultRef],
      materializedQueryRefs: [queryRef],
      materializedInputRefs: [inputResultRef],
      allowedProfiles: ["CORE_ANALYSIS"] as const,
    };
    await expect(verifyAnalysisDerivation(base)).resolves.toEqual({ ok: true });
    await expect(
      verifyAnalysisDerivation({
        ...base,
        receipt: { ...receipt, dependency_lock_digest: hashes.a },
        materializedResultRefs: [reference("SandboxResult", "77")],
        evidence: {
          ...evidence,
          result: { ...trendResult, points: [secondPoint, firstPoint] },
          derivation_hash: hashes.a,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "RECEIPT_RUNTIME_MISMATCH",
        "RESULT_REFERENCE_CLOSURE_FAILED",
        "RESULT_ORACLE_FAILED",
        "DERIVATION_HASH_MISMATCH",
      ]),
    });

    await expect(
      verifyAnalysisDerivation({
        ...base,
        receipt: {
          ...receipt,
          policy_version: "python-policy@0.9.0",
          workspace_id: "20000000-0000-4000-8000-000000000001",
          hard_controls: { ...receipt.hard_controls, network_isolated: false },
        },
        materializedResultRefs: [resultRef, resultRef],
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "RECEIPT_RUNTIME_MISMATCH",
        "RECEIPT_SCOPE_MISMATCH",
        "RECEIPT_HARD_CONTROL_MISMATCH",
        "RESULT_REFERENCE_CLOSURE_FAILED",
      ]),
    });

    await expect(
      verifyAnalysisDerivation({
        ...base,
        program: { ...program, query_evidence_refs: [reference("QueryEvidence", "78")] },
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "PROGRAM_VERIFICATION_FAILED",
        "QUERY_REFERENCE_CLOSURE_FAILED",
      ]),
    });
    await expect(
      verifyAnalysisDerivation({
        ...base,
        program: { ...program, input_refs: [reference("SandboxResult", "80")] },
      }),
    ).resolves.toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        "PROGRAM_VERIFICATION_FAILED",
        "INPUT_REFERENCE_CLOSURE_FAILED",
      ]),
    });
  });
});
