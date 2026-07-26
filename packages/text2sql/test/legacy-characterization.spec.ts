import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const fixtureRoot = new URL(
  "../../../tests/fixtures/text2sql/legacy-characterization/",
  import.meta.url,
);

async function readFixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(fileURLToPath(new URL(name, fixtureRoot)), {
      encoding: "utf8",
    }),
  );
}

const manifestSchema = z.strictObject({
  schema_version: z.literal("data-agent-legacy-characterization/v1"),
  source: z.strictObject({
    repository: z.literal("text2sql"),
    commit: z.literal("c36aca8977697ce7d7a67cbea8e77d67aee1676b"),
  }),
  assets: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        source_path: z.string().min(1),
        source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        local_fixture: z.string().endsWith(".json"),
        disposition: z.enum(["preserved", "tightened"]),
      }),
    )
    .length(5),
  rejected_framework_shapes: z.array(z.string().min(1)).min(1),
  new_u5_coverage: z.array(z.string().min(1)).length(3),
});

const sumDistinctSchema = z.strictObject({
  schema_version: z.literal("data-agent-text2sql-case/v1"),
  case_id: z.literal("ae1-sum-distinct"),
  question: z.string().min(1),
  semantic_intent: z.strictObject({
    metric: z.literal("total_payment_amount"),
    aggregation: z.literal("sum"),
    unit: z.literal("CNY"),
    grain: z.literal("payment"),
  }),
  baseline_sql: z.string().min(1),
  mutant_sql: z.string().min(1),
  oracle: z.strictObject({
    kind: z.literal("golden_result"),
    mandatory: z.literal(true),
    ordered: z.boolean(),
  }),
  fixtures: z
    .array(
      z.strictObject({
        fixture_id: z.enum(["unique-amounts", "duplicate-amounts"]),
        rows: z.array(z.strictObject({ amount: z.number() })).min(1),
        expected_rows: z.array(z.strictObject({ total_amount: z.number() })).length(1),
        mutant_detected: z.boolean(),
      }),
    )
    .length(2),
});

describe("旧版 Text2SQL 行为刻画", () => {
  it("固定来源提交、来源摘要与有意迁移边界", async () => {
    const manifest = manifestSchema.parse(await readFixture("manifest.json"));

    expect(new Set(manifest.assets.map(({ id }) => id)).size).toBe(5);
    expect(manifest.rejected_framework_shapes).toContain("langgraph-stage");
    expect(manifest.new_u5_coverage).toEqual([
      "fan-out",
      "null-semantics",
      "half-open-time-boundary",
    ]);
  });

  it("保留 SUM(DISTINCT) 在唯一值样本静默通过、在重复值样本暴露错误的反例", async () => {
    const fixture = sumDistinctSchema.parse(await readFixture("sum-distinct.json"));
    const uniqueAmounts = fixture.fixtures.find(
      ({ fixture_id }) => fixture_id === "unique-amounts",
    );
    const duplicateAmounts = fixture.fixtures.find(
      ({ fixture_id }) => fixture_id === "duplicate-amounts",
    );

    expect(uniqueAmounts?.mutant_detected).toBe(false);
    expect(duplicateAmounts?.mutant_detected).toBe(true);
    expect(duplicateAmounts?.rows.reduce((total, { amount }) => total + amount, 0)).toBe(40);
    expect(new Set(duplicateAmounts?.rows.map(({ amount }) => amount)).size).toBe(2);
  });

  it("保留 QueryContract 意图，但拒绝静默补 UTC 或未解析时间字段", async () => {
    const fixture = z
      .strictObject({
        schema_version: z.literal("data-agent-query-contract-mapping/v1"),
        preserved_fields: z.array(z.string()).min(1),
        tightened_fields: z.array(z.string()).min(1),
        rejected_defaults: z
          .array(
            z.strictObject({
              field: z.string().min(1),
              legacy_default: z.string().min(1),
              current_rule: z.string().min(1),
            }),
          )
          .length(2),
        revision_rule: z.string().min(1),
      })
      .parse(await readFixture("query-contract.json"));

    expect(fixture.rejected_defaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ legacy_default: "UTC" }),
        expect.objectContaining({ legacy_default: "unresolved_time_field" }),
      ]),
    );
    expect(fixture.tightened_fields).toContain("datasource_id");
  });

  it("把 legacy sandbox 明确映射为当前 EXECUTION，且执行前只允许五道 Gate", async () => {
    const fixture = z
      .strictObject({
        schema_version: z.literal("data-agent-gate-sealing/v1"),
        legacy_gate_mapping: z.record(z.string(), z.string()),
        pre_execution_gates: z.array(z.string()).length(5),
        sequence: z.array(z.string()).min(8),
        invariants: z.array(z.string()).min(5),
      })
      .parse(await readFixture("gate-sealing.json"));

    expect(fixture.legacy_gate_mapping.sandbox).toBe("EXECUTION");
    expect(fixture.pre_execution_gates).not.toContain("EXECUTION");
    expect(fixture.sequence.indexOf("ExecutionPermit")).toBeLessThan(
      fixture.sequence.indexOf("ExecutionReceipt"),
    );
    expect(fixture.sequence.at(-1)).toBe("QueryEvidence");
  });

  it("竞争指标未消歧时禁止创建 QueryContract 或 SQL Candidate", async () => {
    const fixture = z
      .strictObject({
        schema_version: z.literal("data-agent-semantic-ambiguity/v1"),
        case_id: z.literal("gross-vs-net-revenue"),
        question: z.string().min(1),
        conflict_set: z.array(z.string()).min(2),
        before_resolution: z.strictObject({
          decision: z.literal("CLARIFY"),
          query_contract_created: z.literal(false),
          sql_candidate_created: z.literal(false),
        }),
        after_resolution: z.strictObject({
          selected_metric: z.string().min(1),
          create_new_query_contract_revision: z.literal(true),
          invalidate_previous_candidates: z.literal(true),
        }),
      })
      .parse(await readFixture("semantic-ambiguity.json"));

    expect(new Set(fixture.conflict_set).size).toBe(fixture.conflict_set.length);
    expect(fixture.before_resolution.decision).toBe("CLARIFY");
    expect(fixture.after_resolution.invalidate_previous_candidates).toBe(true);
  });

  it("发布语义保持 synthetic HOLD、安全回归 NO_GO/ROLLBACK、真实成对结果才具备 GO 资格", async () => {
    const fixture = z
      .strictObject({
        schema_version: z.literal("data-agent-release-semantics/v1"),
        cases: z
          .array(
            z
              .object({
                case_id: z.string().min(1),
                expected_decision: z.enum(["HOLD", "GO_ELIGIBLE", "NO_GO_OR_ROLLBACK"]),
              })
              .passthrough(),
          )
          .length(4),
        public_projection_forbidden_fields: z.array(z.string()).min(1),
      })
      .parse(await readFixture("release-semantics.json"));
    const decisions = new Map(
      fixture.cases.map(({ case_id, expected_decision }) => [case_id, expected_decision]),
    );

    expect(decisions.get("sanitized-only")).toBe("HOLD");
    expect(decisions.get("mixed-version")).toBe("HOLD");
    expect(decisions.get("verified-paired-real-outcome")).toBe("GO_ELIGIBLE");
    expect(decisions.get("safety-regression")).toBe("NO_GO_OR_ROLLBACK");
    expect(fixture.public_projection_forbidden_fields).toContain("setup_sql");
  });
});
