import { describe, expect, it } from "vitest";
import {
  semanticSourceBundleSchema,
  computeExecutableSemanticDigest,
  computeSemanticSourceBundleHash,
  assertSemanticSourceBundleInvariants,
  assertM1SubsetRestriction,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  U5_EXECUTABLE_SUBSET,
} from "@data-agent/contracts";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const baseMetadata = {
  bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
  capability_profile: U5_EXECUTABLE_SUBSET,
  bundle_id: "00000000-0000-1000-8000-0000000000aa",
  scope: {
    app_id: "00000000-0000-1000-8000-0000000000bb",
    tenant_id: "00000000-0000-1000-8000-0000000000cc",
    environment: "test" as const,
  },
  producer: { kind: "deterministic" as const, id: "semantic-compiler" },
  authority: { kind: "deterministic" as const, id: "semantic-authority", policy_version: "semantic-authority@1.0.0" },
  created_at: "2026-08-04T00:00:00Z",
};

const baseMetric = {
  metric_id: "metric-revenue",
  name: "Revenue",
  aliases: ["revenue", "sales"],
  table_id: "orders",
  column_id: "orders.amount",
  aggregation: "sum" as const,
  formula: null,
  grain: { grain_id: "grain-day", granularity: "day" as const },
  unit: { unit_id: "unit-usd", dimension: "currency" as const, base_unit: null, conversion_factor: null },
  time_domain: { time_domain_id: "td-utc", calendar: "gregorian" as const, timezone: "UTC" as const, min_time: null, max_time: null },
  time_column_id: "orders.order_date",
  additivity: "additive" as const,
  null_policy: "coalesce-zero" as const,
  fanout_policy: "preaggregate" as const,
  dependency_column_ids: ["orders.amount"],
  tags: [] as string[],
};

const baseDimension = {
  dimension_id: "dimension-region",
  name: "Region",
  aliases: ["region", "area"],
  table_id: "customers",
  column_id: "customers.region",
  grain: { grain_id: "grain-day", granularity: "day" as const },
  data_type: "text" as const,
  sensitivity: "PUBLIC" as const,
  hierarchical: false,
  parent_dimension_id: null,
  tags: [] as string[],
};

const baseRelationship = {
  relationship_id: "rel-orders-customers",
  name: "orders_customers",
  kind: "analytical" as const,
  left_table_id: "orders",
  left_column_ids: ["orders.customer_id"],
  right_table_id: "customers",
  right_column_ids: ["customers.id"],
  cardinality: "many-to-one" as const,
  left_row_preservation: "required" as const,
  right_row_preservation: "optional" as const,
  proof_kind: "DDL_ENFORCED" as const,
  proof_detail: null,
  tags: [] as string[],
};

const baseRuntimeAuth = {
  table_rules: [
    {
      table_id: "orders",
      action: "DENY" as const,
      column_ids: ["orders.amount"],
      predicates: [],
    },
  ],
};

function createValidBundle() {
  return {
    metadata: baseMetadata,
    formulas: [],
    metrics: [baseMetric],
    dimensions: [baseDimension],
    relationships: [baseRelationship],
    runtime_authorization: baseRuntimeAuth,
  };
}

