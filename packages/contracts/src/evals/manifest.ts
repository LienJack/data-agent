import { z } from "zod";
import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import type { EvalCase } from "./schemas.js";
import { benchmarkSuiteSchema } from "./schemas.js";

export const benchmarkDatasetReferenceSchema = z.strictObject({
  dataset_id: immutableIdSchema,
  dataset_version: versionIdentifierSchema,
  dataset_name: z.string().min(1).max(256),
  dataset_description: z.string().max(4096).nullable(),
  dialect: z.enum(["postgresql", "bigquery", "snowflake", "generic"]),
  schema_digest: contentHashSchema,
  row_count: z.number().int().nonnegative(),
  parameters: z.record(z.string(), z.json()).optional(),
});

export const benchmarkMutationDefinitionSchema = z.strictObject({
  mutation_id: versionIdentifierSchema,
  description: z.string().min(1).max(2048),
  mutation_type: z.enum([
    "DATA_FILTER",
    "MEASURE_SUBSTITUTION",
    "DIMENSION_REDUCTION",
    "AGGREGATION_CHANGE",
    "TIME_PERIOD_SHIFT",
    "COMPARISON_BENCHMARK",
    "OUTLIER_EXCLUSION",
    "CURRENCY_ADJUSTMENT",
  ]),
  expected_impact: z.string().min(1).max(1024),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  oracle_expectation: z.string().min(1).max(4096),
});

export const benchmarkBudgetSchema = z.strictObject({
  max_cases: z.number().int().positive(),
  max_duration_ms: z.number().int().positive(),
  max_cost_micros: z.number().int().nonnegative(),
  max_sql_queries: z.number().int().positive(),
  max_drivers: z.number().int().positive(),
});

export const benchmarkDemoHoldoutIdentitySchema = z.strictObject({
  demo_registry: z.enum(["DEMO", "TUNING", "HOLDOUT"]),
  demo_policy_version: versionIdentifierSchema,
  holdout_fraction: z.number().gt(0).lt(1),
  holdout_seed: z.number().int().nonnegative(),
  demo_license: z.string().min(1).max(256),
});

export const benchmarkManifestSchema = z.strictObject({
  manifest_id: immutableIdSchema,
  manifest_version: versionIdentifierSchema,
  manifest_revision: z.number().int().positive(),
  case_ref: artifactReferenceFor("EvalCase"),
  suite: benchmarkSuiteSchema,
  dataset: benchmarkDatasetReferenceSchema,
  semantic_release_ref: artifactReferenceFor("SemanticRelease").nullable(),
  mutation_definitions: z.array(benchmarkMutationDefinitionSchema),
  budget: benchmarkBudgetSchema,
  demo_holdout_identity: benchmarkDemoHoldoutIdentitySchema,
  l2_non_causal_boundary: z.string().min(1).max(4096),
  supplements: z.array(z.string()).optional(),
  manifest_hash: contentHashSchema,
  created_at: timestampSchema,
});

export async function computeBenchmarkManifestHash(input: unknown): Promise<`sha256:${string}`> {
  const manifest = benchmarkManifestSchema.parse(input);
  const { manifest_hash: _manifestHash, ...material } = manifest;
  return sha256ContentHash(material);
}

export function benchmarkManifestReference(
  manifest: z.infer<typeof benchmarkManifestSchema>,
): ArtifactReference {
  return {
    artifact_id: manifest.manifest_id,
    artifact_type: "BenchmarkManifest",
    app_id: manifest.case_ref.app_id,
    tenant_id: manifest.case_ref.tenant_id,
    environment: manifest.case_ref.environment,
    run_id: manifest.case_ref.run_id,
    revision: manifest.manifest_revision,
    content_hash: manifest.manifest_hash,
  };
}

export function benchmarkManifestInputIdentity(
  manifest: z.infer<typeof benchmarkManifestSchema>,
): string {
  return [
    artifactReferenceIdentity(manifest.case_ref),
    manifest.suite,
    manifest.manifest_version,
  ].join("|");
}

