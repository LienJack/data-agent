import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  buildSemanticContextAuthoritySnapshot,
} from "@data-agent/contracts";
import { compileSemanticContextPackage } from "@data-agent/semantic/runtime-context";
import { describe, expect, it } from "vitest";
import {
  createDeepSeekAnalysisProgramSource,
  deepSeekAnalysisProgramSourceInternals,
} from "../../src/analysis/deepseek-program-source.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../../src/analysis/skill-catalog.js";

const id = (suffix: number) => `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);
const analysisContract = {
  case_id: "falcon24-business-review-18m",
  statistical_method_contract: ["Compute monthly KPIs at order grain."],
  semantic_contract: {
    semantic_release_hash: hash("2"),
    metrics: [
      {
        metric_id: "metric.order_revenue",
        definition: "SUM(order_total)",
        formula_id: "formula.order_revenue",
        grain: { grain_id: "grain.order", granularity: "atomic" },
        unit: {
          unit_id: "unit.currency",
          dimension: "currency",
          base_unit: null,
          conversion_factor: null,
        },
        time_dimension_id: "blinkit_orders.order_date",
        additivity: "additive",
        null_policy: "exclude",
        allowed_dimension_ids: ["dimension.order_month"],
      },
    ],
    formulas: [
      {
        formula_id: "formula.order_revenue",
        expression: "SUM(order_total)",
        expression_hash: hash("f"),
      },
    ],
    dimensions: [
      {
        dimension_id: "dimension.order_month",
        definition: "blinkit_orders.order_date",
        grain: { grain_id: "grain.order_month", granularity: "month" },
        data_type: "date",
      },
    ],
    relationships: [],
    quality_rules: [],
  },
  output_json_schema: {
    type: "object",
    required: ["case_id"],
    properties: { case_id: { const: "falcon24-business-review-18m" } },
  },
} as const;

function reference(
  artifact_type: ArtifactReference["artifact_type"],
  suffix: number,
  content_hash: `sha256:${string}`,
): ArtifactReference {
  return {
    artifact_id: id(suffix),
    artifact_type,
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash,
  };
}

async function semanticContextPackage() {
  const authority = await buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "falcon24",
    question: "分析订单收入变化",
    defaults_ref: { defaults_id: id(4), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(5),
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: id(6),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(6),
      semantic_release_id: id(5),
      semantic_generation: 1,
    },
    context_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 8_192,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(9),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [
      {
        metric_id: "order_revenue",
        name: "订单收入",
        aliases: ["收入"],
        mapping_refs: ["orders.total_amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("8")],
  });
  return compileSemanticContextPackage(authority);
}

async function fixture() {
  const contextPackage = await semanticContextPackage();
  const descriptor = DEFAULT_ANALYSIS_SKILL_CATALOG.resolve("open-python-analysis@1");
  const program: AnalysisProgramPayload = {
    artifact_type: "AnalysisProgram",
    protocol_version: "analysis-program@1.0.0",
    brief_ref: reference("ResearchBrief", 10, hash("9")) as never,
    analysis_context_hash: hash("a"),
    semantic_context_package_hash: contextPackage.package_hash,
    nodes: [
      {
        node_id: "falcon24-question-1",
        skill_id: "open-python-analysis@1",
        metric_refs: [
          {
            container_ref: reference("SemanticRelease", 5, hash("2")) as never,
            node_id: "order_revenue",
          },
        ],
        dimension_refs: ["customer_type"],
        time_window: {
          start: "2023-05-01T00:00:00.000Z",
          end: "2024-11-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        comparison_window: null,
        parameters: {
          declared_method: "buyers-frequency-aov-shapley",
          required_methods: [
            "buyers-frequency-aov-shapley",
            "full-month-window",
            "monthly-kpi-trend",
            "revenue-worst-mom",
            "segment-driver-decomposition",
          ],
        },
        execution_mode: "MODEL_GENERATED",
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
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: 120_000,
    },
    compiler_kind: "MODEL_CANDIDATE_HOST_VERIFIED",
    compiler_version: "falcon24-analysis-program@1.0.0",
    program_hash: hash("b"),
  };
  const lease = {
    scope,
    principal_id: id(11),
    outbox_id: id(12),
    run_id: runId,
    command_id: id(13),
    command_kind: "START_L2_RESEARCH",
    attempt_id: id(14),
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 120_000,
    worker_id: "analysis-worker",
    lease_token: 1,
    worker_fence: 1,
    expires_at: "2026-08-24T00:02:00.000Z",
    payload: {},
  } as const;
  const programRef = reference("AnalysisProgram", 15, program.program_hash as `sha256:${string}`);
  const node = program.nodes[0];
  if (!node) throw new TypeError("missing analysis node fixture");
  return { contextPackage, lease, node, program, programRef };
}

describe("DeepSeek governed Python source", () => {
  it("replays committed source before loading context or calling DeepSeek", async () => {
    const base = await fixture();
    const existing =
      "import pandas as pd\ndef main(context):\n    context.write_json('result', {})\n";
    const existingHash =
      `sha256:${createHash("sha256").update(existing, "utf8").digest("hex")}` as const;
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          throw new Error("context must not load during replay");
        },
      },
      model: {
        async generate() {
          throw new Error("provider must not run during replay");
        },
      },
      artifacts: {
        async load() {
          return {
            source_text: existing,
            source_text_ref: reference("SensitiveExecutionArtifact", 18, existingHash),
          };
        },
        async commit() {
          throw new Error("source must not recommit during replay");
        },
      },
      standard_programs: {
        async load() {
          throw new Error("standard program must not load");
        },
      },
    });

    await expect(
      source.load({
        lease: base.lease,
        analysis_program: base.program,
        analysis_program_ref: base.programRef,
        node: base.node,
        standard_program: null,
      }),
    ).resolves.toMatchObject({
      source_text: existing,
      source_text_ref: { content_hash: existingHash },
    });
  });

  it("uses the fixed model and sends semantic/schema projections without rows or secrets", async () => {
    const base = await fixture();
    const requests: unknown[] = [];
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          return {
            semantic_context_package: base.contextPackage,
            analysis_contract: analysisContract,
            input_schemas: [
              {
                input_name: "monthly_orders",
                format: "JSON",
                row_count_upper_bound: 18,
                fields: [
                  { name: "month", data_type: "DATE", nullable: false },
                  { name: "revenue", data_type: "NUMBER", nullable: false },
                ],
              },
            ],
          };
        },
      },
      model: {
        async generate(request) {
          requests.push(request);
          return {
            provider: "deepseek",
            model_id: "deepseek-v4-flash",
            provider_invocation_ref: {
              resource_id: id(90),
              resource_revision: 1,
              resource_hash: hash("9"),
            },
            output_text: JSON.stringify({
              schema_version: "analysis-python-source@1.0.0",
              python_source:
                "import pandas as pd\ndef main(context):\n    context.write_json('result', {})\n",
            }),
          };
        },
      },
      artifacts: {
        async commit(input) {
          return reference("SensitiveExecutionArtifact", 16, input.source_sha256);
        },
      },
      standard_programs: {
        async load() {
          throw new Error("not used");
        },
      },
    });
    const result = await source.load({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      standard_program: null,
    });
    expect(result.source_text_ref.artifact_type).toBe("SensitiveExecutionArtifact");
    expect(result.source_text_ref.content_hash).toBe(
      `sha256:${createHash("sha256").update(result.source_text, "utf8").digest("hex")}`,
    );
    expect(result.provider_invocation_ref).toEqual({
      resource_id: id(90),
      resource_revision: 1,
      resource_hash: hash("9"),
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      response_schema_version: "analysis-python-source@1.0.0",
    });
    const serialized = JSON.stringify(requests[0]);
    expect(serialized).toContain(base.contextPackage.package_hash);
    expect(serialized).toContain("monthly_orders");
    expect(serialized).toContain("statistical_method_contract");
    expect(serialized).toContain("semantic_contract");
    expect(serialized).toContain("SUM(order_total)");
    expect(serialized).toContain("dimension.order_month");
    expect(serialized).toContain("output_json_schema");
    expect(serialized).toContain("def main(context)");
    expect(serialized).toContain("pandas.to_datetime(frame[column], errors='raise', utc=True)");
    expect(serialized).toContain("pandas.Timestamp(..., tz='UTC')");
    expect(serialized).toContain("pandas.Categorical");
    expect(serialized).toContain("series.astype(str)");
    expect(serialized).toContain("complete import-root allowlist");
    expect(serialized).toContain("Do not import typing, dataclasses, itertools");
    expect(serialized).toContain("literal constant assignments");
    expect(serialized).toContain("Verify helper call arity");
    expect(serialized).toContain("buyers-frequency-aov-shapley");
    const bounded = JSON.parse((requests[0] as { prompt: string }).prompt) as {
      method_evidence_contract?: { exact_key_set?: boolean; required_keys?: string[] };
    };
    expect(bounded.method_evidence_contract?.exact_key_set).toBe(true);
    expect(bounded.method_evidence_contract?.required_keys).toEqual([
      "buyers-frequency-aov-shapley",
      "full-month-window",
      "monthly-kpi-trend",
      "revenue-worst-mom",
      "segment-driver-decomposition",
    ]);
    expect(serialized).not.toContain("def main(sdk)");
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//iu);
    expect(serialized).not.toMatch(/password|api[_-]?key|raw_rows|row_values/iu);
  });

  it("gives the bounded repair attempt a deterministic policy correction", async () => {
    const base = await fixture();
    const prompts: string[] = [];
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          return {
            semantic_context_package: base.contextPackage,
            analysis_contract: analysisContract,
            input_schemas: [],
          };
        },
      },
      model: {
        async generate(request) {
          prompts.push(request.prompt);
          return {
            provider: "deepseek",
            model_id: "deepseek-v4-flash",
            provider_invocation_ref: {
              resource_id: id(92),
              resource_revision: 1,
              resource_hash: hash("7"),
            },
            output_text: JSON.stringify({
              schema_version: "analysis-python-source@1.0.0",
              python_source:
                "import pandas as pd\ndef main(context):\n    context.write_json('result', {})\n",
            }),
          };
        },
      },
      artifacts: {
        async commit(input) {
          return reference("SensitiveExecutionArtifact", 19, input.source_sha256);
        },
      },
      standard_programs: {
        async load() {
          throw new Error("not used");
        },
      },
    });

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text:
        "def main(context):\n    value = context.read('input')\n    hasattr(value, 'shape')\n",
      failure_code: "PYTHON_POLICY_CALL_DENIED",
      attempt: 1,
    });

    const prompt = JSON.parse(prompts[0] ?? "{}") as {
      repair?: { failure_code?: string; required_correction?: string };
    };
    expect(prompt.repair?.failure_code).toBe("PYTHON_POLICY_CALL_DENIED");
    expect(prompt.repair?.required_correction).toContain("pandas.to_datetime");
    expect(prompt.repair?.required_correction).toContain("hasattr/getattr/setattr");
    expect(
      deepSeekAnalysisProgramSourceInternals.scrubFailureCode(
        "FALCON24_ORACLE_METHOD_EVIDENCE_INVALID",
      ),
    ).toBe("FALCON24_ORACLE_METHOD_EVIDENCE_INVALID");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text:
        "VALUES = [str(value) for value in range(3)]\ndef main(context):\n    pass\n",
      failure_code: "PYTHON_POLICY_TOP_LEVEL_EFFECT_DENIED",
      attempt: 1,
    });
    const topLevelRepair = JSON.parse(prompts[1] ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(topLevelRepair.repair?.required_correction).toContain(
      "comprehensions and function calls are forbidden at module scope",
    );

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text:
        "from typing import Any\nimport pandas as pd\ndef main(context):\n    pass\n",
      failure_code: "PYTHON_POLICY_IMPORT_DENIED",
      attempt: 1,
    });
    const importRepair = JSON.parse(prompts[2] ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(importRepair.repair?.required_correction).toContain("complete import-root allowlist");
    expect(importRepair.repair?.required_correction).toContain("typing and dataclasses");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context):\n    pass\n",
      failure_code: "FALCON24_Q1_WORST_MONTH_INVALID",
      attempt: 1,
    });
    const worstMonthRepair = JSON.parse(prompts[3] ?? "{}") as {
      repair?: { failure_code?: string; required_correction?: string };
    };
    expect(worstMonthRepair.repair?.failure_code).toBe("FALCON24_Q1_WORST_MONTH_INVALID");
    expect(worstMonthRepair.repair?.required_correction).toContain("minimum absolute_change");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text:
        "def main(context):\n    value = context.read('input')\n    hasattr(value, 'shape')\n",
      failure_code: "PROGRAM_HOST_POLICY_REJECTED",
      attempt: 1,
    });
    const hostPolicyRepair = JSON.parse(prompts[4] ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(hostPolicyRepair.repair?.required_correction).toContain("preserve or reduce");
    expect(hostPolicyRepair.repair?.required_correction).toContain("context.read");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context):\n    pass\n",
      failure_code: "FALCON24_Q2_GLM_CONTROL_MISSING",
      attempt: 1,
    });
    const q2ControlRepair = JSON.parse(prompts[5] ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(q2ControlRepair.repair?.required_correction).toContain("log_order_amount");
    expect(q2ControlRepair.repair?.required_correction).toContain("semantic identifiers");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context):\n    pass\n",
      failure_code: "FALCON24_ORACLE_CAUSAL_LANGUAGE_REJECTED",
      attempt: 1,
    });
    const associationRepair = JSON.parse(prompts[6] ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(associationRepair.repair?.required_correction).toContain("exact word 关联");
    expect(associationRepair.repair?.required_correction).toContain("ASSOCIATION_ONLY");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q3_RAW_P_MISMATCH",
      standard_program: null,
    });
    const mannKendallRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(mannKendallRepair.repair?.required_correction).toContain("continuity correction");
    expect(mannKendallRepair.repair?.required_correction).toContain("math.erf");
    expect(mannKendallRepair.repair?.required_correction).toContain("scipy.stats.kendalltau");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q3_THEIL_SEN_MISMATCH",
      standard_program: null,
    });
    const theilSenRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(theilSenRepair.repair?.required_correction).toContain("x=0..11");
    expect(theilSenRepair.repair?.required_correction).toContain("all 66 slopes");
    expect(theilSenRepair.repair?.required_correction).toContain("ordinal days");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q3_BH_Q_MISMATCH",
      standard_program: null,
    });
    const bhRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(bhRepair.repair?.required_correction).toContain("every product");
    expect(bhRepair.repair?.required_correction).toContain("1-based rank");
    expect(bhRepair.repair?.required_correction).toContain("reverse monotonicity");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q4_WEEK_WINDOW_INVALID",
      standard_program: null,
    });
    const marketingWindowRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(marketingWindowRepair.repair?.required_correction).toContain("2024-11-01");
    expect(marketingWindowRepair.repair?.required_correction).toContain("79 Mondays");
    expect(marketingWindowRepair.repair?.required_correction).toContain(
      "day after the last Monday",
    );

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q4_CONTROL_MISSING",
      standard_program: null,
    });
    const marketingControlRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(marketingControlRepair.repair?.required_correction).toContain("['trend','seasonality']");
    expect(marketingControlRepair.repair?.required_correction).toContain(
      "semantic evidence identifiers",
    );

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def main(context): pass",
      failure_code: "FALCON24_Q4_HAC_P_MISMATCH",
      standard_program: null,
    });
    const marketingStatisticsRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(marketingStatisticsRepair.repair?.required_correction).toContain(
      "shared business-by-week",
    );
    expect(marketingStatisticsRepair.repair?.required_correction).toContain(
      "distinct (channel,target_audience) tuples",
    );
    expect(marketingStatisticsRepair.repair?.required_correction).toContain("spend[0:79-L]");
    expect(marketingStatisticsRepair.repair?.required_correction).toContain(
      "maps for all three outcomes",
    );
    expect(marketingStatisticsRepair.repair?.required_correction).toContain("use_correction':True");
    expect(marketingStatisticsRepair.repair?.required_correction).toContain("normal z p-value");

    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "def helper(a):\n    return a\ndef main(context):\n    helper(1, 2)\n",
      failure_code: "PYTHON_TYPE_ERROR",
      attempt: 1,
    });
    const typeRepair = JSON.parse(prompts.at(-1) ?? "{}") as {
      repair?: { required_correction?: string };
    };
    expect(typeRepair.repair?.required_correction).toContain("argument counts identical");
    expect(typeRepair.repair?.required_correction).toContain("timezone-aware UTC");
    expect(typeRepair.repair?.required_correction).toContain("pandas.Categorical");
    expect(typeRepair.repair?.required_correction).toContain("series.astype(str)");
  });

  it("rejects model substitution and scrubs repair failures to one bounded attempt", async () => {
    const base = await fixture();
    const prompts: string[] = [];
    let substituted = true;
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          return {
            semantic_context_package: base.contextPackage,
            analysis_contract: analysisContract,
            input_schemas: [],
          };
        },
      },
      model: {
        async generate(request) {
          prompts.push(request.prompt);
          return {
            provider: "deepseek",
            model_id: substituted ? ("deepseek-other" as never) : "deepseek-v4-flash",
            provider_invocation_ref: {
              resource_id: id(91),
              resource_revision: 1,
              resource_hash: hash("8"),
            },
            output_text: JSON.stringify({
              schema_version: "analysis-python-source@1.0.0",
              python_source:
                "import pandas as pd\ndef main(context):\n    context.write_json('result', {})\n",
            }),
          };
        },
      },
      artifacts: {
        async commit(input) {
          return reference("SensitiveExecutionArtifact", 17, input.source_sha256);
        },
      },
      standard_programs: {
        async load() {
          throw new Error("not used");
        },
      },
    });
    await expect(
      source.load({
        lease: base.lease,
        analysis_program: base.program,
        analysis_program_ref: base.programRef,
        node: base.node,
        standard_program: null,
      }),
    ).rejects.toThrow("ANALYSIS_PYTHON_MODEL_IDENTITY_MISMATCH");
    substituted = false;
    await source.repair?.({
      lease: base.lease,
      analysis_program: base.program,
      analysis_program_ref: base.programRef,
      node: base.node,
      previous_source_text: "import pandas as pd\ndef main(context):\n    pass\n",
      failure_code: "postgres://user:password@secret-host/falcon_db_24",
      attempt: 1,
    });
    const repair = JSON.parse(prompts[1] ?? "{}") as { repair?: { failure_code?: string } };
    expect(repair.repair?.failure_code).toBe("SANDBOX_EXECUTION_FAILED");
    expect(prompts[1]).not.toContain("secret-host");
  });

  it("rejects a semantic contract bound to a different published release", async () => {
    const base = await fixture();
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          return {
            semantic_context_package: base.contextPackage,
            analysis_contract: {
              ...analysisContract,
              semantic_contract: {
                ...analysisContract.semantic_contract,
                semantic_release_hash: hash("e"),
              },
            },
            input_schemas: [],
          };
        },
      },
      model: {
        async generate() {
          throw new Error("model must not be called");
        },
      },
      artifacts: {
        async commit() {
          throw new Error("artifact must not be committed");
        },
      },
      standard_programs: {
        async load() {
          throw new Error("not used");
        },
      },
    });

    await expect(
      source.load({
        lease: base.lease,
        analysis_program: base.program,
        analysis_program_ref: base.programRef,
        node: base.node,
        standard_program: null,
      }),
    ).rejects.toThrow("ANALYSIS_PYTHON_SEMANTIC_CONTRACT_RELEASE_MISMATCH");
  });
});
