import { describe, expect, it } from "vitest";
import {
  assertM1SubsetRestriction,
  assertSemanticSourceBundleInvariants,
  type CapabilityProfile,
  computeExecutableSemanticDigest,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  SemanticGovernanceError,
  type SemanticSourceBundle,
  semanticSourceBundleSchema,
  U5_EXECUTABLE_SUBSET,
  U13_EXECUTABLE_SUBSET,
} from "../src/artifacts/semantic-governance.js";
import { environments, hashes, ids } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const baseMetadata = {
  bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
  bundle_id: ids.appA,
  scope,
  producer: { kind: "deterministic" as const, id: "test-producer" },
  authority: { kind: "deterministic" as const, id: "test-authority", policy_version: "1.0.0" },
  authority_envelope: {
    kind: "PREVIEW" as const,
    candidate_id: ids.appA,
    working_revision: 1,
  },
  created_at: "2026-08-04T00:00:00.000Z",
};

function makeFormula() {
  return {
    formula_id: ids.appA,
    expression: "SUM(revenue) - SUM(cost)",
  };
}

function makeGrain() {
  return {
    grain_id: ids.appA,
    description: "Daily grain",
    granularity: "day" as const,
  };
}

function makeUnit() {
  return {
    unit_id: ids.appA,
    description: "US Dollar",
    dimension: "currency" as const,
    base_unit: null,
    conversion_factor: null,
  };
}

function makeTimeDomain() {
  return {
    time_domain_id: ids.appA,
    description: "Fiscal year",
    calendar: "gregorian" as const,
    timezone: "UTC",
    min_time: "2024-01-01",
    max_time: "2026-12-31",
  };
}

function makeMetric(overrides: Record<string, unknown> = {}) {
  return {
    metric_id: ids.appA,
    name: "Revenue",
    aliases: ["revenue", "sales"],
    description: "Total revenue",
    table_id: ids.appA,
    column_id: "amount",
    aggregation: "sum" as const,
    formula: makeFormula(),
    grain: makeGrain(),
    unit: makeUnit(),
    time_domain: makeTimeDomain(),
    time_column_id: "order_date",
    additivity: "additive" as const,
    null_policy: "coalesce-zero" as const,
    fanout_policy: "preaggregate" as const,
    dependency_column_ids: ["order_id", "customer_id"],
    analysis: {
      primary: true,
      priority: 0,
      missing_period_policy: "NULL" as const,
      seasonality: null,
      allowed_dimension_ids: [],
      capabilities: [],
      causal_role: null,
    },
    ...overrides,
  };
}

function makeContributionProfile(overrides: Record<string, unknown> = {}) {
  return {
    profile_id: ids.appA,
    targets: [
      {
        endpoint_id: ids.appA,
        kind: "ROW_PARTITION" as const,
        metric_ref: ids.appA,
        baseline_query_contract_template_hash: hashes.input,
        followup_query_contract_template_hash: hashes.input,
        fixed_predicate_ast_hash: hashes.input,
        expected_row0_cell: "0",
        ontology_identity: ids.appA,
        datasource_id: ids.appA,
        unit_ref: null,
        grain_ref: ids.appA,
        time_domain_ref: null,
        filter_hash: hashes.input,
        snapshot_policy: "LATEST" as const,
      },
    ],
    witnesses: [
      {
        kind: "ROW_PARTITION" as const,
        witness: {
          same_measure: {
            canonical_measure_ast_hash: hashes.input,
            aggregation_algebra: "SUM",
            grain_identity: ids.appA,
            unit_identity: null,
            null_policy_identity: "coalesce-zero",
            universe_hash: hashes.input,
          },
          driver_predicate_hash: hashes.input,
          residual_predicate_hash: hashes.input,
          driver_residual_mutual_exclusion_hash: hashes.input,
          driver_residual_exhaustive_union_hash: hashes.input,
          max_bound: 6,
          stable_ordering: ["channel", "region"],
        },
      },
    ],
    static_driver_capacity: [
      {
        obligation_id: ids.appA,
        max_sql_executions: 16,
        endpoint_cost_model: "simple",
        compiler_version: ids.appA,
        diagnostic_binding_limit: 100,
        artifact_input_limit: 50,
      },
    ],
    stable_ordering: ["channel", "region"],
    declared_max_bound: 6,
    ...overrides,
  };
}

