import type {
  SemanticContextAuthoritySnapshot,
  SemanticContextRouteDecision,
} from "@data-agent/contracts/context";
import { resolvePublishedLexicon } from "./lexical-matcher.js";

const capabilityChain = ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"] as const;

export async function routeSemanticContext(
  snapshot: SemanticContextAuthoritySnapshot,
): Promise<SemanticContextRouteDecision> {
  const lexical = await resolvePublishedLexicon(snapshot);
  if (lexical.matches.length > 1) {
    return {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "NEEDS_CLARIFICATION",
      route: lexical.matches.some((entry) => entry.target_kind === "METRIC")
        ? "METRIC"
        : "ONTOLOGY_TEXT2SQL",
      selected_metric_id: null,
      selected_ontology_ids: [],
      clarification_candidates: [...lexical.clarifications],
      lexical_evidence: [...lexical.matches],
      capability_chain: [...capabilityChain],
      reason_codes: ["AMBIGUOUS_PUBLISHED_LEXICON"],
    };
  }
  const selected = lexical.matches[0];
  if (selected?.target_kind === "METRIC") {
    return {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: selected.target_id,
      selected_ontology_ids: [],
      clarification_candidates: [],
      lexical_evidence: [selected],
      capability_chain: [...capabilityChain],
      reason_codes: [`LEXICAL_${selected.match_kind}_PUBLISHED_METRIC`],
    };
  }
  const ontology =
    selected?.target_kind === "ONTOLOGY"
      ? snapshot.published_ontology.find((object) => object.object_id === selected.target_id)
      : undefined;
  if (ontology?.queryable && ontology.mapping_refs.length > 0) {
    return {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "ONTOLOGY_TEXT2SQL",
      selected_metric_id: null,
      selected_ontology_ids: [ontology.object_id],
      clarification_candidates: [],
      lexical_evidence: selected ? [selected] : [],
      capability_chain: [...capabilityChain],
      reason_codes: [`LEXICAL_${selected?.match_kind ?? "CANONICAL"}_QUERYABLE_ONTOLOGY`],
    };
  }
  if (snapshot.knowledge_refs.length > 0) {
    return {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "PARTIAL",
      route: "KNOWLEDGE",
      selected_metric_id: null,
      selected_ontology_ids: ontology ? [ontology.object_id] : [],
      clarification_candidates: [],
      lexical_evidence: selected ? [selected] : [],
      capability_chain: [...capabilityChain],
      reason_codes: ontology
        ? ["KNOWLEDGE_ONLY_CONCEPT", "KNOWLEDGE_RETRIEVAL_DEFERRED"]
        : ["KNOWLEDGE_RETRIEVAL_DEFERRED"],
    };
  }
  if (snapshot.published_relationships.length > 0) {
    return {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "PARTIAL",
      route: "GRAPH",
      selected_metric_id: null,
      selected_ontology_ids: ontology ? [ontology.object_id] : [],
      clarification_candidates: [],
      lexical_evidence: selected ? [selected] : [],
      capability_chain: [...capabilityChain],
      reason_codes: ["GRAPH_TRAVERSAL_DEFERRED"],
    };
  }
  return {
    schema_version: "semantic-context-route-decision@1.0.0",
    state: "REJECTED",
    route: "NONE",
    selected_metric_id: null,
    selected_ontology_ids: [],
    clarification_candidates: [],
    lexical_evidence: selected ? [selected] : [],
    capability_chain: [...capabilityChain],
    reason_codes: ["NO_GOVERNED_CONTEXT_ROUTE"],
  };
}
