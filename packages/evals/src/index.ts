import {
  type ArtifactReference,
  type AuthoritativeEvalCase,
  type AuthoritativeEvalReleaseDecision,
  type AuthoritativeEvalRun,
  type AuthoritativeOracleVerdictReceipt,
  type AuthoritativeScoreCard,
  type BenchmarkManifest,
  type BenchmarkSuite,
  type EvalReleaseDecision,
  type EvalReleaseDecisionCondition,
  type EvalRun,
  type OracleVerdictReceipt,
  type ScoreCard,
  scoreCardReference,
} from "@data-agent/contracts";

export * from "./agent-routing/harness-routing-oracle.js";
export * from "./agent-routing/harness-routing-suite.js";
export * from "./test-center/index.js";

// ============================================================
// Adapter 基础接口
// ============================================================

export interface EvalAdapterContext {
  resolveEvalCase(reference: ArtifactReference): Promise<AuthoritativeEvalCase | null>;
  resolveEvalRun(reference: ArtifactReference): Promise<AuthoritativeEvalRun | null>;
  resolveOracleVerdictReceipt(
    reference: ArtifactReference,
  ): Promise<AuthoritativeOracleVerdictReceipt | null>;
  resolveScoreCard(reference: ArtifactReference): Promise<AuthoritativeScoreCard | null>;
  verifyCommitted(reference: ArtifactReference): Promise<boolean>;
}

export interface EvalAdapterResult {
  scoreCard: AuthoritativeScoreCard;
  oracleReceipt: AuthoritativeOracleVerdictReceipt;
  evalRun: AuthoritativeEvalRun;
}

export interface EvalAdapter {
  readonly suite: BenchmarkSuite;
  readonly suite_version: string;
  readonly oracle_type: string;

  run(evalCase: AuthoritativeEvalCase, context: EvalAdapterContext): Promise<EvalAdapterResult>;
  oracle(
    evalRun: AuthoritativeEvalRun,
    context: EvalAdapterContext,
  ): Promise<AuthoritativeOracleVerdictReceipt>;
}

// ============================================================
// 四类 Suite Adapter
// ============================================================

export interface InsightBenchAdapter extends EvalAdapter {
  readonly suite: "insightbench";
  readonly oracle_type: "ANALYSIS_REPORT_QUALITY";
}

export interface DABAdapter extends EvalAdapter {
  readonly suite: "dab";
  readonly oracle_type: "RESULT_EQUIVALENCE";
}

export interface RCAEvalAdapter extends EvalAdapter {
  readonly suite: "rcaeval";
  readonly oracle_type: "ROOT_CAUSE_RANKING";
}

export interface ControlledAttributionAdapter extends EvalAdapter {
  readonly suite: "controlled-attribution";
  readonly oracle_type: "ATTRIBUTION_MATCH";
}

export interface GovernanceAdapter extends EvalAdapter {
  readonly suite: "governance";
  readonly oracle_type: "GOVERNANCE_SERVICE_QUALITY";
}

// ============================================================
// Oracle Runner 基础设施
// ============================================================

export interface OracleRunnerResult {
  oracleReceipt: AuthoritativeOracleVerdictReceipt;
  evalRun: AuthoritativeEvalRun;
}

export interface OracleRunner {
  run(evalRun: AuthoritativeEvalRun, context: EvalAdapterContext): Promise<OracleRunnerResult>;
}

// ============================================================
// Manifest Replay
// ============================================================

export interface ManifestReplayResult {
  replay: EvalRun["replay"];
  replayedEvalRun: AuthoritativeEvalRun;
  replayScoreCard: AuthoritativeScoreCard | null;
}

export interface ManifestReplayer {
  replay(manifest: BenchmarkManifest, context: EvalAdapterContext): Promise<ManifestReplayResult>;
}

// ============================================================
// Paired Comparison Runner
// ============================================================

export interface PairedComparisonResult {
  baselineScoreCard: AuthoritativeScoreCard;
  candidateScoreCard: AuthoritativeScoreCard;
  pairedScoreCard: AuthoritativeScoreCard;
  interval: {
    interval_version: string;
    metric: string;
    confidence_level: number;
    lower: number;
    upper: number;
    sample_size: number;
    method: string;
  };
}

export interface PairedComparisonRunner {
  compare(
    baselineEvalRun: AuthoritativeEvalRun,
    candidateEvalRun: AuthoritativeEvalRun,
    context: EvalAdapterContext,
  ): Promise<PairedComparisonResult>;
}

// ============================================================
// Holdout Contamination Checker
// ============================================================

export interface ContaminationCheckResult {
  isContaminated: boolean;
  details: string[];
  contaminatedRefs: ArtifactReference[];
}

export interface HoldoutContaminationChecker {
  check(
    evalRun: AuthoritativeEvalRun,
    holdoutRegistry: ArtifactReference[],
    context: EvalAdapterContext,
  ): Promise<ContaminationCheckResult>;
}