// === retail-revenue-investigation-v1 具体定义 ===

export const RETAIL_REVENUE_INVESTIGATION_V1_SUITE = "controlled-attribution" as const;
export const RETAIL_REVENUE_INVESTIGATION_V1_QUESTION =
  "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？";

export const RETAIL_REVENUE_INVESTIGATION_V1_DATASET = {
  dataset_id: "retail-revenue-south-china-2025q1",
  dataset_version: "1.0.0",
  dataset_name: "华南区零售收入数据集（2025Q1）",
  dataset_description:
    "包含 2024Q1-2025Q1 华南区（广东、福建、广西、海南）门店级别订单、退款、促销、商品、区域与履约数据。",
  dialect: "postgresql" as const,
  schema_digest:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  row_count: 50000,
  parameters: {
    table_count: 8,
    date_range: "2024-01-01 to 2025-03-31",
    store_count: 120,
    product_category_count: 25,
  },
};

export const RETAIL_REVENUE_INVESTIGATION_V1_MUTATIONS = [
  {
    mutation_id: "RR-001",
    description: "排除 2025年1月促销活动对净收入的贡献",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "排除促销后净收入同比下降幅度应收窄 2-4 个百分点",
    severity: "HIGH" as const,
    oracle_expectation: "促销排除后降幅从 8.3% 收窄至 5.5% 左右",
  },
  {
    mutation_id: "RR-002",
    description: "以平均售价替代实际售价计算收入",
    mutation_type: "MEASURE_SUBSTITUTION" as const,
    expected_impact: "平均售价应消除产品组合变化的影响，显示真实销量变化",
    severity: "MEDIUM" as const,
    oracle_expectation: "改用平均售价后收入降幅应小于 3%",
  },
  {
    mutation_id: "RR-003",
    description: "排除福建省（受台风影响严重）",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "排除福建省后整体降幅应显著缩小",
    severity: "HIGH" as const,
    oracle_expectation: "排除福建后降幅从 8.3% 收窄至 4% 左右",
  },
  {
    mutation_id: "RR-004",
    description: "按季度比较而非同比（2025Q1 vs 2024Q4）",
    mutation_type: "TIME_PERIOD_SHIFT" as const,
    expected_impact: "环比应为正增长或持平，证明季节性因素是同比下降的主因",
    severity: "CRITICAL" as const,
    oracle_expectation: "QoQ 应显示 +1-2% 增长，支持季节性假设",
  },
  {
    mutation_id: "RR-005",
    description: "剔除高价值商品（单价 > 500元）后的收入变化",
    mutation_type: "DIMENSION_REDUCTION" as const,
    expected_impact: "剔除高价值商品后降幅应扩大，说明高价值商品销量相对稳定",
    severity: "MEDIUM" as const,
    oracle_expectation: "剔除高价值商品后降幅扩大至 10-12%",
  },
  {
    mutation_id: "RR-006",
    description: "将退款率纳入收入计算（净收入 vs 毛收入）",
    mutation_type: "MEASURE_SUBSTITUTION" as const,
    expected_impact: "退款率上升可能导致净收入下降而毛收入持平",
    severity: "HIGH" as const,
    oracle_expectation: "毛收入降幅应小于净收入降幅，退款率贡献约 1-2 个百分点",
  },
];

export const RETAIL_REVENUE_INVESTIGATION_V1_BUDGET = {
  max_cases: 1,
  max_duration_ms: 600000,
  max_cost_micros: 50000000,
  max_sql_queries: 16,
  max_drivers: 6,
};

export const RETAIL_REVENUE_INVESTIGATION_V1_DEMO_HOLDOUT = {
  demo_registry: "HOLDOUT" as const,
  demo_policy_version: "1.0.0",
  holdout_fraction: 0.15,
  holdout_seed: 42,
  demo_license: "CC-BY-4.0",
};

