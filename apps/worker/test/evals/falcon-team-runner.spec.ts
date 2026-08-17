import {
  buildFalconSemanticBundleIndex,
  CERTIFIED_MODEL_SQL_AGENT_ID,
  FALCON_DATASET_VERSION,
  FALCON_SOURCE_COMMIT,
  publicBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { BenchmarkEvalAgent } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import { createFalconTeamRunner } from "../../src/evals/falcon-team-runner.js";

const id = (suffix: number) => `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const ref = (suffix: number, character: string) => ({
  resource_id: id(suffix),
  resource_revision: 1,
  resource_hash: hash(character),
});

async function bundleIndex() {
  return buildFalconSemanticBundleIndex({
    schema_version: "falcon-semantic-bundle-index@1.0.0",
    scope,
    workspace_id: id(2),
    semantic_domain: "falcon",
    dataset_version: FALCON_DATASET_VERSION,
    source_commit: FALCON_SOURCE_COMMIT,
    source_digest: hash("1"),
    release_set_ref: ref(3, "2"),
    first_release_receipt_ref: ref(4, "3"),
    entries: Array.from({ length: 28 }, (_, index) => ({
      database_id: index + 1,
      schema_name: `falcon_db_${String(index + 1).padStart(2, "0")}`,
      package_ref: ref(100 + index, "4"),
      schema_snapshot_hash: hash("5"),
      admission_receipt_ref: ref(200 + index, "6"),
      coverage_receipt_hash: hash("7"),
      physical_object_count: 1,
      queryable_mapping_count: 1,
      join_count: 0,
      mandatory_assertions_passed: true,
    })),
    created_at: "2026-08-18T00:00:00.000Z",
  });
}

async function testCase(registry: "DEMO" | "OFFICIAL_TEST_BLIND" = "DEMO") {
  const draft = {
    case_id: registry === "DEMO" ? id(300) : id(301),
    suite_id: "falcon" as const,
    suite_version: "1.0.0",
    dataset_version: FALCON_DATASET_VERSION,
    ordinal: 1,
    database_id: registry === "DEMO" ? "falcon_db_14" : "falcon_db_01",
    question: "Return the product count.",
    evidence: "Use the public schema.",
    difficulty: "simple" as const,
    capabilities: ["TEXT_TO_SQL" as const],
    registry,
    runnable: true,
    status_reason: null,
    schema: [
      {
        name: "products",
        columns: [{ name: "id", data_type: "BIGINT", nullable: false, primary_key: true }],
      },
    ],
  };
  return publicBenchmarkCaseSchema.parse({
    ...draft,
    public_case_hash: await sha256ContentHash(draft),
  });
}

function agent(onReflect?: () => void): BenchmarkEvalAgent {
  return {
    descriptor: {
      agent_id: CERTIFIED_MODEL_SQL_AGENT_ID,
      agent_version: "fixture@1.0.0",
      display_name: "Fixture SQL Agent",
      kind: "CERTIFIED_MODEL_SQL",
      provider: "deepseek",
      model_id: "fixture",
      available: true,
      unavailable_reason: null,
      supports_reflection: true,
    },
    answer: async () => ({
      sql: "select count(*) from products",
      usage: { input_tokens: 10, output_tokens: 5, cost_micros: 0, currency: "USD" },
      latency_ms: 1,
    }),
    reflect: async () => {
      onReflect?.();
      return {
        diagnosis_summary: "Blind schema review completed.",
        proposed_actions: ["Keep the query."],
        confidence: 1,
        retry_recommendation: "APPROVED",
        revised_answer: {
          sql: "select count(id) from products",
          usage: { input_tokens: 10, output_tokens: 5, cost_micros: 0, currency: "USD" },
          latency_ms: 1,
        },
      };
    },
  };
}

describe("FalconTeamRunner", () => {
  it("freezes blind reflection before Oracle and emits Team/Usage/Report evidence", async () => {
    let reflected = false;
    let oracleCalls = 0;
    const runner = createFalconTeamRunner({
      scope,
      bundle_index: await bundleIndex(),
      agent_profile_hashes: {
        orchestrator: hash("8"),
        text2sql: hash("9"),
        report: hash("a"),
      },
      create_agent: () => agent(() => (reflected = true)),
      oracle: {
        evaluate: async (input) => {
          expect(reflected).toBe(true);
          oracleCalls += 1;
          return {
            verdict: input.candidate_sql.includes("count") ? "PASS" : "FAIL",
            feedback: {
              oracle_version: "fixture@1.0.0",
              failure_type: null,
              public_message: "pass",
              candidate_row_count: 1,
              gold_row_count: 1,
              candidate_column_count: 1,
              gold_column_count: 1,
              oracle_receipt_hash: hash("b"),
            },
            candidate_result_hash: hash("c"),
            gold_result_hash: hash("d"),
            diagnostic_code: null,
          };
        },
      },
      observe_invocation: () => ({
        invocation_id: id(20),
        invocation_hash: hash("e"),
        input_tokens: 10,
        output_tokens: 5,
        usage_available: true,
      }),
    });
    const result = await runner.runCase({
      test_case: await testCase(),
      mode: "DEV",
      reflection_mode: "BLIND",
      report: true,
      seed: 42,
    });

    expect(oracleCalls).toBe(2);
    expect(result).toMatchObject({ status: "PASS", first_verdict: "PASS", final_verdict: "PASS" });
    expect(result.team_trace.tasks).toHaveLength(3);
    expect(result.team_trace.handoffs).toHaveLength(2);
    expect(result.semantic_usage_receipt?.token_usage.availability).toBe("AVAILABLE");
    expect(result.report?.citation_hash).toBe(
      result.semantic_usage_receipt?.query_evidence_ref.resource_hash,
    );
  });

  it("runs TEST as unscored submission without calling the sealed Oracle", async () => {
    const runner = createFalconTeamRunner({
      scope,
      bundle_index: await bundleIndex(),
      agent_profile_hashes: {
        orchestrator: hash("8"),
        text2sql: hash("9"),
        report: hash("a"),
      },
      create_agent: () => agent(),
      oracle: { evaluate: async () => Promise.reject(new Error("ORACLE_MUST_NOT_RUN")) },
      observe_invocation: () => ({
        invocation_id: id(20),
        invocation_hash: hash("e"),
        input_tokens: null,
        output_tokens: null,
        usage_available: false,
      }),
    });
    const result = await runner.runCase({
      test_case: await testCase("OFFICIAL_TEST_BLIND"),
      mode: "TEST",
      reflection_mode: "NONE",
      report: false,
      seed: 42,
    });

    expect(result).toMatchObject({ status: "SUBMITTED", first_verdict: null, final_verdict: null });
    expect(result.team_trace.tasks).toHaveLength(2);
    expect(result.semantic_usage_receipt?.token_usage.availability).toBe("UNAVAILABLE");
  });
});