// ============================================================
// 安全校验
// ============================================================

export interface BundleDigestCheckResult {
  passed: boolean;
  expectedDigest: string;
  actualDigest: string;
  details: string[];
}

export interface LicenseCheckResult {
  passed: boolean;
  detectedLicenses: string[];
  violations: string[];
}

export interface PathBoundaryCheckResult {
  passed: boolean;
  blockedPaths: string[];
  allowedPaths: string[];
}

export interface HookVerificationResult {
  passed: boolean;
  hookName: string;
  details: string[];
}

export interface SafetyCheckContext {
  bundleDigest: string;
  allowedLicenses: string[];
  allowedPaths: string[];
  allowedHooks: string[];
}

export interface SafetyChecker {
  checkBundleDigest(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<BundleDigestCheckResult>;
  checkLicense(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<LicenseCheckResult>;
  checkPathBoundary(
    artifact: ArtifactReference,
    context: SafetyCheckContext,
  ): Promise<PathBoundaryCheckResult>;
  checkHook(hookName: string, context: SafetyCheckContext): Promise<HookVerificationResult>;
}

// ============================================================
// Eval Runner 组合
// ============================================================

export interface EvalRunnerOptions {
  adapter: EvalAdapter;
  oracleRunner: OracleRunner;
  manifestReplayer: ManifestReplayer;
  pairedComparisonRunner: PairedComparisonRunner;
  contaminationChecker: HoldoutContaminationChecker;
  safetyChecker: SafetyChecker;
  context: EvalAdapterContext;
  safetyContext: SafetyCheckContext;
}

export interface EvalRunResult {
  evalRun: AuthoritativeEvalRun;
  scoreCard: AuthoritativeScoreCard;
  oracleReceipt: AuthoritativeOracleVerdictReceipt;
  releaseDecision: AuthoritativeEvalReleaseDecision;
  contaminationCheck: ContaminationCheckResult;
  safetyChecks: {
    bundleDigest: BundleDigestCheckResult;
    license: LicenseCheckResult;
    pathBoundary: PathBoundaryCheckResult;
    hooks: HookVerificationResult[];
  };
}

export class EvalRunner {
  constructor(private readonly options: EvalRunnerOptions) {}

  async runSingle(evalCase: AuthoritativeEvalCase): Promise<EvalRunResult> {
    const adapterResult = await this.options.adapter.run(evalCase, this.options.context);
    const oracleResult = await this.options.oracleRunner.run(
      adapterResult.evalRun,
      this.options.context,
    );
    const contaminationCheck = await this.options.contaminationChecker.check(
      adapterResult.evalRun,
      [],
      this.options.context,
    );
    const bundleDigest = await this.options.safetyChecker.checkBundleDigest(
      scoreCardReference(adapterResult.scoreCard),
      this.options.safetyContext,
    );
    const license = await this.options.safetyChecker.checkLicense(
      scoreCardReference(adapterResult.scoreCard),
      this.options.safetyContext,
    );
    const pathBoundary = await this.options.safetyChecker.checkPathBoundary(
      scoreCardReference(adapterResult.scoreCard),
      this.options.safetyContext,
    );
    const hooks = await Promise.all(
      this.options.safetyContext.allowedHooks.map((hook) =>
        this.options.safetyChecker.checkHook(hook, this.options.safetyContext),
      ),
    );

    const safetyChecks = {
      bundleDigest,
      license,
      pathBoundary,
      hooks,
    };

    return {
      evalRun: adapterResult.evalRun,
      scoreCard: adapterResult.scoreCard,
      oracleReceipt: adapterResult.oracleReceipt,
      releaseDecision: {} as AuthoritativeEvalReleaseDecision,
      contaminationCheck,
      safetyChecks,
    };
  }

  async runPaired(
    baselineEvalCase: AuthoritativeEvalCase,
    candidateEvalCase: AuthoritativeEvalCase,
  ): Promise<{
    baseline: EvalRunResult;
    candidate: EvalRunResult;
    comparison: PairedComparisonResult;
  }> {
    const baseline = await this.runSingle(baselineEvalCase);
    const candidate = await this.runSingle(candidateEvalCase);
    const comparison = await this.options.pairedComparisonRunner.compare(
      baseline.evalRun,
      candidate.evalRun,
      this.options.context,
    );
    return { baseline, candidate, comparison };
  }
}

// ============================================================
// 类型导出
// ============================================================

export type {
  AuthoritativeEvalCase,
  AuthoritativeEvalReleaseDecision,
  AuthoritativeEvalRun,
  AuthoritativeOracleVerdictReceipt,
  AuthoritativeScoreCard,
  BenchmarkManifest,
  BenchmarkSuite,
  EvalReleaseDecision,
  EvalReleaseDecisionCondition,
  EvalRun,
  OracleVerdictReceipt,
  ScoreCard,
};