export const RETAIL_REVENUE_INVESTIGATION_V1_L2_BOUNDARY =
  "本案例仅评估 L2 Text2SQL 与报告生成能力，不验证因果归因、归因贡献分解或 L3-L5 实验能力。问题中的 '为什么' 应理解为 '哪些因素在数据层面可观察到关联变化'，而非因果推断。归因驱动因素的识别和优先级排序属于产品归因能力（F9），不在本评测范围内。";

export async function createRetailRevenueInvestigationV1Case(): Promise<EvalCase> {
  const caseInput = {
    case_id: "retail-revenue-investigation-v1" as const,
    suite: "controlled-attribution" as const,
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    source_commit: "0000000000000000000000000000000000000000",
    question: RETAIL_REVENUE_INVESTIGATION_V1_QUESTION,
    oracle: {
      suite: "controlled-attribution" as const,
      oracle_type: "ATTRIBUTION_MATCH" as const,
      expected: [
        "促销活动减少导致收入下降",
        "高价值商品销量占比下降（产品组合变化）",
        "福建省因台风影响收入下滑",
        "退款率上升净收入承压",
        "季节性因素（春节后淡季）",
      ],
    },
    license: "CC-BY-4.0",
    case_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  };
  const { case_hash: _, ...material } = caseInput;
  const hash = await sha256ContentHash(material);
  return {
    ...caseInput,
    case_hash: hash,
  };
}

export function createRetailRevenueInvestigationV1Manifest(
  evalCase: EvalCase,
): z.infer<typeof benchmarkManifestSchema> {
  return {
    manifest_id: `manifest-${evalCase.case_id}`,
    manifest_version: "1.0.0",
    manifest_revision: 1,
    case_ref: {
      artifact_id: evalCase.case_id,
      artifact_type: "EvalCase",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: evalCase.case_hash,
    },
    suite: "controlled-attribution",
    dataset: RETAIL_REVENUE_INVESTIGATION_V1_DATASET,
    semantic_release_ref: null,
    mutation_definitions: RETAIL_REVENUE_INVESTIGATION_V1_MUTATIONS,
    budget: RETAIL_REVENUE_INVESTIGATION_V1_BUDGET,
    demo_holdout_identity: RETAIL_REVENUE_INVESTIGATION_V1_DEMO_HOLDOUT,
    l2_non_causal_boundary: RETAIL_REVENUE_INVESTIGATION_V1_L2_BOUNDARY,
    manifest_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
    created_at: new Date().toISOString(),
  };
}

export type BenchmarkManifest = z.infer<typeof benchmarkManifestSchema>;
export type BenchmarkDatasetReference = z.infer<typeof benchmarkDatasetReferenceSchema>;
export type BenchmarkMutationDefinition = z.infer<typeof benchmarkMutationDefinitionSchema>;
export type BenchmarkBudget = z.infer<typeof benchmarkBudgetSchema>;
export type BenchmarkDemoHoldoutIdentity = z.infer<typeof benchmarkDemoHoldoutIdentitySchema>;

// === governance-semantic-review-v1 具体定义 ===

export const GOVERNANCE_SEMANTIC_REVIEW_V1_SUITE = "governance" as const;
export const GOVERNANCE_SEMANTIC_REVIEW_V1_QUESTION =
  "治理系统能否正确执行语义治理审核流程（候选提交→审核→决策→发布→回滚），" +
  "并确保审核决策一致性、角色权限分离、发布/回滚流程正确性和审核超时处理？";

export const GOVERNANCE_SEMANTIC_REVIEW_V1_DATASET = {
  dataset_id: "governance-semantic-review-v1",
  dataset_version: "1.0.0",
  dataset_name: "语义治理审核流程测试数据集",
  dataset_description:
    "包含治理候选、审核记录、决策记录、发布/回滚操作的模拟数据，覆盖完整治理生命周期。",
  dialect: "postgresql" as const,
  schema_digest:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  row_count: 1000,
  parameters: {
    table_count: 6,
    candidate_count: 50,
    reviewer_count: 5,
    scenario_count: 4,
  },
};

