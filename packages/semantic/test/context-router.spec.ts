import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticLexicalEntry,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  applyContextCapacity,
  compileSemanticContextPackage,
  resolvePublishedLexicon,
  routeSemanticContext,
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
  lexicon?: readonly Record<string, unknown>[];
  maxTokens?: number;
}) {
  const question = input?.question ?? "Gross Revenue by channel";
  return buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
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
    published_lexicon: input?.lexicon,
    knowledge_refs: input?.knowledge ?? [],
    projection_hashes: [hash("6")],
  });
}

describe("resolved context routing", () => {
  it("matches only exact published lexical entries deterministically", async () => {
    const metrics = [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("f"),
      },
      {
        metric_id: "orders_count",
        name: "Order Count",
        aliases: ["Orders"],
        mapping_refs: ["orders.id"],
        mapping_hash: hash("7"),
        formula_hash: hash("e"),
      },
    ];
    const forward = await resolvePublishedLexicon(
      await snapshot({ question: "Show GMV by channel", metrics }),
    );
    expect(forward.matches.map(({ target_id }) => target_id)).toEqual(["gross_revenue"]);
    expect(
      (await resolvePublishedLexicon(await snapshot({ question: "Show gross margins", metrics })))
        .matches,
    ).toEqual([]);
  });

  it.each([
    ["PREFERRED", "成交总额"],
    ["SYNONYM", "交易额"],
    ["ABBREVIATION", "GMV"],
  ] as const)(
    "routes a published %s glossary term with exact evidence",
    async (matchKind, phrase) => {
      const lexical = await buildSemanticLexicalEntry({
        schema_version: "semantic-lexical-entry@1.0.0",
        release_ref: {
          resource_id: id(4),
          resource_revision: 1,
          resource_hash: hash("2"),
        },
        target_kind: "METRIC",
        target_id: "gross_revenue",
        term_id: "term_gmv",
        match_kind: matchKind,
        phrase,
      });
      const authority = await snapshot({
        question: `按渠道查看${phrase}`,
        ontology: [
          {
            object_id: "term_gmv",
            object_kind: "TERM",
            name: "成交总额术语",
            aliases: [],
            queryable: false,
            mapping_refs: [],
            object_hash: hash("9"),
          },
        ],
        lexicon: [lexical],
      });
      const decision = await routeSemanticContext(authority);
      expect(decision).toMatchObject({
        state: "READY",
        route: "METRIC",
        selected_metric_id: "gross_revenue",
        lexical_evidence: [{ evidence_hash: lexical.evidence_hash, match_kind: matchKind }],
        reason_codes: [`LEXICAL_${matchKind}_PUBLISHED_METRIC`],
      });
    },
  );

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
    const decision = await routeSemanticContext(authority);
    expect(decision.state).toBe("NEEDS_CLARIFICATION");
    expect(decision.route).toBe("METRIC");
    expect(decision.reason_codes).toEqual(["AMBIGUOUS_PUBLISHED_LEXICON"]);
    expect(decision.clarification_candidates.map(({ candidate_id }) => candidate_id)).toEqual([
      "gross",
      "net",
    ]);
  });

  it("resolves distinct business concepts together without treating multi-intent as ambiguity", async () => {
    const authority = await snapshot({
      question: "查看收入与客户关系",
      metrics: [
        {
          metric_id: "revenue",
          name: "收入",
          aliases: [],
          mapping_refs: ["orders.amount"],
          mapping_hash: hash("a"),
          formula_hash: hash("b"),
        },
      ],
      ontology: [
        {
          object_id: "customer",
          object_kind: "ENTITY",
          name: "客户",
          aliases: [],
          queryable: true,
          mapping_refs: ["table:customers"],
          object_hash: hash("c"),
        },
      ],
    });
    await expect(routeSemanticContext(authority)).resolves.toMatchObject({
      state: "READY",
      route: "METRIC",
      selected_metric_id: "revenue",
      selected_ontology_ids: ["customer"],
      clarification_candidates: [],
    });
  });

  it("uses an exact published concept as a ready typed-graph seed", async () => {
    const authority = await snapshot({
      question: "经营复盘",
      metrics: [],
      ontology: [
        {
          object_id: "case.business_review",
          object_kind: "ENTITY",
          name: "经营复盘",
          aliases: [],
          queryable: false,
          mapping_refs: [],
          object_hash: hash("c"),
        },
      ],
      relationships: [
        {
          relationship_id: "case_requires_revenue",
          source_object_id: "case.business_review",
          target_object_id: "metric.revenue",
          relationship_kind: "LINEAGE_REQUIREMENT",
          relationship_hash: hash("d"),
        },
      ],
    });
    await expect(routeSemanticContext(authority)).resolves.toMatchObject({
      state: "READY",
      route: "GRAPH",
      selected_ontology_ids: ["case.business_review"],
      reason_codes: ["LEXICAL_CANONICAL_TYPED_GRAPH"],
    });
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
        await routeSemanticContext(
          await snapshot({ question: "Customer details", metrics: [], ontology: [ontology] }),
        )
      ).route,
    ).toBe("ONTOLOGY_TEXT2SQL");
    expect(
      (
        await routeSemanticContext(
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
        await routeSemanticContext(
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

    const packageDocument = await compileSemanticContextPackage(
      await snapshot({ question: "Gross Revenue", maxTokens: 1 }),
    );
    expect(packageDocument.route_decision.state).toBe("REJECTED");
    expect(packageDocument.route_decision.reason_codes).toContain(
      "CONTEXT_CAPACITY_MANDATORY_EXCEEDED",
    );
  });
});
