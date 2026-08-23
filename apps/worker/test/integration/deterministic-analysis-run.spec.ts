import {
  type AnalysisCompletionReceiptPayload,
  type AnalysisProgramPayload,
  type ArtifactReference,
  type DerivedAnalysisEvidencePayload,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  computeDeterministicAnalysisGolden,
  type DeterministicAnalysisFixture,
  evaluateDeterministicAnalysis,
  loadEcommerceDeterministicAnalysisSuite,
} from "@data-agent/evals";
import {
  buildDerivedAnalysisChartDocument,
  buildDeterministicAnalysisRunProjection,
} from "@data-agent/platform";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../../src/analysis/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const contentHash = (value: string | undefined) => (value ?? hash("0")) as `sha256:${string}`;
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

async function runAcceptedEcommerceTrend() {
  const suite = await loadEcommerceDeterministicAnalysisSuite();
  const testCase = suite.public_cases.find(({ slug }) => slug === "monthly-gmv-trend");
  if (!testCase) throw new Error("e-commerce trend case missing");
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("trend-change@1");
  const plan: AnalysisProgramPayload = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: ref("ResearchBrief", 4),
    analysis_context_hash: testCase.semantic_frontier.semantic_release_hash,
    semantic_context_package_hash: testCase.semantic_frontier.semantic_release_hash,
    nodes: [
      {
        node_id: "ecommerce-monthly-gmv",
        skill_id: "trend-change@1",
        metric_refs: [],
        dimension_refs: [],
        time_window: {
          start: "2026-01-01T00:00:00.000Z",
          end: "2026-05-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {},
        execution_mode: "FROZEN_TEMPLATE",
        output_contract: descriptor.output_contract,
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" },
        criticality: "CRITICAL",
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 4,
      max_group_rows: 1,
      max_elapsed_ms: 30_000,
    },
    compiler_kind: "DETERMINISTIC_DEFAULT",
    compiler_version: "analysis-program-compiler@1.0.0",
    program_hash: hash("a"),
  };
  const planRef = ref("AnalysisProgram", 5, await sha256ContentHash(plan));
  const fixture: DeterministicAnalysisFixture = {
    fixture_id: testCase.case_id,
    skill_id: "trend-change@1",
    algorithm_version: suite.manifest.algorithm_versions.trend ?? "trend-v1",
    periods: [
      { period_start: "2026-01-01T00:00:00.000Z", value: 100 },
      { period_start: "2026-02-01T00:00:00.000Z", value: 80 },
      { period_start: "2026-03-01T00:00:00.000Z", value: null },
      { period_start: "2026-04-01T00:00:00.000Z", value: 120 },
    ],
  };
  const queryEvidenceRef = ref(
    "QueryEvidence",
    6,
    contentHash(suite.sealed_cases[0]?.query_evidence_hashes[0]),
  );
  const evidence: DerivedAnalysisEvidencePayload = {
    artifact_type: "DerivedAnalysisEvidence",
    protocol_version: "derived-analysis-evidence@1.0.0",
    analysis_program_ref: planRef,
    node_id: "ecommerce-monthly-gmv",
    skill_id: "trend-change@1",
    algorithm_version: fixture.algorithm_version,
    query_evidence_refs: [queryEvidenceRef],
    sandbox_program_ref: ref("SandboxProgram", 7),
    sandbox_execution_receipt_ref: ref("SandboxExecutionReceipt", 8),
    sandbox_result_refs: [ref("SandboxResult", 9)],
    runtime_digest: hash("b"),
    dependency_lock_digest: hash("c"),
    parameter_hash: hash("d"),
    input_closure_hash: hash("e"),
    result: computeDeterministicAnalysisGolden(fixture),
    quality: {
      oracle_verdict: "PASS",
      deterministic_replay: "PASS",
      sample_size: 3,
      coverage_ratio: 0.75,
    },
    limitation_codes: ["MISSING_PERIOD_POLICY_UNRESOLVED"],
    mandatory_disclosures: [],
    derivation_hash: hash("f"),
  };
  const independent = await evaluateDeterministicAnalysis({ fixture, evidence });
  if (independent.verdict !== "PASS") throw new Error(independent.hard_failures.join(","));
  const evidenceRef = ref("DerivedAnalysisEvidence", 10, await sha256ContentHash(evidence));
  const chart = await buildDerivedAnalysisChartDocument({
    document_ref: ref("ArtifactWorkspaceDocument", 11),
    evidence_ref: evidenceRef,
    evidence,
    semantic_context: {
      package_id: id(12),
      package_hash: contentHash(testCase.semantic_frontier.semantic_release_hash),
      receipt_id: id(13),
      receipt_hash: contentHash(testCase.semantic_frontier.policy_receipt_hash),
    },
    unit: "BRL",
  });
  if (!chart) throw new Error("accepted trend chart missing");
  const completion: AnalysisCompletionReceiptPayload = {
    artifact_type: "AnalysisCompletionReceipt",
    protocol_version: "analysis-completion@1.0.0",
    analysis_program_ref: planRef,
    node_results: [
      {
        node_id: "ecommerce-monthly-gmv",
        criticality: "CRITICAL",
        status: "SUCCEEDED",
        evidence_ref: evidenceRef,
        reason_codes: [],
      },
    ],
    budget_usage: {
      steps: 1,
      sql_executions: 1,
      sandbox_executions: 1,
      series_rows: 4,
      group_rows: 0,
      elapsed_ms: 50,
    },
    terminal: "READY",
    limitation_codes: [],
    completion_hash: hash("1"),
  };
  const completionRef = ref("AnalysisCompletionReceipt", 14, await sha256ContentHash(completion));
  const projection = await buildDeterministicAnalysisRunProjection({
    analysis_program_ref: planRef,
    analysis_program: plan,
    completion_ref: completionRef,
    completion,
    evidence: [{ ref: evidenceRef, payload: evidence }],
    charts: [chart],
    findings: [
      {
        finding_id: "monthly-gmv-fact",
        tier: "FACT",
        statement: "月度 GMV 从 100 BRL 变为 120 BRL；缺期未补零。",
        evidence_ref: evidenceRef,
        evidence_level: "L2_OBSERVATION",
        status: "ACCEPTED",
        disclosure_codes: [],
      },
    ],
  });
  const reportProjection = await buildDeterministicAnalysisRunProjection({
    analysis_program_ref: planRef,
    analysis_program: plan,
    completion_ref: completionRef,
    completion,
    evidence: [{ ref: evidenceRef, payload: evidence }],
    charts: [chart],
    findings: [
      {
        finding_id: "sales-return-pattern",
        tier: "PATTERN",
        statement: "销售退货异常与月度 GMV 变化同时出现，当前仅构成待验证根因候选。",
        evidence_ref: evidenceRef,
        evidence_level: "L4_DISCOVERY",
        status: "CANDIDATE",
        disclosure_codes: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
      },
    ],
    root_cause: {
      level: "L4_DISCOVERY",
      candidate_ref: ref("DiscoveryCandidate", 15),
      estimate_ref: null,
      certificate_ref: null,
      disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
    },
  });
  return {
    independent,
    chart,
    projection,
    reportProjection,
    queryEvidenceRef,
    evidenceRef,
    suite,
  };
}

describe("e-commerce governed SQL to deterministic report acceptance", () => {
  it("closes semantic frontier, QueryEvidence, Sandbox, independent Oracle, chart and report", async () => {
    const result = await runAcceptedEcommerceTrend();
    expect(result.independent).toMatchObject({ verdict: "PASS", score: 100 });
    expect(result.chart.source_refs).toMatchObject({
      query_evidence_refs: [result.queryEvidenceRef],
      derived_evidence_ref: result.evidenceRef,
    });
    expect(result.projection).toMatchObject({
      terminal: "READY",
      charts: [result.chart.document_ref],
      root_cause: { level: "NONE" },
    });
    expect(result.reportProjection).toMatchObject({
      terminal: "READY",
      root_cause: {
        level: "L4_DISCOVERY",
        certificate_ref: null,
        disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
      },
    });
    const salesReturn = result.suite.public_cases.find(
      ({ slug }) => slug === "sales-return-report",
    );
    expect(salesReturn?.required_skills).toEqual([
      "data-profile@1",
      "semantic-transform@1",
      "trend-change@1",
      "contribution-concentration@1",
      "robust-anomaly@1",
      "open-python-analysis@1",
      "visual-insight-story@1",
    ]);
    expect(JSON.stringify(result.projection)).not.toMatch(
      /source_text|stdout|stderr|sql_parameters|private_reasoning|raw_rows/u,
    );
  });

  it("does not build a public artifact after the independent Oracle hard-fails", async () => {
    const fixture: DeterministicAnalysisFixture = {
      fixture_id: "tampered",
      skill_id: "trend-change@1",
      algorithm_version: "trend-v1",
      periods: [{ period_start: "2026-01-01T00:00:00.000Z", value: 1 }],
    };
    const observed = {
      skill_id: "trend-change@1",
      algorithm_version: "trend-v1",
      result: { ...computeDeterministicAnalysisGolden(fixture), last_value: 99 },
      quality: { oracle_verdict: "PASS", deterministic_replay: "PASS" },
    } as DerivedAnalysisEvidencePayload;
    const verdict = await evaluateDeterministicAnalysis({ fixture, evidence: observed });
    expect(verdict).toMatchObject({
      verdict: "FAIL",
      hard_failures: ["NUMERIC_OR_STRUCTURE_MISMATCH"],
    });
  });
});
