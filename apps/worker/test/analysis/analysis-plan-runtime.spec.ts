import { createHash } from "node:crypto";
import {
  type AnalysisPlanPayload,
  type ArtifactReference,
  analysisPlanPayloadSchema,
  buildAnalysisContext,
  researchBriefV3PayloadSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  admitAnalysisProgram,
  admitAnalysisProgramRepair,
  computeAnalysisPlanHash,
  createAnalysisPlanExecutor,
  createDefaultAnalysisPlan,
  createServerOwnedAnalysisSkillCatalog,
  createServerOwnedAnalysisSkillCatalogFromReleaseManifest,
  DEFAULT_ANALYSIS_SKILL_CATALOG,
  executeControlledTabularImport,
  gateAnalysisPlan,
  selectEvidenceGroundedChartStory,
} from "../../src/analysis/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const principalId = id(4);
const timestamp = "2026-08-22T00:00:00.000Z";
const window = {
  start: "2026-07-01T00:00:00.000Z",
  end: "2026-08-01T00:00:00.000Z",
  timezone: "Asia/Shanghai",
  semantics: "HALF_OPEN" as const,
};

function reference<const T extends ArtifactReference["artifact_type"]>(
  artifact_type: T,
  suffix: number,
  content_hash: `sha256:${string}` = hash((suffix % 10).toString()),
): ArtifactReference & { readonly artifact_type: T; readonly content_hash: `sha256:${string}` } {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

async function fixture() {
  const semanticReleaseRef = reference("SemanticRelease", 10);
  const metricRef = { container_ref: semanticReleaseRef, node_id: "gross_revenue" } as const;
  const context = await buildAnalysisContext({
    schema_version: "analysis-context@1.0.0",
    scope,
    resolved_context_binding: {
      package_id: id(11),
      package_hash: hash("a"),
      receipt_id: id(12),
      receipt_hash: hash("b"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 13),
    policy_receipt_ref: reference("PolicyReceipt", 14),
    semantic_source_bundle_ref: reference("SemanticSourceBundle", 15),
    ontology_analysis_binding_hash: hash("c"),
    metrics: [
      {
        metric_ref: metricRef,
        formula_hash: hash("d"),
        unit: {
          unit_id: "cny",
          dimension: "currency",
          base_unit: null,
          conversion_factor: null,
        },
        grain: { grain_id: "order-day", granularity: "day" },
        time_domain: {
          time_domain_id: "order-time",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: null,
          max_time: null,
        },
        time_dimension_ref: "ordered_at",
        additivity: "additive",
        null_policy: "coalesce-zero",
        missing_period_policy: "ZERO_IF_SEMANTICALLY_EMPTY",
        seasonality: { kind: "WEEKLY", period_count: 7, minimum_history_points: 28 },
        priority: 10_000,
        causal_role: "OUTCOME",
        allowed_dimensions: [
          {
            dimension_id: "region",
            grain: { grain_id: "order-day", granularity: "day" },
            data_type: "text",
            sensitivity: "PUBLIC",
            groupable: true,
            pivotable: true,
            causal_role: "CANDIDATE_CONFOUNDER",
          },
        ],
        analysis_capabilities: ["CHART_DATASET", "DATA_PROFILE", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
  const briefRef = reference("ResearchBrief", 16);
  const brief = researchBriefV3PayloadSchema.parse({
    artifact_type: "ResearchBrief",
    protocol_version: "research-brief@3.0.0",
    question_frame_ref: reference("QuestionFrame", 17),
    research_mode: "EXPLORATORY_DETERMINISTIC",
    question: "订单收入趋势如何？",
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: context.schema_snapshot_ref,
    policy_receipt_ref: context.policy_receipt_ref,
    primary_metric_refs: [metricRef],
    approved_dimension_refs: ["region"],
    requested_time_window: window,
    analysis_mode: "EXPLICIT",
    root_cause_mode: "DISABLED",
    code_generation: "FROZEN_ONLY",
    success_criteria: ["给出受验证趋势"],
    required_disclosures: [],
    budget: {
      max_steps: 4,
      max_model_calls: 0,
      max_sql_executions: 4,
      max_sandbox_executions: 4,
      max_elapsed_ms: 60_000,
    },
    brief_hash: hash("e"),
  });
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("trend-change@1");
  const material: Omit<AnalysisPlanPayload, "plan_hash"> = {
    artifact_type: "AnalysisPlan",
    protocol_version: "analysis-plan@1.0.0",
    brief_ref: briefRef,
    analysis_context_hash: context.context_hash,
    nodes: [
      {
        node_id: "trend",
        skill_id: "trend-change@1",
        metric_refs: [metricRef],
        dimension_refs: ["region"],
        time_window: window,
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
      max_steps: 4,
      max_sql_executions: 4,
      max_sandbox_executions: 4,
      max_series_rows: 100,
      max_group_rows: 100,
      max_elapsed_ms: 60_000,
    },
    planner_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    planner_version: "analysis-planner@1.0.0",
  };
  const plan = analysisPlanPayloadSchema.parse({
    ...material,
    plan_hash: await computeAnalysisPlanHash(material),
  });
  return { brief, briefRef, context, plan };
}

describe("deterministic analysis worker runtime", () => {
  it("registers the complete frozen skill catalog and rejects unknown skills", () => {
    expect(DEFAULT_ANALYSIS_SKILL_CATALOG.list().map(({ skill_id }) => skill_id)).toEqual([
      "data-profile@1",
      "semantic-transform@1",
      "trend-change@1",
      "contribution-concentration@1",
      "robust-anomaly@1",
      "association-outlier-completeness@1",
      "baseline-forecast-backtest@1",
      "open-python-analysis@1",
      "root-cause-investigation@1",
      "visual-insight-story@1",
    ]);
    expect(() => DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("invented@1")).toThrow(
      "ANALYSIS_SKILL_NOT_REGISTERED",
    );
    expect(
      DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1").python_import_profile,
    ).toBe("ML_DIAGNOSTIC");
  });

  it("applies each server-owned skill kill switch independently", () => {
    const catalog = createServerOwnedAnalysisSkillCatalog(new Set(["trend-change@1"]));
    expect(() => catalog.resolve("trend-change@1")).toThrow("ANALYSIS_SKILL_NOT_REGISTERED");
    expect(catalog.resolve("data-profile@1").skill_id).toBe("data-profile@1");
    expect(catalog.list()).toHaveLength(DEFAULT_ANALYSIS_SKILL_CATALOG.list().length - 1);
  });

  it("does not accept an untrusted rollout document as server registration authority", () => {
    expect(() =>
      createServerOwnedAnalysisSkillCatalogFromReleaseManifest({
        deterministic_analysis_rollout: {},
      } as never),
    ).toThrow("ANALYSIS_RELEASE_MANIFEST_NOT_AUTHORITATIVE");
  });

  it("builds the automatic plan from primary metrics and approved dimensions only", async () => {
    const base = await fixture();
    const { context_hash: _contextHash, ...contextMaterial } = base.context;
    const primary = base.context.metrics[0];
    if (!primary) throw new TypeError("missing primary metric fixture");
    const context = await buildAnalysisContext({
      ...contextMaterial,
      metrics: [
        primary,
        {
          ...primary,
          metric_ref: { ...primary.metric_ref, node_id: "unrequested_metric" },
          formula_hash: hash("f"),
        },
      ],
    });
    const plan = await createDefaultAnalysisPlan({
      brief: base.brief,
      brief_ref: base.briefRef,
      context,
      time_window: window,
    });
    expect(plan.planner_kind).toBe("DETERMINISTIC_DEFAULT");
    expect(
      plan.nodes.flatMap(({ metric_refs }) => metric_refs.map(({ node_id }) => node_id)),
    ).toEqual(plan.nodes.map(() => "gross_revenue"));
    expect(
      plan.nodes.every(({ dimension_refs }) => dimension_refs.every((id) => id === "region")),
    ).toBe(true);
  });

  it("rejects unauthorized dimensions, budgets, comparison windows, and cross-run refs", async () => {
    const base = await fixture();
    const baseNode = base.plan.nodes[0];
    if (!baseNode) throw new TypeError("missing plan node fixture");
    const variants: readonly [Partial<AnalysisPlanPayload>, string][] = [
      [
        {
          nodes: [{ ...baseNode, dimension_refs: ["customer_secret"] }],
        },
        "ANALYSIS_PLAN_DIMENSION_NOT_APPROVED",
      ],
      [{ budget: { ...base.plan.budget, max_steps: 9 } }, "ANALYSIS_PLAN_BUDGET_EXCEEDED"],
      [
        {
          nodes: [
            {
              ...baseNode,
              comparison_window: {
                ...window,
                start: "2020-01-01T00:00:00.000Z",
                end: "2020-01-02T00:00:00.000Z",
              },
            },
          ],
        },
        "ANALYSIS_PLAN_TIME_WINDOW_NOT_APPROVED",
      ],
      [{ brief_ref: { ...base.plan.brief_ref, run_id: id(999) } }, "ANALYSIS_PLAN_SCOPE_MISMATCH"],
    ];
    for (const [change, expected] of variants) {
      const { plan_hash: _hash, ...changedMaterial } = { ...base.plan, ...change };
      const changed = {
        ...changedMaterial,
        plan_hash: await computeAnalysisPlanHash(changedMaterial),
      };
      const verdict = await gateAnalysisPlan({
        plan: changed,
        brief: base.brief,
        brief_ref: base.briefRef,
        context: base.context,
      });
      expect(verdict).toMatchObject({ ok: false, failure: expected });
    }
  });

  it("admits one repair only and rejects imports or reference authority expansion", async () => {
    const base = await fixture();
    const planRef = reference("AnalysisPlan", 20);
    const source = "import math\ndef main(sdk):\n    return math.fsum([1.0])\n";
    const sourceHash = `sha256:${createHash("sha256").update(source).digest("hex")}` as const;
    const sourceRef = reference("SensitiveExecutionArtifact", 21, sourceHash);
    const queryRef = reference("QueryEvidence", 22);
    const inputRef = reference("SandboxResult", 23);
    const admitted = await admitAnalysisProgram({
      plan: base.plan,
      plan_ref: planRef,
      node_id: "trend",
      source_text: source,
      source_text_ref: sourceRef,
      query_evidence_refs: [queryRef],
      input_refs: [inputRef],
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const repaired = "import math\ndef main(sdk):\n    return math.fsum([2.0])\n";
    const repairedRef = reference(
      "SensitiveExecutionArtifact",
      24,
      `sha256:${createHash("sha256").update(repaired).digest("hex")}`,
    );
    await expect(
      admitAnalysisProgramRepair({
        attempt: 1,
        previous_program: admitted.program,
        previous_source_text: source,
        repaired_source_text: repaired,
        repaired_source_text_ref: repairedRef,
        plan: base.plan,
        plan_ref: planRef,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      admitAnalysisProgramRepair({
        attempt: 2,
        previous_program: admitted.program,
        previous_source_text: source,
        repaired_source_text: repaired,
        repaired_source_text_ref: repairedRef,
        plan: base.plan,
        plan_ref: planRef,
      }),
    ).resolves.toEqual({ ok: false, failure: "PROGRAM_REPAIR_LIMIT_EXCEEDED" });
    const expanded = `${repaired}\nimport pandas\n`;
    await expect(
      admitAnalysisProgramRepair({
        attempt: 1,
        previous_program: admitted.program,
        previous_source_text: source,
        repaired_source_text: expanded,
        repaired_source_text_ref: reference(
          "SensitiveExecutionArtifact",
          25,
          `sha256:${createHash("sha256").update(expanded).digest("hex")}`,
        ),
        plan: base.plan,
        plan_ref: planRef,
      }),
    ).resolves.toEqual({ ok: false, failure: "PROGRAM_REPAIR_EXPANDED_AUTHORITY" });
  });

  it.each([
    ["TABULAR_IMPORT_ARCHIVE_LIMIT_EXCEEDED", { zip_uncompressed_bytes: 10_000_000 }],
    ["TABULAR_IMPORT_MACRO_REJECTED", { macro_detected: true }],
    ["TABULAR_IMPORT_EXTERNAL_LINK_REJECTED", { external_link_detected: true }],
    ["TABULAR_IMPORT_FORMULA_POLICY_REJECTED", { formula_cell_count: 1 }],
    ["TABULAR_IMPORT_ROW_LIMIT_EXCEEDED", { row_count: 100_001 }],
    ["TABULAR_IMPORT_COLUMN_LIMIT_EXCEEDED", { column_count: 257 }],
    ["TABULAR_IMPORT_CELL_LIMIT_EXCEEDED", { maximum_cell_bytes: 65_537 }],
    ["TABULAR_IMPORT_ENCODING_AMBIGUOUS", { encoding: "gb18030" }],
    ["TABULAR_IMPORT_TIMEOUT", { parse_ms: 60_001 }],
  ] as const)("rejects controlled parser attack: %s", async (failure, override) => {
    const bytes = Buffer.from("region,revenue\n华南,1\n", "utf8");
    const raw = reference(
      "ArtifactWorkspaceDocument",
      30,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
    const output = reference("ArtifactWorkspaceDocument", 31);
    const receipt = await executeControlledTabularImport({
      raw_artifact_ref: raw,
      raw_bytes: bytes,
      declared_mime_type: "text/csv",
      selected_sheet_names: ["sales.csv"],
      now: () => new Date(timestamp),
      parser: {
        async inspectAndMaterialize() {
          return {
            sniffed_format: "CSV",
            parse_ms: "parse_ms" in override ? override.parse_ms : 1,
            zip_uncompressed_bytes:
              "zip_uncompressed_bytes" in override ? override.zip_uncompressed_bytes : null,
            macro_detected: "macro_detected" in override && override.macro_detected,
            external_link_detected:
              "external_link_detected" in override && override.external_link_detected,
            encoding: "encoding" in override ? override.encoding : "utf-8",
            delimiter: ",",
            selected_sheet_names: ["sales.csv"],
            sheets: [
              {
                sheet_id: "sales",
                source_name: "sales.csv",
                normalized_name: "sales",
                row_count: "row_count" in override ? override.row_count : 1,
                column_count: "column_count" in override ? override.column_count : 2,
                maximum_cell_bytes:
                  "maximum_cell_bytes" in override ? override.maximum_cell_bytes : 8,
                formula_cell_count:
                  "formula_cell_count" in override ? override.formula_cell_count : 0,
                output_ref: output,
                output_format: "ARROW",
                output_hash: output.content_hash,
              },
            ],
            warnings: [],
          };
        },
      },
    });
    expect(receipt).toMatchObject({ status: "REJECTED", failure_code: failure, sheets: [] });
  });

  it("rejects narrative numbers and keeps chart calculations server-side", async () => {
    const evidence = reference("DerivedAnalysisEvidence", 40);
    const story = await selectEvidenceGroundedChartStory({
      scope: evidence,
      max_charts: 2,
      findings: [
        {
          finding_id: "accepted",
          evidence_ref: evidence,
          intent: "TREND",
          x_field: "month",
          y_field: "revenue",
          series_field: null,
          observed_numbers: [12],
          accepted_statement: "收入为 12",
          score: 10,
        },
        {
          finding_id: "invented",
          evidence_ref: evidence,
          intent: "TREND",
          x_field: "month",
          y_field: "revenue",
          series_field: null,
          observed_numbers: [12],
          accepted_statement: "收入增长 99",
          score: 100,
        },
      ],
    });
    expect(story.charts).toEqual([
      expect.objectContaining({ finding_id: "accepted", expression: null }),
    ]);
  });

  it.each([
    ["CRITICAL", "HOLD"],
    ["OPTIONAL", "PARTIAL"],
  ] as const)(
    "stale fence on a %s node produces %s and commits no receipt, result, or derived evidence",
    async (criticality, expectedTerminal) => {
      const base = await fixture();
      const { plan_hash: _planHash, ...planMaterial } = base.plan;
      const changedMaterial = {
        ...planMaterial,
        nodes: base.plan.nodes.map((node) => ({ ...node, criticality })),
      };
      const plan = analysisPlanPayloadSchema.parse({
        ...changedMaterial,
        plan_hash: await computeAnalysisPlanHash(changedMaterial),
      });
      const l2: string[] = [];
      const system: string[] = [];
      const source = "def main(sdk):\n    return None\n";
      const sourceRef = reference(
        "SensitiveExecutionArtifact",
        50,
        `sha256:${createHash("sha256").update(source).digest("hex")}`,
      );
      const queryRef = reference("QueryEvidence", 51);
      const inputRef = reference("SandboxResult", 52);
      const executor = createAnalysisPlanExecutor({
        artifacts: {
          async commitL2({ payload }) {
            const artifactType = payload.artifact_type;
            l2.push(artifactType);
            return reference(artifactType, 60 + l2.length, await sha256ContentHash(payload));
          },
          async commitSystem({ reference: output }) {
            system.push(output.artifact_type);
            return output;
          },
          async resolveCommitted() {
            return null;
          },
        },
        queries: {
          async execute() {
            return [
              {
                name: "input",
                format: "JSON",
                query_evidence_ref: queryRef,
                query_evidence_document: {},
                input_ref: inputRef,
                content: Buffer.from("{}"),
              },
            ];
          },
        },
        programs: {
          async load() {
            return { source_text: source, source_text_ref: sourceRef };
          },
        },
        oracle: {
          async expect() {
            return {
              expected_outputs: [{ name: "result", type: "JSON", content: Buffer.from("{}") }],
              result: {
                result_kind: "TREND_CHANGE",
                points: [],
                first_value: null,
                last_value: null,
              },
              sample_size: 0,
              coverage_ratio: 0,
              limitation_codes: ["INSUFFICIENT_SAMPLE_SIZE"],
              material_change: false,
            };
          },
        },
        sandbox: {
          async execute() {
            throw new Error("stale fence must stop before transport");
          },
          async cancel() {
            return {
              protocol_version: "data-agent-python-sandbox-control@1.0.0",
              status: "NOT_FOUND",
            };
          },
        },
        sandbox_authorization: "test-authorization-token-with-32-chars",
        fence_guard: {
          async isCurrent() {
            return false;
          },
        },
        references: {
          createSystem({ artifact_type, content_hash }) {
            return reference(artifact_type, 70 + system.length, content_hash);
          },
          create({ content_hash }) {
            return reference("SandboxResult", 80, content_hash);
          },
        },
        now: () => new Date(timestamp),
      });
      const result = await executor.execute({
        lease: {
          scope,
          principal_id: principalId,
          outbox_id: id(90),
          run_id: runId,
          command_id: id(91),
          command_kind: "START_L2_RESEARCH",
          attempt_id: id(92),
          attempt_no: 1,
          delivery_attempt_no: 1,
          lease_duration_ms: 60_000,
          worker_id: "analysis-worker",
          lease_token: 1,
          worker_fence: 1,
          expires_at: "2026-08-22T00:01:00.000Z",
          payload: {},
        },
        principal_id: principalId,
        brief: base.brief,
        brief_ref: base.briefRef,
        context: base.context,
        plan,
      });
      expect(result.completion.terminal).toBe(expectedTerminal);
      expect(result.completion.limitation_codes).toContain("SANDBOX_FENCE_STALE");
      expect(system).toEqual(["SandboxProgram"]);
      expect(l2).toEqual(["AnalysisPlan", "AnalysisCompletionReceipt"]);
    },
  );
});