export const GOVERNANCE_SEMANTIC_REVIEW_V1_MUTATIONS = [
  {
    mutation_id: "GSR-001",
    description: "审核决策一致性：相同候选在不同审核轮次中应获得一致决策",
    mutation_type: "COMPARISON_BENCHMARK" as const,
    expected_impact: "相同候选的审核决策一致性应达到 90% 以上",
    severity: "HIGH" as const,
    oracle_expectation: "审核决策一致性 ≥ 90%，不一致的决策应有明确的理由记录",
  },
  {
    mutation_id: "GSR-002",
    description: "角色权限分离：proposer 不能同时担任 reviewer，reviewer 不能发布自己的审核结果",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "角色权限分离违规应被系统拒绝并记录审计日志",
    severity: "CRITICAL" as const,
    oracle_expectation: "所有角色权限分离违规均被系统拒绝，审计日志完整可追溯",
  },
  {
    mutation_id: "GSR-003",
    description: "发布/回滚流程正确性：已发布的治理配置应可回滚，回滚后状态与发布前一致",
    mutation_type: "COMPARISON_BENCHMARK" as const,
    expected_impact: "发布/回滚操作应保持状态一致性，回滚后系统状态与发布前一致",
    severity: "HIGH" as const,
    oracle_expectation: "回滚后系统状态与发布前完全一致，状态差异为零",
  },
  {
    mutation_id: "GSR-004",
    description: "审核超时处理：超过审核时限的候选应自动进入升级流程",
    mutation_type: "TIME_PERIOD_SHIFT" as const,
    expected_impact: "超时候选应产生升级通知，且升级流程不能绕过正常审核",
    severity: "MEDIUM" as const,
    oracle_expectation: "超时候选正确触发升级流程，升级后的审核仍遵循角色权限分离规则",
  },
];

export const GOVERNANCE_SEMANTIC_REVIEW_V1_BUDGET = {
  max_cases: 1,
  max_duration_ms: 600000,
  max_cost_micros: 50000000,
  max_sql_queries: 16,
  max_drivers: 6,
};

export const GOVERNANCE_SEMANTIC_REVIEW_V1_DEMO_HOLDOUT = {
  demo_registry: "HOLDOUT" as const,
  demo_policy_version: "1.0.0",
  holdout_fraction: 0.15,
  holdout_seed: 42,
  demo_license: "CC-BY-4.0",
};

export const GOVERNANCE_SEMANTIC_REVIEW_V1_L2_BOUNDARY =
  "本案例仅评估语义治理审核流程的正确性和一致性，不评估治理候选的内容质量、不评估归因贡献数值的准确性、不评估因果推断。治理评测专注于流程正确性而非业务结果。";

export async function createGovernanceSemanticReviewV1Case(): Promise<EvalCase> {
  const caseInput = {
    case_id: "governance-semantic-review-v1" as const,
    suite: "governance" as const,
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    source_commit: "0000000000000000000000000000000000000000",
    question: GOVERNANCE_SEMANTIC_REVIEW_V1_QUESTION,
    oracle: {
      suite: "governance" as const,
      oracle_type: "GOVERNANCE_SERVICE_QUALITY" as const,
      expected: [
        "审核决策一致性 ≥ 90%",
        "角色权限分离违规被系统拒绝",
        "发布/回滚操作保持状态一致性",
        "超时候选正确触发升级流程",
      ],
    },
    license: "CC-BY-4.0",
    case_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  };
  const { case_hash: _, ...material } = caseInput;
  const hash = await sha256ContentHash(material);
  return {
    ...caseInput,
    case_hash: hash,
  };
}

