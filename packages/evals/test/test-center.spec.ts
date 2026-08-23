import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BenchmarkOracleFeedback,
  benchmarkAgentDescriptorSchema,
  benchmarkAnalysisReportSchema,
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  sealedBenchmarkCaseSchema,
  sealedInsightBenchmarkCaseSchema,
  sealedMultipleChoiceBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BenchmarkAgentAnswer,
  type BenchmarkAgentReflection,
  type BenchmarkAnalysisAgent,
  type BenchmarkAnalysisAgentAnswer,
  type BenchmarkAnalysisAgentReflection,
  type BenchmarkEvalAgent,
  type BenchmarkMultipleChoiceAgent,
  type BirdMiniDevDataset,
  executeBirdBenchmarkBatch,
  executeInsightBenchBatch,
  executeMultipleChoiceBenchmarkBatch,
  getBenchmarkCatalog,
  InsightBenchRuleOracle,
  parseBenchmarkCsv,
  SqliteResultOracle,
  validateBenchmarkArchiveListing,
} from "../src/test-center/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("benchmark catalog", () => {
  it("advertises exact-choice reflection for BLADE", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-catalog-"));
    temporaryDirectories.push(root);
    const catalog = await getBenchmarkCatalog(root);
    expect(catalog.find((suite) => suite.suite_id === "blade")?.supports_reflection).toBe(true);
  });

  it("advertises verified E-commerce SQL execution while retaining per-case Python gates", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-agent-catalog-"));
    temporaryDirectories.push(root);
    const catalog = await getBenchmarkCatalog(root);
    const suite = catalog.find((entry) => entry.suite_id === "ecommerce-production");
    expect(suite).toMatchObject({
      dataset_status: "READY",
      previewable: true,
      runnable: true,
    });
    expect(suite?.installed_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});

