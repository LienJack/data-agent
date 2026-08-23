import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputRoot = resolve("infra/agenticdatabench/ecommerce-v1/deterministic-analysis-suite");
const digest = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const release = {
  semantic_release_id: "ec200000-0000-4000-8000-000000000001",
  semantic_release_hash: `sha256:${"a".repeat(64)}`,
  schema_snapshot_hash: `sha256:${"b".repeat(64)}`,
  policy_receipt_hash: `sha256:${"c".repeat(64)}`,
};
const cases = [
  [
    "monthly-gmv-trend",
    "月度 GMV 趋势与缺期",
    ["trend-change@1"],
    "L2_OBSERVATION",
    ["MISSING_PERIOD_ZERO_FILL"],
  ],
  [
    "state-contribution",
    "州贡献、负值与净变化抵消",
    ["contribution-concentration@1"],
    "L2_OBSERVATION",
    ["NET_CHANGE_CANCELLATION"],
  ],
  [
    "return-anomaly",
    "退货状态异常与稳健基线",
    ["robust-anomaly@1"],
    "L2_OBSERVATION",
    ["ROBUST_OUTLIER_SENSITIVITY"],
  ],
  [
    "delivery-satisfaction",
    "履约与低评分关联及离群敏感性",
    ["association-outlier-completeness@1"],
    "L2_OBSERVATION",
    ["CORRELATION_OUTLIER_SENSITIVITY"],
  ],
  [
    "honest-forecast",
    "月度 GMV 无泄漏回测",
    ["baseline-forecast-backtest@1"],
    "L2_OBSERVATION",
    ["SEASONAL_LEAKAGE", "UNPUBLISHED_SEASONAL_PERIOD"],
  ],
  [
    "sales-return-report",
    "销售退货完整证据报告",
    [
      "data-profile@1",
      "semantic-transform@1",
      "trend-change@1",
      "contribution-concentration@1",
      "robust-anomaly@1",
      "open-python-analysis@1",
      "visual-insight-story@1",
    ],
    "L4_DISCOVERY",
    ["PUBLIC_SOURCE_OR_STDOUT_DISCLOSURE"],
  ],
  [
    "root-cause-discovery",
    "退货根因候选与竞争解释",
    ["root-cause-investigation@1"],
    "L4_DISCOVERY",
    [
      "SIMPSON_PARADOX",
      "REVERSE_CAUSALITY",
      "COLLIDER_OR_CONFOUNDER_MISUSE",
      "PERMISSION_DIMENSION_INDUCTION",
    ],
  ],
  [
    "certified-causal",
    "履约干预的认证因果估计",
    ["causal-identification@1"],
    "L5_CERTIFIED",
    ["POST_TREATMENT_LEAKAGE", "SMALL_SAMPLE", "MISSING_NOT_AT_RANDOM", "MULTIPLE_TESTING"],
  ],
] as const;
const publicCases = cases.map(([slug, title, requiredSkills, expectedLevel], index) => {
  const material = {
    case_id: `ec200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    slug,
    title,
    question: `${title}；必须使用发布语义、治理 SQL、受证明 Python、独立 Oracle 和安全报告投影。`,
    required_skills: requiredSkills,
    expected_evidence_level: expectedLevel,
    semantic_frontier: release,
    dataset_version: "adb-ecommerce-bounded-v1",
  };
  return { ...material, public_case_hash: digest(material) };
});
const sealedCases = publicCases.map((publicCase, index) => {
  const adversarialCases = cases[index]?.[4] ?? [];
  const material = {
    public_case_hash: publicCase.public_case_hash,
    query_evidence_hashes: [digest({ case_id: publicCase.case_id, query: 1 })],
    golden_result_hashes: [digest({ case_id: publicCase.case_id, result: "frozen-v1" })],
    hard_failures: [
      ...(index === 7
        ? ["SCM_EFFECT_DIRECTION_OR_INTERVAL_MISMATCH", "CERTIFICATE_OR_PUBLIC_LEVEL_INVALID"]
        : ["NUMERIC_OR_STRUCTURE_MISMATCH", "EVIDENCE_QUALITY_NOT_PASS"]),
      ...adversarialCases.map((name) => `ADVERSARIAL_${name}_NOT_HELD`),
    ],
    adversarial_cases: adversarialCases,
    expected_terminal: index === 7 ? "L5_CERTIFIED" : index >= 5 ? "L4_DISCOVERY" : "READY",
  };
  return { ...material, sealed_case_hash: digest(material) };
});
const manifestMaterial = {
  schema_version: "ecommerce-deterministic-analysis-suite@1.0.0",
  suite_version: "1.0.0",
  algorithm_versions: {
    trend: "trend-v1",
    contribution: "contribution-v1",
    anomaly: "anomaly-v1",
    association: "association-v1",
    forecast: "forecast-v1",
    causal: "causal-scm-independent-oracle@1.0.0",
  },
  case_count: publicCases.length,
  public_cases_hash: digest(publicCases),
  sealed_cases_hash: digest(sealedCases),
  minimum_score: 100,
  hard_fail_on_any_case: true,
  readiness: "HOLD",
  readiness_reason: "U7 release registration and staged rollout gate are not yet complete.",
};
await mkdir(resolve(outputRoot, "sealed"), { recursive: true });
await Promise.all([
  writeFile(resolve(outputRoot, "public-cases.json"), `${JSON.stringify(publicCases, null, 2)}\n`),
  writeFile(
    resolve(outputRoot, "sealed/sealed-cases.json"),
    `${JSON.stringify(sealedCases, null, 2)}\n`,
  ),
  writeFile(
    resolve(outputRoot, "manifest.json"),
    `${JSON.stringify({ ...manifestMaterial, manifest_hash: digest(manifestMaterial) }, null, 2)}\n`,
  ),
]);
process.stdout.write(`${JSON.stringify(manifestMaterial)}\n`);
