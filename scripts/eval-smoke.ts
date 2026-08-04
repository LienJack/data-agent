import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EvalReleaseDecision,
  evalReleaseDecisionSchema,
} from "../packages/contracts/src/evals/index.js";
import { createRetailRevenueInvestigationV1Case } from "../packages/contracts/src/evals/manifest.js";

/**
 * eval:smoke — U7 Eval 门禁烟测
 *
 * 本脚本动态检测 U7 各工作包的实现状态，并签发 EvalReleaseDecision。
 *
 * 检测逻辑：
 * - 文件存在性检测：检查核心实现文件是否存在
 * - 内容哈希完整性：验证 case_hash 不是占位符
 * - 实现状态推断：根据文件存在性 + 哈希完整性推断各工作包实现状态
 */

// ── 实现检测 ────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const EVALS_SRC = resolve(__dirname, "../packages/evals/src");

interface ImplementationStatus {
  implemented: boolean;
  file: string;
  description: string;
}

function checkImplementation(
  unitName: string,
  relativePath: string,
  description: string,
): ImplementationStatus {
  const fullPath = resolve(EVALS_SRC, relativePath);
  const implemented = existsSync(fullPath);
  return {
    implemented,
    file: relativePath,
    description: implemented ? description : `${description}（文件不存在）`,
  };
}

function detectImplementedUnits(): {
  implementedUnits: string[];
  missingUnits: string[];
  statuses: Record<string, ImplementationStatus>;
} {
  const statuses: Record<string, ImplementationStatus> = {
    "U7-base": {
      implemented: true,
      file: "index.ts",
      description: "EvalCase、EvalRun、ScoreCard、ReleaseDecision 类型定义与接口",
    },
    "U7-adapter-insightbench": checkImplementation(
      "U7-adapter-insightbench",
      "insightbench-adapter.ts",
      "InsightBench Adapter 实现",
    ),
    "U7-adapter-dab": checkImplementation("U7-adapter-dab", "dab-adapter.ts", "DAB Adapter 实现"),
    "U7-adapter-rcaeval": checkImplementation(
      "U7-adapter-rcaeval",
      "rcaeval-adapter.ts",
      "RCAEval Adapter 实现",
    ),
    "U7-adapter-controlled-attribution": checkImplementation(
      "U7-adapter-controlled-attribution",
      "controlled-attribution-adapter.ts",
      "Controlled Attribution Adapter 实现",
    ),
    "U7-oracle-runner": checkImplementation(
      "U7-oracle-runner",
      "oracle-runner.ts",
      "Oracle Runner 实现（含内容哈希计算）",
    ),
    "U7-manifest-replay": checkImplementation(
      "U7-manifest-replay",
      "manifest-replay.ts",
      "Manifest Replay 实现（含内容哈希计算）",
    ),
    "U7-paired-comparison": checkImplementation(
      "U7-paired-comparison",
      "paired-comparison.ts",
      "Paired Comparison 实现（含 ScoreCard 哈希计算）",
    ),
    "U7-holdout-contamination": checkImplementation(
      "U7-holdout-contamination",
      "contamination-checker.ts",
      "Holdout 污染检测实现",
    ),
    "U7-safety-checks": checkImplementation(
      "U7-safety-checks",
      "safety-checker.ts",
      "安全校验实现（Bundle Digest、License、Path Boundary、Hook）",
    ),
    "U7-truth-contract": checkImplementation(
      "U7-truth-contract",
      "../../contracts/src/evals/manifest.ts",
      "Truth Contract 定义（BenchmarkManifest、retail-revenue-investigation-v1）",
    ),
    "U7-eval-verdict": {
      implemented: false,
      file: "eval-verdict.ts",
      description: "Eval Verdict 签发（U13.1 完成后实现）",
    },
  };

  const implementedUnits = Object.entries(statuses)
    .filter(([, status]) => status.implemented)
    .map(([name]) => name);

  const missingUnits = Object.entries(statuses)
    .filter(([, status]) => !status.implemented)
    .map(([name]) => name);

  return { implementedUnits, missingUnits, statuses };
}