export function createGovernanceSemanticReviewV1Manifest(
  evalCase: EvalCase,
): z.infer<typeof benchmarkManifestSchema> {
  return {
    manifest_id: `manifest-${evalCase.case_id}`,
    manifest_version: "1.0.0",
    manifest_revision: 1,
    case_ref: {
      artifact_id: evalCase.case_id,
      artifact_type: "EvalCase",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: evalCase.case_hash,
    },
    suite: "governance",
    dataset: GOVERNANCE_SEMANTIC_REVIEW_V1_DATASET,
    semantic_release_ref: null,
    mutation_definitions: GOVERNANCE_SEMANTIC_REVIEW_V1_MUTATIONS,
    budget: GOVERNANCE_SEMANTIC_REVIEW_V1_BUDGET,
    demo_holdout_identity: GOVERNANCE_SEMANTIC_REVIEW_V1_DEMO_HOLDOUT,
    l2_non_causal_boundary: GOVERNANCE_SEMANTIC_REVIEW_V1_L2_BOUNDARY,
    manifest_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
    created_at: new Date().toISOString(),
  };
}

// === governance-domain-coverage-v1 具体定义 ===

export const GOVERNANCE_DOMAIN_COVERAGE_V1_SUITE = "governance" as const;
export const GOVERNANCE_DOMAIN_COVERAGE_V1_QUESTION =
  "治理系统能否覆盖多个语义领域（零售、金融、医疗、制造），确保领域边界隔离，并支持新领域注册？";

export const GOVERNANCE_DOMAIN_COVERAGE_V1_DATASET = {
  dataset_id: "governance-domain-coverage-v1",
  dataset_version: "1.0.0",
  dataset_name: "语义治理领域覆盖完整性测试数据集",
  dataset_description:
    "包含四个语义领域（零售、金融、医疗、制造）的治理候选和审核数据，覆盖跨领域和领域边界隔离场景。",
  dialect: "postgresql" as const,
  schema_digest:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  row_count: 2000,
  parameters: {
    table_count: 8,
    domain_count: 4,
    candidate_count: 80,
    cross_domain_scenario: true,
  },
};

export const GOVERNANCE_DOMAIN_COVERAGE_V1_MUTATIONS = [
  {
    mutation_id: "GDC-001",
    description: "多领域覆盖：治理系统应能同时管理零售、金融、医疗、制造四个领域的语义治理",
    mutation_type: "COMPARISON_BENCHMARK" as const,
    expected_impact: "四个领域的治理候选均能独立通过审核流程，领域间不干扰",
    severity: "HIGH" as const,
    oracle_expectation: "每个领域的治理候选均完成独立审核流程，领域间无状态串扰",
  },
  {
    mutation_id: "GDC-002",
    description: "领域边界隔离：跨领域引用应被系统识别并标记，不允许直接引用其他领域的治理配置",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "跨领域引用被系统正确标记，非授权的跨领域引用被拒绝",
    severity: "HIGH" as const,
    oracle_expectation: "所有跨领域引用被正确标记，非授权引用被系统拒绝",
  },
  {
    mutation_id: "GDC-003",
    description: "新领域注册：治理系统应支持注册新的语义领域并立即生效",
    mutation_type: "AGGREGATION_CHANGE" as const,
    expected_impact: "新领域注册后，用户可以立即在该领域提交治理候选和审核",
    severity: "MEDIUM" as const,
    oracle_expectation: "新领域注册后零延迟生效，治理候选和审核流程正常运行",
  },
];

export const GOVERNANCE_DOMAIN_COVERAGE_V1_BUDGET = {
  max_cases: 1,
  max_duration_ms: 600000,
  max_cost_micros: 50000000,
  max_sql_queries: 16,
  max_drivers: 6,
};

export const GOVERNANCE_DOMAIN_COVERAGE_V1_DEMO_HOLDOUT = {
  demo_registry: "HOLDOUT" as const,
  demo_policy_version: "1.0.0",
  holdout_fraction: 0.15,
  holdout_seed: 42,
  demo_license: "CC-BY-4.0",
};

export const GOVERNANCE_DOMAIN_COVERAGE_V1_L2_BOUNDARY =
  "本案例仅评估治理系统对多领域覆盖的完整性，不评估各领域内治理候选的内容质量或领域特定的语义正确性。领域覆盖评测专注于治理系统的跨领域能力而非单个领域的治理深度。";

