import {
  buildAnalysisResultContract,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
  researchBriefV3PayloadSchema,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { buildAnalysisContext } from "@data-agent/contracts/context";
import { analysisResultContractFixture } from "@data-agent/contracts/testing";
import { describe, expect, it } from "vitest";
import { resolveAnalysisEvidenceTimeWindow } from "../../src/analysis/analysis-evidence-time-window.js";
import {
  analysisProgramCandidateSchema,
  compileAnalysisProgramCandidate,
} from "../../src/analysis/analysis-program-compiler.js";
import { computeAnalysisProgramHash } from "../../src/analysis/analysis-program-hash.js";
import { gateAnalysisProgram } from "../../src/analysis/program-gate.js";
import {
  comparisonHash,
  comparisonId,
  comparisonRef,
  monthlyComparisonFixture,
} from "./support/monthly-comparison-fixture.js";

// Contract-boundary fixture only: no production method, model execution, or publication claim.
async function fixture() {
  const source = await monthlyComparisonFixture();
  if (
    source.document.projection.kind !== "TABLE" ||
    source.document.provenance?.kind !== "GOVERNED_QUERY_RESULT"
  )
    throw new Error("TEST_QUERY_REQUIRED");
  const { binding_hash: _bindingHash, ...material } = source.binding;
  const binding = await buildQueryEvidenceSemanticBinding({
    ...material,
    time_window: null,
    columns: material.columns.slice(1, 2),
  });
  const document = await buildProductTeamArtifactDocument({
    ...source.document,
    provenance: { ...source.document.provenance, semantic_binding: binding },
    projection: {
      ...source.document.projection,
      columns: source.document.projection.columns.slice(1, 2),
      rows: source.rows.map(({ current }) => ({ current })),
    },
  });
  if (document.artifact_ref.artifact_type !== "QueryEvidence")
    throw new Error("TEST_QUERY_REQUIRED");
  const { contract_hash: _contractHash, ...contractMaterial } = analysisResultContractFixture({
    semantic_context_hash: source.context.semantic_context_binding.package_hash,
    metric_id: "metric.revenue",
  });
  const resultContract = await buildAnalysisResultContract(contractMaterial);
  const brief = researchBriefV3PayloadSchema.parse({
    artifact_type: "ResearchBrief",
    protocol_version: "research-brief@3.0.0",
    question_frame_ref: comparisonRef("QuestionFrame", 90),
    research_mode: "EXPLORATORY_DETERMINISTIC",
    question: "使用全部已接受数据作描述性比较。",
    semantic_release_ref: source.context.semantic_release_ref,
    schema_snapshot_ref: source.context.schema_snapshot_ref,
    policy_receipt_ref: source.context.policy_receipt_ref,
    primary_metric_refs: source.context.metrics.map((metric) => metric.metric_ref),
    approved_dimension_refs: [],
    requested_time_window: null,
    analysis_mode: "AUTO",
    root_cause_mode: "DISABLED",
    code_generation: "ALLOW_SANDBOXED",
    success_criteria: ["原输入全部保留"],
    required_disclosures: [],
    budget: {
      max_steps: 1,
      max_model_calls: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_elapsed_ms: 120000,
    },
    brief_hash: comparisonHash("f"),
  });
  const candidate = {
    schema_version: "analysis-program-candidate@2.1.0",
    objective_hash: await sha256ContentHash({
      hash_domain: "analysis-program-objective@1.0.0",
      question: brief.question,
    }),
    nodes: [
      {
        node_id: "comparison",
        method_registry_entry_ids: ["test-source-comparison@1"],
        metric_ids: ["metric.revenue"],
        dimension_ids: [],
        time_window: null,
        comparison_window: null,
        parameters: {},
        operator_obligations: [],
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
  };
  return {
    source,
    binding,
    input: {
      brief,
      brief_ref: comparisonRef("ResearchBrief", 91),
      context: source.context,
      candidate,
      query_evidence: { reference: document.artifact_ref, document },
      method_registry: [
        {
          method_id: "test-source-comparison@1",
          skill_id: "open-python-analysis@1" as const,
          result_contract: resultContract,
          required_operator_obligations: [],
        },
      ],
    },
  };
}

describe("accepted analysis input time scope", () => {
  it("preserves explicit null without deriving dates from published coverage", async () => {
    const { source, binding } = await fixture();
    expect(resolveAnalysisEvidenceTimeWindow(binding, source.context)).toBeNull();
    expect(resolveAnalysisEvidenceTimeWindow(source.binding, source.context)).toEqual({
      start: "2024-01-01T00:00:00.000+08:00",
      end: "2025-01-01T00:00:00.000+08:00",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    });
  });

  it("compiles, hashes, and gates source-bound null only through the new versions", async () => {
    const { input } = await fixture();
    const program = await compileAnalysisProgramCandidate(input);
    expect(program.protocol_version).toBe("analysis-program@1.1.0");
    expect(program.compiler_version).toBe("analysis-program-host-compiler@2.1.0");
    expect(program.nodes[0]?.time_window).toBeNull();
    const { program_hash, ...material } = program;
    expect(program_hash).toBe(
      await sha256ContentHash({ hash_domain: "analysis-program@1.1.0", value: material }),
    );
    expect((await gateAnalysisProgram({ ...input, program })).ok).toBe(true);
    expect(
      analysisProgramCandidateSchema.safeParse({
        ...input.candidate,
        schema_version: "analysis-program-candidate@2.0.0",
      }).success,
    ).toBe(false);
    const absent = structuredClone(input.candidate);
    Reflect.deleteProperty(absent.nodes[0] ?? {}, "time_window");
    expect(analysisProgramCandidateSchema.safeParse(absent).success).toBe(false);
  });

  it.each([
    "missing-source",
    "bounded-source",
    "wrong-run",
    "wrong-context",
    "wrong-release",
    "wrong-snapshot",
  ])("rejects null scope without exact accepted authority: %s", async (kind) => {
    const { input, source } = await fixture();
    if (kind === "missing-source") {
      const { query_evidence: _evidence, ...withoutSource } = input;
      await expect(compileAnalysisProgramCandidate(withoutSource)).rejects.toThrow(
        "ANALYSIS_PROGRAM_INPUT_TIME_SCOPE_INVALID",
      );
      return;
    }
    if (kind === "bounded-source")
      input.query_evidence = { reference: source.reference, document: source.document };
    if (kind === "wrong-run")
      input.brief = {
        ...input.brief,
        question_frame_ref: { ...input.brief.question_frame_ref, run_id: comparisonId(999) },
      };
    const { context_hash: _contextHash, ...contextMaterial } = input.context;
    if (kind === "wrong-context")
      input.context = await buildAnalysisContext({
        ...contextMaterial,
        semantic_context_binding: {
          ...input.context.semantic_context_binding,
          receipt_hash: comparisonHash("9"),
        },
      });
    if (kind === "wrong-release" || kind === "wrong-snapshot") {
      const key = kind === "wrong-release" ? "semantic_release_ref" : "schema_snapshot_ref";
      input.context = await buildAnalysisContext({
        ...contextMaterial,
        [key]: { ...input.context[key], content_hash: comparisonHash("9") },
      });
    }
    await expect(compileAnalysisProgramCandidate(input)).rejects.toThrow(
      "ANALYSIS_PROGRAM_INPUT_TIME_SCOPE_INVALID",
    );
  });

  it.each(["invent-window", "drop-window", "invent-comparison"])(
    "gate rejects %s",
    async (kind) => {
      const { input, source } = await fixture();
      const program = await compileAnalysisProgramCandidate(input);
      const window = resolveAnalysisEvidenceTimeWindow(source.binding, source.context);
      const nodes = program.nodes.map((node) => ({
        ...node,
        ...(kind === "invent-window" ? { time_window: window } : {}),
        ...(kind === "invent-comparison" ? { comparison_window: window } : {}),
      }));
      const { program_hash: _hash, ...material } = { ...program, nodes };
      const changed = { ...material, program_hash: await computeAnalysisProgramHash(material) };
      const verdict = await gateAnalysisProgram({
        ...input,
        program: changed,
        brief: { ...input.brief, requested_time_window: kind === "drop-window" ? window : null },
      });
      expect(verdict.ok).toBe(false);
      expect(verdict).toMatchObject({
        failure:
          kind === "invent-comparison"
            ? "ANALYSIS_PROGRAM_SCHEMA_INVALID"
            : "ANALYSIS_PROGRAM_TIME_WINDOW_NOT_APPROVED",
      });
    },
  );
});
