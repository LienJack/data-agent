import {
  type AuthoritativeEvalCase,
  type AuthoritativeEvalRun,
  type AuthoritativeOracleVerdictReceipt,
  type AuthoritativeScoreCard,
  type EvalCase,
  type EvalRun,
  type OracleVerdictReceipt,
  type ScoreCard,
  scoreCardReference,
} from "@data-agent/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BenchmarkSuite,
  type BundleDigestCheckResult,
  type ContaminationCheckResult,
  type EvalAdapter,
  type EvalAdapterContext,
  type EvalAdapterResult,
  EvalRunner,
  type EvalRunnerOptions,
  type HoldoutContaminationChecker,
  type HookVerificationResult,
  type LicenseCheckResult,
  type ManifestReplayer,
  type OracleRunner,
  type PairedComparisonRunner,
  type PathBoundaryCheckResult,
  type SafetyCheckContext,
  type SafetyChecker,
} from "../src/index.js";

// ============================================================
// Helpers: inline artifact reference literals
// ============================================================
const CASE_REF = {
  artifact_id: "eval-case-1",
  artifact_type: "EvalCase" as const,
  app_id: "app-a",
  tenant_id: "tenant-a",
  environment: "test",
  run_id: "run-1",
  revision: 1,
  content_hash: "sha256:test",
};
const EVAL_RUN_REF = {
  artifact_id: "er-1",
  artifact_type: "EvalRun" as const,
  app_id: "app-a",
  tenant_id: "tenant-a",
  environment: "test",
  run_id: "eval-run-1",
  revision: 1,
  content_hash: "sha256:test",
};
const ORACLE_RECEIPT_REF = {
  artifact_id: "or-1",
  artifact_type: "OracleVerdictReceipt" as const,
  app_id: "app-a",
  tenant_id: "tenant-a",
  environment: "test",
  run_id: "eval-run-1",
  revision: 1,
  content_hash: "sha256:test",
};
const REGISTRY_ASSIGNMENT_REF = {
  artifact_id: "ra-1",
  artifact_type: "EvalRegistryAssignment" as const,
  app_id: "app-a",
  tenant_id: "tenant-a",
  environment: "test",
  run_id: "run-1",
  revision: 1,
  content_hash: "sha256:test",
};
const QUERY_EVIDENCE_REF = {
  artifact_id: "qe-1",
  artifact_type: "QueryEvidence" as const,
  app_id: "app-a",
  tenant_id: "tenant-a",
  environment: "test",
  run_id: "eval-run-1",
  revision: 1,
  content_hash: "sha256:test",
};

