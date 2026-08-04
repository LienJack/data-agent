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
import { benchmarkSuiteSchema, type EvalCase } from "./index.js";

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
