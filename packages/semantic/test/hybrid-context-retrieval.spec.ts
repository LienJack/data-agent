import {
  buildSemanticContextAuthoritySnapshot,
  verifySemanticContextPackage,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { compileSemanticContextPackage } from "../src/context/semantic-context-compiler.js";

const id = (suffix: number) => `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

async function snapshot() {
  return buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
    semantic_domain: "falcon24",
    question: "分析订单收入和客单价下降，并沿公式依赖找到订单量",
    defaults_ref: { defaults_id: id(3), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(4),
      resource_revision: 7,
      resource_hash: hash("2"),
      datasource_id: id(5),
      semantic_generation: 7,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(5),
      semantic_release_id: id(4),
      semantic_generation: 7,
    },
    context_policy: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 16_384,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [
      {
        metric_id: "average_order_value",
        name: "客单价",
        aliases: ["AOV"],
        mapping_refs: ["orders.order_id", "orders.total_amount"],
        mapping_hash: hash("8"),
        formula_hash: hash("9"),
      },
      {
        metric_id: "order_revenue",
        name: "订单收入",
        aliases: ["收入"],
        mapping_refs: ["orders.total_amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [
      {
        object_id: "orders_count",
        object_kind: "EVENT",
        name: "订单量",
        aliases: [],
        queryable: true,
        mapping_refs: ["orders.order_id"],
        object_hash: hash("a"),
      },
    ],
    published_relationships: [
      {
        relationship_id: "aov_formula_order_revenue",
        source_object_id: "average_order_value",
        target_object_id: "order_revenue",
        relationship_kind: "FORMULA_DEPENDENCY",
        relationship_hash: hash("b"),
      },
      {
        relationship_id: "aov_formula_orders_count",
        source_object_id: "average_order_value",
        target_object_id: "orders_count",
        relationship_kind: "FORMULA_DEPENDENCY",
        relationship_hash: hash("c"),
      },
    ],
    knowledge_refs: [{ resource_id: id(9), resource_revision: 1, resource_hash: hash("d") }],
    projection_hashes: [hash("e")],
  });
}

describe("hybrid semantic retrieval", () => {
  it("fuses lexical, sparse and vector routes and closes typed formula lineage", async () => {
    const authority = await snapshot();
    const document = await compileSemanticContextPackage(authority, {
      vector: {
        async search() {
          return [
            { object_id: "average_order_value", score: 0.93 },
            { object_id: id(9), score: 0.82 },
          ];
        },
      },
    });
    expect(document.retrieval_receipt.route_states).toEqual({
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: "READY",
      GRAPH: "READY",
    });
    expect(new Set(document.retrieval_receipt.hits.map(({ route }) => route))).toEqual(
      new Set(["LEXICON", "SPARSE", "VECTOR"]),
    );
    expect(document.mandatory_closure.object_ids).toEqual(
      expect.arrayContaining(["average_order_value", "order_revenue", "orders_count"]),
    );
    expect(document.mandatory_closure.relationship_ids).toEqual([
      "aov_formula_order_revenue",
      "aov_formula_orders_count",
    ]);
    await expect(verifySemanticContextPackage(document)).resolves.toEqual(document);
  });

  it("records vector degradation while keeping deterministic PostgreSQL projections", async () => {
    const authority = await snapshot();
    const first = await compileSemanticContextPackage(authority, {
      vector: {
        async search() {
          throw new Error("index unavailable");
        },
      },
    });
    const second = await compileSemanticContextPackage(authority, {
      vector: {
        async search() {
          throw new Error("index unavailable");
        },
      },
    });
    expect(first.retrieval_receipt.route_states.VECTOR).toBe("DEGRADED");
    expect(first.retrieval_receipt.fallback_reason_codes).toContain(
      "VECTOR_ROUTE_POSTGRES_FALLBACK",
    );
    expect(first.package_hash).toBe(second.package_hash);
  });

  it("fails closed instead of pruning mandatory closure", async () => {
    await expect(
      compileSemanticContextPackage(await snapshot(), { max_nodes: 2, max_edges: 1 }),
    ).rejects.toThrow("SEMANTIC_MANDATORY_CLOSURE_CAPACITY_EXCEEDED");
  });

  it("hard-filters denied objects before every retrieval route", async () => {
    const document = await compileSemanticContextPackage(await snapshot(), {
      excluded_objects: [{ object_id: "order_revenue", reason_code: "RBAC_DENIED" }],
      vector: {
        async search() {
          return [{ object_id: "order_revenue", score: 0.99 }];
        },
      },
    });
    expect(document.retrieval_receipt.hard_filter.excluded_objects).toEqual([
      { object_id: "order_revenue", reason_code: "RBAC_DENIED" },
    ]);
    expect(document.retrieval_receipt.hits).not.toContainEqual(
      expect.objectContaining({ object_id: "order_revenue" }),
    );
    expect(document.mandatory_closure.object_ids).not.toContain("order_revenue");
  });
});
