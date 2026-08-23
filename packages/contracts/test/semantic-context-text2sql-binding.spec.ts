import { describe, expect, it } from "vitest";
import {
  buildSemanticContextText2SqlBinding,
  isAuthoritativeSemanticContextText2SqlBinding,
  verifySemanticContextText2SqlBinding,
} from "../src/artifacts/grounding-materializer.js";
import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticContextPackage,
} from "../src/context/semantic-context-package.js";
import {
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
} from "../src/context/semantic-retrieval.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function authoritySnapshot(options: { readonly ontologyQueryable?: boolean } = {}) {
  return buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Gross Revenue by channel",
    defaults_ref: { defaults_id: id(3), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(4),
      resource_revision: 2,
      resource_hash: hash("2"),
      datasource_id: id(5),
      semantic_generation: 2,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 3,
      resource_hash: hash("3"),
      datasource_id: id(5),
      semantic_release_id: id(4),
      semantic_generation: 2,
    },
    context_policy: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 4096,
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
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["mapping.amount", "mapping.channel"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [
      {
        object_id: "sales_channel",
        object_kind: "DIMENSION",
        name: "Sales Channel",
        aliases: ["Channel"],
        queryable: options.ontologyQueryable ?? true,
        mapping_refs: ["mapping.channel"],
        object_hash: hash("8"),
      },
    ],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("6"), hash("8")],
  });
}

async function contextPackage(
  snapshot: Awaited<ReturnType<typeof authoritySnapshot>>,
  route: "METRIC" | "ONTOLOGY_TEXT2SQL" | "KNOWLEDGE",
) {
  const selectedObjectIds = route === "METRIC" ? ["gross_revenue"] : route === "ONTOLOGY_TEXT2SQL" ? ["sales_channel"] : [];
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: snapshot.snapshot_hash,
    release_hash: snapshot.semantic_release.resource_hash,
    query_hash: snapshot.question_hash,
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("b"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: selectedObjectIds,
      excluded_objects: [],
    },
    route_states: { LEXICON: "READY", SPARSE: "READY", VECTOR: "UNAVAILABLE", GRAPH: "UNAVAILABLE" },
    hits: [],
    expansions: [],
    selected_object_ids: selectedObjectIds,
    pruned_object_ids: [],
    fallback_reason_codes: ["VECTOR_ROUTE_NOT_CONFIGURED"],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("9"),
    steps: [],
    mandatory_object_ids: selectedObjectIds,
    mandatory_relationship_ids: [],
    closure_complete: true,
    reason_codes: [],
  });
  return buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: snapshot.semantic_domain,
    question_hash: snapshot.question_hash,
    defaults_ref: snapshot.defaults_ref,
    semantic_release: snapshot.semantic_release,
    schema_snapshot: snapshot.schema_snapshot,
    context_policy: snapshot.context_policy,
    egress_policy: snapshot.egress_policy,
    provider: snapshot.provider,
    authority_snapshot_hash: snapshot.snapshot_hash,
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: route === "KNOWLEDGE" ? "PARTIAL" : "READY",
      route,
      selected_metric_id: route === "METRIC" ? "gross_revenue" : null,
      selected_ontology_ids: route === "ONTOLOGY_TEXT2SQL" ? ["sales_channel"] : [],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: [route === "METRIC" ? "EXACT_PUBLISHED_METRIC" : "EXACT_QUERYABLE_ONTOLOGY"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 4096,
      max_context_bytes: 4096,
      mandatory_bytes: 64,
      included_bytes: 64,
      cropped_bytes: 0,
      items: [
        {
          item_kind: route === "METRIC" ? "METRIC" : "MAPPING",
          item_id: route === "METRIC" ? "gross_revenue" : "sales_channel",
          item_hash: route === "METRIC" ? hash("6") : hash("8"),
          byte_size: 64,
          priority: 9000,
          mandatory: true,
          disposition: "MANDATORY",
          reason_code: "ROUTE_SELECTED",
        },
      ],
    },
    evidence: [],
    knowledge_refs: [],
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: selectedObjectIds,
      relationship_ids: [],
      closure_hash: hash("a"),
    },
    analysis_capabilities: [],
  });
}

describe("Semantic Context Text2SQL binding", () => {
  it("derives a deterministic exact Metric mapping closure", async () => {
    const snapshot = await authoritySnapshot();
    const packageDocument = await contextPackage(snapshot, "METRIC");
    const first = await buildSemanticContextText2SqlBinding({
      package: packageDocument,
      snapshot,
    });
    const second = await buildSemanticContextText2SqlBinding({
      package: packageDocument,
      snapshot,
    });
    expect(first).toEqual(second);
    expect(isAuthoritativeSemanticContextText2SqlBinding(first)).toBe(true);
    expect(first).toMatchObject({
      route: "METRIC",
      selected_metric_id: "gross_revenue",
      mapping_refs: ["mapping.amount", "mapping.channel"],
      semantic_projection_hashes: [hash("6"), hash("8")],
      semantic_context_package_ref: {
        package_id: packageDocument.package_id,
        package_hash: packageDocument.package_hash,
      },
    });
  });

  it("binds only queryable Ontology mappings", async () => {
    const snapshot = await authoritySnapshot();
    const packageDocument = await contextPackage(snapshot, "ONTOLOGY_TEXT2SQL");
    await expect(
      buildSemanticContextText2SqlBinding({ package: packageDocument, snapshot }),
    ).resolves.toMatchObject({
      route: "ONTOLOGY_TEXT2SQL",
      selected_ontology_ids: ["sales_channel"],
      mapping_refs: ["mapping.channel"],
    });

    const nonQueryable = await authoritySnapshot({ ontologyQueryable: false });
    const nonQueryablePackage = await contextPackage(nonQueryable, "ONTOLOGY_TEXT2SQL");
    await expect(
      buildSemanticContextText2SqlBinding({
        package: nonQueryablePackage,
        snapshot: nonQueryable,
      }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_ONTOLOGY_MAPPING_NOT_QUERYABLE");
  });

  it("rejects non-query routes and cross-snapshot substitution", async () => {
    const snapshot = await authoritySnapshot();
    const knowledgePackage = await contextPackage(snapshot, "KNOWLEDGE");
    await expect(
      buildSemanticContextText2SqlBinding({ package: knowledgePackage, snapshot }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_ROUTE_NOT_QUERYABLE");

    const metricPackage = await contextPackage(snapshot, "METRIC");
    const {
      snapshot_hash: _snapshotHash,
      question_hash: _questionHash,
      ...snapshotBuilderInput
    } = snapshot;
    const otherSnapshot = await buildSemanticContextAuthoritySnapshot({
      ...snapshotBuilderInput,
      question: "Gross Revenue by region",
    });
    await expect(
      buildSemanticContextText2SqlBinding({ package: metricPackage, snapshot: otherSnapshot }),
    ).rejects.toThrow("SEMANTIC_CONTEXT_TEXT2SQL_AUTHORITY_MISMATCH");
  });

  it("rejects a caller-tampered binding hash", async () => {
    const snapshot = await authoritySnapshot();
    const packageDocument = await contextPackage(snapshot, "METRIC");
    const binding = await buildSemanticContextText2SqlBinding({
      package: packageDocument,
      snapshot,
    });
    await expect(
      verifySemanticContextText2SqlBinding(
        { ...binding, mapping_closure_hash: hash("f") },
        { package: packageDocument, snapshot },
      ),
    ).rejects.toThrow("SEMANTIC_CONTEXT_TEXT2SQL_BINDING_MISMATCH");
  });
});
