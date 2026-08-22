import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DerivedAnalysisEvidencePayload } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  type CausalScmFixture,
  type CausalScmObservation,
  computeDeterministicAnalysisGolden,
  DETERMINISTIC_PROFILE_ANALYSIS_PRODUCTION_ELIGIBLE,
  type DeterministicAnalysisFixture,
  evaluateCausalScm,
  evaluateDeterministicAnalysis,
  evaluateGeneratedProgram,
  loadEcommerceDeterministicAnalysisSuite,
  scoreDeterministicAnalysisGate,
} from "../src/test-center/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function evidence(
  fixture: DeterministicAnalysisFixture,
  result = computeDeterministicAnalysisGolden(fixture),
): DerivedAnalysisEvidencePayload {
  return {
    skill_id: fixture.skill_id,
    algorithm_version: fixture.algorithm_version,
    result,
    quality: { oracle_verdict: "PASS", deterministic_replay: "PASS" },
  } as DerivedAnalysisEvidencePayload;
}

const fixtures: readonly DeterministicAnalysisFixture[] = [
  {
    fixture_id: "trend-missing-zero",
    skill_id: "trend-change@1",
    algorithm_version: "trend-v1",
    periods: [
      { period_start: "2026-03-01T00:00:00.000Z", value: 5 },
      { period_start: "2026-01-01T00:00:00.000Z", value: 0 },
      { period_start: "2026-02-01T00:00:00.000Z", value: null },
    ],
  },
  {
    fixture_id: "contribution-net-cancellation",
    skill_id: "contribution-concentration@1",
    algorithm_version: "contribution-v1",
    groups: [
      { group_key_hash: hash("a"), baseline: 10, current: 15 },
      { group_key_hash: hash("b"), baseline: 10, current: 5 },
    ],
    total_baseline: 20,
    total_current: 20,
    closure_tolerance: 1e-9,
  },
  {
    fixture_id: "robust-anomaly-outlier",
    skill_id: "robust-anomaly@1",
    algorithm_version: "anomaly-v1",
    periods: [1, 2, 2, 3, 40].map((value, index) => ({
      period_start: `2026-0${index + 1}-01T00:00:00.000Z`,
      value,
    })),
    threshold: 3.5,
    minimum_samples: 5,
  },
  {
    fixture_id: "association-missing-outlier",
    skill_id: "association-outlier-completeness@1",
    algorithm_version: "association-v1",
    pairs: [
      { left: 1, right: 2 },
      { left: 2, right: 4 },
      { left: 3, right: 6 },
      { left: 100, right: 8 },
      { left: null, right: 10 },
    ],
    outlier_threshold: 3.5,
  },
  {
    fixture_id: "forecast-no-leakage",
    skill_id: "baseline-forecast-backtest@1",
    algorithm_version: "forecast-v1",
    values: [10, 12, 11, 13, 14, 15, 16, 17],
    horizon: 2,
    minimum_train: 5,
    backtest_hash: hash("f"),
  },
];