function buildU5Bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { ...baseMetadata, capability_profile: U5_EXECUTABLE_SUBSET },
    formulas: [],
    metrics: [makeMetric()],
    dimensions: [],
    relationships: [],
    ...overrides,
  };
}

function buildU13Bundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { ...baseMetadata, capability_profile: U13_EXECUTABLE_SUBSET },
    formulas: [],
    metrics: [makeMetric()],
    dimensions: [],
    relationships: [],
    ...overrides,
  };
}

describe("U13_EXECUTABLE_SUBSET", () => {
  it("U13_EXECUTABLE_SUBSET 常量定义正确", () => {
    expect(U13_EXECUTABLE_SUBSET).toBe("U13_EXECUTABLE_SUBSET");
  });

  it("CapabilityProfile 类型包含 U13", () => {
    const profile: CapabilityProfile = U13_EXECUTABLE_SUBSET;
    expect(profile).toBe(U13_EXECUTABLE_SUBSET);
  });

  it("CapabilityProfile 类型包含 U5", () => {
    const profile: CapabilityProfile = U5_EXECUTABLE_SUBSET;
    expect(profile).toBe(U5_EXECUTABLE_SUBSET);
  });

  it("U13 profile 可以通过 schema 校验", () => {
    const bundle = buildU13Bundle();
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("U13 profile 可以通过 schema 校验（含 contribution_profile）", () => {
    const bundle = buildU13Bundle({ contribution_profile: makeContributionProfile() });
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("U5 profile 可以通过 schema 校验（不含 contribution_profile）", () => {
    const bundle = buildU5Bundle();
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("U5 profile 通过 schema 校验（含 contribution_profile）", () => {
    const bundle = buildU5Bundle({ contribution_profile: makeContributionProfile() });
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("不支持的 capability_profile 被 schema 拒绝", () => {
    const bundle = buildU5Bundle();
    (bundle.metadata as Record<string, unknown>).capability_profile = "INVALID_PROFILE";
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });
});

describe("assertSemanticSourceBundleInvariants", () => {
  it("U5 profile 校验通过", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();
  });

  it("U13 profile 校验通过", () => {
    const bundle = buildU13Bundle() as SemanticSourceBundle;
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();
  });

  it("U13 profile 含 contribution_profile 校验通过", () => {
    const bundle = buildU13Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();
  });

  it("catalog 中存在的 table 可以建立物理绑定", () => {
    const tableId = "orders@1";
    const columnId = "orders.amount@1";
    const bundle = buildU5Bundle({
      catalog_governance: {
        tables: [
          {
            table_id: tableId,
            table_name: "orders",
            columns: [
              {
                column_id: columnId,
                nullable: false,
                data_type: "numeric",
                constraint_refs: [],
              },
            ],
            snapshot_currentness: {
              snapshot_timestamp: "2026-08-15T00:00:00.000Z",
              staleness_threshold_seconds: null,
            },
            catalog_fence: "test-catalog",
          },
        ],
        data_quality_oracle_refs: [],
      },
      physical_binding: {
        default_datasource_id: ids.appB,
        entries: [
          {
            logical_object_id: tableId,
            logical_object_type: "table",
            datasource_id: ids.appB,
            schema_name: "demo",
            table_name: "orders",
            column_name: null,
            binding_lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
          {
            logical_object_id: columnId,
            logical_object_type: "column",
            datasource_id: ids.appB,
            schema_name: "demo",
            table_name: "orders",
            column_name: "amount",
            binding_lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
        ],
      },
    }) as SemanticSourceBundle;
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();
  });

  it("不支持的 capability_profile 被拒绝", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    (bundle.metadata as Record<string, unknown>).capability_profile = "INVALID_PROFILE";
    expect(() => assertSemanticSourceBundleInvariants(bundle)).toThrow(SemanticGovernanceError);
  });

  it("不支持的 capability_profile 错误消息正确", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    (bundle.metadata as Record<string, unknown>).capability_profile = "INVALID_PROFILE";
    expect(() => assertSemanticSourceBundleInvariants(bundle)).toThrow(
      "CapabilityProfile 必须为 U5_EXECUTABLE_SUBSET 或 U13_EXECUTABLE_SUBSET",
    );
  });
});

describe("assertM1SubsetRestriction", () => {
  it("U5 profile 不含 contribution_profile 通过", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    expect(() => assertM1SubsetRestriction(bundle)).not.toThrow();
  });

  it("U5 profile 含 contribution_profile 被拒绝", () => {
    const bundle = buildU5Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    expect(() => assertM1SubsetRestriction(bundle)).toThrow(SemanticGovernanceError);
  });

  it("U5 profile 含 contribution_profile 错误消息正确", () => {
    const bundle = buildU5Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    expect(() => assertM1SubsetRestriction(bundle)).toThrow(
      "M1 不允许 DescriptiveContributionProfile",
    );
  });

  it("U13 profile 不含 contribution_profile 通过", () => {
    const bundle = buildU13Bundle() as SemanticSourceBundle;
    expect(() => assertM1SubsetRestriction(bundle)).not.toThrow();
  });

  it("U13 profile 含 contribution_profile 通过", () => {
    const bundle = buildU13Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    expect(() => assertM1SubsetRestriction(bundle)).not.toThrow();
  });

  it("不支持的 profile 被拒绝", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    (bundle.metadata as Record<string, unknown>).capability_profile = "INVALID_PROFILE";
    expect(() => assertM1SubsetRestriction(bundle)).toThrow(SemanticGovernanceError);
  });

  it("不支持的 profile 错误消息正确", () => {
    const bundle = buildU5Bundle() as SemanticSourceBundle;
    (bundle.metadata as Record<string, unknown>).capability_profile = "INVALID_PROFILE";
    expect(() => assertM1SubsetRestriction(bundle)).toThrow(
      "M1 只允许 U5_EXECUTABLE_SUBSET 或 U13_EXECUTABLE_SUBSET",
    );
  });
});

describe("computeExecutableSemanticDigest", () => {
  it("U13 bundle 的 digest 包含 contribution_profile", async () => {
    const bundleWithProfile = buildU13Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    const bundleWithoutProfile = buildU13Bundle() as SemanticSourceBundle;
    // Re-parse through Zod to get defaults filled in
    const parsedWith = semanticSourceBundleSchema.parse(bundleWithProfile);
    const parsedWithout = semanticSourceBundleSchema.parse(bundleWithoutProfile);

    const digestWith = await computeExecutableSemanticDigest(parsedWith);
    const digestWithout = await computeExecutableSemanticDigest(parsedWithout);

    // contribution_profile 改变应导致 digest 不同
    expect(digestWith).not.toBe(digestWithout);
  });

  it("U13 bundle 的 digest 格式正确", async () => {
    const bundle = buildU13Bundle({
      contribution_profile: makeContributionProfile(),
    }) as SemanticSourceBundle;
    const parsed = semanticSourceBundleSchema.parse(bundle);
    const digest = await computeExecutableSemanticDigest(parsed);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("U5 bundle 与 U13 bundle 的 digest 相同（无 contribution_profile 时）", async () => {
    const u5Bundle = semanticSourceBundleSchema.parse(buildU5Bundle());
    const u13Bundle = semanticSourceBundleSchema.parse(buildU13Bundle());

    const digestU5 = await computeExecutableSemanticDigest(u5Bundle);
    const digestU13 = await computeExecutableSemanticDigest(u13Bundle);

    // metadata 被排除，且两者都没有 contribution_profile，所以 digest 应相同
    expect(digestU5).toBe(digestU13);
  });
});
