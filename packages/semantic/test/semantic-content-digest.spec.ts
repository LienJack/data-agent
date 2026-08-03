import { describe, expect, it } from "vitest";
import { computeExecutableSemanticDigest, computeSemanticSourceBundleHash } from "@data-agent/contracts";
import { U5_EXECUTABLE_SUBSET, SEMANTIC_SOURCE_BUNDLE_VERSION } from "@data-agent/contracts";

const baseMetadata = {
  bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
  capability_profile: U5_EXECUTABLE_SUBSET,
  bundle_id: "00000000-0000-1000-8000-000000000003",
  scope: { app_id: "00000000-0000-1000-8000-000000000004", tenant_id: "00000000-0000-1000-8000-000000000005", environment: "test" },
  producer: { kind: "deterministic" as const, id: "semantic-compiler" },
  authority: { kind: "deterministic" as const, id: "semantic-authority", policy_version: "semantic-authority@1.0.0" },
  created_at: "2026-08-04T00:00:00Z",
};

const baseMetric = {
  metric_id: "metric-revenue",
  name: "Revenue",
  aliases: ["revenue"],
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

describe("Semantic Content Digest", () => {
  it("same executable content has same digest in fixture/published context", async () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const digest1 = await computeExecutableSemanticDigest(bundle);
    const digest2 = await computeExecutableSemanticDigest(bundle);
    expect(digest1).toBe(digest2);
  });

  it("metric mutation changes digest", () => {
    const bundle1 = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const bundle2 = {
      ...bundle1,
      metrics: [{ ...baseMetric, aggregation: "count" as const }],
    };
    const digest1 = computeExecutableSemanticDigest(bundle1);
    const digest2 = computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("relation mutation changes digest", async () => {
    const bundle1 = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [{
        relationship_id: "rel-1", name: "R1", kind: "analytical" as const,
        left_table_id: "a", left_column_ids: ["a.id"],
        right_table_id: "b", right_column_ids: ["b.id"],
        cardinality: "one-to-one" as const, left_row_preservation: "required" as const,
        right_row_preservation: "required" as const, proof_kind: "DDL_ENFORCED" as const,
        proof_detail: null, tags: [],
      }],
      runtime_authorization: undefined,
    };
    const bundle2 = {
      ...bundle1,
      relationships: [{
        relationship_id: "rel-2",
        kind: "business" as const,
        left_table_id: "a",
        left_column_ids: ["a.id"],
        name: "test-rel",
        right_table_id: "b",
        right_column_ids: ["b.id"],
        cardinality: "one-to-one" as const,
        left_row_preservation: "required" as const,
        right_row_preservation: "required" as const,
        proof_kind: "DDL_ENFORCED" as const,
        proof_detail: null,
        tags: [] as string[],
      }],
    };
    const digest1 = computeExecutableSemanticDigest(bundle1);
    const digest2 = computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("binding mutation changes digest", async () => {
    const bundle1 = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [],
      runtime_authorization: { table_rules: [{ table_id: "orders", action: "DENY" as const, column_ids: ["orders.amount"], predicates: [] }] },
    };
    const bundle2 = {
      ...bundle1,
      runtime_authorization: { table_rules: [{ table_id: "orders", action: "DENY" as const, column_ids: ["orders.amount", "orders.customer_id"], predicates: [] }] },
    };
    const digest1 = computeExecutableSemanticDigest(bundle1);
    const digest2 = computeExecutableSemanticDigest(bundle2);
    expect(digest1).not.toBe(digest2);
  });

  it("bundle hash is deterministic", async () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const hash1 = await computeSemanticSourceBundleHash(bundle);
    const hash2 = await computeSemanticSourceBundleHash(bundle);
    expect(hash1).toBe(hash2);
  });
});