// ── 主逻辑 ──────────────────────────────────────────────────

async function main(): Promise<number> {
  // ── 1. 检测实现状态 ───────────────────────────────────────
  const { implementedUnits, missingUnits, statuses } = detectImplementedUnits();

  // ── 2. 验证 retail-revenue-investigation-v1 案例 ──────────
  const evalCase = await createRetailRevenueInvestigationV1Case();
  const suite = evalCase.suite;

  // 简单完整性检查：case_hash 不能是占位符
  if (
    evalCase.case_hash === "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    process.stderr.write(
      "FATAL: retail-revenue-investigation-v1 case_hash 为占位符，未正确计算。\n",
    );
    return 3;
  }

  // ── 3. 构建条件与 taxonomy ────────────────────────────────
  const conditions = [
    {
      condition_id: "adapter-impl-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "四类 Suite Adapter 完整实现",
      required_ref: null,
    },
    {
      condition_id: "oracle-runner-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "真实 Oracle Runner 接入",
      required_ref: null,
    },
    {
      condition_id: "manifest-replay-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "Manifest Replay 全链验证",
      required_ref: null,
    },
    {
      condition_id: "holdout-contamination-v1",
      condition_type: "SAFETY_COUNTER" as const,
      description: "Holdout 污染检测实现",
      required_ref: null,
    },
    {
      condition_id: "paired-comparison-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "Paired Comparison 基线/候选对比",
      required_ref: null,
    },
    {
      condition_id: "truth-contract-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "Truth Contract 冻结",
      required_ref: null,
    },
    {
      condition_id: "eval-verdict-v1",
      condition_type: "SCORE_THRESHOLD" as const,
      description: "Eval Verdict 签发（U13.1 后置）",
      required_ref: null,
    },
  ];

  const failureTaxonomy: Array<{
    code: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    description: string;
    affected_conditions: string[];
  }> = [];

  if (missingUnits.length > 0) {
    const missingAdapterUnits = missingUnits.filter((u) => u.startsWith("U7-adapter-"));
    if (missingAdapterUnits.length > 0) {
      failureTaxonomy.push({
        code: "ADAPTER_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: `缺失 Adapter：${missingAdapterUnits.join("、")}`,
        affected_conditions: ["adapter-impl-v1", "oracle-runner-v1"],
      });
    }

    if (missingUnits.includes("U7-oracle-runner")) {
      failureTaxonomy.push({
        code: "ORACLE_RUNNER_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "Oracle Runner 尚未实现",
        affected_conditions: ["oracle-runner-v1"],
      });
    }

    if (missingUnits.includes("U7-manifest-replay")) {
      failureTaxonomy.push({
        code: "MANIFEST_REPLAY_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "Manifest Replay 尚未实现",
        affected_conditions: ["manifest-replay-v1"],
      });
    }

    if (missingUnits.includes("U7-paired-comparison")) {
      failureTaxonomy.push({
        code: "PAIRED_COMPARISON_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "Paired Comparison 尚未实现",
        affected_conditions: ["paired-comparison-v1"],
      });
    }

    if (missingUnits.includes("U7-holdout-contamination")) {
      failureTaxonomy.push({
        code: "HOLDOUT_CONTAMINATION_NOT_IMPLEMENTED",
        severity: "MEDIUM",
        description: "Holdout 污染检测尚未实现",
        affected_conditions: ["holdout-contamination-v1"],
      });
    }

    if (missingUnits.includes("U7-safety-checks")) {
      failureTaxonomy.push({
        code: "SAFETY_CHECKS_NOT_IMPLEMENTED",
        severity: "MEDIUM",
        description: "安全校验尚未实现",
        affected_conditions: ["holdout-contamination-v1"],
      });
    }

    if (missingUnits.includes("U7-truth-contract")) {
      failureTaxonomy.push({
        code: "TRUTH_CONTRACT_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "Truth Contract 尚未冻结",
        affected_conditions: ["truth-contract-v1"],
      });
    }
  }

  // ── 4. 安全计数器 ─────────────────────────────────────────
  const safetyCounters = [
    {
      counter_id: "bundle-digest-v1",
      counter_type: "BUNDLE_INTEGRITY" as const,
      passed: statuses["U7-safety-checks"]?.implemented ?? false,
      detail: statuses["U7-safety-checks"]?.implemented
        ? "Bundle Digest 校验已实现，待真实数据接入验证。"
        : "Bundle Digest 校验尚未接入真实实现。",
    },
    {
      counter_id: "license-v1",
      counter_type: "LICENSE_COMPLIANCE" as const,
      passed: statuses["U7-safety-checks"]?.implemented ?? false,
      detail: statuses["U7-safety-checks"]?.implemented
        ? "License 合规检查已实现，待真实数据接入验证。"
        : "License 合规检查尚未接入真实实现。",
    },
    {
      counter_id: "path-boundary-v1",
      counter_type: "PATH_BOUNDARY" as const,
      passed: statuses["U7-safety-checks"]?.implemented ?? false,
      detail: statuses["U7-safety-checks"]?.implemented
        ? "Path Boundary 检查已实现，待真实数据接入验证。"
        : "Path Boundary 检查尚未接入真实实现。",
    },
  ];

  // ── 5. 签发 EvalReleaseDecision ───────────────────────────
  const allAdapterImplemented = ["insightbench", "dab", "rcaeval", "controlled-attribution"].every(
    (name) => implementedUnits.includes(`U7-adapter-${name}`),
  );

  // 核心实现就绪：adapter + oracle + manifest + paired + contamination
  const coreReady =
    allAdapterImplemented &&
    implementedUnits.includes("U7-oracle-runner") &&
    implementedUnits.includes("U7-manifest-replay") &&
    implementedUnits.includes("U7-paired-comparison") &&
    implementedUnits.includes("U7-holdout-contamination") &&
    implementedUnits.includes("U7-safety-checks");

  // 完整 U7 就绪：core + truth contract + eval verdict
  const u7Complete =
    coreReady &&
    implementedUnits.includes("U7-truth-contract") &&
    implementedUnits.includes("U7-eval-verdict");

  // 确定 verdict
  let verdict: "HOLD" | "READY" | "PASS";
  let reasonCode: string;
  let reason: string;

  if (u7Complete) {
    verdict = "PASS";
    reasonCode = "U7_COMPLETE";
    reason = "U7 所有工作包已实现并通过门禁。";
  } else if (coreReady) {
    verdict = "HOLD";
    reasonCode = "U7_CORE_READY_TRUTH_CONTRACT_PENDING";
    reason =
      "U7 核心实现（Adapter、Oracle Runner、Manifest Replay、Paired Comparison、" +
      "Contamination Check、Safety Checks）已就绪，但 Truth Contract 与 Eval Verdict " +
      "尚未完成，不满足完整发布条件。";
  } else {
    verdict = "HOLD";
    reasonCode = "RELEASE_EVIDENCE_INCOMPLETE";
    reason = `U7 核心实现不完整，缺失：${missingUnits.join("、")}`;
  }

  const decisionId = randomUUID();
  const now = new Date().toISOString();

  const releaseDecision: EvalReleaseDecision = {
    decision_id: decisionId,
    decision_version: "1.0.0",
    verdict,
    conditions,
    scorecard_ref: {
      artifact_id: decisionId,
      artifact_type: "ScoreCard",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    safety_counters: safetyCounters,
    failure_taxonomy: failureTaxonomy,
    eval_run_ref: {
      artifact_id: `eval-run-${decisionId}`,
      artifact_type: "EvalRun",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    decision_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    decided_at: now,
    reason,
  };

  // ── 6. 输出 JSON ──────────────────────────────────────────
  const output = {
    gate: "eval:smoke",
    suite,
    case_id: evalCase.case_id,
    case_hash: evalCase.case_hash,
    release_decision: releaseDecision.verdict,
    reason_code: reasonCode,
    decision: releaseDecision,
    implemented_units: implementedUnits,
    missing_units: missingUnits,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

  // PASS → 0, HOLD → 2, FATAL → 3
  return verdict === "PASS" ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`FATAL: eval:smoke 异常退出: ${String(err)}\n`);
    process.exit(3);
  });
