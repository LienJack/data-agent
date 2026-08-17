import { buildResolvedContextAuthoritySnapshot } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  applyContextCapacity,
  resolveContextPackage,
  resolvePublishedMetric,
  routeResolvedContext,
} from "../src/context/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "development" } as const;

async function snapshot(input?: {
  question?: string;
  metrics?: readonly Record<string, unknown>[];
  ontology?: readonly Record<string, unknown>[];
  relationships?: readonly Record<string, unknown>[];
  knowledge?: readonly Record<string, unknown>[];
  maxTokens?: number;
}) {
  const question = input?.question ?? "Gross Revenue by channel";
  return buildResolvedContextAuthoritySnapshot({
    schema_version: "resolved-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question,
    defaults_ref: { defaults_id: id(3), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(4),
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: id(5),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(5),
      semantic_release_id: id(4),
      semantic_generation: 1,
    },
    context_policy: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: input?.maxTokens ?? 4_096,
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
    published_metrics: input?.metrics ?? [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("f"),
      },
    ],
    published_ontology: input?.ontology ?? [],
    published_relationships: input?.relationships ?? [],
    knowledge_refs: input?.knowledge ?? [],
    projection_hashes: [hash("6")],
  });
}

describe("resolved context routing", () => {
  it("matches only exact published metric name or alias and is order independent", async () => {
    const metrics = [
      {
        metric_id: "orders_count",
        name: "Order Count",
        aliases: ["Orders"],
        mapping_refs: ["orders.id"],
        mapping_hash: hash("7"),
        formula_hash: hash("e"),
      },
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("f"),
      },
    ];
    const forward = await resolvePublishedMetric("Show GMV by channel", metrics);
    const reverse = await resolvePublishedMetric("Show GMV by channel", [...metrics].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.matches.map(({ metric_id }) => metric_id)).toEqual(["gross_revenue"]);
    expect((await resolvePublishedMetric("Show gross margins", metrics)).matches).toEqual([]);
  });

  it("returns clarification for ambiguous published aliases", async () => {
    const shared = {
      aliases: ["Revenue"],
      mapping_refs: ["orders.amount"],
      formula_hash: hash("f"),
    } as const;
    const authority = await snapshot({
      question: "Revenue by channel",
      metrics: [
        { ...shared, metric_id: "gross", name: "Gross Revenue", mapping_hash: hash("a") },
        { ...shared, metric_id: "net", name: "Net Revenue", mapping_hash: hash("b") },
      ],
    });
    const decision = await routeResolvedContext(authority);
    expect(decision.state).toBe("NEEDS_CLARIFICATION");
    expect(decision.route).toBe("METRIC");
    expect(decision.clarification_candidates.map(({ candidate_id }) => candidate_id)).toEqual([
      "gross",
      "net",
    ]);
  });

  it("falls through ontology, knowledge and graph in fixed order", async () => {
    const ontology = {
      object_id: "customer",
      object_kind: "ENTITY" as const,
      name: "Customer",
      aliases: ["Buyer"],
      queryable: true,
      mapping_refs: ["table:customers"],
      object_hash: hash("c"),
    };
    expect(
      (
        await routeResolvedContext(
          await snapshot({ question: "Customer details", metrics: [], ontology: [ontology] }),
        )
      ).route,
    ).toBe("ONTOLOGY_TEXT2SQL");
    expect(
      (
        await routeResolvedContext(
          await snapshot({
            question: "Unknown policy",
            metrics: [],
            knowledge: [{ resource_id: id(20), resource_revision: 1, resource_hash: hash("d") }],
          }),
        )
      ).route,
    ).toBe("KNOWLEDGE");
    expect(
      (
        await routeResolvedContext(
          await snapshot({
            question: "Unknown relationship",
            metrics: [],
            relationships: [
              {
                relationship_id: "customer_orders",
                source_object_id: "customer",
                target_object_id: "order",
                relationship_kind: "owns",
                relationship_hash: hash("e"),
              },
            ],
          }),
        )
      ).route,
    ).toBe("GRAPH");
  });

  it("applies deterministic mandatory-first capacity without embedding cropped evidence", async () => {
    const candidates = [
      {
        item_kind: "AUTHORITY" as const,
        item_id: "authority",
        item_hash: hash("1"),
        priority: 10_000,
        mandatory: true,
        evidence: null,
      },
      {
        item_kind: "GRAPH" as const,
        item_id: "optional-b",
        item_hash: hash("2"),
        priority: 100,
        mandatory: false,
        evidence: {
          evidence_kind: "GRAPH" as const,
          evidence_id: "optional-b",
          evidence_hash: hash("2"),
          summary: "B".repeat(200),
          source_ref: null,
        },
      },
      {
        item_kind: "ONTOLOGY" as const,
        item_id: "optional-a",
        item_hash: hash("3"),
        priority: 200,
        mandatory: false,
        evidence: {
          evidence_kind: "ONTOLOGY" as const,
          evidence_id: "optional-a",
          evidence_hash: hash("3"),
          summary: "A",
          source_ref: null,
        },
      },
    ];
    const forward = applyContextCapacity({ max_context_tokens: 400, candidates });
    const reverse = applyContextCapacity({
      max_context_tokens: 400,
      candidates: [...candidates].reverse(),
    });
    expect(forward).toEqual(reverse);
    expect(forward.plan.items[0]?.disposition).toBe("MANDATORY");
    expect(forward.included_evidence.map(({ evidence_id }) => evidence_id)).toEqual(["optional-a"]);

    const packageDocument = await resolveContextPackage(
      await snapshot({ question: "Gross Revenue", maxTokens: 1 }),
    );
    expect(packageDocument.route_decision.state).toBe("REJECTED");
    expect(packageDocument.route_decision.reason_codes).toContain(
      "CONTEXT_CAPACITY_MANDATORY_EXCEEDED",
    );
  });
});