export async function createGovernanceDomainCoverageV1Case(): Promise<EvalCase> {
  const caseInput = {
    case_id: "governance-domain-coverage-v1" as const,
    suite: "governance" as const,
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    source_commit: "0000000000000000000000000000000000000000",
    question: GOVERNANCE_DOMAIN_COVERAGE_V1_QUESTION,
    oracle: {
      suite: "governance" as const,
      oracle_type: "GOVERNANCE_SERVICE_QUALITY" as const,
      expected: [
        "四个领域独立完成审核流程，无状态串扰",
        "跨领域引用被正确标记",
        "非授权跨领域引用被系统拒绝",
        "新领域注册零延迟生效",
      ],
    },
    license: "CC-BY-4.0",
    case_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  };
  const { case_hash: _, ...material } = caseInput;
  const hash = await sha256ContentHash(material);
  return {
    ...caseInput,
    case_hash: hash,
  };
}

export function createGovernanceDomainCoverageV1Manifest(
  evalCase: EvalCase,
): z.infer<typeof benchmarkManifestSchema> {
  return {
    manifest_id: `manifest-${evalCase.case_id}`,
    manifest_version: "1.0.0",
    manifest_revision: 1,
    case_ref: {
      artifact_id: evalCase.case_id,
      artifact_type: "EvalCase",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: evalCase.case_hash,
    },
    suite: "governance",
    dataset: GOVERNANCE_DOMAIN_COVERAGE_V1_DATASET,
    semantic_release_ref: null,
    mutation_definitions: GOVERNANCE_DOMAIN_COVERAGE_V1_MUTATIONS,
    budget: GOVERNANCE_DOMAIN_COVERAGE_V1_BUDGET,
    demo_holdout_identity: GOVERNANCE_DOMAIN_COVERAGE_V1_DEMO_HOLDOUT,
    l2_non_causal_boundary: GOVERNANCE_DOMAIN_COVERAGE_V1_L2_BOUNDARY,
    manifest_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
    created_at: new Date().toISOString(),
  };
}

// === governance-role-permission-v1 具体定义 ===

export const GOVERNANCE_ROLE_PERMISSION_V1_SUITE = "governance" as const;
export const GOVERNANCE_ROLE_PERMISSION_V1_QUESTION =
  "治理系统能否正确实施 proposer/reviewer/admin/publisher 四类角色的权限隔离，防止越权操作？";

export const GOVERNANCE_ROLE_PERMISSION_V1_DATASET = {
  dataset_id: "governance-role-permission-v1",
  dataset_version: "1.0.0",
  dataset_name: "治理角色权限分离测试数据集",
  dataset_description:
    "包含四类角色（proposer、reviewer、admin、publisher）的权限边界测试数据，覆盖正常操作和越权操作场景。",
  dialect: "postgresql" as const,
  schema_digest:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  row_count: 800,
  parameters: {
    table_count: 5,
    role_count: 4,
    scenario_count: 4,
    user_count: 12,
  },
};

export const GOVERNANCE_ROLE_PERMISSION_V1_MUTATIONS = [
  {
    mutation_id: "GRP-001",
    description:
      "proposer 越权：proposer 不能审核自己的候选、不能发布治理配置、不能批准其他 proposer 的候选",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "proposer 的所有越权操作被系统拒绝",
    severity: "CRITICAL" as const,
    oracle_expectation: "proposer 越权操作全部被拒绝，审计日志记录完整",
  },
  {
    mutation_id: "GRP-002",
    description:
      "reviewer 越权：reviewer 不能发布自己审核的候选、不能修改候选内容、不能跳过审核流程",
    mutation_type: "DATA_FILTER" as const,
    expected_impact: "reviewer 的所有越权操作被系统拒绝",
    severity: "CRITICAL" as const,
    oracle_expectation: "reviewer 越权操作全部被拒绝，审核流程完整性保持",
  },
  {
    mutation_id: "GRP-003",
    description:
      "admin 越权：admin 不能绕过审核直接发布、不能修改审核记录、不能删除已发布的治理配置",
    mutation_type: "COMPARISON_BENCHMARK" as const,
    expected_impact: "admin 的越权发布和修改操作被系统拒绝",
    severity: "HIGH" as const,
    oracle_expectation: "admin 越权操作被拒绝，操作日志记录完整",
  },
  {
    mutation_id: "GRP-004",
    description:
      "publisher 权限：publisher 可以发布已审核的候选、可以回滚已发布的配置、不能修改候选内容",
    mutation_type: "COMPARISON_BENCHMARK" as const,
    expected_impact: "publisher 的合法操作成功执行，越权操作被拒绝",
    severity: "HIGH" as const,
    oracle_expectation: "publisher 合法发布/回滚操作成功，内容修改操作被拒绝",
  },
];

