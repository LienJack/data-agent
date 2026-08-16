import { describe, expect, it } from "vitest";
import {
  evaluateSemanticCoverage,
  SEMANTIC_COVERAGE_POLICY_FLOOR,
  semanticCoveragePolicyFloorSchema,
} from "../src/semantic/semantic-coverage-policy.js";

const hash = `sha256:${"a".repeat(64)}`;

function assessment() {
  return {
    schema_version: "semantic-coverage-assessment@1.0.0",
    policy_floor: SEMANTIC_COVERAGE_POLICY_FLOOR,
    effective_adapter_candidate_id: "postgresql-core-v1",
    adapter_candidates: [
      {
        classification: "CANDIDATE",
        capability_id: "postgresql-core-v1",
        supported_physical_types: ["int8", "text"],
        deterministic_exclusions: [
          {
            physical_type: "geography",
            reason_code: "ADAPTER_TYPE_UNSUPPORTED",
            evidence_hash: hash,
          },
        ],
      },
    ],
    physical_inventory: {
      relations: [
        {
          relation_id: "public.orders",
          primary_key_id: "orders_pkey",
          foreign_keys: [
            {
              foreign_key_id: "orders_customer_fk",
              constraint_identity: "public.orders:orders_customer_fk",
              source_endpoint: {
                relation_id: "public.orders",
                column_ids: ["public.orders.customer_id"],
              },
              target_endpoint: {
                relation_id: "public.customers",
                column_ids: ["public.customers.id"],
              },
            },
          ],
          columns: [
            { column_id: "public.orders.id", physical_type: "int8", queryable: true },
            { column_id: "public.orders.customer_id", physical_type: "int8", queryable: true },
            { column_id: "public.orders.note", physical_type: "text", queryable: true },
            { column_id: "public.orders.area", physical_type: "geography", queryable: true },
          ],
        },
        {
          relation_id: "public.customers",
          primary_key_id: "customers_pkey",
          foreign_keys: [],
          columns: [{ column_id: "public.customers.id", physical_type: "int8", queryable: true }],
        },
      ],
    },
    join_edge_inventory: [
      {
        join_edge_id: "edge.orders.customer",
        foreign_key_id: "orders_customer_fk",
        constraint_identity: "public.orders:orders_customer_fk",
        source_endpoint: {
          relation_id: "public.orders",
          column_ids: ["public.orders.customer_id"],
        },
        target_endpoint: {
          relation_id: "public.customers",
          column_ids: ["public.customers.id"],
        },
        evidence_hash: hash,
      },
    ],
    semantic_coverage: {
      relations: [
        { relation_id: "public.orders", semantic_object_id: "concept.orders" },
        { relation_id: "public.customers", semantic_object_id: "concept.customers" },
      ],
      primary_keys: [
        { primary_key_id: "orders_pkey", mapping_id: "mapping.orders.pk" },
        { primary_key_id: "customers_pkey", mapping_id: "mapping.customers.pk" },
      ],
      foreign_keys: [
        {
          foreign_key_id: "orders_customer_fk",
          join_edge_id: "edge.orders.customer",
          evidence_hash: hash,
        },
      ],
      queryable_columns: [
        { column_id: "public.orders.id", mapping_id: "mapping.orders.id" },
        { column_id: "public.orders.customer_id", mapping_id: "mapping.orders.customer_id" },
        { column_id: "public.orders.note", mapping_id: "mapping.orders.note" },
        { column_id: "public.customers.id", mapping_id: "mapping.customers.id" },
      ],
      excluded_columns: [
        {
          column_id: "public.orders.area",
          adapter_candidate_id: "postgresql-core-v1",
          reason_code: "ADAPTER_TYPE_UNSUPPORTED",
          evidence_hash: hash,
        },
      ],
    },
  } as const;
}

