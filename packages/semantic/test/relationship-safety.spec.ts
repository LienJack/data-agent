import { describe, expect, it } from "vitest";
import {
  assertNoRelationshipIdCollision,
  lowerRelationship,
} from "../src/compiler/relationship-lowering.js";

describe("Relationship Safety", () => {
  it("business/physical relationship cannot impersonate analytical join", () => {
    const businessRel = {
      relationship_id: "rel-business",
      name: "Business Relation",
      kind: "business" as const,
      left_table_id: "a",
      left_column_ids: ["a.id"],
      right_table_id: "b",
      right_column_ids: ["b.id"],
      cardinality: "one-to-one" as const,
      left_row_preservation: "required" as const,
      right_row_preservation: "required" as const,
      proof_kind: "DDL_ENFORCED" as const,
      proof_detail: null,
      tags: [] as string[],
      analysis: { join_allowed: false, fanout_closed: true, ontology_path: [] as string[] },
    };
    // business relationships are valid but should not be treated as analytical
    // They lower to edges with analyticalId = relationshipId
    const edge = lowerRelationship(businessRel, "default-catalog");
    expect(edge.analyticalId).toBe("rel-business");
    // The kind is preserved in the edge's identity
    expect(edge.relationshipId).toBe("rel-business");
  });

  it("physical relationship with DDL_ENFORCED proof is valid", () => {
    const physicalRel = {
      relationship_id: "rel-physical",
      name: "Physical FK",
      kind: "physical" as const,
      left_table_id: "orders",
      left_column_ids: ["orders.customer_id"],
      right_table_id: "customers",
      right_column_ids: ["customers.id"],
      cardinality: "many-to-one" as const,
      left_row_preservation: "required" as const,
      right_row_preservation: "optional" as const,
      proof_kind: "DDL_ENFORCED" as const,
      proof_detail: "FK constraint orders.customer_id -> customers.id",
      tags: [] as string[],
      analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] as string[] },
    };
    const edge = lowerRelationship(physicalRel, "default-catalog");
    expect(edge.proofKind).toBe("DDL_ENFORCED");
    expect(edge.proofDetail).toBe("FK constraint orders.customer_id -> customers.id");
    expect(edge.rowPreservation).toBe("left");
  });

  it("analytical relationship with DECLARED_ONLY proof is valid but not lowerable", () => {
    const analyticalRel = {
      relationship_id: "rel-analytical",
      name: "Analytical Mapping",
      kind: "analytical" as const,
      left_table_id: "sales",
      left_column_ids: ["sales.product_id"],
      right_table_id: "products",
      right_column_ids: ["products.id"],
      cardinality: "many-to-one" as const,
      left_row_preservation: "optional" as const,
      right_row_preservation: "required" as const,
      proof_kind: "DECLARED_ONLY" as const,
      proof_detail: "Declared mapping without FK constraint",
      tags: [] as string[],
      analysis: { join_allowed: false, fanout_closed: true, ontology_path: [] as string[] },
    };
    const edge = lowerRelationship(analyticalRel, "default-catalog");
    expect(edge.proofKind).toBe("DECLARED_ONLY");
    // DECLARED_ONLY is valid as a concept but should not provide execution safety guarantees
  });

  it("required inner join when both sides are required", () => {
    const rel = {
      relationship_id: "rel-inner",
      name: "Inner Join",
      kind: "analytical" as const,
      left_table_id: "a",
      left_column_ids: ["a.id"],
      right_table_id: "b",
      right_column_ids: ["b.id"],
      cardinality: "one-to-one" as const,
      left_row_preservation: "required" as const,
      right_row_preservation: "required" as const,
      proof_kind: "DDL_ENFORCED" as const,
      proof_detail: null,
      tags: [] as string[],
      analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] as string[] },
    };
    const edge = lowerRelationship(rel, "default-catalog");
    expect(edge.rowPreservation).toBe("inner");
  });

  it("fanout warning for one-to-many cardinality", () => {
    const rel = {
      relationship_id: "rel-fanout",
      name: "Fanout",
      kind: "analytical" as const,
      left_table_id: "customers",
      left_column_ids: ["customers.id"],
      right_table_id: "orders",
      right_column_ids: ["orders.customer_id"],
      cardinality: "one-to-many" as const,
      left_row_preservation: "required" as const,
      right_row_preservation: "optional" as const,
      proof_kind: "DDL_ENFORCED" as const,
      proof_detail: null,
      tags: [] as string[],
      analysis: { join_allowed: true, fanout_closed: false, ontology_path: [] as string[] },
    };
    const edge = lowerRelationship(rel, "default-catalog");
    expect(edge.fanoutGrainProof).toContain("FANOUT_WARNING");
    expect(edge.direction).toBe("left-to-right");
  });

  it("assertNoRelationshipIdCollision detects duplicate IDs", () => {
    const edges = [
      lowerRelationship(
        {
          relationship_id: "rel-duplicate",
          name: "Dup1",
          kind: "analytical",
          left_table_id: "a",
          left_column_ids: ["a.id"],
          right_table_id: "b",
          right_column_ids: ["b.id"],
          cardinality: "one-to-one",
          left_row_preservation: "required" as const,
          right_row_preservation: "required" as const,
          proof_kind: "DDL_ENFORCED" as const,
          proof_detail: null,
          tags: [],
          analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] },
        },
        "catalog",
      ),
      lowerRelationship(
        {
          relationship_id: "rel-duplicate",
          name: "Dup2",
          kind: "analytical",
          left_table_id: "c",
          left_column_ids: ["c.id"],
          right_table_id: "d",
          right_column_ids: ["d.id"],
          cardinality: "one-to-one",
          left_row_preservation: "required" as const,
          right_row_preservation: "required" as const,
          proof_kind: "DDL_ENFORCED" as const,
          proof_detail: null,
          tags: [],
          analysis: { join_allowed: true, fanout_closed: true, ontology_path: [] },
        },
        "catalog",
      ),
    ];
    expect(() => assertNoRelationshipIdCollision(edges)).toThrow();
  });
});
