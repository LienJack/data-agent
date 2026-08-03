import { describe, expect, it } from "vitest";
import {
  semanticSourceBundleSchema,
  semanticSourceBundleMetadataSchema,
  semanticMetricSchema,
  semanticDimensionSchema,
  semanticRelationshipSchema,
  runtimeAuthSchema,
  grainSchema,
  unitSchema,
  timeDomainSchema,
  U5_EXECUTABLE_SUBSET,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
} from "@data-agent/contracts";

const validGrain = { grain_id: "00000000-0000-1000-8000-000000000001", granularity: "day" as const };
const validUnit = { unit_id: "00000000-0000-1000-8000-000000000006", dimension: "currency" as const, base_unit: null, conversion_factor: null };
const validTimeDomain = {
  time_domain_id: "00000000-0000-1000-8000-000000000007",
  calendar: "gregorian" as const,
  timezone: "UTC" as const,
  min_time: null,
  max_time: null,
};
const validMetric = {
  metric_id: "00000000-0000-1000-8000-000000000010",
  name: "Revenue",
  aliases: ["revenue", "sales"],
  table_id: "00000000-0000-1000-8000-000000000011",
  column_id: "orders.amount",
  aggregation: "sum",
  formula: null,
  grain: validGrain,
  unit: validUnit,
  time_domain: validTimeDomain,
  time_column_id: "orders.order_date",
  additivity: "additive",
  null_policy: "coalesce-zero",
  fanout_policy: "preaggregate",
  dependency_column_ids: ["orders.amount"],
  tags: [],
};
const validDimension = {
  dimension_id: "00000000-0000-1000-8000-000000000020",
  name: "Region",
  aliases: ["region", "area"],
  table_id: "00000000-0000-1000-8000-000000000002",
  column_id: "customers.region",
  grain: validGrain,
  data_type: "text",
  sensitivity: "PUBLIC",
  hierarchical: false,
  parent_dimension_id: null,
  tags: [],
};
const validMetadata = {
  bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
  capability_profile: U5_EXECUTABLE_SUBSET,
  bundle_id: "00000000-0000-1000-8000-000000000003",
  scope: { app_id: "00000000-0000-1000-8000-000000000004", tenant_id: "00000000-0000-1000-8000-000000000005", environment: "test" },
  producer: { kind: "deterministic" as const, id: "semantic-compiler" },
  authority: { kind: "deterministic" as const, id: "semantic-authority", policy_version: "semantic-authority@1.0.0" },
  created_at: "2026-08-04T00:00:00Z",
};
const validBundle = {
  metadata: validMetadata,
  formulas: [],
  metrics: [validMetric],
  dimensions: [validDimension],
  relationships: [],
  runtime_authorization: undefined,
};

describe("SemanticSourceBundle Schema", () => {
  it("accepts valid bundle", () => {
    expect(semanticSourceBundleSchema.safeParse(validBundle).success).toBe(true);
  });
  it("rejects empty metrics", () => {
    expect(semanticSourceBundleSchema.safeParse({ ...validBundle, metrics: [] }).success).toBe(false);
  });
  it("rejects wrong capability_profile", () => {
    expect(semanticSourceBundleSchema.safeParse({ ...validBundle, metadata: { ...validMetadata, capability_profile: "UNKNOWN" } }).success).toBe(false);
  });
  it("rejects unknown relation discriminator", () => {
    expect(semanticRelationshipSchema.safeParse({
      relationship_id: "00000000-0000-1000-8000-000000000030", name: "R", kind: "invalid",
      left_table_id: "00000000-0000-1000-8000-000000000001", left_column_ids: ["a.id"],
      right_table_id: "00000000-0000-1000-8000-000000000040", right_column_ids: ["b.id"],
      cardinality: "one-to-one", left_row_preservation: "required" as const,
      right_row_preservation: "required" as const, proof_kind: "DDL_ENFORCED" as const,
      proof_detail: null, tags: [],
    }).success).toBe(false);
  });
  it("rejects wrong granularity", () => {
    expect(grainSchema.safeParse({ grain_id: "g", granularity: "millennium" as const }).success).toBe(false);
  });
  it("rejects wrong aggregation", () => {
    expect(semanticMetricSchema.safeParse({ ...validMetric, aggregation: "stdev" }).success).toBe(false);
  });
  it("rejects wrong additivity", () => {
    expect(semanticMetricSchema.safeParse({ ...validMetric, additivity: "invalid" }).success).toBe(false);
  });
  it("rejects wrong data_type", () => {
    expect(semanticDimensionSchema.safeParse({ ...validDimension, data_type: "blob" }).success).toBe(false);
  });
  it("rejects wrong proof_kind", () => {
    expect(semanticRelationshipSchema.safeParse({
      relationship_id: "00000000-0000-1000-8000-000000000050", name: "R", kind: "analytical",
      left_table_id: "00000000-0000-1000-8000-000000000001", left_column_ids: ["a.id"],
      right_table_id: "00000000-0000-1000-8000-000000000040", right_column_ids: ["b.id"],
      cardinality: "one-to-one", left_row_preservation: "required" as const,
      right_row_preservation: "required" as const, proof_kind: "invalid" as const,
      proof_detail: null, tags: [],
    }).success).toBe(false);
  });
  it("rejects wrong action", () => {
    expect(runtimeAuthSchema.safeParse({
      table_rules: [{ table_id: "00000000-0000-1000-8000-000000000001", action: "GRANT", column_ids: ["t.c"], predicates: [] }],
    }).success).toBe(false);
  });
});