describe("independent deterministic analysis oracle", () => {
  it.each(fixtures)(
    "recomputes $fixture_id without production implementation reuse",
    async (fixture) => {
      await expect(
        evaluateDeterministicAnalysis({ fixture, evidence: evidence(fixture) }),
      ).resolves.toMatchObject({
        verdict: "PASS",
        score: 100,
        hard_failures: [],
      });
    },
  );

  it("hard-fails numeric tampering and an unversioned Golden change", async () => {
    const fixture = fixtures[0] as DeterministicAnalysisFixture;
    const result = computeDeterministicAnalysisGolden(fixture);
    if (result.result_kind !== "TREND_CHANGE") throw new Error("fixture mismatch");
    const tampered = { ...result, last_value: 999 };
    await expect(
      evaluateDeterministicAnalysis({ fixture, evidence: evidence(fixture, tampered) }),
    ).resolves.toMatchObject({
      verdict: "FAIL",
      hard_failures: ["NUMERIC_OR_STRUCTURE_MISMATCH"],
    });
    await expect(
      evaluateDeterministicAnalysis({
        fixture,
        evidence: { ...evidence(fixture), algorithm_version: "trend-v2" },
      }),
    ).resolves.toMatchObject({ hard_failures: ["ALGORITHM_VERSION_MISMATCH"] });
  });

  it("preserves scaling/permutation metamorphism and requires every hard-gate case at 100", async () => {
    const contribution = fixtures[1] as Extract<
      DeterministicAnalysisFixture,
      { skill_id: "contribution-concentration@1" }
    >;
    const permuted = {
      ...contribution,
      groups: [...contribution.groups].reverse(),
    };
    expect(computeDeterministicAnalysisGolden(permuted)).toEqual(
      computeDeterministicAnalysisGolden(contribution),
    );
    const verdicts = await Promise.all(
      fixtures.map(async (fixture) => {
        const verdict = await evaluateDeterministicAnalysis({
          fixture,
          evidence: evidence(fixture),
        });
        return verdict;
      }),
    );
    await expect(
      scoreDeterministicAnalysisGate({
        required_case_ids: fixtures.map(({ fixture_id }) => fixture_id),
        verdicts,
      }),
    ).resolves.toMatchObject({ verdict: "PASS", score: 100, passed_case_count: 5 });
    await expect(
      scoreDeterministicAnalysisGate({
        required_case_ids: [...fixtures.map(({ fixture_id }) => fixture_id), "missing"],
        verdicts,
      }),
    ).resolves.toMatchObject({
      verdict: "FAIL",
      hard_failures: ["MISSING_REQUIRED_CASE:missing"],
    });
  });

  it("proves contribution cancellation, missing periods and forecast no-usefulness explicitly", () => {
    const trend = computeDeterministicAnalysisGolden(fixtures[0] as DeterministicAnalysisFixture);
    const contribution = computeDeterministicAnalysisGolden(
      fixtures[1] as DeterministicAnalysisFixture,
    );
    const forecast = computeDeterministicAnalysisGolden(
      fixtures[4] as DeterministicAnalysisFixture,
    );
    expect(trend.result_kind === "TREND_CHANGE" ? trend.points[0] : null).toMatchObject({
      value: 0,
      relative_delta: null,
    });
    expect(trend.result_kind === "TREND_CHANGE" ? trend.points : null).toHaveLength(2);
    expect(contribution).toMatchObject({ residual: 0, hhi: 0.5 });
    expect(forecast).toMatchObject({ useful: false, forecast_rows_ref: null });
  });
});

