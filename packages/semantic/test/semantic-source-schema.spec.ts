import {
  businessOntologySchema,
  catalogGovernanceSchema,
  grainSchema,
  physicalBindingSchema,
  runtimeAuthSchema,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  semanticDimensionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
  semanticSourceBundleMetadataSchema,
  semanticSourceBundleSchema,
  timeDomainSchema,
  U5_EXECUTABLE_SUBSET,
  unitSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";

const validGrain = {
  grain_id: "00000000-0000-1000-8000-000000000001",
  granularity: "day" as const,
};
const validUnit = {
  unit_id: "00000000-0000-1000-8000-000000000006",
  dimension: "currency" as const,
  base_unit: null,
  conversion_factor: null,
};
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
    expect(semanticSourceBundleSchema.safeParse({ ...validBundle, metrics: [] }).success).toBe(
      false,
    );
  });
  it("rejects wrong capability_profile", () => {
    expect(
      semanticSourceBundleSchema.safeParse({
        ...validBundle,
        metadata: { ...validMetadata, capability_profile: "UNKNOWN" },
      }).success,
    ).toBe(false);
  });
  it("rejects unknown relation discriminator", () => {
    expect(
      semanticRelationshipSchema.safeParse({
        relationship_id: "00000000-0000-1000-8000-000000000030",
        name: "R",
        kind: "invalid",
        left_table_id: "00000000-0000-1000-8000-000000000001",
        left_column_ids: ["a.id"],
        right_table_id: "00000000-0000-1000-8000-000000000040",
        right_column_ids: ["b.id"],
        cardinality: "one-to-one",
        left_row_preservation: "required" as const,
        right_row_preservation: "required" as const,
        proof_kind: "DDL_ENFORCED" as const,
        proof_detail: null,
        tags: [],
      }).success,
    ).toBe(false);
  });
  it("rejects wrong granularity", () => {
    expect(
      grainSchema.safeParse({ grain_id: "g", granularity: "millennium" as const }).success,
    ).toBe(false);
  });
  it("rejects wrong aggregation", () => {
    expect(semanticMetricSchema.safeParse({ ...validMetric, aggregation: "stdev" }).success).toBe(
      false,
    );
  });
  it("rejects wrong additivity", () => {
    expect(semanticMetricSchema.safeParse({ ...validMetric, additivity: "invalid" }).success).toBe(
      false,
    );
  });
  it("rejects wrong data_type", () => {
    expect(
      semanticDimensionSchema.safeParse({ ...validDimension, data_type: "blob" }).success,
    ).toBe(false);
  });
  it("rejects wrong proof_kind", () => {
    expect(
      semanticRelationshipSchema.safeParse({
        relationship_id: "00000000-0000-1000-8000-000000000050",
        name: "R",
        kind: "analytical",
        left_table_id: "00000000-0000-1000-8000-000000000001",
        left_column_ids: ["a.id"],
        right_table_id: "00000000-0000-1000-8000-000000000040",
        right_column_ids: ["b.id"],
        cardinality: "one-to-one",
        left_row_preservation: "required" as const,
        right_row_preservation: "required" as const,
        proof_kind: "invalid" as const,
        proof_detail: null,
        tags: [],
      }).success,
    ).toBe(false);
  });
  it("rejects wrong action", () => {
    expect(
      runtimeAuthSchema.safeParse({
        table_rules: [
          {
            table_id: "00000000-0000-1000-8000-000000000001",
            action: "GRANT",
            column_ids: ["t.c"],
            predicates: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
describe("BusinessOntology Schema", () => {
  it("accepts valid business ontology", () => {
    const ontology = {
      domain: "ecommerce",
      entities: [
        {
          entity_id: "00000000-0000-1000-8000-000000000100",
          name: "Customer",
          domain: "ecommerce",
          owner: "data-team",
          lifecycle: "active" as const,
          aliases: ["client"],
          business_relationship_types: [],
        },
      ],
      events: [
        {
          event_id: "00000000-0000-1000-8000-000000000200",
          name: "OrderPlaced",
          domain: "ecommerce",
          subject_entity_id: "00000000-0000-1000-8000-000000000100",
          event_type: "transactional",
        },
      ],
      terms: [
        {
          term_id: "00000000-0000-1000-8000-000000000300",
          name: "Active Customer",
          definition: "A customer with at least one order in the last 90 days.",
          domain: "ecommerce",
          aliases: [],
        },
      ],
      owner: "data-team",
      lifecycle: "active" as const,
    };
    expect(businessOntologySchema.safeParse(ontology).success).toBe(true);
  });

  it("rejects business ontology with unknown field", () => {
    const ontology = {
      domain: "ecommerce",
      entities: [],
      events: [],
      terms: [],
      owner: "data-team",
      lifecycle: "active" as const,
      extra_field: "not-allowed",
    };
    expect(businessOntologySchema.safeParse(ontology).success).toBe(false);
  });

  it("rejects wrong lifecycle", () => {
    expect(
      businessOntologySchema.safeParse({
        domain: "ecommerce",
        entities: [],
        events: [],
        terms: [],
        owner: "data-team",
        lifecycle: "unknown",
      }).success,
    ).toBe(false);
  });
});

describe("CatalogGovernance Schema", () => {
  it("accepts valid catalog governance", () => {
    const catalog = {
      tables: [
        {
          table_id: "00000000-0000-1000-8000-000000000400",
          table_name: "orders",
          columns: [
            {
              column_id: "orders.id",
              nullable: false,
              data_type: "uuid",
              constraint_refs: ["pk_orders"],
            },
          ],
          snapshot_currentness: {
            snapshot_timestamp: "2026-08-04T00:00:00Z",
            staleness_threshold_seconds: 3600,
          },
          catalog_fence: "default",
        },
      ],
      data_quality_oracle_refs: [],
    };
    expect(catalogGovernanceSchema.safeParse(catalog).success).toBe(true);
  });

  it("rejects catalog governance with unknown field", () => {
    const catalog = {
      tables: [
        {
          table_id: "00000000-0000-1000-8000-000000000400",
          table_name: "orders",
          columns: [
            {
              column_id: "orders.id",
              nullable: false,
              data_type: "uuid",
              constraint_refs: [],
            },
          ],
          snapshot_currentness: {
            snapshot_timestamp: null,
            staleness_threshold_seconds: null,
          },
          catalog_fence: null,
          extra: "not-allowed",
        },
      ],
      data_quality_oracle_refs: [],
    };
    expect(catalogGovernanceSchema.safeParse(catalog).success).toBe(false);
  });

  it("rejects catalog governance with empty tables", () => {
    expect(
      catalogGovernanceSchema.safeParse({
        tables: [],
        data_quality_oracle_refs: [],
      }).success,
    ).toBe(false);
  });
});

describe("PhysicalBinding Schema", () => {
  it("accepts valid physical binding", () => {
    const binding = {
      entries: [
        {
          logical_object_id: "00000000-0000-1000-8000-000000000010",
          logical_object_type: "metric" as const,
          datasource_id: "00000000-0000-1000-8000-000000000500",
          schema_name: "public",
          table_name: "orders",
          column_name: "amount",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
        },
      ],
      default_datasource_id: "00000000-0000-1000-8000-000000000500",
    };
    expect(physicalBindingSchema.safeParse(binding).success).toBe(true);
  });

  it("rejects physical binding with unknown field", () => {
    const binding = {
      entries: [
        {
          logical_object_id: "00000000-0000-1000-8000-000000000010",
          logical_object_type: "metric" as const,
          datasource_id: "00000000-0000-1000-8000-000000000500",
          schema_name: "public",
          table_name: "orders",
          column_name: "amount",
          binding_lifecycle: "active" as const,
          valid_from: null,
          valid_until: null,
          extra: "not-allowed",
        },
      ],
      default_datasource_id: null,
    };
    expect(physicalBindingSchema.safeParse(binding).success).toBe(false);
  });

  it("rejects physical binding with empty entries", () => {
    expect(
      physicalBindingSchema.safeParse({
        entries: [],
        default_datasource_id: null,
      }).success,
    ).toBe(false);
  });
});

describe("SemanticSourceBundle with new planes", () => {
  it("accepts bundle with business_ontology", () => {
    const bundle = {
      ...validBundle,
      runtime_authorization: undefined,
      business_ontology: {
        domain: "ecommerce",
        entities: [],
        events: [],
        terms: [],
        owner: "data-team",
        lifecycle: "active" as const,
      },
    };
    expect(semanticSourceBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it("accepts bundle with physical_binding", () => {
    const bundle = {
      ...validBundle,
      runtime_authorization: undefined,
      physical_binding: {
        entries: [
          {
            logical_object_id: "00000000-0000-1000-8000-000000000010",
            logical_object_type: "metric" as const,
            datasource_id: "00000000-0000-1000-8000-000000000500",
            schema_name: "public",
            table_name: "orders",
            column_name: "amount",
            binding_lifecycle: "active" as const,
            valid_from: null,
            valid_until: null,
          },
        ],
        default_datasource_id: null,
      },
    };
    expect(semanticSourceBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it("accepts bundle with catalog_governance", () => {
    const bundle = {
      ...validBundle,
      runtime_authorization: undefined,
      catalog_governance: {
        tables: [
          {
            table_id: "00000000-0000-1000-8000-000000000011",
            table_name: "orders",
            columns: [
              {
                column_id: "orders.amount",
                nullable: false,
                data_type: "numeric",
                constraint_refs: [],
              },
            ],
            snapshot_currentness: {
              snapshot_timestamp: null,
              staleness_threshold_seconds: null,
            },
            catalog_fence: null,
          },
        ],
        data_quality_oracle_refs: [],
      },
    };
    expect(semanticSourceBundleSchema.safeParse(bundle).success).toBe(true);
  });
});