describe("InsightBench analysis boundary", () => {
  it("parses quoted CSV fields without changing row width", () => {
    const csv = parseBenchmarkCsv(
      'category,description\nHardware,"Printer, office 2"\nSoftware,Portal\n',
    );
    expect(csv.headers).toEqual(["category", "description"]);
    expect(csv.rows[0]?.description).toBe("Printer, office 2");
  });

  it("scores reports with sealed references and keeps reference values out of feedback", async () => {
    const publicDraft = {
      case_id: randomUUID(),
      suite_id: "insightbench" as const,
      suite_version: "1.0.0",
      dataset_version: "insightbench-hf-fd1a1cad",
      ordinal: 0,
      database_id: "fixture-analysis",
      question: "Find the category imbalance.",
      evidence: "A small incident dataset.",
      difficulty: "moderate" as const,
      capabilities: ["ANALYSIS_REPORT" as const],
      registry: "DEMO" as const,
      schema: [
        {
          name: "dataset",
          columns: [{ name: "category", data_type: "TEXT", nullable: false, primary_key: false }],
        },
      ],
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = {
      public_case: publicCase,
      data_relative_path: "data/fixture.csv",
      reference_summary: "Hardware represents 67% of incidents and is concentrated in Australia.",
      reference_insights: [
        "hardware incidents is significantly higher than others",
        "hardware incidents are concentrated in Australia",
      ],
      reference_values: ["Hardware", "67%", "Australia", "335"],
    };
    const sealedCase = sealedInsightBenchmarkCaseSchema.parse({
      ...sealedDraft,
      sealed_case_hash: await sha256ContentHash(sealedDraft),
    });
    const goodReport = benchmarkAnalysisReportSchema.parse({
      answer_type: "ANALYSIS_REPORT",
      summary: "Hardware represents 67% of incidents and is concentrated in Australia.",
      insights: [
        {
          title: "Hardware concentration",
          finding: "Hardware incidents are significantly higher than others.",
          evidence: "Hardware: 335; Australia is the leading location.",
          recommendation: "Rebalance incident support resources.",
        },
      ],
    });
    const oracle = new InsightBenchRuleOracle();
    const result = await oracle.evaluate({ report: goodReport, sealed_case: sealedCase });
    expect(result.verdict).toBe("PASS");
    expect(result.normalized_score).toBeGreaterThan(22.5);
    expect(result.feedback.metric_scores?.composite).toBeGreaterThan(0.225);
    expect(JSON.stringify(result.feedback)).not.toContain("Australia");
    expect(JSON.stringify(result.feedback)).not.toContain("335");

    class RecoveringAnalysisAgent implements BenchmarkAnalysisAgent {
      readonly descriptor = benchmarkAgentDescriptorSchema.parse({
        agent_id: randomUUID(),
        agent_version: "fixture-analysis@1.0.0",
        display_name: "Fixture analysis agent",
        kind: "DETERMINISTIC_ANALYSIS_BASELINE",
        provider: "fixture",
        model_id: null,
        available: true,
        unavailable_reason: null,
        supports_reflection: true,
      });
      async answer(): Promise<BenchmarkAnalysisAgentAnswer> {
        return {
          report: benchmarkAnalysisReportSchema.parse({
            answer_type: "ANALYSIS_REPORT",
            summary: "No material pattern found.",
            insights: [
              {
                title: "No pattern",
                finding: "The data appears balanced.",
                evidence: "Initial profile only.",
                recommendation: "Collect more data.",
              },
            ],
          }),
          usage,
          latency_ms: 1,
        };
      }
      async reflect(input: {
        readonly feedback: BenchmarkOracleFeedback;
      }): Promise<BenchmarkAnalysisAgentReflection> {
        expect(JSON.stringify(input.feedback)).not.toContain("Hardware");
        return {
          diagnosis_summary: "Initial grouping was too shallow.",
          proposed_actions: ["Expand categorical grouping."],
          confidence: 0.9,
          retry_recommendation: "APPROVED",
          revised_answer: { report: goodReport, usage, latency_ms: 1 },
        };
      }
    }
    const run = await executeInsightBenchBatch({
      dataset: {
        installation_directory: "/fixture",
        public_cases: [publicCase],
        sealed_cases: [sealedCase],
        csv_by_case_id: new Map([[publicCase.case_id, "category\nHardware\nSoftware\n"]]),
        installed_digest: `sha256:${"b".repeat(64)}`,
      },
      case_ids: [publicCase.case_id],
      agent: new RecoveringAnalysisAgent(),
      reflection_enabled: true,
      budget,
      seed: 42,
    });
    expect(run.case_runs[0]?.attempts.map((attempt) => attempt.verdict)).toEqual(["FAIL", "PASS"]);
    expect(run.case_runs[0]?.reflection?.mutable_scope).toEqual(["ANALYSIS_REPORT"]);
    expect(run.scorecard.recovery_rate).toBe(1);
  });
});

async function fixtureDataset(caseCount = 1): Promise<BirdMiniDevDataset> {
  const directory = await mkdtemp(join(tmpdir(), "data-agent-test-center-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "fixture.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    create table heroes (id integer primary key, name text not null, score real, note text);
    insert into heroes (id, name, score, note) values
      (1, 'Alpha', 0.3000001, null),
      (2, 'Beta', 0.6, 'ready'),
      (3, 'Beta', 0.6, 'ready');
  `);
  database.close();

  const publicCases: PublicBenchmarkCase[] = [];
  const sealedCases: Array<ReturnType<typeof sealedBenchmarkCaseSchema.parse>> = [];
  for (let index = 0; index < caseCount; index += 1) {
    const publicDraft = {
      case_id: randomUUID(),
      suite_id: "bird-mini-dev" as const,
      suite_version: "1.0.0",
      dataset_version: "bird-mini-dev-v1-2024-06",
      ordinal: index,
      database_id: "fixture",
      question: index === 0 ? "Return Alpha's name." : "Return all hero names.",
      evidence: null,
      difficulty: index === 0 ? ("simple" as const) : ("moderate" as const),
      capabilities: ["TEXT_TO_SQL" as const],
      registry: "DEMO" as const,
      schema: [
        {
          name: "heroes",
          columns: [
            { name: "id", data_type: "integer", nullable: false, primary_key: true },
            { name: "name", data_type: "text", nullable: false, primary_key: false },
            { name: "score", data_type: "real", nullable: true, primary_key: false },
            { name: "note", data_type: "text", nullable: true, primary_key: false },
          ],
        },
      ],
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = {
      public_case: publicCase,
      database_relative_path: "fixture.sqlite",
      gold_sql:
        index === 0
          ? "select name from heroes where id = 1"
          : "select name from heroes order by id",
    };
    publicCases.push(publicCase);
    sealedCases.push(
      sealedBenchmarkCaseSchema.parse({
        ...sealedDraft,
        sealed_case_hash: await sha256ContentHash(sealedDraft),
      }),
    );
  }
  return {
    installation_directory: directory,
    public_cases: publicCases,
    sealed_cases: sealedCases,
    published_predictions: {},
    database_path: databasePath,
    installed_digest: `sha256:${"a".repeat(64)}`,
  };
}

const usage = {
  availability: "AVAILABLE" as const,
  input_tokens: 10,
  output_tokens: 5,
  tool_calls: 0,
};

class RecoveringAgent implements BenchmarkEvalAgent {
  readonly descriptor = benchmarkAgentDescriptorSchema.parse({
    agent_id: randomUUID(),
    agent_version: "fixture-agent@1.0.0",
    display_name: "Fixture recovering agent",
    kind: "OPENAI_SQL_BASELINE",
    provider: "fixture",
    model_id: "fixture-model",
    available: true,
    unavailable_reason: null,
    supports_reflection: true,
  });

  async answer(): Promise<BenchmarkAgentAnswer> {
    return { sql: "select name from heroes where id = 999", usage, latency_ms: 4 };
  }

  async reflect(input: {
    readonly feedback: BenchmarkOracleFeedback;
  }): Promise<BenchmarkAgentReflection> {
    expect(input.feedback.failure_type).toBe("ORACLE_MISMATCH");
    expect(JSON.stringify(input.feedback)).not.toContain("Alpha");
    return {
      diagnosis_summary: "过滤条件没有命中目标实体，需要重新绑定题面中的实体标识。",
      proposed_actions: ["仅修正当前 SQL 的过滤条件。"],
      confidence: 0.8,
      retry_recommendation: "APPROVED",
      revised_answer: {
        sql: "select name from heroes where id = 1",
        usage,
        latency_ms: 6,
      },
    };
  }
}

const budget = {
  max_cases: 10,
  max_attempts_per_case: 2,
  max_case_duration_ms: 2_000,
  max_batch_duration_ms: 20_000,
  max_output_tokens_per_attempt: 1_000,
  concurrency: 1,
};

describe("test center SQLite oracle", () => {
  it("distinguishes equivalent, mismatched and unsafe SQL without exposing gold values", async () => {
    const dataset = await fixtureDataset();
    const testCase = dataset.sealed_cases[0];
    if (!testCase) throw new Error("fixture case missing");
    const oracle = new SqliteResultOracle({ timeout_ms: 2_000 });

    const equivalent = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: "select name from heroes where id = 1;",
      gold_sql: testCase.gold_sql,
    });
    expect(equivalent.verdict).toBe("PASS");

    const mismatch = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: "select name from heroes where id = 2",
      gold_sql: testCase.gold_sql,
    });
    expect(mismatch.verdict).toBe("FAIL");
    expect(mismatch.feedback.failure_type).toBe("ORACLE_MISMATCH");
    expect(JSON.stringify(mismatch.feedback)).not.toContain("Alpha");

    const unsafe = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: "delete from heroes",
      gold_sql: testCase.gold_sql,
    });
    expect(unsafe.verdict).toBe("FAIL");
    expect(unsafe.feedback.failure_type).toBe("SQL_EXECUTION");
  });

  it("preserves duplicates and respects ORDER BY while tolerating tiny numeric drift", async () => {
    const dataset = await fixtureDataset();
    const oracle = new SqliteResultOracle({ timeout_ms: 2_000 });
    const duplicatePass = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: "select name from heroes where id >= 2 order by id",
      gold_sql: "select name from heroes where id >= 2 order by id",
    });
    expect(duplicatePass.verdict).toBe("PASS");
    const numericPass = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: "select 0.3",
      gold_sql: "select score from heroes where id = 1",
    });
    expect(numericPass.verdict).toBe("PASS");

    const legacyDoubleQuotedLiteral = await oracle.evaluate({
      database_path: dataset.database_path,
      candidate_sql: 'select "Alpha"',
      gold_sql: "select 'Alpha'",
    });
    expect(legacyDoubleQuotedLiteral.verdict).toBe("PASS");
  });
});

describe("BLADE exact-choice reflection", () => {
  it("keeps the answer key sealed and retries after excluding only the wrong prior choice", async () => {
    const publicDraft = {
      case_id: randomUUID(),
      suite_id: "blade" as const,
      suite_version: "1.0.0",
      dataset_version: "blade-mcq-smoke-v1",
      ordinal: 0,
      database_id: "fixture-blade",
      question: "Select the LEAST justifiable variable.\nA. Age\nB. Favorite color\nC. Income",
      evidence: "Research question: What predicts household savings?",
      difficulty: "moderate" as const,
      capabilities: ["MULTIPLE_CHOICE" as const],
      registry: "TUNING" as const,
      schema: [],
    };
    const publicCase = publicBenchmarkCaseSchema.parse({
      ...publicDraft,
      public_case_hash: await sha256ContentHash(publicDraft),
    });
    const sealedDraft = { public_case: publicCase, correct_choice: "B" as const };
    const sealedCase = sealedMultipleChoiceBenchmarkCaseSchema.parse({
      ...sealedDraft,
      sealed_case_hash: await sha256ContentHash(sealedDraft),
    });
    class RecoveringChoiceAgent implements BenchmarkMultipleChoiceAgent {
      readonly descriptor = benchmarkAgentDescriptorSchema.parse({
        agent_id: randomUUID(),
        agent_version: "fixture-choice@1.0.0",
        display_name: "Fixture choice agent",
        kind: "CERTIFIED_MODEL_MULTIPLE_CHOICE",
        provider: "fixture",
        model_id: "fixture",
        available: true,
        unavailable_reason: null,
        supports_reflection: true,
      });

      async answer(input: { readonly excluded_choices?: readonly ("A" | "B" | "C" | "D")[] }) {
        expect(input.excluded_choices ?? []).not.toContain("B");
        return {
          answer: {
            answer_type: "MULTIPLE_CHOICE" as const,
            choice: input.excluded_choices?.includes("A") ? ("B" as const) : ("A" as const),
            rationale: "Fixture rationale.",
          },
          usage,
          latency_ms: 1,
        };
      }
    }
    const result = await executeMultipleChoiceBenchmarkBatch({
      dataset: {
        installation_directory: "/fixture",
        public_cases: [publicCase],
        sealed_cases: [sealedCase],
        installed_digest: `sha256:${"c".repeat(64)}`,
      },
      case_ids: [publicCase.case_id],
      agent: new RecoveringChoiceAgent(),
      reflection_enabled: true,
      budget,
      seed: 42,
    });
    expect(result.case_runs[0]?.attempts.map((attempt) => attempt.verdict)).toEqual([
      "FAIL",
      "PASS",
    ]);
    expect(result.case_runs[0]?.reflection?.mutable_scope).toEqual(["MULTIPLE_CHOICE"]);
    expect(JSON.stringify(result.case_runs[0]?.attempts[0]?.oracle_feedback)).not.toContain('"B"');
    expect(result.scorecard.first_pass_pass_rate).toBe(0);
    expect(result.scorecard.post_reflection_pass_rate).toBe(1);
  });
});

describe("verifier-guided reflection", () => {
  it("keeps first-pass failure, records a bounded receipt and reports recovery separately", async () => {
    const dataset = await fixtureDataset();
    const caseId = dataset.public_cases[0]?.case_id;
    if (!caseId) throw new Error("fixture case missing");
    const result = await executeBirdBenchmarkBatch({
      dataset,
      case_ids: [caseId],
      agent: new RecoveringAgent(),
      reflection_enabled: true,
      budget,
      seed: 42,
    });
    const caseRun = result.case_runs[0];
    expect(caseRun?.attempts).toHaveLength(2);
    expect(caseRun?.attempts[0]?.verdict).toBe("FAIL");
    expect(caseRun?.attempts[1]?.verdict).toBe("PASS");
    expect(caseRun?.reflection?.mutable_scope).toEqual(["ANSWER_SQL"]);
    expect(JSON.stringify(caseRun?.reflection)).not.toContain("Alpha");
    expect(result.scorecard.first_pass_pass_rate).toBe(0);
    expect(result.scorecard.post_reflection_pass_rate).toBe(1);
    expect(result.scorecard.recovery_rate).toBe(1);
    expect(result.scorecard.regression_rate).toBeNull();
  });

  it("does not let one cancelled case rewrite already completed results", async () => {
    const dataset = await fixtureDataset(2);
    let cancellationChecks = 0;
    const result = await executeBirdBenchmarkBatch({
      dataset,
      case_ids: dataset.public_cases.map((testCase) => testCase.case_id),
      agent: new RecoveringAgent(),
      reflection_enabled: false,
      budget,
      seed: 42,
      cancelled: () => {
        cancellationChecks += 1;
        return cancellationChecks > 1;
      },
    });
    expect(result.case_runs[0]?.status).toBe("FAIL");
    expect(result.case_runs[1]?.status).toBe("CANCELLED");
    expect(result.scorecard.valid_cases).toBe(1);
    expect(result.scorecard.total_cases).toBe(2);
  });
});

describe("benchmark archive boundary", () => {
  it("rejects traversal and absolute archive entries before selected extraction", () => {
    const required = [
      "minidev/MINIDEV/mini_dev_sqlite.json",
      "minidev/MINIDEV/dev_tables.json",
      "minidev/MINIDEV/dev_databases/superhero/superhero.sqlite",
    ].join("\n");
    expect(() => validateBenchmarkArchiveListing(`${required}\n../../escape`)).toThrow(
      "BENCHMARK_ARCHIVE_PATH_UNSAFE",
    );
    expect(() => validateBenchmarkArchiveListing(`${required}\n/etc/passwd`)).toThrow(
      "BENCHMARK_ARCHIVE_PATH_UNSAFE",
    );
  });
});
