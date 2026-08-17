import {
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextClarification,
  type ResolvedContextRouteDecision,
  sha256ContentHash,
} from "@data-agent/contracts";
import { contextPhraseOccurs, resolvePublishedMetric } from "./metric-resolver.js";

const capabilityChain = ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"] as const;

export async function routeResolvedContext(
  snapshot: ResolvedContextAuthoritySnapshot,
): Promise<ResolvedContextRouteDecision> {
  const metric = await resolvePublishedMetric(snapshot.question, snapshot.published_metrics);
  if (metric.matches.length > 1) {
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "NEEDS_CLARIFICATION",
      route: "METRIC",
      selected_metric_id: null,
      selected_ontology_ids: [],
      clarification_candidates: [...metric.clarifications],
      capability_chain: [...capabilityChain],
      reason_codes: ["AMBIGUOUS_PUBLISHED_METRIC"],
    };
  }
  if (metric.matches[0]) {
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: metric.matches[0].metric_id,
      selected_ontology_ids: [],
      clarification_candidates: [],
      capability_chain: [...capabilityChain],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    };
  }

  const ontologyMatches = snapshot.published_ontology
    .filter((object) =>
      [object.name, ...object.aliases].some((phrase) =>
        contextPhraseOccurs(snapshot.question, phrase),
      ),
    )
    .sort((left, right) => left.object_id.localeCompare(right.object_id));
  if (ontologyMatches.length > 1) {
    const clarifications: ResolvedContextClarification[] = await Promise.all(
      ontologyMatches.map(async (object) => ({
        candidate_id: object.object_id,
        candidate_kind: "ONTOLOGY" as const,
        label: object.name,
        candidate_hash: await sha256ContentHash(object),
      })),
    );
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "NEEDS_CLARIFICATION",
      route: "ONTOLOGY_TEXT2SQL",
      selected_metric_id: null,
      selected_ontology_ids: [],
      clarification_candidates: clarifications,
      capability_chain: [...capabilityChain],
      reason_codes: ["AMBIGUOUS_PUBLISHED_ONTOLOGY"],
    };
  }
  const ontology = ontologyMatches[0];
  if (ontology?.queryable && ontology.mapping_refs.length > 0) {
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "READY",
      route: "ONTOLOGY_TEXT2SQL",
      selected_metric_id: null,
      selected_ontology_ids: [ontology.object_id],
      clarification_candidates: [],
      capability_chain: [...capabilityChain],
      reason_codes: ["EXACT_QUERYABLE_ONTOLOGY"],
    };
  }
  if (snapshot.knowledge_refs.length > 0) {
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "PARTIAL",
      route: "KNOWLEDGE",
      selected_metric_id: null,
      selected_ontology_ids: ontology ? [ontology.object_id] : [],
      clarification_candidates: [],
      capability_chain: [...capabilityChain],
      reason_codes: ontology
        ? ["KNOWLEDGE_ONLY_CONCEPT", "KNOWLEDGE_RETRIEVAL_DEFERRED"]
        : ["KNOWLEDGE_RETRIEVAL_DEFERRED"],
    };
  }
  if (snapshot.published_relationships.length > 0) {
    return {
      schema_version: "resolved-context-route-decision@1.0.0",
      state: "PARTIAL",
      route: "GRAPH",
      selected_metric_id: null,
      selected_ontology_ids: ontology ? [ontology.object_id] : [],
      clarification_candidates: [],
      capability_chain: [...capabilityChain],
      reason_codes: ["GRAPH_TRAVERSAL_DEFERRED"],
    };
  }
  return {
    schema_version: "resolved-context-route-decision@1.0.0",
    state: "REJECTED",
    route: "NONE",
    selected_metric_id: null,
    selected_ontology_ids: [],
    clarification_candidates: [],
    capability_chain: [...capabilityChain],
    reason_codes: ["NO_GOVERNED_CONTEXT_ROUTE"],
  };
}