export const GOVERNANCE_ROLE_PERMISSION_V1_BUDGET = {
  max_cases: 1,
  max_duration_ms: 600000,
  max_cost_micros: 50000000,
  max_sql_queries: 16,
  max_drivers: 6,
};

export const GOVERNANCE_ROLE_PERMISSION_V1_DEMO_HOLDOUT = {
  demo_registry: "HOLDOUT" as const,
  demo_policy_version: "1.0.0",
  holdout_fraction: 0.15,
  holdout_seed: 42,
  demo_license: "CC-BY-4.0",
};

export const GOVERNANCE_ROLE_PERMISSION_V1_L2_BOUNDARY =
  "本案例仅评估治理系统的角色权限分离机制，不评估治理候选的内容质量、不评估归因贡献数值、不评估审核决策的合理性。权限评测专注于存取控制而非治理流程的业务正确性。";

export async function createGovernanceRolePermissionV1Case(): Promise<EvalCase> {
  const caseInput = {
    case_id: "governance-role-permission-v1" as const,
    suite: "governance" as const,
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    source_commit: "0000000000000000000000000000000000000000",
    question: GOVERNANCE_ROLE_PERMISSION_V1_QUESTION,
    oracle: {
      suite: "governance" as const,
      oracle_type: "GOVERNANCE_SERVICE_QUALITY" as const,
      expected: [
        "proposer 越权操作全部被拒绝",
        "reviewer 越权操作全部被拒绝",
        "admin 越权操作被拒绝",
        "publisher 合法发布/回滚操作成功",
        "publisher 内容修改操作被拒绝",
      ],
    },
    license: "CC-BY-4.0",
    case_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
  };
  const { case_hash: _, ...material } = caseInput;
  const hash = await sha256ContentHash(material);
  return {
    ...caseInput,
    case_hash: hash,
  };
}

export function createGovernanceRolePermissionV1Manifest(
  evalCase: EvalCase,
): z.infer<typeof benchmarkManifestSchema> {
  return {
    manifest_id: `manifest-${evalCase.case_id}`,
    manifest_version: "1.0.0",
    manifest_revision: 1,
    case_ref: {
      artifact_id: evalCase.case_id,
      artifact_type: "EvalCase",
      app_id: evalCase.case_id,
      tenant_id: "default",
      environment: "research",
      run_id: evalCase.case_id,
      revision: 1,
      content_hash: evalCase.case_hash,
    },
    suite: "governance",
    dataset: GOVERNANCE_ROLE_PERMISSION_V1_DATASET,
    semantic_release_ref: null,
    mutation_definitions: GOVERNANCE_ROLE_PERMISSION_V1_MUTATIONS,
    budget: GOVERNANCE_ROLE_PERMISSION_V1_BUDGET,
    demo_holdout_identity: GOVERNANCE_ROLE_PERMISSION_V1_DEMO_HOLDOUT,
    l2_non_causal_boundary: GOVERNANCE_ROLE_PERMISSION_V1_L2_BOUNDARY,
    manifest_hash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000" as `sha256:${string}`,
    created_at: new Date().toISOString(),
  };
}
