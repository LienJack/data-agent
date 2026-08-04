import { randomUUID } from "node:crypto";
import {
  type EvalReleaseDecision,
  evalReleaseDecisionSchema,
} from "../packages/contracts/src/evals/index.js";
import { createRetailRevenueInvestigationV1Case } from "../packages/contracts/src/evals/manifest.js";

/**
 * eval:smoke — U7 Eval 门禁烟测
 *
 * 当前阶段：
 * - U7 base / B2-fixture 已定义 EvalReleaseDecision 类型、BenchmarkManifest 类型
 *   与 retail-revenue-investigation-v1 案例。
 * - packages/evals 定义了 Adapter 接口与 EvalRunner 骨架，但尚未接入真实
 *   Adapter/Oracle/Mutation/Demo 实现。
 *
 * 本脚本：
 * 1. 创建 retail-revenue-investigation-v1 EvalCase 并验证其哈希完整。
 * 2. 签发一个 EvalReleaseDecision HOLD（因完整 U7 门禁尚未实现）。
 * 3. 输出结构化 JSON 供上游门禁解析。
 *
 * U7 完全实现后，本脚本应替换为调用 packages/evals 的 EvalRunner 并输出
 * 真实 AdapterResult 驱动的 EvalReleaseDecision。
 */

async function main(): Promise<number> {
  // ── 1. 验证 retail-revenue-investigation-v1 案例 ──────────────
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

  // ── 2. 签发 EvalReleaseDecision ──────────────────────────────
  const decisionId = randomUUID();
  const now = new Date().toISOString();

  const releaseDecision: EvalReleaseDecision = {
    decision_id: decisionId,
    decision_version: "1.0.0",
    verdict: "HOLD",
    conditions: [
      {
        condition_id: "adapter-impl-v1",
        condition_type: "SCORE_THRESHOLD",
        description: "四类 Suite Adapter 完整实现",
        required_ref: null,
      },
      {
        condition_id: "oracle-runner-v1",
        condition_type: "SCORE_THRESHOLD",
        description: "真实 Oracle Runner 接入",
        required_ref: null,
      },
      {
        condition_id: "manifest-replay-v1",
        condition_type: "SCORE_THRESHOLD",
        description: "Manifest Replay 全链验证",
        required_ref: null,
      },
      {
        condition_id: "holdout-contamination-v1",
        condition_type: "SAFETY_COUNTER",
        description: "Holdout 污染检测实现",
        required_ref: null,
      },
      {
        condition_id: "paired-comparison-v1",
        condition_type: "SCORE_THRESHOLD",
        description: "Paired Comparison 基线/候选对比",
        required_ref: null,
      },
    ],
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
    safety_counters: [
      {
        counter_id: "bundle-digest-v1",
        counter_type: "BUNDLE_INTEGRITY",
        passed: false,
        detail: "Bundle Digest 校验尚未接入真实实现。",
      },
      {
        counter_id: "license-v1",
        counter_type: "LICENSE_COMPLIANCE",
        passed: false,
        detail: "License 合规检查尚未接入真实实现。",
      },
      {
        counter_id: "path-boundary-v1",
        counter_type: "PATH_BOUNDARY",
        passed: false,
        detail: "Path Boundary 检查尚未接入真实实现。",
      },
    ],
    failure_taxonomy: [
      {
        code: "ADAPTER_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "四类 Suite Adapter 尚未接入真实实现，当前仅有接口定义与骨架。",
        affected_conditions: ["adapter-impl-v1", "oracle-runner-v1"],
      },
      {
        code: "MANIFEST_REPLAY_NOT_IMPLEMENTED",
        severity: "HIGH",
        description: "Manifest Replay 全链尚未实现，无法验证完整评测流程。",
        affected_conditions: ["manifest-replay-v1"],
      },
      {
        code: "SAFETY_CHECKS_NOT_IMPLEMENTED",
        severity: "MEDIUM",
        description: "安全校验（Bundle Digest、License、Path Boundary）尚未接入真实实现。",
        affected_conditions: ["holdout-contamination-v1"],
      },
    ],
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
    reason:
      "U7 base / B2-fixture 已定义 EvalReleaseDecision、BenchmarkManifest 类型与 retail-revenue-investigation-v1 案例，但四类 Suite Adapter、Oracle Runner、Manifest Replay、Paired Comparison 与 Holdout Contamination 尚未接入真实实现。",
  };

  // ── 3. 输出 JSON ─────────────────────────────────────────────
  const output = {
    gate: "eval:smoke",
    suite,
    case_id: evalCase.case_id,
    case_hash: evalCase.case_hash,
    release_decision: releaseDecision.verdict,
    reason_code: "RELEASE_EVIDENCE_INCOMPLETE",
    decision: releaseDecision,
    implemented_units: ["U7-base"],
    missing_units: [
      "U7-adapter-insightbench",
      "U7-adapter-dab",
      "U7-adapter-rcaeval",
      "U7-adapter-controlled-attribution",
      "U7-oracle-runner",
      "U7-manifest-replay",
      "U7-paired-comparison",
      "U7-holdout-contamination",
      "U7-safety-checks",
      "U7-truth-contract",
      "U7-eval-verdict",
    ],
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

  // HOLD → 非零退出
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`FATAL: eval:smoke 异常退出: ${String(err)}\n`);
    process.exit(3);
  });
