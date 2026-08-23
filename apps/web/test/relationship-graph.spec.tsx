import type { SemanticRelationshipSearchResult } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RelationshipGraph } from "../src/components/semantic/explorer/relationship-graph";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

function result(): SemanticRelationshipSearchResult {
  const releaseIdentity = {
    semantic_domain: "revenue",
    release_id: id("01"),
    release_generation: 1,
    release_digest: hash("a"),
    executable_projection: { projection_id: id("02"), projection_digest: hash("b") },
    relationship_projection: { projection_id: id("03"), projection_digest: hash("c") },
    runtime_restriction_projection: {
      projection_id: id("04"),
      projection_digest: hash("d"),
    },
    published_at: "2026-08-09T00:00:00.000Z",
    published_by: id("05"),
  };
  return {
    schema_version: "semantic-relationship-search-result@1.0.0",
    release_identity: releaseIdentity,
    pointer_observation: {
      current_release_id: id("01"),
      current_release_generation: 1,
      current_release_digest: hash("a"),
      pointer_generation: 1,
      observed_at: "2026-08-09T00:01:00.000Z",
    },
    is_active: true,
    source: "POSTGRESQL_FALLBACK",
    index_state: "DISABLED",
    index_reason_code: "INDEX_DISABLED",
    manifest_digest: hash("f"),
    root: null,
    term: null,
    categories: ["GOVERN"],
    nodes: [
      {
        node_type: "governance_object",
        node_key: hash("1"),
        canonical_digest: hash("2"),
        name: "Revenue release",
        governance_kind: "semantic_release",
        governance_id: id("06"),
        release_id: id("01"),
        release_generation: 1,
        digest: hash("a"),
      },
      {
        node_type: "governance_object",
        node_key: hash("3"),
        canonical_digest: hash("4"),
        name: "Relationship projection",
        governance_kind: "relationship_projection",
        governance_id: id("07"),
        release_id: id("01"),
        release_generation: 1,
        digest: hash("c"),
      },
    ],
    edges: [
      {
        edge_key: hash("5"),
        edge_id: "govern:release:relationship_projection",
        category: "GOVERN",
        source_node_key: hash("1"),
        target_node_key: hash("3"),
        canonical_digest: hash("6"),
        label: "GOVERN · binds relationship projection",
        contract: {
          category: "GOVERN",
          governance_relation: "RELEASE_BINDS_PROJECTION",
          projection_kind: "relationship_projection",
        },
      },
    ],
    truncated: false,
    truncation_reasons: [],
    explanation: {
      summary: "Exact release relationship traversal.",
      requested_hop_limit: 2,
      traversed_hops: 1,
      categories: ["GOVERN"],
      authority_revalidated: true,
      fallback_reason: "INDEX_DISABLED",
    },
  };
}

describe("RelationshipGraph", () => {
  it("renders explicit source, directed labels, selection detail and accessible controls", () => {
    const html = renderToStaticMarkup(
      <RelationshipGraph result={result()} onSelectObject={vi.fn()} />,
    );

    expect(html).toContain("PostgreSQL fallback");
    expect(html).toContain("DISABLED · INDEX_DISABLED");
    expect(html).toContain("relationship-arrow-GOVERN");
    expect(html).toContain("GOVERN · binds relationship projection");
    expect(html).toContain("Selection contract");
    expect(html).toContain("Accessible relationship table");
    expect(html).toContain("放大关系图");
    expect(html).toContain("PostgreSQL authority revalidated: yes");
  });
});