describe("frozen e-commerce deterministic analysis suite", () => {
  it("binds eight public cases to published semantics and sealed hard-fail truth", async () => {
    const suite = await loadEcommerceDeterministicAnalysisSuite();
    expect(suite.public_cases).toHaveLength(8);
    expect(suite.manifest).toMatchObject({
      minimum_score: 100,
      hard_fail_on_any_case: true,
      readiness: "HOLD",
    });
    expect(
      suite.public_cases.every(({ semantic_frontier }) =>
        semantic_frontier.semantic_release_hash.startsWith("sha256:"),
      ),
    ).toBe(true);
    expect(JSON.stringify(suite.public_cases)).not.toMatch(
      /golden_result|query_evidence_hash|hard_failures/u,
    );
    expect(
      new Set(suite.sealed_cases.flatMap(({ adversarial_cases }) => adversarial_cases)),
    ).toEqual(
      new Set([
        "MISSING_PERIOD_ZERO_FILL",
        "NET_CHANGE_CANCELLATION",
        "ROBUST_OUTLIER_SENSITIVITY",
        "CORRELATION_OUTLIER_SENSITIVITY",
        "SEASONAL_LEAKAGE",
        "UNPUBLISHED_SEASONAL_PERIOD",
        "PUBLIC_SOURCE_OR_STDOUT_DISCLOSURE",
        "SIMPSON_PARADOX",
        "REVERSE_CAUSALITY",
        "COLLIDER_OR_CONFOUNDER_MISUSE",
        "PERMISSION_DIMENSION_INDUCTION",
        "POST_TREATMENT_LEAKAGE",
        "SMALL_SAMPLE",
        "MISSING_NOT_AT_RANDOM",
        "MULTIPLE_TESTING",
      ]),
    );
    expect(DETERMINISTIC_PROFILE_ANALYSIS_PRODUCTION_ELIGIBLE).toBe(false);
  });

  it("fails closed after public fixture tampering", async () => {
    const source = resolve(
      "../../infra/agenticdatabench/ecommerce-v1/deterministic-analysis-suite",
    );
    const directory = await mkdtemp(join(tmpdir(), "deterministic-analysis-suite-"));
    try {
      await cp(source, directory, { recursive: true });
      const path = join(directory, "public-cases.json");
      const cases = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
      cases[0] = { ...cases[0], title: "tampered" };
      await writeFile(path, JSON.stringify(cases));
      await expect(loadEcommerceDeterministicAnalysisSuite(directory)).rejects.toThrow(
        "ECOMMERCE_DETERMINISTIC_ANALYSIS_SUITE_DIGEST_MISMATCH",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("generated program independent gate", () => {
  const safeSource =
    "from data_agent_sandbox import sdk\n\ndef main():\n    return sdk.result(1)\n";
  it("passes attested deterministic replay and rejects environment, process, network and dynamic code", async () => {
    const base = {
      source_text: safeSource,
      source_hash: `sha256:${createHash("sha256").update(safeSource).digest("hex")}` as const,
      admitted_imports: ["data_agent_sandbox"],
      expected_runtime_digest: hash("1"),
      expected_dependency_lock_digest: hash("2"),
      observed_runtime_digest: hash("1"),
      observed_dependency_lock_digest: hash("2"),
      first_result_hash: hash("3"),
      replay_result_hash: hash("3"),
      terminal: "SUCCEEDED" as const,
      output_count: 1,
      repair_attempts: 0,
    };
    await expect(evaluateGeneratedProgram(base)).resolves.toMatchObject({ verdict: "PASS" });
    for (const malicious of [
      "import socket\nsocket.socket()",
      "import os\nos.environ['SECRET']",
      "import subprocess\nsubprocess.run(['id'])",
      "eval('1+1')",
      "import ctypes",
      "import pickle",
    ]) {
      const sourceHash = `sha256:${createHash("sha256").update(malicious).digest("hex")}` as const;
      await expect(
        evaluateGeneratedProgram({ ...base, source_text: malicious, source_hash: sourceHash }),
      ).resolves.toMatchObject({ verdict: "HOLD" });
    }
  });

  it("hard-fails nondeterminism, second repair, runtime drift and outputs on unavailable sandbox", async () => {
    const sourceHash = `sha256:${createHash("sha256").update(safeSource).digest("hex")}` as const;
    const verdict = await evaluateGeneratedProgram({
      source_text: safeSource,
      source_hash: sourceHash,
      admitted_imports: ["data_agent_sandbox"],
      expected_runtime_digest: hash("1"),
      expected_dependency_lock_digest: hash("2"),
      observed_runtime_digest: hash("9"),
      observed_dependency_lock_digest: hash("2"),
      first_result_hash: hash("3"),
      replay_result_hash: hash("4"),
      terminal: "SUCCEEDED",
      output_count: 1,
      repair_attempts: 2,
    });
    expect(verdict.reason_codes).toEqual([
      "DETERMINISTIC_REPLAY_FAILED",
      "REPAIR_BUDGET_EXCEEDED",
      "RUNTIME_OR_LOCK_DRIFT",
    ]);
    await expect(
      evaluateGeneratedProgram({
        ...verdictInput(safeSource, sourceHash),
        terminal: "UNAVAILABLE",
        output_count: 1,
        first_result_hash: hash("3"),
      }),
    ).resolves.toMatchObject({
      verdict: "HOLD",
      reason_codes: ["ANALYSIS_SANDBOX_UNAVAILABLE", "NON_SUCCESS_OUTPUT_COMMITTED"],
    });
  });
});

function verdictInput(source_text: string, source_hash: `sha256:${string}`) {
  return {
    source_text,
    source_hash,
    admitted_imports: ["data_agent_sandbox"],
    expected_runtime_digest: hash("1"),
    expected_dependency_lock_digest: hash("2"),
    observed_runtime_digest: hash("1"),
    observed_dependency_lock_digest: hash("2"),
    first_result_hash: null,
    replay_result_hash: null,
    terminal: "UNAVAILABLE" as const,
    output_count: 0,
    repair_attempts: 0,
  };
}

describe("independent SCM causal gate", () => {
  const passing: CausalScmObservation = {
    candidate_grounded: true,
    temporal_order_passed: true,
    point_estimate: 2,
    interval_low: 1.5,
    interval_high: 2.5,
    effective_sample_size: 500,
    overlap_score: 0.9,
    adjustment_has_mediator_or_collider: false,
    refutation_verdicts: ["PASS", "PASS", "PASS", "PASS"],
    negative_control_passed: true,
    sensitivity_passed: true,
    attribution_authority_passed: true,
    certificate_verdict: "CERTIFIED",
    public_level: "L5_CERTIFIED",
  };

  it.each([
    ["positive", 2],
    ["negative", -2],
    ["zero", 0],
  ] as const)(
    "certifies the known %s SCM effect direction and interval",
    async (_label, effect) => {
      const fixture: CausalScmFixture = {
        fixture_id: `scm-${_label}`,
        expected_effect: effect,
        tolerance: 0.01,
        minimum_effective_sample_size: 100,
        minimum_overlap: 0.5,
        expected_terminal: "L5_CERTIFIED",
        adversarial_case: null,
      };
      await expect(
        evaluateCausalScm({
          fixture,
          observed: {
            ...passing,
            point_estimate: effect,
            interval_low: effect - 0.5,
            interval_high: effect + 0.5,
          },
        }),
      ).resolves.toMatchObject({ verdict: "PASS", score: 100 });
    },
  );

  it.each([
    "SIMPSON_PARADOX",
    "REVERSE_CAUSALITY",
    "COLLIDER_ADJUSTMENT",
    "UNOBSERVED_CONFOUNDING",
    "POSITIVITY_FAILURE",
    "POST_TREATMENT_LEAKAGE",
    "SMALL_SAMPLE",
    "MISSING_NOT_AT_RANDOM",
    "MULTIPLE_TESTING",
  ] as const)(
    "keeps %s at L4/HOLD and fails any accidental L5 promotion",
    async (adversarialCase) => {
      const fixture: CausalScmFixture = {
        fixture_id: adversarialCase,
        expected_effect: 0,
        tolerance: 0.01,
        minimum_effective_sample_size: 100,
        minimum_overlap: 0.5,
        expected_terminal: "HOLD",
        adversarial_case: adversarialCase,
      };
      await expect(
        evaluateCausalScm({
          fixture,
          observed: { ...passing, public_level: "HOLD", certificate_verdict: "HOLD" },
        }),
      ).resolves.toMatchObject({ verdict: "PASS" });
      await expect(evaluateCausalScm({ fixture, observed: passing })).resolves.toMatchObject({
        verdict: "FAIL",
        hard_failures: [`ADVERSARIAL_${adversarialCase}_NOT_HELD`, "FAIL_CLOSED_LEVEL_MISMATCH"],
      });
    },
  );
});