describe("EvalRunner", () => {
  const mockContext: EvalAdapterContext = {
    resolveEvalCase: vi.fn(),
    resolveEvalRun: vi.fn(),
    resolveOracleVerdictReceipt: vi.fn(),
    resolveScoreCard: vi.fn(),
    verifyCommitted: vi.fn(),
  };

  const mockSafetyContext: SafetyCheckContext = {
    bundleDigest: "sha256:test-digest",
    allowedLicenses: ["MIT"],
    allowedPaths: ["/tmp"],
    allowedHooks: [],
  };

  const mockAdapter: EvalAdapter = {
    suite: "insightbench" as BenchmarkSuite,
    suite_version: "1.0.0",
    oracle_type: "ANALYSIS_REPORT_QUALITY",
    run: vi.fn(),
    oracle: vi.fn(),
  };

  const mockOracleRunner: OracleRunner = {
    run: vi.fn(),
  };

  const mockManifestReplayer: ManifestReplayer = {
    replay: vi.fn(),
  };

  const mockPairedComparisonRunner: PairedComparisonRunner = {
    compare: vi.fn(),
  };

  const mockContaminationChecker: HoldoutContaminationChecker = {
    check: vi.fn(),
  };

  const mockSafetyChecker: SafetyChecker = {
    checkBundleDigest: vi.fn(),
    checkLicense: vi.fn(),
    checkPathBoundary: vi.fn(),
    checkHook: vi.fn(),
  };

  // ── EvalCase ──────────────────────────────────────────────
  const mockEvalCaseInput: EvalCase = {
    case_id: "eval-case-1",
    suite: "insightbench",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    source_commit: "abc123def",
    question: "test question",
    oracle: {
      suite: "insightbench",
      oracle_type: "ANALYSIS_REPORT_QUALITY",
      expected: ["expected answer"],
    },
    license: "MIT",
    case_hash: "sha256:test",
  };
  const mockEvalCase = mockEvalCaseInput as unknown as AuthoritativeEvalCase;

  // ── EvalRun ───────────────────────────────────────────────
  const mockEvalRunInput: EvalRun = {
    eval_run_id: "er-1",
    eval_run_version: 1,
    case_ref: CASE_REF,
    registry_assignment_ref: REGISTRY_ASSIGNMENT_REF,
    suite: "insightbench",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    oracle_type: "ANALYSIS_REPORT_QUALITY",
    manifest_version: "1.0.0",
    replay: {
      state: "REPLAYABLE",
      source_commit: "abc123def",
      data_snapshot_hash: "sha256:snapshot",
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "1.0.0",
      model_profile_id: "mp-1",
      model_profile_version: "1.0.0",
      prompt_version: "1.0.0",
      workflow_version: "1.0.0",
      evaluator_version: "1.0.0",
      seed: 42,
      budget: {
        max_cases: 100,
        max_duration_ms: 60000,
        max_cost_micros: 1000000,
      },
      trace: {
        trace_id: "trace-1",
        trace_hash: "sha256:trace",
      },
    },
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T01:00:00.000Z",
    status: "COMPLETED",
    eval_run_hash: "sha256:er",
  };
  const mockEvalRun = mockEvalRunInput as unknown as AuthoritativeEvalRun;

  // ── OracleVerdictReceipt ──────────────────────────────────
  const mockOracleReceiptInput: OracleVerdictReceipt = {
    schema_version: "1.0.0",
    receipt_ref: ORACLE_RECEIPT_REF,
    case_ref: CASE_REF,
    eval_run_ref: EVAL_RUN_REF,
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    deterministic_verdict: "PASS",
    oracle_result_hash: "sha256:result",
    evaluated_at: "2026-01-01T01:00:00.000Z",
    receipt_hash: "sha256:or",
    suite: "insightbench",
    oracle_type: "ANALYSIS_REPORT_QUALITY",
  };
  const mockOracleReceipt = mockOracleReceiptInput as unknown as AuthoritativeOracleVerdictReceipt;

  // ── ScoreCard ─────────────────────────────────────────────
  const mockScoreCardInput: ScoreCard = {
    scorecard_id: "sc-1",
    scorecard_version: 1,
    case_ref: CASE_REF,
    eval_run_ref: EVAL_RUN_REF,
    suite: "insightbench",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    oracle_type: "ANALYSIS_REPORT_QUALITY",
    deterministic_verdict: "PASS",
    oracle_verdict_receipt_ref: ORACLE_RECEIPT_REF,
    comparison: { mode: "SINGLE" },
    evidence_refs: [QUERY_EVIDENCE_REF],
    latency: { total_ms: 1500, model_ms: 1200, execution_ms: 300 },
    cost: {
      currency: "USD",
      amount_micros: 10000,
      input_tokens: 5000,
      output_tokens: 1000,
    },
    safety_counters: [{ counter_id: "v1", count: 0 }],
    failure_taxonomy: [],
    scorecard_hash: "sha256:sc",
  };
  const mockScoreCard = mockScoreCardInput as unknown as AuthoritativeScoreCard;

  function createOptions(): EvalRunnerOptions {
    return {
      adapter: mockAdapter,
      oracleRunner: mockOracleRunner,
      manifestReplayer: mockManifestReplayer,
      pairedComparisonRunner: mockPairedComparisonRunner,
      contaminationChecker: mockContaminationChecker,
      safetyChecker: mockSafetyChecker,
      context: mockContext,
      safetyContext: mockSafetyContext,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns for adapter.run
    vi.mocked(mockAdapter.run).mockResolvedValue({
      scoreCard: mockScoreCard,
      oracleReceipt: mockOracleReceipt,
      evalRun: mockEvalRun,
    } satisfies EvalAdapterResult);

    vi.mocked(mockOracleRunner.run).mockResolvedValue({
      oracleReceipt: mockOracleReceipt,
      evalRun: mockEvalRun,
    });

    vi.mocked(mockContaminationChecker.check).mockResolvedValue({
      isContaminated: false,
      details: [],
      contaminatedRefs: [],
    });

    vi.mocked(mockSafetyChecker.checkBundleDigest).mockResolvedValue({
      passed: true,
      expectedDigest: "sha256:bundle",
      actualDigest: "sha256:bundle",
      details: [],
    });

    vi.mocked(mockSafetyChecker.checkLicense).mockResolvedValue({
      passed: true,
      detectedLicenses: ["MIT"],
      violations: [],
    });

    vi.mocked(mockSafetyChecker.checkPathBoundary).mockResolvedValue({
      passed: true,
      blockedPaths: [],
      allowedPaths: ["/tmp"],
    });
  });

  describe("constructor", () => {
    it("should construct an EvalRunner with valid options", () => {
      const runner = new EvalRunner(createOptions());
      expect(runner).toBeInstanceOf(EvalRunner);
    });

    it("should store options", () => {
      const options = createOptions();
      const runner = new EvalRunner(options);
      expect(runner).toBeDefined();
    });
  });

  describe("runSingle", () => {
    it("should run a single eval case and return a result", async () => {
      const runner = new EvalRunner(createOptions());
      const result = await runner.runSingle(mockEvalCase);

      expect(result).toBeDefined();
      expect(result.evalRun).toBeDefined();
      expect(result.scoreCard).toBeDefined();
      expect(result.oracleReceipt).toBeDefined();
      expect(result.contaminationCheck).toBeDefined();
      expect(result.contaminationCheck.isContaminated).toBe(false);
      expect(result.safetyChecks).toBeDefined();
      expect(result.safetyChecks.bundleDigest.passed).toBe(true);
      expect(result.safetyChecks.license.passed).toBe(true);
      expect(result.safetyChecks.pathBoundary.passed).toBe(true);
      expect(result.safetyChecks.hooks).toEqual([]);
    });

    it("should call adapter.run with the eval case", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockAdapter.run).toHaveBeenCalledWith(mockEvalCase, mockContext);
    });

    it("should call oracleRunner.run with the adapter result", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockOracleRunner.run).toHaveBeenCalled();
    });

    it("should call contaminationChecker.check", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockContaminationChecker.check).toHaveBeenCalled();
    });

    it("should call safetyChecker.checkBundleDigest", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockSafetyChecker.checkBundleDigest).toHaveBeenCalled();
    });

    it("should call safetyChecker.checkLicense", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockSafetyChecker.checkLicense).toHaveBeenCalled();
    });

    it("should call safetyChecker.checkPathBoundary", async () => {
      const runner = new EvalRunner(createOptions());
      await runner.runSingle(mockEvalCase);

      expect(mockSafetyChecker.checkPathBoundary).toHaveBeenCalled();
    });
  });

  describe("runPaired", () => {
    it("should run baseline and candidate and return comparison", async () => {
      const runner = new EvalRunner(createOptions());

      vi.mocked(mockPairedComparisonRunner.compare).mockResolvedValue({
        baselineScoreCard: mockScoreCardInput as unknown as AuthoritativeScoreCard,
        candidateScoreCard: {
          ...mockScoreCardInput,
          scorecard_id: "sc-candidate",
        } as unknown as AuthoritativeScoreCard,
        pairedScoreCard: {
          ...mockScoreCardInput,
          scorecard_id: "sc-paired",
        } as unknown as AuthoritativeScoreCard,
        interval: {
          interval_version: "1.0.0",
          metric: "overall",
          confidence_level: 0.95,
          lower: 0.05,
          upper: 0.15,
          sample_size: 100,
          method: "bootstrap",
        },
      });

      const mockCandidateCase = {
        ...mockEvalCaseInput,
        case_id: "eval-case-candidate",
      } as unknown as AuthoritativeEvalCase;
      const result = await runner.runPaired(mockEvalCase, mockCandidateCase);

      expect(result).toBeDefined();
      expect(result.baseline).toBeDefined();
      expect(result.candidate).toBeDefined();
      expect(result.comparison).toBeDefined();
      expect(result.comparison.interval.lower).toBe(0.05);
      expect(result.comparison.interval.upper).toBe(0.15);
    });

    it("should call pairedComparisonRunner.compare with both eval runs", async () => {
      const runner = new EvalRunner(createOptions());
      const mockCandidateCase = {
        ...mockEvalCaseInput,
        case_id: "eval-case-candidate",
      } as unknown as AuthoritativeEvalCase;

      await runner.runPaired(mockEvalCase, mockCandidateCase);

      expect(mockPairedComparisonRunner.compare).toHaveBeenCalled();
    });
  });

  describe("scoreCardReference", () => {
    it("should create a reference from a score card", () => {
      const ref = scoreCardReference(mockScoreCardInput);
      expect(ref).toBeDefined();
      expect(ref.artifact_id).toBe("sc-1");
    });
  });
});