describe("semantic coverage policy floor", () => {
  it("cannot be lowered below complete in-scope coverage", () => {
    expect(semanticCoveragePolicyFloorSchema.parse(SEMANTIC_COVERAGE_POLICY_FLOOR)).toEqual(
      SEMANTIC_COVERAGE_POLICY_FLOOR,
    );
    expect(() =>
      semanticCoveragePolicyFloorSchema.parse({
        ...SEMANTIC_COVERAGE_POLICY_FLOOR,
        relation_coverage_percent: 99,
      }),
    ).toThrow();
  });

  it("passes complete relation, PK, FK/join/evidence and supported-column coverage", () => {
    expect(evaluateSemanticCoverage(assessment())).toEqual({
      ok: true,
      code: "SEMANTIC_COVERAGE_COMPLETE",
      missing: [],
    });
  });

  it("fails closed for missing mappings, join evidence or non-deterministic exclusions", () => {
    const base = assessment();
    expect(
      evaluateSemanticCoverage({
        ...base,
        semantic_coverage: { ...base.semantic_coverage, queryable_columns: [] },
      }).ok,
    ).toBe(false);
    expect(
      evaluateSemanticCoverage({
        ...base,
        semantic_coverage: {
          ...base.semantic_coverage,
          foreign_keys: [{ ...base.semantic_coverage.foreign_keys[0], evidence_hash: undefined }],
        },
      }).ok,
    ).toBe(false);
    expect(
      evaluateSemanticCoverage({
        ...base,
        semantic_coverage: {
          ...base.semantic_coverage,
          excluded_columns: [
            { ...base.semantic_coverage.excluded_columns[0], reason_code: "MODEL_DECIDED" },
          ],
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects a random or endpoint-mismatched join edge for a physical FK", () => {
    const base = assessment();
    expect(
      evaluateSemanticCoverage({
        ...base,
        semantic_coverage: {
          ...base.semantic_coverage,
          foreign_keys: [
            { ...base.semantic_coverage.foreign_keys[0], join_edge_id: "edge.random" },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      evaluateSemanticCoverage({
        ...base,
        join_edge_inventory: [
          {
            ...base.join_edge_inventory[0],
            target_endpoint: {
              ...base.join_edge_inventory[0].target_endpoint,
              relation_id: "public.attackers",
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("requires every FK endpoint to resolve to inventory relations and columns", () => {
    const base = assessment();
    for (const foreignKey of [
      {
        ...base.physical_inventory.relations[0].foreign_keys[0],
        target_endpoint: {
          relation_id: "public.missing",
          column_ids: ["public.missing.id"],
        },
      },
      {
        ...base.physical_inventory.relations[0].foreign_keys[0],
        source_endpoint: {
          relation_id: "public.orders",
          column_ids: ["public.orders.missing"],
        },
      },
      {
        ...base.physical_inventory.relations[0].foreign_keys[0],
        target_endpoint: {
          relation_id: "public.customers",
          column_ids: ["public.customers.missing"],
        },
      },
    ]) {
      expect(
        evaluateSemanticCoverage({
          ...base,
          physical_inventory: {
            relations: [
              { ...base.physical_inventory.relations[0], foreign_keys: [foreignKey] },
              base.physical_inventory.relations[1],
            ],
          },
        }),
      ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
    }
  });

  it("rejects composite FK and join-edge endpoints with unequal arity", () => {
    const base = assessment();
    const mismatchedForeignKey = {
      ...base.physical_inventory.relations[0].foreign_keys[0],
      source_endpoint: {
        relation_id: "public.orders",
        column_ids: ["public.orders.customer_id", "public.orders.id"],
      },
    };
    const mismatchedEdge = {
      ...base.join_edge_inventory[0],
      source_endpoint: mismatchedForeignKey.source_endpoint,
    };
    expect(
      evaluateSemanticCoverage({
        ...base,
        physical_inventory: {
          relations: [
            { ...base.physical_inventory.relations[0], foreign_keys: [mismatchedForeignKey] },
            base.physical_inventory.relations[1],
          ],
        },
        join_edge_inventory: [mismatchedEdge],
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
  });

  it("requires physical FK and join-edge inventories to be exact bidirectional sets", () => {
    const base = assessment();
    expect(evaluateSemanticCoverage({ ...base, join_edge_inventory: [] }).ok).toBe(false);
    expect(
      evaluateSemanticCoverage({
        ...base,
        join_edge_inventory: [
          ...base.join_edge_inventory,
          {
            ...base.join_edge_inventory[0],
            join_edge_id: "edge.extra",
            foreign_key_id: "unknown_fk",
            constraint_identity: "public.orders:unknown_fk",
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects empty physical inventories and relations without columns", () => {
    expect(
      evaluateSemanticCoverage({
        ...assessment(),
        physical_inventory: { relations: [] },
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
    expect(
      evaluateSemanticCoverage({
        ...assessment(),
        physical_inventory: {
          relations: [{ ...assessment().physical_inventory.relations[0], columns: [] }],
        },
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
  });

  it("rejects globally duplicated physical PK, FK and column identities", () => {
    const base = assessment();
    const duplicateInventory = {
      relations: [
        ...base.physical_inventory.relations,
        {
          ...base.physical_inventory.relations[0],
          relation_id: "public.order_archive",
        },
      ],
    };
    expect(
      evaluateSemanticCoverage({
        ...base,
        physical_inventory: duplicateInventory,
        semantic_coverage: {
          ...base.semantic_coverage,
          relations: [
            ...base.semantic_coverage.relations,
            {
              relation_id: "public.order_archive",
              semantic_object_id: "concept.order_archive",
            },
          ],
        },
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
  });

  it("uses only the uniquely bound effective adapter capability", () => {
    const base = assessment();
    const secondaryAdapter = {
      classification: "CANDIDATE",
      capability_id: "adapter-secondary-v1",
      supported_physical_types: ["geography"],
      deterministic_exclusions: [],
    } as const;
    expect(
      evaluateSemanticCoverage({
        ...base,
        adapter_candidates: [...base.adapter_candidates, secondaryAdapter],
      }),
    ).toEqual({ ok: true, code: "SEMANTIC_COVERAGE_COMPLETE", missing: [] });
    expect(
      evaluateSemanticCoverage({
        ...base,
        effective_adapter_candidate_id: "missing-adapter-v1",
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
    expect(
      evaluateSemanticCoverage({
        ...base,
        adapter_candidates: [{ ...base.adapter_candidates[0], classification: "AUTHORITY" }],
      }),
    ).toMatchObject({ ok: false, code: "SEMANTIC_COVERAGE_INPUT_INVALID" });
  });
});