describe("U10.1a Projection Compatibility — U10 projection 经 U10.0 物化后通过 U5 schema/hash", () => {
  // ─── U5 Schema Validation ─────────────────────────────────────────────────

  it("U10 SemanticSourceBundle 通过 U5 schema 验证", () => {
    const bundle = createValidBundle();
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("U10 SemanticSourceBundle 通过 U5 不变量断言", () => {
    const bundle = createValidBundle();
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();
  });

  it("U10 SemanticSourceBundle 通过 M1 子集限制", () => {
    const bundle = createValidBundle();
    expect(() => assertM1SubsetRestriction(bundle)).not.toThrow();
  });

  it("U5 schema 拒绝空 metrics（U5 必须有至少一个 metric）", () => {
    const bundle = { ...createValidBundle(), metrics: [] };
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(false);
  });

  it("U5 不变量断言拒绝空 metrics", () => {
    const bundle = { ...createValidBundle(), metrics: [] };
    expect(() => assertSemanticSourceBundleInvariants(bundle)).toThrow("必须包含至少一个 Metric");
  });

  it("U5 schema 拒绝不支持的 capability_profile", () => {
    const bundle = createValidBundle();
    const mutated = {
      ...bundle,
      metadata: { ...bundle.metadata, capability_profile: "UNKNOWN" },
    };
    const result = semanticSourceBundleSchema.safeParse(mutated);
    expect(result.success).toBe(false);
  });

  it("U5 schema 拒绝不支持的 bundle_version", () => {
    const bundle = createValidBundle();
    const mutated = {
      ...bundle,
      metadata: { ...bundle.metadata, bundle_version: "semantic-source-bundle@2" },
    };
    const result = semanticSourceBundleSchema.safeParse(mutated);
    expect(result.success).toBe(false);
  });

  // ─── Content Digest Consistency ───────────────────────────────────────────

  it("U10 projection 的内容 digest 是确定性的（同一 bundle 两次计算相同）", async () => {
    const bundle = createValidBundle();
    const digest1 = await computeExecutableSemanticDigest(bundle);
    const digest2 = await computeExecutableSemanticDigest(bundle);
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("U10 projection 的 bundle hash 是确定性的", async () => {
    const bundle = createValidBundle();
    const hash1 = await computeSemanticSourceBundleHash(bundle);
    const hash2 = await computeSemanticSourceBundleHash(bundle);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("metric 内容变化改变 digest（digest 绑定可执行内容而非 metadata）", async () => {
    const bundle1 = createValidBundle();
    const bundle2 = { ...createValidBundle(), metrics: [{ ...baseMetric, aggregation: "count" as const }] };
    const digest1 = await computeExecutableSemanticDigest(bundle1);
    const digest2 = await computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("dimension 添加改变 digest", async () => {
    const bundle1 = createValidBundle();
    const extraDim = { ...baseDimension, dimension_id: "dimension-country", name: "Country" };
    const bundle2 = { ...bundle1, dimensions: [...bundle1.dimensions, extraDim] };
    const digest1 = await computeExecutableSemanticDigest(bundle1);
    const digest2 = await computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("relationship 变化改变 digest", async () => {
    const bundle1 = createValidBundle();
    const bundle2 = {
      ...bundle1,
      relationships: [{
        ...baseRelationship,
        relationship_id: "rel-orders-customers-v2",
        cardinality: "one-to-one" as const,
      }],
    };
    const digest1 = await computeExecutableSemanticDigest(bundle1);
    const digest2 = await computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("runtime_authorization 变化改变 digest", async () => {
    const bundle1 = createValidBundle();
    const bundle2 = {
      ...bundle1,
      runtime_authorization: {
        table_rules: [
          { table_id: "orders", action: "DENY" as const, column_ids: ["orders.amount", "orders.customer_id"], predicates: [] },
        ],
      },
    };
    const digest1 = await computeExecutableSemanticDigest(bundle1);
    const digest2 = await computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("metadata 变化不影响 executable digest（只影响 bundle hash）", async () => {
    const bundle1 = createValidBundle();
    const bundle2 = {
      ...bundle1,
      metadata: { ...bundle1.metadata, bundle_id: "00000000-0000-1000-8000-0000000000dd" },
    };
    // executable digest 忽略 metadata
    const digest1 = await computeExecutableSemanticDigest(bundle1);
    const digest2 = await computeExecutableSemanticDigest(bundle2);
    expect(digest1).toBe(digest2);
    // bundle hash 包含 metadata
    const hash1 = await computeSemanticSourceBundleHash(bundle1);
    const hash2 = await computeSemanticSourceBundleHash(bundle2);
    expect(hash1).not.toBe(hash2);
  });

  // ─── Full Pipeline: Parse → Validate → Digest ────────────────────────────

  it("完整流水线：parse → validate → digest 一致", async () => {
    // 模拟 U10 projection 通过 U10.0 物化后的完整流程
    const bundle = createValidBundle();

    // Step 1: U5 schema parse
    const parsed = semanticSourceBundleSchema.safeParse(bundle);
    expect(parsed.success).toBe(true);

    // Step 2: U5 invariant validation
    expect(() => assertSemanticSourceBundleInvariants(bundle)).not.toThrow();

    // Step 3: M1 subset restriction
    expect(() => assertM1SubsetRestriction(bundle)).not.toThrow();

    // Step 4: Content digest
    const digest = await computeExecutableSemanticDigest(bundle);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Step 5: Bundle hash (for content-addressed storage)
    const hash = await computeSemanticSourceBundleHash(bundle);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Step 6: 重新 parse 同一 bundle 产生相同 digest
    const digestRepeated = await computeExecutableSemanticDigest(bundle);
    expect(digestRepeated).toBe(digest);
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────

  it("空 dimensions 数组允许（dimensions 默认 []）", () => {
    const bundle = { ...createValidBundle(), dimensions: [] };
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("空 relationships 数组允许（relationships 默认 []）", () => {
    const bundle = { ...createValidBundle(), relationships: [] };
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("空 runtime_authorization 允许（runtime_authorization 可选）", () => {
    const bundle = { ...createValidBundle(), runtime_authorization: undefined };
    const result = semanticSourceBundleSchema.safeParse(bundle);
    expect(result.success).toBe(true);
  });

  it("重复 metric ID 被不变量断言拒绝", () => {
    const bundle = createValidBundle();
    const mutated = {
      ...bundle,
      metrics: [bundle.metrics[0], bundle.metrics[0]],
    };
    expect(() => assertSemanticSourceBundleInvariants(mutated)).toThrow("重复的 Metric ID");
  });

  it("重复 dimension ID 被不变量断言拒绝", () => {
    const bundle = createValidBundle();
    const mutated = {
      ...bundle,
      dimensions: [bundle.dimensions[0], bundle.dimensions[0]],
    };
    expect(() => assertSemanticSourceBundleInvariants(mutated)).toThrow("重复的 Dimension ID");
  });

  it("M1 子集限制拒绝 contribution_profile", () => {
    const bundle = createValidBundle();
    const mutated = {
      ...bundle,
      contribution_profile: {
        profile_version: "descriptive-contribution@1",
        description: "test",
        endpoints: [],
        binding_rules: [],
        capacity_proofs: [],
      },
    };
    expect(() => assertM1SubsetRestriction(mutated)).toThrow("M1 不允许 DescriptiveContributionProfile");
  });
});
