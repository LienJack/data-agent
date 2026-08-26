import {
  buildSemanticContextAuthoritySnapshot,
  buildSemanticContextPackage,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
} from "@data-agent/contracts";
import { buildSemanticContextText2SqlBinding } from "@data-agent/contracts/server";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

export async function authoritativeSemanticContextBindingFixture() {
  const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
  const snapshot = await buildSemanticContextAuthoritySnapshot({
    schema_version: "semantic-context-authority-snapshot@1.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Net Revenue by region",
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
        metric_id: "net_revenue",
        name: "Net Revenue",
        aliases: ["Revenue"],
        mapping_refs: ["orders.net_amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("6"), hash("8")],
  });
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: snapshot.snapshot_hash,
    release_hash: snapshot.semantic_release.resource_hash,
    query_hash: snapshot.question_hash,
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("9"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: ["net_revenue"],
      excluded_objects: [],
    },
    route_states: {
      LEXICON: "READY",
      SPARSE: "READY",
      VECTOR: "UNAVAILABLE",
      GRAPH: "UNAVAILABLE",
    },
    hits: [],
    expansions: [],
    selected_object_ids: ["net_revenue"],
    pruned_object_ids: [],
    fallback_reason_codes: ["VECTOR_ROUTE_NOT_CONFIGURED"],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("a"),
    steps: [],
    mandatory_object_ids: ["net_revenue"],
    mandatory_relationship_ids: [],
    closure_complete: true,
    reason_codes: [],
  });
  const packageDocument = await buildSemanticContextPackage({
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
      state: "READY",
      route: "METRIC",
      selected_metric_id: "net_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
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
          item_kind: "METRIC",
          item_id: "net_revenue",
          item_hash: hash("6"),
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
      object_ids: ["net_revenue"],
      relationship_ids: [],
      closure_hash: hash("b"),
    },
    analysis_capabilities: [],
  });
  return buildSemanticContextText2SqlBinding({ package: packageDocument, snapshot });
}
