import { createHash } from "node:crypto";
import {
  type AnalysisProgramPayload,
  type ArtifactReference,
  buildSemanticContextAuthoritySnapshot,
} from "@data-agent/contracts";
import { compileSemanticContextPackage } from "@data-agent/semantic/runtime-context";
import { describe, expect, it } from "vitest";
import { createDeepSeekAnalysisProgramSource } from "../../src/analysis/deepseek-program-source.js";
import { DEFAULT_ANALYSIS_SKILL_CATALOG } from "../../src/analysis/skill-catalog.js";

const id = (suffix: number) => `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

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
        parameters: { declared_method: "buyers-frequency-aov-shapley" },
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
    const existing = "import pandas as pd\ndef main(sdk):\n    sdk.write_json('result', {})\n";
    const existingHash = `sha256:${createHash("sha256").update(existing, "utf8").digest("hex")}` as const;
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
                "import pandas as pd\ndef main(sdk):\n    sdk.write_json('result', {})\n",
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
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      response_schema_version: "analysis-python-source@1.0.0",
    });
    const serialized = JSON.stringify(requests[0]);
    expect(serialized).toContain(base.contextPackage.package_hash);
    expect(serialized).toContain("monthly_orders");
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//iu);
    expect(serialized).not.toMatch(/password|api[_-]?key|raw_rows|row_values/iu);
  });

  it("rejects model substitution and scrubs repair failures to one bounded attempt", async () => {
    const base = await fixture();
    const prompts: string[] = [];
    let substituted = true;
    const source = createDeepSeekAnalysisProgramSource({
      contexts: {
        async load() {
          return { semantic_context_package: base.contextPackage, input_schemas: [] };
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
                "import pandas as pd\ndef main(sdk):\n    sdk.write_json('result', {})\n",
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
      previous_source_text: "import pandas as pd\ndef main(sdk):\n    pass\n",
      failure_code: "postgres://user:password@secret-host/falcon_db_24",
      attempt: 1,
    });
    const repair = JSON.parse(prompts[1] ?? "{}") as { repair?: { failure_code?: string } };
    expect(repair.repair?.failure_code).toBe("SANDBOX_EXECUTION_FAILED");
    expect(prompts[1]).not.toContain("secret-host");
  });
});
