import { SEMANTIC_SOURCE_BUNDLE_VERSION, U5_EXECUTABLE_SUBSET } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  computeLowerabilityProof,
  LowerabilityStatus,
} from "../src/compiler/lowerability-proof.js";
import { compileU5Projection, getLowerabilityVerdict } from "../src/compiler/u5-compiler.js";

const baseMetadata = {
  bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
  capability_profile: U5_EXECUTABLE_SUBSET,
  bundle_id: "00000000-0000-1000-8000-000000000003",
  scope: {
    app_id: "00000000-0000-1000-8000-000000000004",
    tenant_id: "00000000-0000-1000-8000-000000000005",
    environment: "test",
  },
  producer: { kind: "deterministic" as const, id: "semantic-compiler" },
  authority: {
    kind: "deterministic" as const,
    id: "semantic-authority",
    policy_version: "semantic-authority@1.0.0",
  },
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
  unit: {
    unit_id: "unit-usd",
    dimension: "currency" as const,
    base_unit: null,
    conversion_factor: null,
  },
  time_domain: {
    time_domain_id: "td-utc",
    calendar: "gregorian" as const,
    timezone: "UTC" as const,
    min_time: null,
    max_time: null,
  },
  time_column_id: "orders.order_date",
  additivity: "additive" as const,
  null_policy: "coalesce-zero" as const,
  fanout_policy: "preaggregate" as const,
  dependency_column_ids: ["orders.amount"],
  tags: [] as string[],
};

describe("Formula U5 Lowering", () => {
  it("single column basic aggregation is lowerable", async () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [],
      metrics: [baseMetric],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = await compileU5Projection(bundle);
    expect(getLowerabilityVerdict(result)).toBe("LOWERABLE_TO_U5");
    expect(result.errors.length).toBe(0);
  });

  it("ratio formula is not lowerable", () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [
        {
          formula_id: "formula-ratio",
          formula_type: "ratio" as const,
          return_type: "numeric" as const,
          grain: { grain_id: "grain-day", granularity: "day" as const },
          unit: null,
          time_domain: null,
          additivity: "non-additive" as const,
          cardinality: "scalar" as const,
          null_policy: "propagate" as const,
          dependency_formula_ids: [] as string[],
        },
      ],
      metrics: [
        {
          ...baseMetric,
          metric_id: "metric-ratio",
          formula: { formula_id: "formula-ratio", expression: "a/b", dialect: "text2sql" as const },
          aggregation: "avg" as const,
          additivity: "non-additive" as const,
        },
      ],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = computeLowerabilityProof(bundle);
    const ratioProof = result.proofs.find((p) => p.formulaId === "formula-ratio");
    expect(ratioProof?.status).toBe(LowerabilityStatus.NOT_LOWERABLE);
    expect(ratioProof?.reasonCode).toContain("FORMULA_TYPE_NOT_U5_LOWERABLE");
  });

  it("compound formula is not lowerable", () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [
        {
          formula_id: "formula-compound",
          formula_type: "compound" as const,
          return_type: "numeric" as const,
          grain: { grain_id: "grain-day", granularity: "day" as const },
          unit: null,
          time_domain: null,
          additivity: "non-additive" as const,
          cardinality: "scalar" as const,
          null_policy: "propagate" as const,
          dependency_formula_ids: [] as string[],
        },
      ],
      metrics: [
        {
          ...baseMetric,
          metric_id: "metric-compound",
          formula: {
            formula_id: "formula-compound",
            expression: "a + b",
            dialect: "text2sql" as const,
          },
          additivity: "non-additive" as const,
        },
      ],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = computeLowerabilityProof(bundle);
    const proof = result.proofs.find((p) => p.formulaId === "formula-compound");
    expect(proof?.status).toBe(LowerabilityStatus.NOT_LOWERABLE);
  });

  it("window formula is not lowerable", () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [
        {
          formula_id: "formula-window",
          formula_type: "window" as const,
          return_type: "numeric" as const,
          grain: { grain_id: "grain-day", granularity: "day" as const },
          unit: null,
          time_domain: null,
          additivity: "non-additive" as const,
          cardinality: "scalar" as const,
          null_policy: "propagate" as const,
          dependency_formula_ids: [] as string[],
        },
      ],
      metrics: [
        {
          ...baseMetric,
          metric_id: "metric-window",
          formula: {
            formula_id: "formula-window",
            expression: "ROW_NUMBER()",
            dialect: "text2sql" as const,
          },
          additivity: "non-additive" as const,
        },
      ],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = computeLowerabilityProof(bundle);
    const proof = result.proofs.find((p) => p.formulaId === "formula-window");
    expect(proof?.status).toBe(LowerabilityStatus.NOT_LOWERABLE);
  });

  it("additive aggregate is lowerable", () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [
        {
          formula_id: "formula-additive",
          formula_type: "additive_aggregate" as const,
          return_type: "numeric" as const,
          grain: { grain_id: "grain-day", granularity: "day" as const },
          unit: null,
          time_domain: null,
          additivity: "additive" as const,
          cardinality: "scalar" as const,
          null_policy: "preserve" as const,
          dependency_formula_ids: [] as string[],
        },
      ],
      metrics: [
        {
          ...baseMetric,
          metric_id: "metric-additive",
          formula: {
            formula_id: "formula-additive",
            expression: "SUM(amount)",
            dialect: "text2sql" as const,
          },
        },
      ],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = computeLowerabilityProof(bundle);
    const proof = result.proofs.find((p) => p.formulaId === "formula-additive");
    expect(proof?.status).toBe(LowerabilityStatus.LOWERABLE_TO_U5);
  });

  it("non-additive cardinality is not lowerable", () => {
    const bundle = {
      metadata: baseMetadata,
      formulas: [
        {
          formula_id: "formula-set",
          formula_type: "additive_aggregate" as const,
          return_type: "numeric" as const,
          grain: { grain_id: "grain-day", granularity: "day" as const },
          unit: null,
          time_domain: null,
          additivity: "additive" as const,
          cardinality: "set" as const,
          null_policy: "preserve" as const,
          dependency_formula_ids: [] as string[],
        },
      ],
      metrics: [
        {
          ...baseMetric,
          metric_id: "metric-set",
          formula: {
            formula_id: "formula-set",
            expression: "SUM(amount)",
            dialect: "text2sql" as const,
          },
          cardinality: "set" as const,
        },
      ],
      dimensions: [],
      relationships: [],
      runtime_authorization: undefined,
    };
    const result = computeLowerabilityProof(bundle);
    const proof = result.proofs.find((p) => p.formulaId === "formula-set");
    expect(proof?.status).toBe(LowerabilityStatus.NOT_LOWERABLE);
  });
});
